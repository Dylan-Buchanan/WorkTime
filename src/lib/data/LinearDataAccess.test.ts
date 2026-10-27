import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseLinearDataAccess } from "./LinearDataAccess";

function clientMock(options: {
    settings?: unknown;
    settingsError?: unknown;
    deleteError?: unknown;
    rpcError?: unknown;
    syncData?: unknown;
    syncError?: unknown;
} = {}) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: options.settings ?? null, error: options.settingsError ?? null });
    const selectEq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn((_columns: string) => ({ eq: selectEq }));
    const deleteEq = vi.fn().mockResolvedValue({ error: options.deleteError ?? null });
    const remove = vi.fn(() => ({ eq: deleteEq }));
    const from = vi.fn(() => ({ select, delete: remove }));
    const rpc = vi.fn().mockResolvedValue({ error: options.rpcError ?? null });
    const invoke = vi.fn().mockResolvedValue({ data: options.syncData ?? null, error: options.syncError ?? null });
    const client = { from, rpc, functions: { invoke } } as unknown as SupabaseClient;
    return { client, from, select, selectEq, maybeSingle, remove, deleteEq, rpc, invoke };
}

const issue = {
    id: "issue-1",
    identifier: "ENG-123",
    title: "Ship it",
    description: "Description",
    url: "https://linear.app/worktime/issue/ENG-123/ship-it",
    dueDate: null,
    priority: 2,
    state: { name: "In Progress" },
};

describe("SupabaseLinearDataAccess", () => {
    it("loads only public settings fields", async () => {
        const mocks = clientMock({ settings: {
            team_key: "ENG",
            included_statuses: ["In Progress"],
            default_project_id: "project-1",
            last_synced_at: null,
            updated_at: "2026-10-26T10:00:00.000Z",
        } });
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.loadSettings()).resolves.toEqual({
            teamKey: "ENG",
            includedStatuses: ["In Progress"],
            defaultProjectId: "project-1",
            lastSyncedAt: null,
            updatedAt: "2026-10-26T10:00:00.000Z",
        });
        expect(mocks.select).toHaveBeenCalledWith("team_key, included_statuses, default_project_id, last_synced_at, updated_at");
        expect(mocks.select.mock.calls[0]?.[0]).not.toContain("linear_token");
        expect(mocks.selectEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("returns null when the owner has no saved connection", async () => {
        const access = new SupabaseLinearDataAccess(clientMock().client, "owner-1");

        await expect(access.loadSettings()).resolves.toBeNull();
    });

    it("uses a separate RPC for connecting and for preference updates", async () => {
        const mocks = clientMock();
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await access.connect({
            token: " secret ", teamKey: " ", includedStatuses: [" In Progress ", "In Progress", ""], defaultProjectId: " project-1 ",
        });
        await access.updatePreferences({ teamKey: " PLAT ", includedStatuses: ["Todo"], defaultProjectId: null });

        expect(mocks.rpc).toHaveBeenNthCalledWith(1, "save_linear_settings", {
            p_linear_token: "secret",
            p_team_key: null,
            p_included_statuses: ["In Progress"],
            p_default_project_id: "project-1",
        });
        expect(mocks.rpc).toHaveBeenNthCalledWith(2, "update_linear_preferences", {
            p_team_key: "PLAT",
            p_included_statuses: ["Todo"],
            p_default_project_id: null,
        });
    });

    it("rejects a blank token before calling the RPC", async () => {
        const mocks = clientMock();
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.connect({ token: "  ", teamKey: "", includedStatuses: [], defaultProjectId: null }))
            .rejects.toMatchObject({ code: "INVALID_SETTINGS" });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("surfaces the backend's message-based token guidance", async () => {
        const mocks = clientMock();
        mocks.rpc.mockResolvedValueOnce({
            error: { message: "LINEAR_TOKEN_INVALID: Paste the personal API key without the Bearer prefix" },
        });
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.connect({ token: "Bearer secret", teamKey: "", includedStatuses: [], defaultProjectId: null }))
            .rejects.toMatchObject({
                code: "LINEAR_TOKEN_INVALID",
                message: "Paste the personal API key without the Bearer prefix",
            });
    });

    it("maps a missing connection on preference updates", async () => {
        const mocks = clientMock();
        mocks.rpc.mockResolvedValueOnce({ error: { message: "LINEAR_NOT_CONFIGURED" } });
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.updatePreferences({ teamKey: "", includedStatuses: [], defaultProjectId: null }))
            .rejects.toMatchObject({ code: "LINEAR_NOT_CONFIGURED" });
    });

    it("deletes only the bound owner's settings", async () => {
        const mocks = clientMock();
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await access.disconnect();

        expect(mocks.remove).toHaveBeenCalledOnce();
        expect(mocks.deleteEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("maps a successful sync response including states and truncation", async () => {
        const mocks = clientMock({ syncData: {
            issues: [issue],
            states: ["Done", "In Progress"],
            truncated: true,
            synced_at: "2026-10-26T12:00:00.000Z",
        } });
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.sync()).resolves.toEqual({
            issues: [issue],
            states: ["Done", "In Progress"],
            truncated: true,
            syncedAt: "2026-10-26T12:00:00.000Z",
        });
        expect(mocks.invoke).toHaveBeenCalledWith("linear-sync", { method: "POST" });
    });

    it("rejects a sync payload without the required fields", async () => {
        const mocks = clientMock({ syncData: {
            issues: [issue],
            states: ["In Progress"],
            synced_at: "2026-10-26T12:00:00.000Z",
        } });
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({ code: "LINEAR_INVALID_RESPONSE" });
    });

    it("rejects an issue outside Linear's priority scale", async () => {
        const mocks = clientMock({ syncData: {
            issues: [{ ...issue, priority: 7 }],
            states: [],
            truncated: false,
            synced_at: "2026-10-26T12:00:00.000Z",
        } });
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({ code: "LINEAR_INVALID_RESPONSE" });
    });

    it("preserves allowlisted function error codes and retry delays", async () => {
        const error = {
            message: "Edge Function returned a non-2xx status code",
            context: { json: vi.fn().mockResolvedValue({ error: "Rate limited", code: "LINEAR_RATE_LIMITED", retry_after_seconds: 17 }) },
        };
        const access = new SupabaseLinearDataAccess(clientMock({ syncError: error }).client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({
            code: "LINEAR_RATE_LIMITED",
            retryAfterSeconds: 17,
        });
    });

    it("preserves the team-not-found code", async () => {
        const error = {
            message: "failed",
            context: { json: vi.fn().mockResolvedValue({ error: "Missing team", code: "LINEAR_TEAM_NOT_FOUND" }) },
        };
        const access = new SupabaseLinearDataAccess(clientMock({ syncError: error }).client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({ code: "LINEAR_TEAM_NOT_FOUND" });
    });

    it("maps unknown function codes to a network error", async () => {
        const error = {
            message: "failed",
            context: { json: vi.fn().mockResolvedValue({ error: "Unexpected", code: "SYNC_FAILED" }) },
        };
        const access = new SupabaseLinearDataAccess(clientMock({ syncError: error }).client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });

    it("maps rejected transport calls to a network error", async () => {
        const mocks = clientMock();
        mocks.invoke.mockRejectedValue(new TypeError("Failed to fetch"));
        const access = new SupabaseLinearDataAccess(mocks.client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });
});
