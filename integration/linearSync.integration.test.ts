import { describe, expect, it, vi } from "vitest";
import { createLinearSyncHandler } from "../supabase/functions/linear-sync/handler";
import { LinearApiError } from "../supabase/functions/linear-sync/linearApi";

type Client = ReturnType<Parameters<typeof createLinearSyncHandler>[0]["createClient"]>;

function setup(options: {
    settings?: unknown; settingsError?: unknown; authError?: unknown; user?: unknown;
    updateError?: unknown; updated?: unknown; missingEnv?: boolean;
} = {}) {
    const read = vi.fn(async () => ({
        data: options.settings === undefined ? { linear_token: "stored-fake-key", team_key: "ENG" } : options.settings,
        error: options.settingsError ?? null,
    }));
    const readEq = vi.fn(() => ({ maybeSingle: read }));
    const select = vi.fn(() => ({ eq: readEq }));
    const recorded = vi.fn(async () => ({
        data: options.updated === undefined ? { owner_id: "verified-owner" } : options.updated,
        error: options.updateError ?? null,
    }));
    const updateSelect = vi.fn(() => ({ maybeSingle: recorded }));
    const updateEq = vi.fn(() => ({ select: updateSelect }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const from = vi.fn(() => ({ select, update }));
    const getUser = vi.fn(async () => ({
        data: { user: options.user === undefined ? { id: "verified-owner" } : options.user },
        error: options.authError ?? null,
    }));
    const createClient = vi.fn(() => ({ auth: { getUser }, from }) as unknown as Client);
    const fetchIssues = vi.fn(async () => ({ issues: [], states: ["Todo"], truncated: false }));
    const handler = createLinearSyncHandler({
        createClient, fetchIssues,
        env: (name) => options.missingEnv ? undefined : name === "SUPABASE_URL" ? "http://localhost:54321" : "fake-service-key",
    });
    return { handler, createClient, getUser, from, select, readEq, update, updateEq, updateSelect, fetchIssues };
}

function request(method = "POST", authorization: string | null = "Bearer fake-user-jwt", body?: string): Request {
    return new Request("http://localhost/functions/v1/linear-sync", {
        method, headers: authorization ? { Authorization: authorization } : {}, body,
    });
}

describe("Linear sync HTTP boundary", () => {
    it("handles CORS and method checks before accessing credentials", async () => {
        const test = setup();
        const preflight = await test.handler(request("OPTIONS", null));
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
        const get = await test.handler(request("GET", null));
        expect(get.status).toBe(405);
        expect(await get.json()).toMatchObject({ code: "METHOD_NOT_ALLOWED" });
        expect(test.createClient).not.toHaveBeenCalled();
    });

    it.each([null, "Basic fake", "Bearer "])("rejects missing or malformed authentication (%s)", async (auth) => {
        const test = setup();
        const response = await test.handler(request("POST", auth));
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
        expect(test.createClient).not.toHaveBeenCalled();
    });

    it("rejects an invalid JWT before reading settings", async () => {
        const test = setup({ authError: { message: "invalid JWT" }, user: null });
        expect((await test.handler(request())).status).toBe(401);
        expect(test.getUser).toHaveBeenCalledWith("fake-user-jwt");
        expect(test.from).not.toHaveBeenCalled();
    });

    it("reports missing runtime configuration", async () => {
        const test = setup({ missingEnv: true });
        const response = await test.handler(request());
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: "SYNC_UNAVAILABLE" });
        expect(test.createClient).not.toHaveBeenCalled();
    });

    it.each([null, { linear_token: "", team_key: null }])("reports an unconfigured connection (%s)", async (settings) => {
        const test = setup({ settings });
        const response = await test.handler(request());
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "LINEAR_NOT_CONFIGURED" });
        expect(test.fetchIssues).not.toHaveBeenCalled();
        expect(test.update).not.toHaveBeenCalled();
    });

    it("reports settings read errors without calling Linear", async () => {
        const test = setup({ settingsError: { message: "database detail" } });
        const response = await test.handler(request());
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: "SETTINGS_READ_FAILED" });
        expect(test.fetchIssues).not.toHaveBeenCalled();
    });

    it("derives both owner filters from the verified JWT, ignores request overrides, and records success", async () => {
        const test = setup();
        const response = await test.handler(request("POST", "Bearer fake-user-jwt", JSON.stringify({
            owner_id: "someone-else", linear_token: "override", team_key: "override",
        })));
        expect(response.status).toBe(200);
        expect(test.select).toHaveBeenCalledWith("linear_token, team_key");
        expect(test.readEq).toHaveBeenCalledWith("owner_id", "verified-owner");
        expect(test.updateEq).toHaveBeenCalledWith("owner_id", "verified-owner");
        expect(test.updateSelect).toHaveBeenCalledWith("owner_id");
        expect(test.fetchIssues).toHaveBeenCalledWith({ token: "stored-fake-key", teamKey: "ENG" });
        const body = await response.json();
        expect(body).toEqual({ issues: [], states: ["Todo"], truncated: false, synced_at: expect.any(String) });
        expect(Number.isFinite(Date.parse(body.synced_at))).toBe(true);
        expect(test.update).toHaveBeenCalledWith({ last_synced_at: body.synced_at });
        expect(JSON.stringify(body)).not.toContain("stored-fake-key");
    });

    it("propagates truncation and records the completed bounded fetch", async () => {
        const test = setup();
        test.fetchIssues.mockResolvedValue({ issues: [], states: ["Todo"], truncated: true });
        const response = await test.handler(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ truncated: true });
        expect(test.update).toHaveBeenCalledOnce();
    });

    it.each([
        new LinearApiError("Invalid key", 401, "LINEAR_TOKEN_INVALID"),
        new LinearApiError("Rate limited", 429, "LINEAR_RATE_LIMITED", 17),
        new LinearApiError("Missing team", 404, "LINEAR_TEAM_NOT_FOUND"),
        new LinearApiError("Invalid response", 502, "LINEAR_INVALID_RESPONSE"),
        new LinearApiError("Upstream failure", 502, "LINEAR_UPSTREAM_ERROR"),
    ])("preserves API error codes and never stamps a failed fetch (%s)", async (error) => {
        const test = setup();
        test.fetchIssues.mockRejectedValue(error);
        const response = await test.handler(request());
        expect(response.status).toBe(error.status);
        expect(await response.json()).toEqual({
            error: error.message, code: error.code,
            ...(error.retryAfterSeconds === undefined ? {} : { retry_after_seconds: error.retryAfterSeconds }),
        });
        expect(test.update).not.toHaveBeenCalled();
    });

    it.each([{ updateError: { message: "failed" } }, { updated: null }])("does not claim success when the timestamp write fails or the connection was deleted (%s)", async (options) => {
        const test = setup(options);
        const response = await test.handler(request());
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: "SYNC_STATE_UPDATE_FAILED" });
    });

    it("does not expose unexpected exception details", async () => {
        const test = setup();
        test.fetchIssues.mockRejectedValue(new Error("stored-fake-key"));
        const response = await test.handler(request());
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Linear sync failed", code: "SYNC_FAILED" });
        expect(test.update).not.toHaveBeenCalled();
    });
});
