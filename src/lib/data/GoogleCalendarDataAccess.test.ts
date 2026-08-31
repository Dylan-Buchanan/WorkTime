import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseGoogleCalendarDataAccess } from "./GoogleCalendarDataAccess";

function clientMock(options: { settings?: unknown; link?: unknown; invokeData?: unknown; invokeError?: unknown } = {}) {
    const settingsSingle = vi.fn().mockResolvedValue({ data: options.settings ?? null, error: null });
    const linkSingle = vi.fn().mockResolvedValue({ data: options.link ?? null, error: null });
    const settingsEq = vi.fn(() => ({ maybeSingle: settingsSingle }));
    const taskEq = vi.fn(() => ({ maybeSingle: linkSingle }));
    const ownerEq = vi.fn(() => ({ eq: taskEq, maybeSingle: settingsSingle }));
    const select = vi.fn((columns: string) => ({ eq: columns.includes("scope_level") ? settingsEq : ownerEq }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const invoke = vi.fn().mockResolvedValue({ data: options.invokeData ?? {}, error: options.invokeError ?? null });
    return { client: { from, rpc, functions: { invoke } } as unknown as SupabaseClient, select, settingsEq, ownerEq, taskEq, rpc, invoke };
}

const linkRow = {
    task_id: "task-1", calendar_id: "calendar-1", event_id: "event-1",
    scheduled_start: "2026-08-29T14:00:00.000Z", scheduled_end: "2026-08-29T15:15:00.000Z",
    estimate_pomos: 3, work_minutes: 25, updated_at: "2026-08-29T13:00:00.000Z",
};

describe("SupabaseGoogleCalendarDataAccess", () => {
    it("loads only public settings fields for the bound owner", async () => {
        const mocks = clientMock({ settings: {
            scope_level: "readonly", selected_calendar_ids: ["primary"], worktime_calendar_id: null,
            connected_at: "2026-08-29T12:00:00.000Z", updated_at: "2026-08-29T12:00:00.000Z",
        } });
        const access = new SupabaseGoogleCalendarDataAccess(mocks.client, "owner-1");
        await expect(access.loadSettings()).resolves.toMatchObject({ scopeLevel: "readonly", selectedCalendarIds: ["primary"] });
        expect(mocks.select).toHaveBeenCalledWith("scope_level, selected_calendar_ids, worktime_calendar_id, connected_at, updated_at");
        expect(mocks.select.mock.calls[0][0]).not.toContain("refresh_token");
        expect(mocks.settingsEq).toHaveBeenCalledWith("owner_id", "owner-1");
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
});
