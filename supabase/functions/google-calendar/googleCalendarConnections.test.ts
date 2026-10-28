import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarConnection } from "../_shared/googleCalendarTypes.ts";
import { readGoogleConnections } from "./googleCalendarConnections.ts";
import { errorResponse } from "./googleCalendarOperations.ts";

export function connection(id: string, overrides: Partial<GoogleCalendarConnection> = {}): GoogleCalendarConnection {
    return { id, owner_id: "owner", google_account_id: `sub-${id}`, google_account_email: `${id}@example.com`, primary_calendar_id: id,
        refresh_token: id, scope_level: "schedule", selected_calendar_ids: [id], worktime_calendar_id: `worktime-${id}`,
        is_scheduling_target: id === "a", identity_source: "userinfo", connected_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides };
}
const timeMin = "2026-10-27T08:00:00.000Z";
const timeMax = "2026-10-27T18:00:00.000Z";
const bounds = { start: "2026-10-27T10:00:00.000Z", end: "2026-10-27T11:00:00.000Z" };
type Calendar = { id: string; accessRole: string; primary?: boolean };
type Account = { calendars?: Calendar[]; tokenStatus?: number; freeBusyStatus?: number; rejected?: string[]; eventStatus?: number; busy?: typeof bounds };
function google(accounts: Record<string, Account>) {
    const calls: Array<{ account: string; path: string; body: Record<string, unknown> }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        const token = url.pathname === "/token";
        const account = token ? new URLSearchParams(String(init?.body)).get("refresh_token")! : new Headers(init?.headers).get("Authorization")!.replace("Bearer ", "");
        const config = accounts[account];
        const body = !token && init?.body ? JSON.parse(String(init.body)) : {};
        calls.push({ account, path: url.pathname, body });
        const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Retry-After": "7" } });
        if (token) return json({ access_token: account }, config.tokenStatus);
        if (url.pathname.endsWith("calendarList")) {
            expect(url.searchParams.get("minAccessRole")).toBe("reader");
            return json({ items: config.calendars?.map((calendar) => ({ summary: calendar.id, ...calendar })) ?? [] });
        }
        if (url.pathname.endsWith("freeBusy")) {
            expect(body.calendarExpansionMax).toBe(50);
            const ids = (body.items as { id: string }[]).map((item) => item.id);
            expect(ids.length).toBeLessThanOrEqual(50);
            return json({ calendars: Object.fromEntries(ids.map((id) => [id, config.rejected?.includes(id) ? { errors: [{ reason: "notFound" }] } : { busy: [bounds] }])) }, config.freeBusyStatus);
        }
        if (url.pathname.endsWith("events")) {
            const busy = config.busy ?? bounds;
            return json({ items: [{ id: "event", summary: "Meeting", start: { dateTime: busy.start }, end: { dateTime: busy.end } }] }, config.eventStatus);
        }
        throw new Error(`Unexpected Google path ${url.pathname}`);
    };
    return { fetcher, calls };
}
const env = () => ({ clientId: "client", clientSecret: "secret", persistIdentity: vi.fn().mockResolvedValue(undefined) });

describe("per-account Google reads", () => {
    it("lists every account with provenance and excludes busy-only calendars", async () => {
        const fake = google({ a: { calendars: [{ id: "shared", accessRole: "reader" }, { id: "hidden", accessRole: "freeBusyReader" }] }, b: { calendars: [{ id: "shared", accessRole: "owner" }] } });
        const result = await readGoogleConnections({ connections: [connection("a"), connection("b")], action: "list_calendars", env: env() }, fake.fetcher);
        expect(result.calendars).toEqual([
            expect.objectContaining({ id: "shared", connection_id: "a", account_email: "a@example.com" }),
            expect.objectContaining({ id: "shared", connection_id: "b", account_email: "b@example.com" }),
        ]);
    });

    it("dedupes selected calendars and uses the strongest role even if another account selected it", async () => {
        const fake = google({ a: { calendars: [{ id: "shared", accessRole: "reader" }] }, b: { calendars: [{ id: "shared", accessRole: "owner" }] } });
        const result = await readGoogleConnections({ connections: [connection("a", { selected_calendar_ids: ["shared"] }), connection("b", { selected_calendar_ids: [] })], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.intervals).toEqual([bounds]);
        expect(result.blocks).toEqual([{ ...bounds, calendar_id: "shared", connection_id: "b", account_email: "b@example.com" }]);
        expect(result.sources).toMatchObject([{ calendar_count: 0, busy_minutes: 0 }, { calendar_count: 1, busy_minutes: 60 }]);
        expect(fake.calls.filter((call) => call.path.endsWith("events")).map((call) => call.account)).toEqual(["b"]);
    });

    it("falls back after a per-calendar freeBusy rejection without leaving a warning", async () => {
        const fake = google({ a: { calendars: [{ id: "shared", accessRole: "owner" }], rejected: ["shared"] }, b: { calendars: [{ id: "shared", accessRole: "reader" }] } });
        const result = await readGoogleConnections({ connections: [connection("a", { selected_calendar_ids: ["shared"] }), connection("b", { selected_calendar_ids: [] })], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.blocks?.[0].connection_id).toBe("b");
        expect(result.sources.every((source) => source.error_code === null)).toBe(true);
    });

    it.each([401, 429])("isolates a %s failure and returns a successful response with a warning", async (status) => {
        const fake = google({ a: { tokenStatus: status }, b: { calendars: [{ id: "b", accessRole: "owner" }] } });
        const result = await readGoogleConnections({ connections: [connection("a"), connection("b")], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.intervals).toEqual([bounds]);
        expect(result.sources[0].error_code).toBe(status === 401 ? "GOOGLE_TOKEN_INVALID" : "GOOGLE_RATE_LIMITED");
        expect(result.sources[1]).toMatchObject({ calendar_count: 1, busy_minutes: 60, error_code: null });
    });

    it("keeps successful sibling calendars when another selection is unavailable", async () => {
        const fake = google({ a: { calendars: [{ id: "bad", accessRole: "owner" }, { id: "good", accessRole: "owner" }], rejected: ["bad"] } });
        const result = await readGoogleConnections({ connections: [connection("a", { selected_calendar_ids: ["bad", "good"] })], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.intervals).toEqual([bounds]);
        expect(result.sources[0]).toMatchObject({ calendar_count: 1, error_code: "GOOGLE_CALENDAR_SELECTION_INVALID" });
    });

    it("errors only when every account fails and preserves the first status and retry delay", async () => {
        const fake = google({ a: { tokenStatus: 429 }, b: { tokenStatus: 401 } });
        try {
            await readGoogleConnections({ connections: [connection("a"), connection("b")], action: "list_calendars", env: env() }, fake.fetcher);
            expect.fail("Expected all accounts to fail");
        } catch (error) {
            const response = errorResponse(error);
            expect(response.status).toBe(429);
            expect(await response.json()).toMatchObject({ code: "GOOGLE_RATE_LIMITED", retry_after_seconds: 7 });
        }
    });

    it("preserves the first calendar failure when every fallback also fails", async () => {
        const fake = google({ a: { calendars: [{ id: "shared", accessRole: "owner" }], freeBusyStatus: 429 }, b: { calendars: [{ id: "shared", accessRole: "reader" }], rejected: ["shared"] } });
        await expect(readGoogleConnections({ connections: [connection("a", { selected_calendar_ids: ["shared"] }), connection("b", { selected_calendar_ids: [] })], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher)).rejects.toMatchObject({ code: "GOOGLE_RATE_LIMITED", status: 429 });
    });

    it("dedupes and tags events and falls back when the strongest event query fails", async () => {
        const fake = google({ a: { calendars: [{ id: "shared", accessRole: "writer" }], eventStatus: 401 }, b: { calendars: [{ id: "shared", accessRole: "reader" }] } });
        const result = await readGoogleConnections({ connections: [connection("a", { selected_calendar_ids: ["shared"] }), connection("b", { selected_calendar_ids: ["shared"] })], action: "list_events", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.events).toEqual([expect.objectContaining({ id: "shared:event", connection_id: "b", account_email: "b@example.com" })]);
        expect(result.sources.every((source) => source.error_code === null)).toBe(true);
    });

    it("attributes overlaps once so source minutes sum to the merged budget", async () => {
        const fake = google({ a: { calendars: [{ id: "a", accessRole: "owner" }] }, b: { calendars: [{ id: "b", accessRole: "owner" }], busy: { start: "2026-10-27T10:30:00.000Z", end: "2026-10-27T11:30:00.000Z" } } });
        const result = await readGoogleConnections({ connections: [connection("a"), connection("b")], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.sources.map((source) => source.busy_minutes)).toEqual([60, 30]);
        expect(result.intervals).toEqual([{ start: bounds.start, end: "2026-10-27T11:30:00.000Z" }]);
    });

    it("resolves a legacy non-email primary id without inventing a Google sub", async () => {
        const fake = google({ a: { calendars: [{ id: "non-email-primary", accessRole: "owner", primary: true }] } });
        const environment = env();
        await readGoogleConnections({ connections: [connection("a", { google_account_id: null, google_account_email: null, primary_calendar_id: null, identity_source: "legacy", selected_calendar_ids: [] })], action: "busy", timeMin, timeMax, env: environment }, fake.fetcher);
        expect(environment.persistIdentity).toHaveBeenCalledWith(expect.objectContaining({ google_account_id: null, primary_calendar_id: "non-email-primary", identity_source: "calendar_list", google_account_email: null }));
    });

    it("preserves the ten-page calendar limit and degrades that account", async () => {
        const base = google({ a: {}, b: { calendars: [] } });
        let pages = 0;
        const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            if (String(input).includes("calendarList") && new Headers(init?.headers).get("Authorization") === "Bearer a") {
                pages++;
                return Response.json({ items: [], nextPageToken: `page-${pages}` });
            }
            return base.fetcher(input, init);
        };
        const result = await readGoogleConnections({ connections: [connection("a"), connection("b")], action: "list_calendars", env: env() }, fetcher);
        expect(pages).toBe(10); expect(result.sources[0].error_code).toBe("GOOGLE_INVALID_RESPONSE");
    });

    it("retains each connection's selection cap while batching large fallback unions at fifty", async () => {
        const ids = Array.from({ length: 75 }, (_, i) => `calendar-${i}`);
        const fake = google({ a: { calendars: ids.map((id) => ({ id, accessRole: "reader" })) }, b: { calendars: ids.map((id) => ({ id, accessRole: "owner" })) } });
        const connections = [connection("a", { selected_calendar_ids: ids.slice(0, 50) }), connection("b", { selected_calendar_ids: ids.slice(50) })];
        const result = await readGoogleConnections({ connections, action: "busy", timeMin, timeMax, env: env() }, fake.fetcher);
        expect(result.sources[1].calendar_count).toBe(75);
        expect(fake.calls.filter((call) => call.path.endsWith("freeBusy"))).toHaveLength(2);
        await expect(readGoogleConnections({ connections: [connection("a", { selected_calendar_ids: ids })], action: "busy", timeMin, timeMax, env: env() }, fake.fetcher))
            .rejects.toMatchObject({ code: "GOOGLE_CALENDAR_SELECTION_INVALID" });
    });
    it("rejects missing or invalid read windows before calling Google", async () => {
        const fetcher = vi.fn();
        for (const window of [{}, { timeMin: "invalid", timeMax }, { timeMin: timeMax, timeMax: timeMin }]) {
            await expect(readGoogleConnections({ connections: [connection("a")], action: "busy", env: env(), ...window }, fetcher))
                .rejects.toMatchObject({ code: "INVALID_REQUEST" });
        }
        expect(fetcher).not.toHaveBeenCalled();
    });
});
