import type {
    GoogleCalendarBusyBlock, GoogleCalendarConnection, GoogleCalendarEvent,
    GoogleCalendarProvenance, GoogleCalendarSource,
} from "../_shared/googleCalendarTypes.ts";
import { refreshGoogleAccessToken } from "../google-calendar-auth/googleOAuth.ts";
import {
    fetchGoogleBusyCalendars, fetchGoogleCalendarEvents, GoogleCalendarApiError,
    type GoogleCalendarRecord, listGoogleCalendars, mergeIntervals,
} from "./googleCalendarApi.ts";

export interface GoogleConnectionEnvironment {
    clientId: string;
    clientSecret: string;
    persistIdentity: (connection: GoogleCalendarConnection) => Promise<void>;
}

export interface PreparedGoogleConnection {
    connection: GoogleCalendarConnection;
    accessToken: string;
    calendars: GoogleCalendarRecord[];
}

const roleStrength: Record<string, number> = { owner: 3, writer: 2, reader: 1 };

export async function prepareGoogleConnection(
    connection: GoogleCalendarConnection,
    env: GoogleConnectionEnvironment,
    fetcher: typeof fetch = fetch,
): Promise<PreparedGoogleConnection> {
    const accessToken = await refreshGoogleAccessToken({
        refreshToken: connection.refresh_token, clientId: env.clientId, clientSecret: env.clientSecret,
    }, fetcher);
    const calendars = (await listGoogleCalendars(accessToken, fetcher)).filter((calendar) => roleStrength[calendar.accessRole]);
    const primary = calendars.find((calendar) => calendar.primary);
    if (!connection.google_account_id && primary && (
        connection.primary_calendar_id !== primary.id || connection.identity_source !== "calendar_list"
    )) {
        // calendarList cannot supply a Google sub. Store its primary id even
        // when it is not an email, so later consent can adopt this exact row.
        connection = { ...connection, primary_calendar_id: primary.id, identity_source: "calendar_list",
            google_account_email: connection.google_account_email ?? (/^[^@\s]+@[^@\s]+$/.test(primary.id) ? primary.id : null) };
        await env.persistIdentity(connection);
    }
    return { connection, accessToken, calendars };
}

function provenance(connection: GoogleCalendarConnection): GoogleCalendarProvenance {
    return { connection_id: connection.id, account_email: connection.google_account_email };
}

function errorCode(error: unknown): string {
    return error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code : "GOOGLE_UPSTREAM_ERROR";
}

function unavailableCalendar(): GoogleCalendarApiError {
    return new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 409, "A selected calendar is unavailable");
}

// Assign overlapping minutes once. Stable ordering makes source totals add up
// to the merged busy budget regardless of asynchronous request completion order.
export function attributeBusyBlocks(blocks: GoogleCalendarBusyBlock[]): GoogleCalendarBusyBlock[] {
    const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
        || a.calendar_id.localeCompare(b.calendar_id) || a.connection_id.localeCompare(b.connection_id));
    let coveredUntil = -Infinity;
    return sorted.flatMap((block) => {
        const start = Math.max(new Date(block.start).getTime(), coveredUntil);
        const end = new Date(block.end).getTime();
        coveredUntil = Math.max(coveredUntil, end);
        return end > start ? [{ ...block, start: new Date(start).toISOString() }] : [];
    });
}

export async function readGoogleConnections(input: {
    connections: GoogleCalendarConnection[];
    action: "list_calendars" | "busy" | "list_events";
    timeMin?: string;
    timeMax?: string;
    env: GoogleConnectionEnvironment;
    prepare?: (connection: GoogleCalendarConnection) => Promise<PreparedGoogleConnection>;
}, fetcher: typeof fetch = fetch) {
    if (input.action !== "list_calendars" && (!input.timeMin || !input.timeMax
        || !Number.isFinite(Date.parse(input.timeMin)) || !Number.isFinite(Date.parse(input.timeMax))
        || Date.parse(input.timeMax) <= Date.parse(input.timeMin))) {
        throw new GoogleCalendarApiError("INVALID_REQUEST", 400, "Invalid calendar window");
    }
    const sources: GoogleCalendarSource[] = input.connections.map((connection) => ({
        ...provenance(connection), calendar_count: 0, busy_minutes: 0, error_code: null,
    }));
    const sourceFor = (id: string) => sources.find((source) => source.connection_id === id)!;
    const settled = await Promise.allSettled(input.connections.map((connection) => input.prepare
        ? input.prepare(connection) : prepareGoogleConnection(connection, input.env, fetcher)));
    const prepared: PreparedGoogleConnection[] = [];
    const errors: unknown[] = [];
    settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
            prepared.push(result.value);
            sourceFor(result.value.connection.id).account_email = result.value.connection.google_account_email;
        } else {
            sourceFor(input.connections[index].id).error_code = errorCode(result.reason);
            errors.push(result.reason);
        }
    });
    if (!prepared.length) throw errors[0] ?? new GoogleCalendarApiError("GOOGLE_CALENDAR_NOT_CONFIGURED", 409, "Google Calendar is not connected");

    if (input.action === "list_calendars") {
        const calendars = prepared.flatMap(({ connection, calendars }) => {
            sourceFor(connection.id).calendar_count = calendars.length;
            return calendars.map(({ id, summary, primary, selected, accessRole }) => ({
                id, summary, primary, selected, access_role: accessRole, ...provenance(connection),
            }));
        });
        return { calendars, sources };
    }

    const timeMin = input.timeMin!;
    const timeMax = input.timeMax!;
    const selected = [...new Set(input.connections.flatMap((connection) => connection.selected_calendar_ids))].sort();
    for (const connection of input.connections) {
        if (connection.selected_calendar_ids.length > 50) throw new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 400, "Select at most 50 calendars per connection");
    }
    const candidates = new Map(selected.map((id) => [id, prepared.filter((entry) => entry.calendars.some((calendar) => calendar.id === id))
        .sort((a, b) => {
            const rank = (entry: PreparedGoogleConnection) => roleStrength[entry.calendars.find((calendar) => calendar.id === id)!.accessRole];
            return rank(b) - rank(a) || a.connection.connected_at.localeCompare(b.connection.connected_at) || a.connection.id.localeCompare(b.connection.id);
        })]));
    const events: Array<GoogleCalendarEvent & GoogleCalendarProvenance> = [];
    const blocks: GoogleCalendarBusyBlock[] = [];
    const pending = new Set(selected);
    const firstErrors = new Map<string, unknown>();
    const calendarFailures = new Map<string, Map<string, unknown>>();
    const failed = (id: string, connectionId: string, error: unknown) => {
        if (!firstErrors.has(id)) firstErrors.set(id, error);
        const failures = calendarFailures.get(id) ?? new Map<string, unknown>();
        failures.set(connectionId, error);
        calendarFailures.set(id, failures);
    };
    const firstCandidates = new Map(selected.map((id) => [id, candidates.get(id)![0]]));
    let served = 0;

    // Each round tries one credential per calendar. Batch freeBusy by connection
    // in groups of <=50, even if another account selected the fallback calendar.
    while (pending.size) {
        const groups = new Map<PreparedGoogleConnection, string[]>();
        for (const id of pending) {
            const candidate = candidates.get(id)!.shift();
            if (!candidate) {
                const error = firstErrors.get(id) ?? unavailableCalendar();
                errors.push(error);
                const connectionId = firstCandidates.get(id)?.connection.id
                    ?? input.connections.find((connection) => connection.selected_calendar_ids.includes(id))!.id;
                sourceFor(connectionId).error_code ??= errorCode(error);
                for (const [failedId, failure] of calendarFailures.get(id) ?? []) {
                    sourceFor(failedId).error_code ??= errorCode(failure);
                }
                pending.delete(id);
            } else groups.set(candidate, [...(groups.get(candidate) ?? []), id]);
        }
        await Promise.all([...groups].flatMap(([entry, ids]) => {
            const batches: string[][] = [];
            for (let offset = 0; offset < ids.length; offset += 50) batches.push(ids.slice(offset, offset + 50));
            return batches.map(async (calendarIds) => {
                const base = { accessToken: entry.accessToken, calendarIds, timeMin, timeMax };
                if (input.action === "busy") {
                    let results;
                    try { results = await fetchGoogleBusyCalendars(base, fetcher); }
                    catch (error) { calendarIds.forEach((id) => failed(id, entry.connection.id, error)); return; }
                    for (const [id, result] of results) {
                        if (result.error) { failed(id, entry.connection.id, result.error); continue; }
                        blocks.push(...result.intervals.map((interval) => ({ ...interval, calendar_id: id, ...provenance(entry.connection) })));
                        sourceFor(entry.connection.id).calendar_count++;
                        pending.delete(id);
                        served++;
                    }
                } else {
                    await Promise.all(calendarIds.map(async (id) => {
                        try {
                            const calendarEvents = await fetchGoogleCalendarEvents({ ...base, calendarIds: [id] }, fetcher);
                            events.push(...calendarEvents.map((event) => ({ ...event, ...provenance(entry.connection) })));
                            sourceFor(entry.connection.id).calendar_count++;
                            pending.delete(id);
                            served++;
                        } catch (error) { failed(id, entry.connection.id, error); }
                    }));
                }
            });
        }));
    }
    if (selected.length && !served) throw errors[0] ?? unavailableCalendar();
    if (input.action === "list_events") return {
        events: events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)), sources,
    };
    const attributed = attributeBusyBlocks(blocks);
    for (const block of attributed) sourceFor(block.connection_id).busy_minutes += (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
    return { intervals: mergeIntervals(blocks, timeMin, timeMax), blocks: attributed, sources };
}
