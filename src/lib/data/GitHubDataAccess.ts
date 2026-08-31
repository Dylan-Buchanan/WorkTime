import type { SupabaseClient } from "@supabase/supabase-js";

export interface GitHubSettings {
    githubUsername: string;
}

export type GitHubIntegrationErrorCode =
    | "AUTH_REQUIRED"
    | "INVALID_REQUEST"
    | "METHOD_NOT_ALLOWED"
    | "GITHUB_NOT_CONFIGURED"
    | "GITHUB_CODE_INVALID"
    | "GITHUB_EXCHANGE_UNAVAILABLE"
    | "GITHUB_UPSTREAM_ERROR"
    | "GITHUB_INVALID_RESPONSE"
    | "GITHUB_TOKEN_INVALID"
    | "SETTINGS_SAVE_FAILED"
    | "EXCHANGE_FAILED"
    | "NETWORK_ERROR";

export class GitHubIntegrationError extends Error {
    constructor(readonly code: GitHubIntegrationErrorCode, message: string) {
        super(message);
        this.name = "GitHubIntegrationError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface GitHubDataAccess {
    beginAuthorization(state: string): Promise<string>;
    completeAuthorization(code: string): Promise<GitHubSettings>;
}

interface FunctionErrorBody {
    error?: unknown;
    code?: unknown;
}

const KNOWN_CODES = new Set<GitHubIntegrationErrorCode>([
    "AUTH_REQUIRED",
    "INVALID_REQUEST",
    "METHOD_NOT_ALLOWED",
    "GITHUB_NOT_CONFIGURED",
    "GITHUB_CODE_INVALID",
    "GITHUB_EXCHANGE_UNAVAILABLE",
    "GITHUB_UPSTREAM_ERROR",
    "GITHUB_INVALID_RESPONSE",
    "GITHUB_TOKEN_INVALID",
    "SETTINGS_SAVE_FAILED",
    "EXCHANGE_FAILED",
]);

async function mapFunctionError(error: unknown): Promise<GitHubIntegrationError> {
    const candidate = error as { message?: unknown; context?: { json?: () => Promise<unknown> } } | null;
    let body: FunctionErrorBody = {};
    try {
        const parsed = await candidate?.context?.json?.();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as FunctionErrorBody;
    } catch {
        // Non-JSON function failures are transport errors.
    }
    const code = typeof body.code === "string" && KNOWN_CODES.has(body.code as GitHubIntegrationErrorCode)
        ? body.code as GitHubIntegrationErrorCode
        : "NETWORK_ERROR";
    const message = typeof body.error === "string" && body.error
        ? body.error
        : typeof candidate?.message === "string" && candidate.message
            ? candidate.message
            : "Unable to reach GitHub.";
    return new GitHubIntegrationError(code, message);
}

function invalidRequest(message: string): GitHubIntegrationError {
    return new GitHubIntegrationError("INVALID_REQUEST", message);
}

function invalidResponse(message: string): GitHubIntegrationError {
    return new GitHubIntegrationError("GITHUB_INVALID_RESPONSE", message);
}

export class SupabaseGitHubDataAccess implements GitHubDataAccess {
    constructor(private readonly client: SupabaseClient) {}

    async beginAuthorization(state: string): Promise<string> {
        const normalizedState = state.trim();
        if (!normalizedState) throw invalidRequest("OAuth state is required.");
        let response;
        try {
            response = await this.client.functions.invoke("github-oauth-exchange", {
                method: "POST",
                body: { action: "start", state: normalizedState },
            });
        } catch {
            throw new GitHubIntegrationError("NETWORK_ERROR", "Unable to begin GitHub authorization.");
        }
        if (response.error) throw await mapFunctionError(response.error);
        const authorizationUrl = (response.data as { authorization_url?: unknown } | null)?.authorization_url;
        let parsed: URL;
        try {
            parsed = new URL(String(authorizationUrl));
        } catch {
            throw invalidResponse("GitHub authorization returned an invalid URL.");
        }
        const redirectUri = parsed.searchParams.getAll("redirect_uri");
        const clientId = parsed.searchParams.getAll("client_id");
        const states = parsed.searchParams.getAll("state");
        const scopes = parsed.searchParams.getAll("scope");
        if (
            parsed.origin !== "https://github.com"
            || parsed.pathname !== "/login/oauth/authorize"
            || parsed.username
            || parsed.password
            || parsed.hash
            || redirectUri.length !== 1
            || !redirectUri[0]
            || clientId.length !== 1
            || !clientId[0]
            || states.length !== 1
            || states[0] !== normalizedState
            || scopes.length !== 1
            || scopes[0] !== "repo"
        ) {
            throw invalidResponse("GitHub authorization returned an untrusted URL.");
        }
        try {
            const callback = new URL(redirectUri[0]);
            if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password || callback.hash) {
                throw new Error("untrusted callback");
            }
        } catch {
            throw invalidResponse("GitHub authorization returned an untrusted URL.");
        }
        return parsed.toString();
    }

    async completeAuthorization(code: string): Promise<GitHubSettings> {
        const normalizedCode = code.trim();
        if (!normalizedCode) throw invalidRequest("Authorization code is required.");
        let response;
        try {
            response = await this.client.functions.invoke("github-oauth-exchange", {
                method: "POST",
                body: { action: "exchange", code: normalizedCode },
            });
        } catch {
            throw new GitHubIntegrationError("NETWORK_ERROR", "Unable to complete GitHub authorization.");
        }
        if (response.error) throw await mapFunctionError(response.error);
        if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
            throw invalidResponse("GitHub authorization returned an invalid response.");
        }
        const data = response.data as Record<string, unknown>;
        const githubUsername = typeof data.github_username === "string" ? data.github_username.trim() : "";
        if (!githubUsername || Object.keys(data).some((key) => key !== "github_username")) {
            throw invalidResponse("GitHub authorization returned an invalid response.");
        }
        return { githubUsername };
    }
}
