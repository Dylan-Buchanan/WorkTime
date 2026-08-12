import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseShortcutDataAccess } from "./ShortcutDataAccess";

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

const story = {
    id: 7,
    app_url: "https://app.shortcut.com/acme/story/7",
    name: "Ship it",
    description: "Description",
    estimate: 3,
    deadline: null,
    workflow_state_id: 1,
    status_name: "Ready",
    completed: false,
    archived: false,
    story_type: "feature" as const,
    labels: [],
};

describe("SupabaseShortcutDataAccess", () => {
    it("loads only public settings fields", async () => {
        const mocks = clientMock({ settings: {
            team_name: "Data Thinkers",
            included_statuses: ["In Dev"],
            default_project_id: "project-1",
            last_synced_at: null,
            updated_at: "2026-08-12T10:00:00.000Z",
        } });
        const access = new SupabaseShortcutDataAccess(mocks.client, "owner-1");

        await expect(access.loadSettings()).resolves.toEqual({
            teamName: "Data Thinkers",
            includedStatuses: ["In Dev"],
            defaultProjectId: "project-1",
            lastSyncedAt: null,
            updatedAt: "2026-08-12T10:00:00.000Z",
        });
        expect(mocks.select).toHaveBeenCalledWith("team_name, included_statuses, default_project_id, last_synced_at, updated_at");
        expect(mocks.select.mock.calls[0]?.[0]).not.toContain("shortcut_token");
        expect(mocks.selectEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("uses separate RPCs for connection and public preference updates", async () => {
        const mocks = clientMock();
        const access = new SupabaseShortcutDataAccess(mocks.client, "owner-1");

        await access.connect({
            token: " secret ", teamName: " Team ", includedStatuses: ["In Dev", "In Dev", ""], defaultProjectId: " project-1 ",
        });
        await access.updatePreferences({ teamName: " Other Team ", includedStatuses: ["Ready for Dev"], defaultProjectId: null });

        expect(mocks.rpc).toHaveBeenNthCalledWith(1, "save_shortcut_settings", {
            p_shortcut_token: "secret",
            p_team_name: "Team",
            p_included_statuses: ["In Dev"],
            p_default_project_id: "project-1",
        });
        expect(mocks.rpc).toHaveBeenNthCalledWith(2, "update_shortcut_preferences", {
            p_team_name: "Other Team",
            p_included_statuses: ["Ready for Dev"],
            p_default_project_id: null,
        });
    });

    it("deletes only the bound owner's settings", async () => {
        const mocks = clientMock();
        const access = new SupabaseShortcutDataAccess(mocks.client, "owner-1");

        await access.disconnect();

        expect(mocks.remove).toHaveBeenCalledOnce();
        expect(mocks.deleteEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("maps successful sync responses", async () => {
        const mocks = clientMock({ syncData: { stories: [story], synced_at: "2026-08-12T12:00:00.000Z" } });
        const access = new SupabaseShortcutDataAccess(mocks.client, "owner-1");

        await expect(access.sync()).resolves.toEqual({ stories: [story], syncedAt: "2026-08-12T12:00:00.000Z" });
        expect(mocks.invoke).toHaveBeenCalledWith("shortcut-sync", { method: "POST" });
    });

    it("preserves structured function error codes and retry delays", async () => {
        const error = {
            message: "Edge Function returned a non-2xx status code",
            context: { json: vi.fn().mockResolvedValue({ error: "Rate limited", code: "SHORTCUT_RATE_LIMITED", retry_after_seconds: 17 }) },
        };
        const access = new SupabaseShortcutDataAccess(clientMock({ syncError: error }).client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({
            code: "SHORTCUT_RATE_LIMITED",
            retryAfterSeconds: 17,
        });
    });

    it("maps rejected transport calls to a network error", async () => {
        const mocks = clientMock();
        mocks.invoke.mockRejectedValue(new TypeError("Failed to fetch"));
        const access = new SupabaseShortcutDataAccess(mocks.client, "owner-1");

        await expect(access.sync()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });
});
