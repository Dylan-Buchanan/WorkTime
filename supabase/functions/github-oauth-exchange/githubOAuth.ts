export const GITHUB_OAUTH_SCOPE = "repo";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

export type GitHubOAuthErrorCode =
    | "INVALID_REQUEST"
    | "GITHUB_NOT_CONFIGURED"
    | "GITHUB_CODE_INVALID"
    | "GITHUB_EXCHANGE_UNAVAILABLE"
    | "GITHUB_UPSTREAM_ERROR"
    | "GITHUB_INVALID_RESPONSE"
    | "GITHUB_TOKEN_INVALID";

export class GitHubOAuthError extends Error {
    constructor(
        readonly code: GitHubOAuthErrorCode,
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "GitHubOAuthError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

function required(value: string, code: GitHubOAuthErrorCode, status: number, message: string): string {
    const normalized = value.trim();
    if (!normalized) throw new GitHubOAuthError(code, status, message);
    return normalized;
}

function configuredRedirectUri(value: string): string {
    const redirectUri = required(value, "GITHUB_NOT_CONFIGURED", 503, "GitHub OAuth is not configured");
    let parsed: URL;
    try {
        parsed = new URL(redirectUri);
    } catch {
        throw new GitHubOAuthError("GITHUB_NOT_CONFIGURED", 503, "GitHub OAuth is not configured");
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
        throw new GitHubOAuthError("GITHUB_NOT_CONFIGURED", 503, "GitHub OAuth is not configured");
    }
    return parsed.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
    let value: unknown;
    try {
        value = await response.json();
    } catch {
        return null;
    }
    return isRecord(value) ? value : null;
}

export function buildGitHubAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
}): string {
    const clientId = required(input.clientId, "GITHUB_NOT_CONFIGURED", 503, "GitHub OAuth is not configured");
    const redirectUri = configuredRedirectUri(input.redirectUri);
    const state = required(input.state, "INVALID_REQUEST", 400, "OAuth state is required");
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", GITHUB_OAUTH_SCOPE);
    url.searchParams.set("state", state);
    return url.toString();
}

export async function exchangeGitHubAuthorizationCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}, fetcher: typeof fetch = fetch): Promise<string> {
    const code = required(input.code, "INVALID_REQUEST", 400, "Authorization code is required");
    const clientId = required(input.clientId, "GITHUB_NOT_CONFIGURED", 503, "GitHub OAuth is not configured");
    const clientSecret = required(input.clientSecret, "GITHUB_NOT_CONFIGURED", 503, "GitHub OAuth is not configured");
    const redirectUri = configuredRedirectUri(input.redirectUri);

    let response: Response;
    try {
        response = await fetcher(GITHUB_TOKEN_URL, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "WorkTime",
            },
            body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
        });
    } catch {
        throw new GitHubOAuthError("GITHUB_EXCHANGE_UNAVAILABLE", 502, "GitHub authorization is unavailable");
    }

    const body = await responseJson(response);
    if (body && typeof body.error === "string") {
        if (body.error === "bad_verification_code") {
            throw new GitHubOAuthError("GITHUB_CODE_INVALID", 400, "GitHub authorization code is invalid or expired");
        }
        throw new GitHubOAuthError("GITHUB_UPSTREAM_ERROR", 502, "GitHub authorization failed");
    }
    if (!response.ok) {
        throw new GitHubOAuthError("GITHUB_UPSTREAM_ERROR", 502, "GitHub authorization failed");
    }
    if (!body) {
        throw new GitHubOAuthError("GITHUB_INVALID_RESPONSE", 502, "GitHub returned an invalid authorization response");
    }

    const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const tokenType = typeof body.token_type === "string" ? body.token_type.toLowerCase() : "";
    const scopes = typeof body.scope === "string" ? new Set(body.scope.split(/[\s,]+/).filter(Boolean)) : new Set<string>();
    if (!accessToken || tokenType !== "bearer" || !scopes.has(GITHUB_OAUTH_SCOPE)) {
        throw new GitHubOAuthError("GITHUB_INVALID_RESPONSE", 502, "GitHub returned an invalid authorization response");
    }
    return accessToken;
}

export async function fetchGitHubUsername(token: string, fetcher: typeof fetch = fetch): Promise<string> {
    const accessToken = required(token, "GITHUB_TOKEN_INVALID", 401, "GitHub must be reconnected");
    let response: Response;
    try {
        response = await fetcher(GITHUB_USER_URL, {
            method: "GET",
            headers: {
                "Accept": "application/vnd.github+json",
                "Authorization": `Bearer ${accessToken}`,
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "WorkTime",
            },
        });
    } catch {
        throw new GitHubOAuthError("GITHUB_UPSTREAM_ERROR", 502, "Unable to load the GitHub account");
    }
    if (response.status === 401) {
        throw new GitHubOAuthError("GITHUB_TOKEN_INVALID", 401, "GitHub must be reconnected");
    }
    if (!response.ok) {
        throw new GitHubOAuthError("GITHUB_UPSTREAM_ERROR", 502, "Unable to load the GitHub account");
    }
    const body = await responseJson(response);
    const login = body && typeof body.login === "string" ? body.login.trim() : "";
    if (!login) {
        throw new GitHubOAuthError("GITHUB_INVALID_RESPONSE", 502, "GitHub returned an invalid account response");
    }
    return login;
}
