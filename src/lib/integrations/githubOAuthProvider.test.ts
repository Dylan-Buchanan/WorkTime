import { describe, expect, it, vi } from "vitest";
import {
    buildGitHubAuthorizationUrl,
    exchangeGitHubAuthorizationCode,
    fetchGitHubUsername,
    GitHubOAuthError,
} from "../../../supabase/functions/github-oauth-exchange/githubOAuth";

const config = {
    clientId: "client-id",
    clientSecret: "server-secret-marker-89",
    redirectUri: "https://worktime.test/auth/github/callback",
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("GitHub OAuth provider helpers", () => {
    it("builds a minimal authorize URL with the exact callback and state", () => {
        const result = new URL(buildGitHubAuthorizationUrl({
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            state: "state-123",
        }));

        expect(result.origin).toBe("https://github.com");
        expect(result.pathname).toBe("/login/oauth/authorize");
        expect(Object.fromEntries(result.searchParams)).toEqual({
            client_id: "client-id",
            redirect_uri: config.redirectUri,
            scope: "repo",
            state: "state-123",
        });
    });

    it("rejects missing state and malformed server configuration", () => {
        expect(() => buildGitHubAuthorizationUrl({ ...config, state: " " })).toThrow(expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }));
        expect(() => buildGitHubAuthorizationUrl({ ...config, state: "state", redirectUri: "javascript:alert(1)" }))
            .toThrow(expect.objectContaining({ code: "GITHUB_NOT_CONFIGURED", status: 503 }));
    });

    it("exchanges a code using form data without returning configuration", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse({ access_token: "gho_test", token_type: "bearer", scope: "repo" }));

        await expect(exchangeGitHubAuthorizationCode({ ...config, code: "code-123" }, fetcher)).resolves.toBe("gho_test");
        expect(fetcher).toHaveBeenCalledOnce();
        const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://github.com/login/oauth/access_token");
        expect(init.method).toBe("POST");
        expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
            code: "code-123",
            client_id: "client-id",
            client_secret: "server-secret-marker-89",
            redirect_uri: config.redirectUri,
        });
    });

    it.each([
        [{ error: "bad_verification_code", error_description: "provider detail" }, 200, "GITHUB_CODE_INVALID", 400],
        [{ error: "incorrect_client_credentials" }, 200, "GITHUB_UPSTREAM_ERROR", 502],
        [{ message: "server error" }, 500, "GITHUB_UPSTREAM_ERROR", 502],
        [{ access_token: "", token_type: "bearer", scope: "repo" }, 200, "GITHUB_INVALID_RESPONSE", 502],
        [{ access_token: "gho_test", token_type: "bearer", scope: "read:user" }, 200, "GITHUB_INVALID_RESPONSE", 502],
    ])("classifies token response %# without exposing provider details", async (body, status, code, expectedStatus) => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse(body, status as number));
        const promise = exchangeGitHubAuthorizationCode({ ...config, code: "code-123" }, fetcher);
        await expect(promise).rejects.toMatchObject({ code, status: expectedStatus });
        await expect(promise).rejects.not.toThrow("provider detail");
    });

    it("maps token endpoint transport and invalid JSON failures", async () => {
        const offline = vi.fn().mockRejectedValue(new Error("includes server-secret-marker-89"));
        await expect(exchangeGitHubAuthorizationCode({ ...config, code: "code-123" }, offline))
            .rejects.toMatchObject({ code: "GITHUB_EXCHANGE_UNAVAILABLE", status: 502 });

        const invalidJson = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
        await expect(exchangeGitHubAuthorizationCode({ ...config, code: "code-123" }, invalidJson))
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE", status: 502 });
    });

    it("fetches and validates the connected GitHub login", async () => {
        const fetcher = vi.fn().mockResolvedValue(jsonResponse({ login: "octocat", name: "The Octocat" }));
        await expect(fetchGitHubUsername("gho_test", fetcher)).resolves.toBe("octocat");
        const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.github.com/user");
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer gho_test");
        expect(new Headers(init.headers).get("X-GitHub-Api-Version")).toBe("2022-11-28");
    });

    it.each([
        [jsonResponse({ message: "Bad credentials" }, 401), "GITHUB_TOKEN_INVALID", 401],
        [jsonResponse({ message: "Down" }, 503), "GITHUB_UPSTREAM_ERROR", 502],
        [jsonResponse({ login: " " }), "GITHUB_INVALID_RESPONSE", 502],
        [new Response("html", { status: 200 }), "GITHUB_INVALID_RESPONSE", 502],
    ])("classifies GitHub user response %#", async (response, code, status) => {
        await expect(fetchGitHubUsername("gho_test", vi.fn().mockResolvedValue(response)))
            .rejects.toMatchObject({ code, status });
    });

    it("does not leak a rejected user-request error", async () => {
        const fetcher = vi.fn().mockRejectedValue(new GitHubOAuthError("GITHUB_UPSTREAM_ERROR", 502, "server-secret-marker-89"));
        await expect(fetchGitHubUsername("gho_test", fetcher))
            .rejects.toMatchObject({ code: "GITHUB_UPSTREAM_ERROR", message: "Unable to load the GitHub account" });
    });
});
