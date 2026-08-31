import type { GoogleCalendarEvent, GoogleCalendarInterval } from "../_shared/googleCalendarTypes.ts";

const API_ORIGIN = "https://www.googleapis.com/calendar/v3";
const WORKTIME_CALENDAR_SUMMARY = "WorkTime";
const WORKTIME_CALENDAR_DESCRIPTION = "Focus-time calendar created and managed by WorkTime.";
const MAX_PAGES = 10;

export class GoogleCalendarApiError extends Error {
    constructor(
        readonly code: string,
        readonly status: number,
        message: string,
        readonly retryAfterSeconds?: number,
        readonly upstreamStatus?: number,
    ) {
        super(message);
        this.name = "GoogleCalendarApiError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

interface GoogleCalendarRecord {
    id: string;
    summary: string;
    description?: string;
    primary: boolean;
    selected: boolean;
    accessRole: string;
}

type Fetcher = typeof fetch;

function retryAfter(response: Response): number | undefined {
    const value = Number(response.headers.get("Retry-After"));
    return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : undefined;
}

async function googleRequest(
    accessToken: string,
    path: string,
    init: RequestInit,
    fetcher: Fetcher,
    allowedStatuses: readonly number[] = [],
): Promise<Response> {
    let response: Response;
    try {
        response = await fetcher(`${API_ORIGIN}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(init.body ? { "Content-Type": "application/json" } : {}),
                ...init.headers,
            },
        });
    } catch {
        throw new GoogleCalendarApiError("GOOGLE_UPSTREAM_ERROR", 502, "Unable to reach Google Calendar");
    }
    if (response.ok || allowedStatuses.includes(response.status)) return response;
    if (response.status === 401) {
        throw new GoogleCalendarApiError("GOOGLE_TOKEN_INVALID", 401, "Google Calendar must be reconnected", undefined, 401);
    }
    if (response.status === 403) {
        throw new GoogleCalendarApiError("GOOGLE_SCOPE_REQUIRED", 403, "Google Calendar permission is required", undefined, 403);
    }
    if (response.status === 429) {
        throw new GoogleCalendarApiError("GOOGLE_RATE_LIMITED", 429, "Google Calendar is rate limited", retryAfter(response), 429);
    }
    throw new GoogleCalendarApiError("GOOGLE_UPSTREAM_ERROR", 502, "Google Calendar request failed", undefined, response.status);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
    let value: unknown;
    try { value = await response.json(); } catch { value = null; }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google Calendar returned an invalid response");
    }
    return value as Record<string, unknown>;
}

export async function listGoogleCalendars(
    accessToken: string,
    fetcher: Fetcher = fetch,
): Promise<GoogleCalendarRecord[]> {
    const calendars: GoogleCalendarRecord[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
            maxResults: "250",
            // Event metadata (timing/transparency/extended properties) is needed
            // to remove all-day and WorkTime events, so freeBusyReader alone is
            // insufficient for a selectable calendar.
            minAccessRole: "reader",
            fields: "nextPageToken,items(id,summary,description,primary,selected,accessRole)",
        });
        if (pageToken) query.set("pageToken", pageToken);
        const data = await responseJson(await googleRequest(accessToken, `/users/me/calendarList?${query}`, { method: "GET" }, fetcher));
        const items = data.items === undefined ? [] : data.items;
        if (!Array.isArray(items)) throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google returned an invalid calendar list");
        for (const value of items) {
            if (!value || typeof value !== "object") continue;
            const item = value as Record<string, unknown>;
            if (typeof item.id !== "string" || typeof item.summary !== "string" || typeof item.accessRole !== "string") continue;
            calendars.push({
                id: item.id,
                summary: item.summary,
                description: typeof item.description === "string" ? item.description : undefined,
                primary: item.primary === true,
                selected: item.selected === true,
                accessRole: item.accessRole,
            });
        }
        pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null;
        if (!pageToken) return calendars;
    }
    throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google calendar pagination exceeded its safe limit");
}

function eventInterval(value: unknown): GoogleCalendarInterval | null {
    if (!value || typeof value !== "object") return null;
    const event = value as Record<string, unknown>;
    if (event.status === "cancelled" || event.transparency === "transparent") return null;
    const start = event.start && typeof event.start === "object" ? event.start as Record<string, unknown> : null;
    const end = event.end && typeof event.end === "object" ? event.end as Record<string, unknown> : null;
    if (!start || !end || typeof start.dateTime !== "string" || typeof end.dateTime !== "string") return null;
    const extended = event.extendedProperties && typeof event.extendedProperties === "object"
        ? event.extendedProperties as Record<string, unknown>
        : null;
    const privateValues = extended?.private && typeof extended.private === "object"
        ? extended.private as Record<string, unknown>
        : null;
    if (typeof privateValues?.["worktime:taskId"] === "string") return null;
    const startMs = new Date(start.dateTime).getTime();
    const endMs = new Date(end.dateTime).getTime();
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() }
        : null;
}

export function mergeIntervals(
    intervals: readonly GoogleCalendarInterval[],
    timeMin?: string,
    timeMax?: string,
): GoogleCalendarInterval[] {
    const min = timeMin ? new Date(timeMin).getTime() : -Infinity;
    const max = timeMax ? new Date(timeMax).getTime() : Infinity;
    const normalized = intervals.flatMap((interval) => {
        const start = Math.max(min, new Date(interval.start).getTime());
        const end = Math.min(max, new Date(interval.end).getTime());
        return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, end] as const] : [];
    }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of normalized) {
        const previous = merged[merged.length - 1];
        if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
        else merged.push([start, end]);
    }
    return merged.map(([start, end]) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
}

async function listTimedBusyEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
    fetcher: Fetcher,
): Promise<GoogleCalendarInterval[]> {
    const intervals: GoogleCalendarInterval[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
            timeMin,
            timeMax,
            singleEvents: "true",
            showDeleted: "false",
            maxResults: "2500",
            fields: "nextPageToken,items(start,end,status,transparency,extendedProperties/private)",
        });
        if (pageToken) query.set("pageToken", pageToken);
        const path = `/calendars/${encodeURIComponent(calendarId)}/events?${query}`;
        const data = await responseJson(await googleRequest(accessToken, path, { method: "GET" }, fetcher));
        const items = data.items === undefined ? [] : data.items;
        if (!Array.isArray(items)) throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google returned invalid events");
        for (const value of items) {
            const interval = eventInterval(value);
            if (interval) intervals.push(interval);
        }
        pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null;
        if (!pageToken) return intervals;
    }
    throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google event pagination exceeded its safe limit");
}

async function listCalendarEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
    fetcher: Fetcher,
): Promise<GoogleCalendarEvent[]> {
    const events: GoogleCalendarEvent[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
            timeMin,
            timeMax,
            singleEvents: "true",
            showDeleted: "false",
            orderBy: "startTime",
            maxResults: "2500",
            fields: "nextPageToken,items(id,summary,start,end,status)",
        });
        if (pageToken) query.set("pageToken", pageToken);
        const path = `/calendars/${encodeURIComponent(calendarId)}/events?${query}`;
        const data = await responseJson(await googleRequest(accessToken, path, { method: "GET" }, fetcher));
        const items = data.items === undefined ? [] : data.items;
        if (!Array.isArray(items)) throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google returned invalid events");
        for (const value of items) {
            if (!value || typeof value !== "object") continue;
            const event = value as Record<string, unknown>;
            if (event.status === "cancelled" || typeof event.id !== "string") continue;
            const start = event.start && typeof event.start === "object" ? event.start as Record<string, unknown> : null;
            const end = event.end && typeof event.end === "object" ? event.end as Record<string, unknown> : null;
            const allDay = typeof start?.date === "string" && typeof end?.date === "string";
            const startValue = allDay ? start.date : start?.dateTime;
            const endValue = allDay ? end.date : end?.dateTime;
            if (typeof startValue !== "string" || typeof endValue !== "string") continue;
            events.push({
                id: `${calendarId}:${event.id}`,
                title: typeof event.summary === "string" && event.summary.trim() ? event.summary.trim() : "(No title)",
                start: startValue,
                end: endValue,
                allDay,
            });
        }
        pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null;
        if (!pageToken) return events;
    }
    throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google event pagination exceeded its safe limit");
}

export async function fetchGoogleCalendarEvents(input: {
    accessToken: string;
    calendarIds: readonly string[];
    timeMin: string;
    timeMax: string;
}, fetcher: Fetcher = fetch): Promise<GoogleCalendarEvent[]> {
    const calendarIds = [...new Set(input.calendarIds.map((value) => value.trim()).filter(Boolean))];
    if (calendarIds.length === 0) return [];
    if (calendarIds.length > 50) throw new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 400, "Select at most 50 calendars");
    const events = (await Promise.all(calendarIds.map((calendarId) =>
        listCalendarEvents(input.accessToken, calendarId, input.timeMin, input.timeMax, fetcher)
    ))).flat();
    return events.sort((left, right) => left.start.localeCompare(right.start) || left.title.localeCompare(right.title));
}

export async function fetchGoogleBusyIntervals(input: {
    accessToken: string;
    calendarIds: readonly string[];
    timeMin: string;
    timeMax: string;
}, fetcher: Fetcher = fetch): Promise<GoogleCalendarInterval[]> {
    const calendarIds = [...new Set(input.calendarIds.map((value) => value.trim()).filter(Boolean))];
    if (calendarIds.length === 0) return [];
    if (calendarIds.length > 50) throw new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 400, "Select at most 50 calendars");
    const freeBusy = await responseJson(await googleRequest(input.accessToken, "/freeBusy", {
        method: "POST",
        body: JSON.stringify({
            timeMin: input.timeMin,
            timeMax: input.timeMax,
            calendarExpansionMax: 50,
            items: calendarIds.map((id) => ({ id })),
        }),
    }, fetcher));
    const calendars = freeBusy.calendars && typeof freeBusy.calendars === "object"
        ? freeBusy.calendars as Record<string, unknown>
        : null;
    if (!calendars) throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google returned invalid free/busy data");
    const calendarsWithBusy = calendarIds.filter((id) => {
        const entry = calendars[id];
        if (!entry || typeof entry !== "object") throw new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 409, "A selected calendar is unavailable");
        const record = entry as Record<string, unknown>;
        if (Array.isArray(record.errors) && record.errors.length) {
            throw new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 409, "A selected calendar is unavailable");
        }
        return Array.isArray(record.busy) && record.busy.length > 0;
    });
    const intervals = (await Promise.all(calendarsWithBusy.map((calendarId) =>
        listTimedBusyEvents(input.accessToken, calendarId, input.timeMin, input.timeMax, fetcher)
    ))).flat();
    return mergeIntervals(intervals, input.timeMin, input.timeMax);
}

export async function getGoogleCalendar(
    accessToken: string,
    calendarId: string,
    fetcher: Fetcher = fetch,
): Promise<{ id: string } | null> {
    const response = await googleRequest(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}?fields=id`,
        { method: "GET" },
        fetcher,
        [404],
    );
    if (response.status === 404) return null;
    const data = await responseJson(response);
    return typeof data.id === "string" && data.id ? { id: data.id } : null;
}

export async function ensureWorkTimeCalendar(
    accessToken: string,
    storedCalendarId: string | null,
    fetcher: Fetcher = fetch,
): Promise<string> {
    if (storedCalendarId && await getGoogleCalendar(accessToken, storedCalendarId, fetcher)) return storedCalendarId;
    const existing = (await listGoogleCalendars(accessToken, fetcher)).find((calendar) =>
        calendar.summary === WORKTIME_CALENDAR_SUMMARY
        && calendar.description === WORKTIME_CALENDAR_DESCRIPTION
        && calendar.accessRole === "owner"
    );
    if (existing) return existing.id;
    const data = await responseJson(await googleRequest(accessToken, "/calendars", {
        method: "POST",
        body: JSON.stringify({ summary: WORKTIME_CALENDAR_SUMMARY, description: WORKTIME_CALENDAR_DESCRIPTION }),
    }, fetcher));
    if (typeof data.id !== "string" || !data.id) {
        throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google did not return the created calendar");
    }
    return data.id;
}

function base32Hex(bytes: Uint8Array): string {
    const alphabet = "0123456789abcdefghijklmnopqrstuv";
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
}

export async function deterministicGoogleEventId(ownerId: string, taskId: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ownerId}:${taskId}`)));
    return `a${base32Hex(digest)}`;
}

function focusEventBody(input: { eventId?: string; title: string; taskId: string; start: string; end: string }): Record<string, unknown> {
    return {
        ...(input.eventId ? { id: input.eventId } : {}),
        summary: input.title,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        transparency: "opaque",
        extendedProperties: { private: { "worktime:taskId": input.taskId } },
    };
}

export async function insertFocusEvent(input: {
    accessToken: string; calendarId: string; eventId: string; title: string; taskId: string; start: string; end: string;
}, fetcher: Fetcher = fetch): Promise<void> {
    const response = await googleRequest(input.accessToken, `/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=none`, {
        method: "POST",
        body: JSON.stringify(focusEventBody(input)),
    }, fetcher, [409]);
    if (response.status === 409) throw new GoogleCalendarApiError("GOOGLE_EVENT_EXISTS", 409, "Google event already exists", undefined, 409);
    const data = await responseJson(response);
    if (data.id !== input.eventId) throw new GoogleCalendarApiError("GOOGLE_INVALID_RESPONSE", 502, "Google returned an invalid event");
}

export async function getFocusEvent(input: {
    accessToken: string; calendarId: string; eventId: string;
}, fetcher: Fetcher = fetch): Promise<boolean> {
    const response = await googleRequest(input.accessToken, `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?fields=id`, { method: "GET" }, fetcher, [404]);
    return response.status !== 404;
}

export async function patchFocusEvent(input: {
    accessToken: string; calendarId: string; eventId: string; title: string; taskId: string; start: string; end: string;
}, fetcher: Fetcher = fetch): Promise<boolean> {
    const response = await googleRequest(input.accessToken, `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=none`, {
        method: "PATCH",
        body: JSON.stringify(focusEventBody(input)),
    }, fetcher, [404]);
    if (response.status === 404) return false;
    await responseJson(response);
    return true;
}

export async function deleteFocusEvent(input: {
    accessToken: string; calendarId: string; eventId: string;
}, fetcher: Fetcher = fetch): Promise<void> {
    await googleRequest(input.accessToken, `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=none`, { method: "DELETE" }, fetcher, [404]);
}
