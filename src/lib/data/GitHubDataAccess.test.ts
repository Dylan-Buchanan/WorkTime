import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
    GitHubIntegrationError,
    SupabaseGitHubDataAccess,
    type GitHubIntegrationErrorCode,
} from "./GitHubDataAccess";

function clientMock(options: {
    settings?: unknown;
    settingsError?: unknown;
    deleteError?: unknown;
    updateRows?: unknown[];
    updateError?: unknown;
} = {}) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: options.settings ?? null, error: options.settingsError ?? null });
    const settingsEq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn((_columns: string) => ({ eq: settingsEq }));
    const deleteFullNameEq = vi.fn().mockResolvedValue({ error: options.deleteError ?? null });
    const deleteEq = vi.fn(() => ({ eq: deleteFullNameEq, error: options.deleteError ?? null }));
    const remove = vi.fn(() => ({ eq: deleteEq }));
    const updateSelect = vi.fn().mockResolvedValue({
        data: options.updateRows ?? [{ full_name: "octocat/hello-world" }],
        error: options.updateError ?? null,
    });
    const updateFullNameEq = vi.fn(() => ({ select: updateSelect }));
    const updateOwnerEq = vi.fn(() => ({ eq: updateFullNameEq }));
    const update = vi.fn(() => ({ eq: updateOwnerEq }));
    const from = vi.fn(() => ({ select, delete: remove, update }));
    const invoke = vi.fn();
    const client = { from, functions: { invoke } } as unknown as SupabaseClient;
    return {
        client, from, select, settingsEq, maybeSingle, remove, deleteEq, deleteFullNameEq,
        update, updateOwnerEq, updateFullNameEq, updateSelect, invoke,
    };
}

const authorizationUrl = "https://github.com/login/oauth/authorize?client_id=client-id&redirect_uri=https%3A%2F%2Fworktime.test%2Fauth%2Fgithub%2Fcallback&scope=repo&state=state-123";

const repoWire = {
    owner_id: "owner-1",
    full_name: "octocat/hello-world",
    selected: true,
    project_id: "project-1",
    label_filter: "bug",
    include_closed: false,
    is_stale: false,
    updated_at: "2026-08-31T12:00:00.000Z",
    labels: [{ name: "bug", color: "D73A4A", description: "Something is broken" }],
};

const syncRepoWire = {
    full_name: "octocat/hello-world",
    project_id: "project-1",
    label_filter: "bug",
    include_closed: false,
};

const syncWire = {
    issues: [{
        number: 7,
        title: "Fix sync",
        html_url: "https://github.com/octocat/hello-world/issues/7",
        state: "open",
        labels: ["bug"],
        closed: false,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
        closed_at: null,
    }],
    repo: syncRepoWire,
    synced_at: "2026-08-31T12:00:00.000Z",
};

describe("SupabaseGitHubDataAccess", () => {
    it("begins authorization and completes exchange with a public-only result", async () => {
        const mocks = clientMock();
        mocks.invoke
            .mockResolvedValueOnce({ data: { authorization_url: authorizationUrl }, error: null })
            .mockResolvedValueOnce({ data: { github_username: "octocat" }, error: null });
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

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

    it("loads only public settings fields", async () => {
        const mocks = clientMock({ settings: {
            github_username: "octocat",
            last_synced_at: "2026-08-30T10:00:00.000Z",
            updated_at: "2026-08-31T09:00:00.000Z",
        } });
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await expect(access.loadSettings()).resolves.toEqual({
            githubUsername: "octocat",
            lastSyncedAt: "2026-08-30T10:00:00.000Z",
            updatedAt: "2026-08-31T09:00:00.000Z",
        });
        expect(mocks.select).toHaveBeenCalledWith("github_username, last_synced_at, updated_at");
        expect(mocks.select.mock.calls[0]?.[0]).not.toContain("token");
        expect(mocks.settingsEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("returns null settings when the owner has never connected", async () => {
        const mocks = clientMock();
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").loadSettings()).resolves.toBeNull();
    });

    it.each([
        [{ github_username: " ", last_synced_at: null, updated_at: "2026-08-31T09:00:00.000Z" }],
        [{ github_username: "octocat", last_synced_at: 3, updated_at: "2026-08-31T09:00:00.000Z" }],
        [{ github_username: "octocat", last_synced_at: null, updated_at: "" }],
    ])("rejects invalid settings rows %#", async (settings) => {
        const mocks = clientMock({ settings });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").loadSettings())
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    it("maps settings read failures to typed codes", async () => {
        const failed = clientMock({ settingsError: { message: "rls" } });
        await expect(new SupabaseGitHubDataAccess(failed.client, "owner-1").loadSettings())
            .rejects.toMatchObject({ code: "SETTINGS_READ_FAILED" });

        const thrown = clientMock();
        thrown.maybeSingle.mockRejectedValue(new TypeError("Failed to fetch"));
        await expect(new SupabaseGitHubDataAccess(thrown.client, "owner-1").loadSettings())
            .rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("lists typed repository rows with per-repo label options", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: { repos: [repoWire] }, error: null });

        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").listRepos()).resolves.toEqual({
            repos: [{
                ownerId: "owner-1",
                fullName: "octocat/hello-world",
                selected: true,
                projectId: "project-1",
                labelFilter: "bug",
                includeClosed: false,
                isStale: false,
                updatedAt: "2026-08-31T12:00:00.000Z",
            }],
            labels: { "octocat/hello-world": ["bug"] },
        });
        expect(mocks.invoke).toHaveBeenCalledWith("github-enumerate-repos", {
            method: "POST",
            body: {},
        });
    });

    it("lists stale rows with empty label options", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: { repos: [{ ...repoWire, is_stale: true, labels: [] }] }, error: null });

        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").listRepos()).resolves.toMatchObject({
            repos: [{ fullName: "octocat/hello-world", isStale: true }],
            labels: { "octocat/hello-world": [] },
        });
    });

    it("accepts the empty repository enumeration payload", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: { repos: [] }, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").listRepos())
            .resolves.toEqual({ repos: [], labels: {} });
    });

    it.each([
        null,
        {},
        { repos: null },
        { repos: [], token: "must-not-reach-client" },
        { repos: [{ full_name: "octocat/repo" }] },
        { repos: [{ ...repoWire, labels: [{ name: "bug", color: "D73A4A", description: null, extra: true }] }] },
    ])("rejects invalid enumeration payload %#", async (data) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").listRepos())
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    it("toggles selection through an owner-scoped table write", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await access.toggleSelection(" octocat/hello-world ", false);

        expect(mocks.update).toHaveBeenCalledWith({ selected: false });
        expect(mocks.updateOwnerEq).toHaveBeenCalledWith("owner_id", "owner-1");
        expect(mocks.updateFullNameEq).toHaveBeenCalledWith("full_name", "octocat/hello-world");
    });

    it("edits per-repo options with trimmed, nullable text fields", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await access.updateRepoOptions("octocat/hello-world", { projectId: " project-1 ", labelFilter: "   ", includeClosed: true });

        expect(mocks.update).toHaveBeenCalledWith({
            project_id: "project-1",
            label_filter: null,
            include_closed: true,
        });
        expect(mocks.updateOwnerEq).toHaveBeenCalledWith("owner_id", "owner-1");
        expect(mocks.updateFullNameEq).toHaveBeenCalledWith("full_name", "octocat/hello-world");
    });

    it("edits stale rows through the same write paths", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await expect(access.toggleSelection("octocat/gone", true)).resolves.toBeUndefined();
        await expect(access.updateRepoOptions("octocat/gone", { projectId: null, labelFilter: null, includeClosed: false }))
            .resolves.toBeUndefined();
    });

    it("removes a repository row through an owner-scoped delete", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await access.removeRepo(" octocat/gone ");

        expect(mocks.remove).toHaveBeenCalledOnce();
        expect(mocks.deleteEq).toHaveBeenCalledWith("owner_id", "owner-1");
        expect(mocks.deleteFullNameEq).toHaveBeenCalledWith("full_name", "octocat/gone");
    });

    it("maps repository removal failures to typed codes", async () => {
        const failed = clientMock({ deleteError: { message: "rls" } });
        await expect(new SupabaseGitHubDataAccess(failed.client, "owner-1").removeRepo("octocat/gone"))
            .rejects.toMatchObject({ code: "REPOSITORY_WRITE_FAILED" });

        const thrown = clientMock();
        thrown.deleteFullNameEq.mockRejectedValue(new TypeError("Failed to fetch"));
        await expect(new SupabaseGitHubDataAccess(thrown.client, "owner-1").removeRepo("octocat/gone"))
            .rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("surfaces repo-not-found when no row is updated", async () => {
        const mocks = clientMock({ updateRows: [] });
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await expect(access.toggleSelection("octocat/missing", true))
            .rejects.toMatchObject({ code: "GITHUB_REPO_NOT_FOUND" });
        await expect(access.updateRepoOptions("octocat/missing", { projectId: null, labelFilter: null, includeClosed: false }))
            .rejects.toMatchObject({ code: "GITHUB_REPO_NOT_FOUND" });
    });

    it("maps repository write failures to typed codes", async () => {
        const failed = clientMock({ updateError: { message: "rls" } });
        await expect(new SupabaseGitHubDataAccess(failed.client, "owner-1")
            .toggleSelection("octocat/hello-world", true))
            .rejects.toMatchObject({ code: "REPOSITORY_WRITE_FAILED" });

        const thrown = clientMock();
        thrown.updateSelect.mockRejectedValue(new TypeError("Failed to fetch"));
        await expect(new SupabaseGitHubDataAccess(thrown.client, "owner-1")
            .updateRepoOptions("octocat/hello-world", { projectId: null, labelFilter: null, includeClosed: false }))
            .rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("rejects malformed repository names before any write or sync call", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await expect(access.toggleSelection("octocat", true)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(access.updateRepoOptions("octocat/a/b", { projectId: null, labelFilter: null, includeClosed: false }))
            .rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(access.removeRepo("octocat/a/b")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(access.sync(" ")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it("maps a successful per-repo sync with the repo context", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: syncWire, error: null });

        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").sync("octocat/hello-world")).resolves.toEqual({
            issues: [{
                number: 7,
                title: "Fix sync",
                html_url: "https://github.com/octocat/hello-world/issues/7",
                state: "open",
                closed: false,
                labels: [{ name: "bug" }],
            }],
            repo: {
                fullName: "octocat/hello-world",
                projectId: "project-1",
                labelFilter: "bug",
                includeClosed: false,
            },
            syncedAt: "2026-08-31T12:00:00.000Z",
        });
        expect(mocks.invoke).toHaveBeenCalledWith("github-sync", {
            method: "POST",
            body: { full_name: "octocat/hello-world" },
        });
    });

    it("short-circuits stale repos to the not-accessible error", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

        await expect(access.sync("octocat/hello-world", { isStale: true }))
            .rejects.toMatchObject({ code: "GITHUB_REPO_NOT_FOUND" });
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it.each([
        null,
        {},
        { issues: [], repo: null, synced_at: "2026-08-31T12:00:00.000Z" },
        { ...syncWire, token: "must-not-reach-client" },
        { issues: [{}], repo: syncRepoWire, synced_at: "2026-08-31T12:00:00.000Z" },
        { issues: [{ ...syncWire.issues[0], closed: true }], repo: syncRepoWire, synced_at: "2026-08-31T12:00:00.000Z" },
        { issues: [{ ...syncWire.issues[0], labels: [7] }], repo: syncRepoWire, synced_at: "2026-08-31T12:00:00.000Z" },
        { issues: [], repo: { ...syncRepoWire, full_name: "octocat/other" }, synced_at: "2026-08-31T12:00:00.000Z" },
        { issues: [], repo: syncRepoWire, synced_at: 12 },
    ])("rejects invalid sync payload %#", async (data) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data, error: null });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").sync("octocat/hello-world"))
            .rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    });

    it("keeps repo-not-found distinct from token-invalid on sync", async () => {
        const notFound = clientMock();
        notFound.invoke.mockResolvedValue({ data: null, error: {
            context: { json: vi.fn().mockResolvedValue({ error: "GitHub repository was not found", code: "GITHUB_REPO_NOT_FOUND" }) },
        } });
        await expect(new SupabaseGitHubDataAccess(notFound.client, "owner-1").sync("octocat/gone"))
            .rejects.toEqual(new GitHubIntegrationError("GITHUB_REPO_NOT_FOUND", "GitHub repository was not found"));

        const tokenInvalid = clientMock();
        tokenInvalid.invoke.mockResolvedValue({ data: null, error: {
            context: { json: vi.fn().mockResolvedValue({ error: "GitHub token is invalid or revoked", code: "GITHUB_TOKEN_INVALID" }) },
        } });
        await expect(new SupabaseGitHubDataAccess(tokenInvalid.client, "owner-1").sync("octocat/hello-world"))
            .rejects.toEqual(new GitHubIntegrationError("GITHUB_TOKEN_INVALID", "GitHub token is invalid or revoked"));
    });

    it("preserves sync rate-limit retry metadata", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({ data: null, error: {
            context: { json: vi.fn().mockResolvedValue({
                error: "GitHub rate limit reached",
                code: "GITHUB_RATE_LIMITED",
                retry_after_seconds: 17,
            }) },
        } });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").sync("octocat/hello-world"))
            .rejects.toMatchObject({ code: "GITHUB_RATE_LIMITED", retryAfterSeconds: 17 });
    });

    it("deletes only the bound owner's settings on disconnect", async () => {
        const mocks = clientMock();
        await new SupabaseGitHubDataAccess(mocks.client, "owner-1").disconnect();

        expect(mocks.remove).toHaveBeenCalledOnce();
        expect(mocks.deleteEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("maps disconnect failures to typed codes", async () => {
        const failed = clientMock({ deleteError: { message: "rls" } });
        await expect(new SupabaseGitHubDataAccess(failed.client, "owner-1").disconnect())
            .rejects.toMatchObject({ code: "SETTINGS_DELETE_FAILED" });

        const thrown = clientMock();
        thrown.deleteEq.mockRejectedValue(new TypeError("Failed to fetch"));
        await expect(new SupabaseGitHubDataAccess(thrown.client, "owner-1").disconnect())
            .rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("rejects blank inputs before invoking the function", async () => {
        const mocks = clientMock();
        const access = new SupabaseGitHubDataAccess(mocks.client, "owner-1");

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
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").beginAuthorization("state-123"))
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
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").completeAuthorization("code-123"))
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
        "SETTINGS_DELETE_FAILED",
        "REPOSITORY_READ_FAILED",
        "REPOSITORY_WRITE_FAILED",
        "ENUMERATION_UNAVAILABLE",
        "ENUMERATION_FAILED",
        "EXCHANGE_FAILED",
        "SYNC_UNAVAILABLE",
        "SYNC_STATE_UPDATE_FAILED",
        "SYNC_FAILED",
    ];

    it.each(knownCodes)("maps function error code %s", async (code) => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({
            data: null,
            error: { context: { json: vi.fn().mockResolvedValue({ error: `safe ${code}`, code }) } },
        });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").completeAuthorization("code-123"))
            .rejects.toEqual(new GitHubIntegrationError(code, `safe ${code}`));
    });

    it("maps unknown function codes to a network error", async () => {
        const mocks = clientMock();
        mocks.invoke.mockResolvedValue({
            data: null,
            error: { context: { json: vi.fn().mockResolvedValue({ error: "mystery", code: "SOMETHING_ELSE" }) } },
        });
        await expect(new SupabaseGitHubDataAccess(mocks.client, "owner-1").completeAuthorization("code-123"))
            .rejects.toMatchObject({ code: "NETWORK_ERROR", message: "mystery" });
    });

    it("maps thrown and non-JSON function failures to network errors", async () => {
        const thrown = clientMock();
        thrown.invoke.mockRejectedValue(new Error("offline"));
        await expect(new SupabaseGitHubDataAccess(thrown.client, "owner-1").completeAuthorization("code-123"))
            .rejects.toMatchObject({ code: "NETWORK_ERROR" });

        const invalidBody = clientMock();
        invalidBody.invoke.mockResolvedValue({ data: null, error: {
            message: "FunctionsFetchError",
            context: { json: vi.fn().mockRejectedValue(new Error("not json")) },
        } });
        await expect(new SupabaseGitHubDataAccess(invalidBody.client, "owner-1").completeAuthorization("code-123"))
            .rejects.toMatchObject({ code: "NETWORK_ERROR", message: "FunctionsFetchError" });
    });
});
