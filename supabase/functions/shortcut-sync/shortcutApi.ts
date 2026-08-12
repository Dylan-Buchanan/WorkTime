const SHORTCUT_API_ORIGIN = "https://api.app.shortcut.com";
const SEARCH_PATH = "/api/v3/search/stories";
const PAGE_SIZE = 250;
const MAX_PAGES = 4;

export interface ShortcutSyncSettings { token: string; teamName: string; }
export interface ShortcutLabel { id: number; name: string; }
export interface ShortcutStoryPayload {
    id: number;
    app_url: string;
    name: string;
    description: string;
    estimate: number | null;
    deadline: string | null;
    workflow_state_id: number;
    status_name: string;
    completed: boolean;
    archived: boolean;
    story_type: "feature" | "bug" | "chore";
    labels: ShortcutLabel[];
}

export type ShortcutErrorCode = "SHORTCUT_TOKEN_INVALID" | "SHORTCUT_RATE_LIMITED" | "SHORTCUT_UPSTREAM_ERROR" | "SHORTCUT_INVALID_RESPONSE";

export class ShortcutApiError extends Error {
    readonly status: number;
    readonly code: ShortcutErrorCode;
    readonly retryAfterSeconds?: number;

    constructor(message: string, status: number, code: ShortcutErrorCode, retryAfterSeconds?: number) {
        super(message);
        this.name = "ShortcutApiError";
        this.status = status;
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function invalidResponse(message = "Shortcut returned an invalid response"): ShortcutApiError {
    return new ShortcutApiError(message, 502, "SHORTCUT_INVALID_RESPONSE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryAfterSeconds(response: Response): number | undefined {
    const value = response.headers.get("Retry-After");
    if (!value) return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

async function shortcutJson(url: URL, token: string, fetcher: Fetcher): Promise<unknown> {
    let response: Response;
    try {
        response = await fetcher(url, { method: "GET", headers: { Accept: "application/json", "Shortcut-Token": token } });
    } catch {
        throw new ShortcutApiError("Shortcut is unavailable", 502, "SHORTCUT_UPSTREAM_ERROR");
    }
    if (response.status === 401) throw new ShortcutApiError("Shortcut token is invalid or revoked", 401, "SHORTCUT_TOKEN_INVALID");
    if (response.status === 429) {
        throw new ShortcutApiError("Shortcut rate limit reached", 429, "SHORTCUT_RATE_LIMITED", retryAfterSeconds(response));
    }
    if (!response.ok) throw new ShortcutApiError("Shortcut request failed", 502, "SHORTCUT_UPSTREAM_ERROR");
    try {
        return await response.json();
    } catch {
        throw invalidResponse();
    }
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== "string") throw invalidResponse();
    return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw invalidResponse();
    return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
    const value = record[key];
    if (typeof value !== "boolean") throw invalidResponse();
    return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw invalidResponse();
    return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | null {
    const value = record[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) throw invalidResponse();
    return value;
}

function storyType(record: Record<string, unknown>): "feature" | "bug" | "chore" {
    const value = record.story_type;
    if (value === "feature" || value === "bug" || value === "chore") return value;
    throw invalidResponse();
}

function labels(record: Record<string, unknown>): ShortcutLabel[] {
    if (!Array.isArray(record.labels)) throw invalidResponse();
    return record.labels.map((label) => {
        if (!isRecord(label)) throw invalidResponse();
        return { id: requiredNumber(label, "id"), name: requiredString(label, "name") };
    });
}

function mapStory(value: unknown, stateNames: Map<number, string>): ShortcutStoryPayload {
    if (!isRecord(value)) throw invalidResponse();
    const workflowStateId = requiredNumber(value, "workflow_state_id");
    return {
        id: requiredNumber(value, "id"),
        app_url: requiredString(value, "app_url"),
        name: requiredString(value, "name"),
        description: optionalString(value, "description") ?? "",
        estimate: optionalNumber(value, "estimate"),
        deadline: optionalString(value, "deadline"),
        workflow_state_id: workflowStateId,
        status_name: stateNames.get(workflowStateId) ?? "Unknown",
        completed: requiredBoolean(value, "completed"),
        archived: requiredBoolean(value, "archived"),
        story_type: storyType(value),
        labels: labels(value),
    };
}

function quotedSearchValue(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function searchUrl(teamName: string, mentionName: string): URL {
    const url = new URL(SEARCH_PATH, SHORTCUT_API_ORIGIN);
    url.searchParams.set("query", `team:${quotedSearchValue(teamName)} owner:${mentionName}`);
    url.searchParams.set("page_size", String(PAGE_SIZE));
    // Full search detail retains description; the function maps it down to a slim response.
    url.searchParams.set("detail", "full");
    return url;
}

function nextSearchUrl(next: unknown, visited: Set<string>): URL | null {
    if (next === null || next === undefined || next === "") return null;
    if (typeof next !== "string") throw invalidResponse("Shortcut returned an invalid pagination cursor");
    const url = new URL(next, SHORTCUT_API_ORIGIN);
    if (url.origin !== SHORTCUT_API_ORIGIN || url.pathname !== SEARCH_PATH || visited.has(url.href)) {
        throw invalidResponse("Shortcut returned an invalid pagination cursor");
    }
    return url;
}

function workflowStateNames(value: unknown): Map<number, string> {
    if (!Array.isArray(value)) throw invalidResponse();
    const result = new Map<number, string>();
    for (const workflow of value) {
        if (!isRecord(workflow) || !Array.isArray(workflow.states)) throw invalidResponse();
        for (const state of workflow.states) {
            if (!isRecord(state)) throw invalidResponse();
            result.set(requiredNumber(state, "id"), requiredString(state, "name"));
        }
    }
    return result;
}

export async function fetchShortcutStories(settings: ShortcutSyncSettings, fetcher: Fetcher = fetch): Promise<ShortcutStoryPayload[]> {
    const memberValue = await shortcutJson(new URL("/api/v3/member", SHORTCUT_API_ORIGIN), settings.token, fetcher);
    if (!isRecord(memberValue)) throw invalidResponse();
    const mentionName = requiredString(memberValue, "mention_name");
    if (!/^[A-Za-z0-9._-]+$/.test(mentionName)) throw invalidResponse("Shortcut returned an invalid member");

    const workflows = await shortcutJson(new URL("/api/v3/workflows", SHORTCUT_API_ORIGIN), settings.token, fetcher);
    const stateNames = workflowStateNames(workflows);
    const stories: ShortcutStoryPayload[] = [];
    const visited = new Set<string>();
    let url: URL | null = searchUrl(settings.teamName, mentionName);

    for (let page = 0; page < MAX_PAGES && url; page += 1) {
        visited.add(url.href);
        const searchValue = await shortcutJson(url, settings.token, fetcher);
        if (!isRecord(searchValue) || !Array.isArray(searchValue.data)) throw invalidResponse();
        stories.push(...searchValue.data.map((story) => mapStory(story, stateNames)));
        url = page === MAX_PAGES - 1 ? null : nextSearchUrl(searchValue.next, visited);
    }
    return stories;
}
