import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseGoogleCalendarDataAccess } from "./GoogleCalendarDataAccess";

function clientMock(options: { settings?: unknown; link?: unknown; invokeData?: unknown; invokeError?: unknown } = {}) {
    const settingsSingle = vi.fn().mockResolvedValue({ data: Array.isArray(options.settings) ? options.settings : options.settings ? [options.settings] : [], error: null });
    const linkSingle = vi.fn().mockResolvedValue({ data: options.link ?? null, error: null });
    const settingsEq = vi.fn(() => ({ order: () => ({ order: settingsSingle }) }));
    const taskEq = vi.fn(() => ({ maybeSingle: linkSingle }));
    const ownerEq = vi.fn(() => ({ eq: taskEq, maybeSingle: settingsSingle }));
    const select = vi.fn((columns: string) => ({ eq: columns.includes("scope_level") ? settingsEq : ownerEq }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const invoke = vi.fn().mockResolvedValue({ data: options.invokeData ?? {}, error: options.invokeError ?? null });
    return { client: { from, rpc, functions: { invoke } } as unknown as SupabaseClient, select, settingsEq, ownerEq, taskEq, rpc, invoke };
}

const linkRow = {
    connection_id: "connection-1",
    task_id: "task-1", calendar_id: "calendar-1", event_id: "event-1",
    scheduled_start: "2026-08-29T14:00:00.000Z", scheduled_end: "2026-08-29T15:15:00.000Z",
    estimate_pomos: 3, work_minutes: 25, updated_at: "2026-08-29T13:00:00.000Z",
};

describe("SupabaseGoogleCalendarDataAccess", () => {
    it("loads only public settings fields for the bound owner", async () => {
        const mocks = clientMock({ settings: {
            id: "connection-1", google_account_id: "sub-1", google_account_email: "a@example.com", primary_calendar_id: "primary",
            identity_source: "userinfo", is_scheduling_target: true,
            scope_level: "readonly", selected_calendar_ids: ["primary"], worktime_calendar_id: null,
            connected_at: "2026-08-29T12:00:00.000Z", updated_at: "2026-08-29T12:00:00.000Z",
        } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await expect(access.loadSettings()).resolves.toMatchObject({ scopeLevel: "readonly", selectedCalendarIds: ["primary"] });
        expect(mocks.select).toHaveBeenCalledWith("id, google_account_id, google_account_email, primary_calendar_id, scope_level, selected_calendar_ids, worktime_calendar_id, is_scheduling_target, identity_source, connected_at, updated_at");
        expect(mocks.select.mock.calls[0][0]).not.toContain("refresh_token");
        expect(mocks.settingsEq).toHaveBeenCalledWith("owner_id", "owner-1");
    });

    it("uses the scheduling connection for the existing settings/preferences contract", async () => {
        const base = { google_account_id: null, google_account_email: null, primary_calendar_id: null, identity_source: "legacy",
            scope_level: "readonly", selected_calendar_ids: [], worktime_calendar_id: null, connected_at: "2026-01-01", updated_at: "2026-01-01" };
        const mocks = clientMock({ settings: [{ ...base, id: "oldest", is_scheduling_target: false }, { ...base, id: "target", is_scheduling_target: true }] });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await expect(access.loadConnections()).resolves.toHaveLength(2);
        await expect(access.loadSettings()).resolves.toMatchObject({ connectionId: "target" });
        await access.updateSelectedCalendars([" primary ", "primary"]);
        expect(mocks.rpc).toHaveBeenCalledWith("update_google_calendar_preferences", { p_connection_id: "target", p_selected_calendar_ids: ["primary"] });
        await access.updateSelectedCalendars(["team"], "oldest");
        expect(mocks.rpc).toHaveBeenCalledWith("update_google_calendar_preferences", { p_connection_id: "oldest", p_selected_calendar_ids: ["team"] });
        await access.setSchedulingConnection("oldest");
        expect(mocks.rpc).toHaveBeenCalledWith("set_google_calendar_scheduling_connection", { p_connection_id: "oldest" });
    });

    it("passes targeted upgrades/disconnects and preserves busy source attribution", async () => {
        const mocks = clientMock({ invokeData: { authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?state=safe" } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await access.beginAuthorization({ scopeLevel: "schedule", connectionId: "connection-1", returnTo: "https://worktime.test/" });
        expect(mocks.invoke).toHaveBeenCalledWith("google-calendar-auth", { method: "POST", body: expect.objectContaining({ connection_id: "connection-1" }) });
        await access.disconnect("connection-1");
        expect(mocks.invoke).toHaveBeenCalledWith("google-calendar", { method: "POST", body: { action: "disconnect", connection_id: "connection-1" } });
        const bounds = { start: "2026-10-27T14:00:00.000Z", end: "2026-10-27T14:30:00.000Z" };
        mocks.invoke.mockResolvedValue({ error: null, data: { intervals: [bounds], refreshed_at: bounds.start,
            blocks: [{ ...bounds, connection_id: "connection-1", account_email: null, calendar_id: "primary" }],
            sources: [{ connection_id: "connection-1", account_email: null, calendar_count: 1, busy_minutes: 30, error_code: null }],
        } });
        await expect(access.fetchBusyIntervals({ timeMin: bounds.start, timeMax: bounds.end })).resolves.toMatchObject({
            blocks: [{ ...bounds, connectionId: "connection-1", accountEmail: null, calendarId: "primary" }],
            sources: [{ connectionId: "connection-1", busyMinutes: 30, calendarCount: 1, errorCode: null }],
        });
    });

    it.each(["GOOGLE_CONNECTION_NOT_FOUND", "GOOGLE_ACCOUNT_LIMIT_REACHED", "GOOGLE_ACCOUNT_MISMATCH", "GOOGLE_SCHEDULING_ACCOUNT_REQUIRED"])("preserves the %s server error", async (code) => {
        const mocks = clientMock({ invokeError: { context: { json: async () => ({ code, error: "Calendar request failed" }) } } });
        await expect(new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1").disconnect()).rejects.toMatchObject({ code });
    });

    it("starts same-window authorization with pending metadata and rejects untrusted URLs", async () => {
        const mocks = clientMock({ invokeData: { authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?state=safe" } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await expect(access.beginAuthorization({ scopeLevel: "schedule", returnTo: "https://worktime.test/projects", pendingTaskId: "task-1", pendingScheduledStart: "2026-08-29T14:00:00Z" }))
            .resolves.toContain("accounts.google.com");
        expect(mocks.invoke).toHaveBeenCalledWith("google-calendar-auth", { method: "POST", body: expect.objectContaining({ pending_task_id: "task-1" }) });

        const unsafe = new SupabaseGoogleCalendarDataAccess(clientMock({ invokeData: { authorization_url: "https://evil.test/steal" } }).client, "owner-1");
        await expect(unsafe.beginAuthorization({ scopeLevel: "readonly", returnTo: "https://worktime.test/integrations" })).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
    });

    it("loads a public linkage and sends a title only in an explicit push body", async () => {
        const mocks = clientMock({ link: linkRow, invokeData: { link: linkRow } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await expect(access.loadTaskLink("task-1")).resolves.toMatchObject({ taskId: "task-1", estimatePomos: 3 });
        await expect(access.pushTask({ taskId: "task-1", title: " Focus ", scheduledStart: "2026-08-29T14:00:00Z", estimatePomos: 3, workMinutes: 25 })).resolves.toMatchObject({ eventId: "event-1" });
        expect(mocks.invoke).toHaveBeenCalledWith("google-calendar", { method: "POST", body: expect.objectContaining({ action: "push_task", title: "Focus" }) });
        expect(mocks.select.mock.calls.some(([columns]) => String(columns).includes("title"))).toBe(false);
    });

    it("preserves interval-only conflict details and rate-limit metadata", async () => {
        const error = { context: { json: vi.fn().mockResolvedValue({
            error: "Busy", code: "CALENDAR_CONFLICT", retry_after_seconds: 2.1,
            conflicts: [{ start: "2026-08-29T14:00:00Z", end: "2026-08-29T14:30:00Z" }],
        }) } };
        const access = new SupabaseGoogleCalendarDataAccess(clientMock({ invokeError: error }).client, "owner-1");
        await expect(access.pushTask({ taskId: "task-1", title: "Focus", scheduledStart: "2026-08-29T14:00:00Z", estimatePomos: 1, workMinutes: 25 }))
            .rejects.toMatchObject({ code: "CALENDAR_CONFLICT", retryAfterSeconds: 3, conflicts: [{ start: "2026-08-29T14:00:00.000Z", end: "2026-08-29T14:30:00.000Z" }] });
    });

    it("loads named calendar events for a bounded display window", async () => {
        const mocks = clientMock({ invokeData: { events: [{
            id: "primary:event-1", title: "Team planning", start: "2026-08-31T13:00:00Z",
            end: "2026-08-31T14:00:00Z", allDay: false,
        }] } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");

        await expect(access.fetchEvents({ timeMin: "2026-08-31T04:00:00Z", timeMax: "2026-09-07T04:00:00Z" }))
            .resolves.toEqual([expect.objectContaining({ title: "Team planning", allDay: false })]);
        expect(mocks.invoke).toHaveBeenCalledWith("google-calendar", { method: "POST", body: expect.objectContaining({ action: "list_events" }) });
    });
    it.each([null, 42, "invalid"])("rejects malformed source %s with the domain error", async (source) => {
        const mocks = clientMock({ invokeData: { intervals: [], refreshed_at: "2026-10-27T12:00:00Z", sources: [source] } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await expect(access.fetchBusyIntervals({ timeMin: "2026-10-27T08:00Z", timeMax: "2026-10-27T18:00Z" }))
            .rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
    });

});
