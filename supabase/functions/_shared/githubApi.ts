const GITHUB_API_ORIGIN = "https://api.github.com";
const PAGE_SIZE = 100;
export const GITHUB_MAX_PAGES = 4;

export interface GitHubRepositorySummary {
    fullName: string;
}

export interface GitHubLabel {
    name: string;
    color: string;
    description: string | null;
}

export type GitHubErrorCode =
    | "GITHUB_TOKEN_INVALID"
    | "GITHUB_RATE_LIMITED"
    | "GITHUB_REPO_NOT_FOUND"
    | "GITHUB_UPSTREAM_ERROR"
    | "GITHUB_INVALID_RESPONSE";

export class GitHubApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: GitHubErrorCode,
        readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "GitHubApiError";
    }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function invalidResponse(): GitHubApiError {
    return new GitHubApiError("GitHub returned an invalid response", 502, "GITHUB_INVALID_RESPONSE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== "string") throw invalidResponse();
    return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw invalidResponse();
    return value;
}

function retryAfterSeconds(response: Response): number | undefined {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
        const numeric = Number(retryAfter);
        if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    }

    const resetHeader = response.headers.get("X-RateLimit-Reset");
    const resetAt = resetHeader === null ? Number.NaN : Number(resetHeader);
    if (Number.isFinite(resetAt) && resetAt >= 0) {
        return Math.max(0, Math.ceil(resetAt - Date.now() / 1000));
    }
    return undefined;
}

function isRateLimited(response: Response): boolean {
    return response.status === 429
        || (response.status === 403 && (
            response.headers.get("X-RateLimit-Remaining") === "0"
            || response.headers.has("Retry-After")
        ));
}

async function githubJson(url: URL, token: string, fetcher: Fetcher): Promise<unknown> {
    let response: Response;
    try {
        response = await fetcher(url, {
            method: "GET",
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });
    } catch {
        throw new GitHubApiError("GitHub is unavailable", 502, "GITHUB_UPSTREAM_ERROR");
    }

    if (isRateLimited(response)) {
        throw new GitHubApiError(
            "GitHub rate limit reached",
            429,
            "GITHUB_RATE_LIMITED",
            retryAfterSeconds(response),
        );
    }
    if (response.status === 401 || response.status === 403) {
        throw new GitHubApiError("GitHub token is invalid or revoked", 401, "GITHUB_TOKEN_INVALID");
    }
    if (response.status === 404) {
        throw new GitHubApiError("GitHub repository is no longer accessible", 404, "GITHUB_REPO_NOT_FOUND");
    }
    if (!response.ok) {
        throw new GitHubApiError("GitHub request failed", 502, "GITHUB_UPSTREAM_ERROR");
    }

    try {
        return await response.json();
    } catch {
        throw invalidResponse();
    }
}

function repository(value: unknown): GitHubRepositorySummary {
    if (!isRecord(value)) throw invalidResponse();
    const fullName = requiredString(value, "full_name");
    if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) throw invalidResponse();
    return { fullName };
}

function label(value: unknown): GitHubLabel {
    if (!isRecord(value)) throw invalidResponse();
    const name = requiredString(value, "name");
    const color = requiredString(value, "color");
    if (!name.trim() || !/^[0-9a-fA-F]{6}$/.test(color)) throw invalidResponse();
    return { name, color: color.toLowerCase(), description: optionalString(value, "description") };
}

function pagedUrl(path: string, page: number): URL {
    const url = new URL(path, GITHUB_API_ORIGIN);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    return url;
}

async function fetchPages<T>(
    path: string,
    token: string,
    mapValue: (value: unknown) => T,
    fetcher: Fetcher,
    configure?: (url: URL) => void,
): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
        const url = pagedUrl(path, page);
        configure?.(url);
        const value = await githubJson(url, token, fetcher);
        if (!Array.isArray(value)) throw invalidResponse();
        result.push(...value.map(mapValue));
        if (value.length < PAGE_SIZE) break;
    }
    return result;
}

export async function fetchGitHubRepositories(
    token: string,
    fetcher: Fetcher = fetch,
): Promise<GitHubRepositorySummary[]> {
    return fetchPages("/user/repos", token, repository, fetcher, (url) => {
        url.searchParams.set("affiliation", "owner,collaborator,organization_member");
        url.searchParams.set("sort", "full_name");
        url.searchParams.set("direction", "asc");
    });
}

export async function fetchGitHubLabels(
    token: string,
    fullName: string,
    fetcher: Fetcher = fetch,
): Promise<GitHubLabel[]> {
    const parts = fullName.split("/");
    if (parts.length !== 2 || parts.some((part) => !part || /\s/.test(part))) throw invalidResponse();
    const path = `/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/labels`;
    return fetchPages(path, token, label, fetcher);
}
