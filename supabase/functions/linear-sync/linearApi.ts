const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
// Explicitly bound both connections; avoid multiplying nested default page sizes.
export const LINEAR_PAGE_SIZE = 50;
export const LINEAR_MAX_PAGES = 20;

export const LINEAR_SYNC_QUERY = `query WorkTimeLinearSync(
    $first: Int!, $issuesAfter: String, $statesAfter: String,
    $issueFilter: IssueFilter!, $stateFilter: WorkflowStateFilter!, $teamFilter: TeamFilter!,
    $fetchIssues: Boolean!, $fetchStates: Boolean!, $checkTeam: Boolean!
) {
    issues(first: $first, after: $issuesAfter, filter: $issueFilter, includeArchived: false)
        @include(if: $fetchIssues) {
        nodes { id identifier title description url dueDate priority state { name } }
        pageInfo { hasNextPage endCursor }
    }
    states: workflowStates(first: $first, after: $statesAfter, filter: $stateFilter, includeArchived: false)
        @include(if: $fetchStates) {
        nodes { name }
        pageInfo { hasNextPage endCursor }
    }
    matchingTeams: teams(first: 1, filter: $teamFilter, includeArchived: false)
        @include(if: $checkTeam) {
        nodes { id }
    }
}`;

export interface LinearSyncSettings { token: string; teamKey: string | null; }
export interface LinearIssuePayload {
    id: string;
    identifier: string;
    title: string;
    description: string;
    url: string;
    dueDate: string | null;
    priority: number;
    state: { name: string };
}
export interface LinearSyncResult { issues: LinearIssuePayload[]; states: string[]; truncated: boolean; }
export type LinearErrorCode = "LINEAR_TOKEN_INVALID" | "LINEAR_RATE_LIMITED" | "LINEAR_TEAM_NOT_FOUND"
    | "LINEAR_INVALID_RESPONSE" | "LINEAR_UPSTREAM_ERROR";

export class LinearApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: LinearErrorCode,
        readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "LinearApiError";
    }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function invalidResponse(message = "Linear returned an invalid response"): LinearApiError {
    return new LinearApiError(message, 502, "LINEAR_INVALID_RESPONSE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw invalidResponse();
    return value;
}

function nullableString(value: unknown): string | null {
    if (value === null || typeof value === "string") return value;
    throw invalidResponse();
}

function retryAfterSeconds(response: Response): number | undefined {
    const value = response.headers.get("Retry-After")?.trim();
    if (!value) return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function linearJson(variables: Record<string, unknown>, token: string, fetcher: Fetcher): Promise<Record<string, unknown>> {
    let response: Response;
    try {
        response = await fetcher(LINEAR_ENDPOINT, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify({ query: LINEAR_SYNC_QUERY, variables }),
            redirect: "error",
        });
    } catch {
        throw new LinearApiError("Linear is unavailable", 502, "LINEAR_UPSTREAM_ERROR");
    }
    if (response.url && response.url !== LINEAR_ENDPOINT) throw invalidResponse("Linear returned an unexpected endpoint");
    if (response.status === 401) {
        throw new LinearApiError("Linear personal API key is invalid or revoked", 401, "LINEAR_TOKEN_INVALID");
    }
    if (response.status === 429) {
        throw new LinearApiError("Linear rate limit reached", 429, "LINEAR_RATE_LIMITED", retryAfterSeconds(response));
    }

    let value: unknown;
    try {
        value = await response.json();
    } catch {
        if (!response.ok) throw new LinearApiError("Linear request failed", 502, "LINEAR_UPSTREAM_ERROR");
        throw invalidResponse();
    }
    if (isRecord(value) && value.errors !== undefined) {
        if (!Array.isArray(value.errors)) throw invalidResponse();
        if (value.errors.length > 0) {
            const codes = value.errors.map((error) => isRecord(error) && isRecord(error.extensions) ? error.extensions.code : null);
            if (codes.includes("RATELIMITED")) {
                throw new LinearApiError("Linear rate limit reached", 429, "LINEAR_RATE_LIMITED", retryAfterSeconds(response));
            }
            if (codes.includes("UNAUTHENTICATED") || codes.includes("AUTHENTICATION_ERROR")) {
                throw new LinearApiError("Linear personal API key is invalid or revoked", 401, "LINEAR_TOKEN_INVALID");
            }
            // Never expose upstream messages or accept partial GraphQL data.
            throw new LinearApiError("Linear could not complete the query", 502, "LINEAR_UPSTREAM_ERROR");
        }
    }
    if (!response.ok) throw new LinearApiError("Linear request failed", 502, "LINEAR_UPSTREAM_ERROR");
    if (!isRecord(value) || !isRecord(value.data)) throw invalidResponse();
    return value.data;
}

function connection(value: unknown, visited: Set<string>): { nodes: unknown[]; next: string | null } {
    if (!isRecord(value) || !Array.isArray(value.nodes) || value.nodes.length > LINEAR_PAGE_SIZE || !isRecord(value.pageInfo)) {
        throw invalidResponse();
    }
    const { hasNextPage, endCursor } = value.pageInfo;
    if (typeof hasNextPage !== "boolean" || (endCursor !== null && typeof endCursor !== "string")) throw invalidResponse();
    if (!hasNextPage) return { nodes: value.nodes, next: null };
    if (typeof endCursor !== "string" || !endCursor.trim() || visited.has(endCursor)
        || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\\\\)/i.test(endCursor)) {
        throw invalidResponse("Linear returned an invalid pagination cursor");
    }
    visited.add(endCursor);
    return { nodes: value.nodes, next: endCursor };
}

function mapIssue(value: unknown): LinearIssuePayload {
    if (!isRecord(value) || !isRecord(value.state)
        || typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > 4) {
        throw invalidResponse();
    }
    return {
        id: requiredString(value.id),
        identifier: requiredString(value.identifier),
        title: requiredString(value.title),
        description: nullableString(value.description) ?? "",
        url: requiredString(value.url),
        dueDate: nullableString(value.dueDate),
        priority: value.priority,
        state: { name: requiredString(value.state.name) },
    };
}

export async function fetchLinearIssues(settings: LinearSyncSettings, fetcher: Fetcher = fetch): Promise<LinearSyncResult> {
    const token = settings.token.trim();
    if (!token || /^Bearer\s/i.test(token)) {
        throw new LinearApiError("Paste the Linear personal API key without the Bearer prefix", 401, "LINEAR_TOKEN_INVALID");
    }
    const teamKey = settings.teamKey?.trim() || null;
    const teamFilter = teamKey ? { key: { eqIgnoreCase: teamKey } } : {};
    const issueFilter = { assignee: { isMe: { eq: true } }, ...(teamKey ? { team: teamFilter } : {}) };
    const stateFilter = teamKey ? { team: teamFilter } : {};
    const issues = new Map<string, LinearIssuePayload>();
    const states = new Set<string>();
    const issueCursors = new Set<string>();
    const stateCursors = new Set<string>();
    let issuesAfter: string | null = null;
    let statesAfter: string | null = null;
    let fetchIssues = true;
    let fetchStates = true;

    for (let page = 0; page < LINEAR_MAX_PAGES; page += 1) {
        const checkTeam = page === 0 && teamKey !== null;
        const data = await linearJson({
            first: LINEAR_PAGE_SIZE, issuesAfter, statesAfter, issueFilter, stateFilter, teamFilter,
            fetchIssues, fetchStates, checkTeam,
        }, token, fetcher);
        if (checkTeam) {
            if (!isRecord(data.matchingTeams) || !Array.isArray(data.matchingTeams.nodes)) throw invalidResponse();
            if (data.matchingTeams.nodes.length === 0) {
                throw new LinearApiError("Linear team key was not found or is not accessible", 404, "LINEAR_TEAM_NOT_FOUND");
            }
            for (const team of data.matchingTeams.nodes) {
                if (!isRecord(team)) throw invalidResponse();
                requiredString(team.id);
            }
        }
        if (fetchIssues) {
            const result = connection(data.issues, issueCursors);
            for (const node of result.nodes) {
                const issue = mapIssue(node);
                if (!issues.has(issue.id)) issues.set(issue.id, issue);
                states.add(issue.state.name);
            }
            issuesAfter = result.next;
            fetchIssues = result.next !== null;
        }
        if (fetchStates) {
            const result = connection(data.states, stateCursors);
            for (const state of result.nodes) {
                if (!isRecord(state)) throw invalidResponse();
                states.add(requiredString(state.name));
            }
            statesAfter = result.next;
            fetchStates = result.next !== null;
        }
        if (!fetchIssues && !fetchStates) break;
    }
    return { issues: [...issues.values()], states: [...states].sort(), truncated: fetchIssues || fetchStates };
}
