import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
    GitHubIntegrationError,
    SupabaseGitHubDataAccess,
    type GitHubIntegrationErrorCode,
} from "./GitHubDataAccess";

function clientMock() {
    const invoke = vi.fn();
    return {
        client: { functions: { invoke } } as unknown as SupabaseClient,
        invoke,
    };
}

const authorizationUrl = "https://github.com/login/oauth/authorize?client_id=client-id&redirect_uri=https%3A%2F%2Fworktime.test%2Fauth%2Fgithub%2Fcallback&scope=repo&state=state-123";

describe("SupabaseGitHubDataAccess", () => {
    it("begins authorization and completes exchange with a public-only result", async () => {
        const mocks = clientMock();
        mocks.invoke
            .mockResolvedValueOnce({ data: { authorization_url: authorizationUrl }, error: null })
            .mockResolvedValueOnce({ data: { github_username: "octocat" }, error: null });
        const access = new SupabaseGitHubDataAccess(mocks.client);

        await expect(access.beginAuthorization(" state-123 ")).resolves.toBe(authorizationUrl);
        await expect(access.completeAuthorization(" code-123 ")).resolves.toEqual({ githubUsername: "octocat" });
        expect(mocks.invoke).toHaveBeenNthCalledWith(1, "github-oauth-exchange", {
            method: "POST",
            body: { action: "start", state: "state-123" },
        });
        expect(mocks.invoke).toHaveBeenNthCalledWith(2, "github-oauth-exchange", {
            method: "POST",
            body: { action: "exchange", code: "code-123" },
        });
    });

    it("enumerates a typed repository and label payload", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: { repos: [{
            owner_id: "owner-1",
            full_name: "octocat/hello-world",
            selected: true,
            project_id: "project-1",
            label_filter: "bug",
            include_closed: false,
            is_stale: false,
            updated_at: "2026-08-31T12:00:00.000Z",
            labels: [{ name: "bug", color: "D73A4A", description: "Something is broken" }],
        }] }, error: null });

        await expect(new SupabaseGitHubDataAccess(mocks.client).enumerateRepositories()).resolves.toEqual([{
            ownerId: "owner-1",
            fullName: "octocat/hello-world",
            selected: true,
            projectId: "project-1",
            labelFilter: "bug",
            includeClosed: false,
            isStale: false,
            updatedAt: "2026-08-31T12:00:00.000Z",
            labels: [{ name: "bug", color: "d73a4a", description: "Something is broken" }],
        }]);
        expect(mocks.invoke).toHaveBeenCalledWith("github-enumerate-repos", {
            method: "POST",
            body: {},
        });
    });

    it("accepts the empty repository enumeration payload", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: { repos: [] }, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client).enumerateRepositories()).resolves.toEqual([]);
    });

    it.each([
        null,
        {},
        { repos: null },
        { repos: [], token: "must-not-reach-client" },
        { repos: [{ full_name: "octocat/repo" }] },
    ])("rejects invalid enumeration payload %#", async (data) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client).enumerateRepositories())
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    it("rejects blank inputs before invoking the function", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client);

        await expect(access.beginAuthorization(" ")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(access.completeAuthorization(" ")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it.each([
        "https://evil.test/login/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fworktime.test%2Fcallback&scope=repo&state=state-123",
        "http://github.com/login/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fworktime.test%2Fcallback&scope=repo&state=state-123",
        "https://github.com/login/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fworktime.test%2Fcallback&scope=repo&state=wrong",
        "https://github.com/login/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fworktime.test%2Fcallback&scope=repo%20read%3Auser&state=state-123",
        "https://github.com/login/oauth/authorize?client_id=x&redirect_uri=javascript%3Aalert%281%29&scope=repo&state=state-123",
        "https://github.com/login/oauth/authorize?redirect_uri=https%3A%2F%2Fworktime.test%2Fcallback&scope=repo&state=state-123",
    ])("rejects an untrusted authorization URL %#", async (url) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: { authorization_url: url }, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client).beginAuthorization("state-123"))
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    it.each([
        [null],
        [{}],
        [{ github_username: " " }],
        [{ github_username: "octocat", token: "must-not-reach-client" }],
    ])("rejects invalid or secret-bearing exchange response %#", async (data) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client).completeAuthorization("code-123"))
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    const knownCodes: GitHubIntegrationErrorCode[] = [
        "AUTH_REQUIRED",
        "INVALID_REQUEST",
        "METHOD_NOT_ALLOWED",
        "GITHUB_NOT_CONFIGURED",
        "GITHUB_CODE_INVALID",
        "GITHUB_EXCHANGE_UNAVAILABLE",
        "GITHUB_UPSTREAM_ERROR",
        "GITHUB_INVALID_RESPONSE",
        "GITHUB_TOKEN_INVALID",
        "GITHUB_RATE_LIMITED",
        "GITHUB_REPO_NOT_FOUND",
        "SETTINGS_SAVE_FAILED",
        "SETTINGS_READ_FAILED",
        "REPOSITORY_READ_FAILED",
        "REPOSITORY_WRITE_FAILED",
        "ENUMERATION_UNAVAILABLE",
        "ENUMERATION_FAILED",
        "EXCHANGE_FAILED",
    ];

    it.each(knownCodes)("maps function error code %s", async (code) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({
            data: null,
            error: { context: { json: vi.fn().mockResolvedValue({ error: `safe ${code}`, code }) } },
        });
        await expect(new SupabaseGitHubDataAccess(mocks.client).completeAuthorization("code-123"))
            .rejects.toEqual(new GitHubIntegrationError(code, `safe ${code}`));
    });

    it("maps GitHub rate-limit retry metadata", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: null, error: {
            context: { json: vi.fn().mockResolvedValue({
                error: "GitHub rate limit reached",
                code: "GITHUB_RATE_LIMITED",
                retry_after_seconds: 30,
            }) },
        } });
        await expect(new SupabaseGitHubDataAccess(mocks.client).enumerateRepositories())
            .rejects.toMatchObject({ code: "GITHUB_RATE_LIMITED", retryAfterSeconds: 30 });
    });

    it("maps thrown and non-JSON function failures to network errors", async () => {
        const thrown = clientMock();
        thrown.invoke.mockRejectedValue(new Error("offline"));
        await expect(new SupabaseGitHubDataAccess(thrown.client).completeAuthorization("code-123"))
            .rejects.toMatchObject({ code: "NETWORK_ERROR" });

        const invalidBody = clientMock();
        invalidBody.invoke.mockResolvedValue({ data: null, error: {
            message: "FunctionsFetchError",
            context: { json: vi.fn().mockRejectedValue(new Error("not json")) },
        } });
        await expect(new SupabaseGitHubDataAccess(invalidBody.client).completeAuthorization("code-123"))
            .rejects.toMatchObject({ code: "NETWORK_ERROR", message: "FunctionsFetchError" });
    });
});
