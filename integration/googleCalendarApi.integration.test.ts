import { describe, expect, it } from "vitest";
import {
    buildGoogleAuthorizationUrl,
    createCodeChallenge,
    exchangeGoogleAuthorizationCode,
    GOOGLE_CALENDAR_READONLY_SCOPE,
    GOOGLE_CALENDAR_SCHEDULE_SCOPE,
} from "../supabase/functions/google-calendar-auth/googleOAuth";
import {
    deterministicGoogleEventId,
    ensureWorkTimeCalendar,
    fetchGoogleCalendarEvents,
    fetchGoogleBusyIntervals,
    getFocusEvent,
    GoogleCalendarApiError,
    insertFocusEvent,
} from "../supabase/functions/google-calendar/googleCalendarApi";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("Google OAuth helpers", () => {
    it("builds incremental offline PKCE authorization and exchanges with the verifier", async () => {
        const challenge = await createCodeChallenge("v".repeat(64));
        const authorization = new URL(buildGoogleAuthorizationUrl({
            clientId: "client-id", redirectUri: "https://project.supabase.co/functions/v1/google-calendar-auth",
            state: "state", codeChallenge: challenge, scopeLevel: "schedule",
        }));
        expect(authorization.searchParams.get("access_type")).toBe("offline");
        expect(authorization.searchParams.get("include_granted_scopes")).toBe("true");
        expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorization.searchParams.get("scope")).toContain(GOOGLE_CALENDAR_READONLY_SCOPE);
        expect(authorization.searchParams.get("scope")).toContain(GOOGLE_CALENDAR_SCHEDULE_SCOPE);

        let sentBody = "";
        const result = await exchangeGoogleAuthorizationCode({
            code: "code", codeVerifier: "v".repeat(64), clientId: "client-id", clientSecret: "server-secret",
            redirectUri: "https://project.supabase.co/functions/v1/google-calendar-auth", existingRefreshToken: "existing-refresh",
        }, async (_input, init) => {
            sentBody = String(init?.body);
            return jsonResponse({ access_token: "access", scope: `${GOOGLE_CALENDAR_READONLY_SCOPE} ${GOOGLE_CALENDAR_SCHEDULE_SCOPE}` });
        });
        expect(sentBody).toContain(`code_verifier=${"v".repeat(64)}`);
        expect(sentBody).toContain("client_secret=server-secret");
        expect(result).toEqual({ accessToken: "access", refreshToken: "existing-refresh", scopeLevel: "schedule" });
    });
});

describe("Google Calendar API helpers", () => {
    it("loads named timed and all-day events for the weekly calendar", async () => {
        const fetcher = async (): Promise<Response> => jsonResponse({ items: [
            { id: "event-1", summary: "Team planning", start: { dateTime: "2026-08-31T13:00:00Z" }, end: { dateTime: "2026-08-31T14:00:00Z" } },
            { id: "event-2", summary: "Conference", start: { date: "2026-09-01" }, end: { date: "2026-09-03" } },
            { id: "cancelled", summary: "Cancelled", status: "cancelled", start: { dateTime: "2026-08-31T15:00:00Z" }, end: { dateTime: "2026-08-31T16:00:00Z" } },
        ] });

        await expect(fetchGoogleCalendarEvents({
            accessToken: "access", calendarIds: ["primary"],
            timeMin: "2026-08-31T04:00:00Z", timeMax: "2026-09-07T04:00:00Z",
        }, fetcher)).resolves.toEqual([
            { id: "primary:event-1", title: "Team planning", start: "2026-08-31T13:00:00Z", end: "2026-08-31T14:00:00Z", allDay: false },
            { id: "primary:event-2", title: "Conference", start: "2026-09-01", end: "2026-09-03", allDay: true },
        ]);
    });

    it("queries freebusy, expands instances, and returns only real timed intervals without requesting titles", async () => {
        const requests: URL[] = [];
        const fetcher = async (input: string | URL | Request): Promise<Response> => {
            const url = new URL(input instanceof Request ? input.url : input.toString());
            requests.push(url);
            if (url.pathname.endsWith("/freeBusy")) {
                return jsonResponse({ calendars: { primary: { busy: [{ start: "2026-08-29T14:00:00Z", end: "2026-08-29T15:00:00Z" }] } } });
            }
            return jsonResponse({ items: [
                { start: { dateTime: "2026-08-29T14:00:00Z" }, end: { dateTime: "2026-08-29T14:30:00Z" }, status: "confirmed" },
                { start: { date: "2026-08-29" }, end: { date: "2026-08-30" }, status: "confirmed" },
                { start: { dateTime: "2026-08-29T14:30:00Z" }, end: { dateTime: "2026-08-29T15:00:00Z" }, extendedProperties: { private: { "worktime:taskId": "task-1" } } },
                { start: { dateTime: "2026-08-29T15:00:00Z" }, end: { dateTime: "2026-08-29T15:30:00Z" }, transparency: "transparent" },
                { start: { dateTime: "2026-08-29T15:30:00Z" }, end: { dateTime: "2026-08-29T16:00:00Z" }, status: "cancelled" },
            ] });
        };
        const intervals = await fetchGoogleBusyIntervals({
            accessToken: "access", calendarIds: ["primary"],
            timeMin: "2026-08-29T13:00:00Z", timeMax: "2026-08-29T16:00:00Z",
        }, fetcher);
        expect(intervals).toEqual([{ start: "2026-08-29T14:00:00.000Z", end: "2026-08-29T14:30:00.000Z" }]);
        const eventsRequest = requests.find((url) => url.pathname.includes("/events"))!;
        expect(eventsRequest.searchParams.get("singleEvents")).toBe("true");
        expect(eventsRequest.searchParams.get("fields")).not.toContain("summary");
    });

    it("recovers a marked WorkTime calendar and derives stable Google-compatible event IDs", async () => {
        const fetcher = async (input: string | URL | Request): Promise<Response> => {
            const url = new URL(input instanceof Request ? input.url : input.toString());
            if (url.pathname.endsWith("/calendars/missing")) return jsonResponse({}, 404);
            if (url.pathname.endsWith("/users/me/calendarList")) return jsonResponse({ items: [{
                id: "worktime-id", summary: "WorkTime", description: "Focus-time calendar created and managed by WorkTime.", accessRole: "owner",
            }] });
            throw new Error(`Unexpected ${url}`);
        };
        await expect(ensureWorkTimeCalendar("access", "missing", fetcher)).resolves.toBe("worktime-id");
        const first = await deterministicGoogleEventId("owner", "task");
        expect(await deterministicGoogleEventId("owner", "task")).toBe(first);
        expect(first).toMatch(/^[0-9a-v]{5,1024}$/);
    });

    it("reports insert conflicts and can recover the deterministic event", async () => {
        let calls = 0;
        const fetcher = async (): Promise<Response> => {
            calls += 1;
            return calls === 1 ? jsonResponse({}, 409) : jsonResponse({ id: "event-id" });
        };
        const input = { accessToken: "access", calendarId: "calendar", eventId: "event-id", title: "Never persist", taskId: "task", start: "2026-08-29T14:00:00Z", end: "2026-08-29T14:25:00Z" };
        await expect(insertFocusEvent(input, fetcher)).rejects.toMatchObject({ code: "GOOGLE_EVENT_EXISTS", status: 409 });
        await expect(getFocusEvent(input, fetcher)).resolves.toBe(true);
        expect(calls).toBe(2);
        expect(new GoogleCalendarApiError("X", 500, "x")).toBeInstanceOf(Error);
    });
});
