import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GoogleCalendarConnection, GoogleCalendarTaskLinkPayload } from "../_shared/googleCalendarTypes.ts";
import { GoogleOAuthError, refreshGoogleAccessToken } from "../google-calendar-auth/googleOAuth.ts";
import {
    deleteFocusEvent, deterministicGoogleEventId, ensureWorkTimeCalendar, getFocusEvent,
    GoogleCalendarApiError, insertFocusEvent, patchFocusEvent,
} from "./googleCalendarApi.ts";
import { prepareGoogleConnection, readGoogleConnections, type GoogleConnectionEnvironment } from "./googleCalendarConnections.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};
const linkColumns = "connection_id, task_id, calendar_id, event_id, scheduled_start, scheduled_end, estimate_pomos, work_minutes, updated_at";
const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

export function errorResponse(error: unknown): Response {
    if (error instanceof GoogleCalendarApiError || error instanceof GoogleOAuthError) {
        return jsonResponse({ error: error.message, code: error.code,
            ...(error.retryAfterSeconds !== undefined ? { retry_after_seconds: error.retryAfterSeconds } : {}) }, error.status);
    }
    return jsonResponse({ error: "Google Calendar operation failed", code: "GOOGLE_UPSTREAM_ERROR" }, 500);
}

function linkPayload(row: Record<string, unknown>): GoogleCalendarTaskLinkPayload {
    return {
        connection_id: String(row.connection_id), task_id: String(row.task_id), calendar_id: String(row.calendar_id), event_id: String(row.event_id),
        scheduled_start: new Date(String(row.scheduled_start)).toISOString(), scheduled_end: new Date(String(row.scheduled_end)).toISOString(),
        estimate_pomos: Number(row.estimate_pomos), work_minutes: Number(row.work_minutes), updated_at: new Date(String(row.updated_at)).toISOString(),
    };
}

export async function executeGoogleCalendarAction(input: {
    supabase: SupabaseClient;
    ownerId: string;
    body: Record<string, unknown>;
    clientId: string;
    clientSecret: string;
    fetcher?: typeof fetch;
}): Promise<Response> {
    const { supabase, ownerId, body, clientId, clientSecret, fetcher = fetch } = input;
    const unavailable = (message: string) => new GoogleCalendarApiError("INTEGRATION_UNAVAILABLE", 500, message);
    try {
        const { data: rows, error } = await supabase.from("google_calendar_connections").select("*")
            .eq("owner_id", ownerId).order("connected_at").order("id");
        if (error) throw unavailable("Unable to load Google connections");
        const connections = (rows ?? []) as GoogleCalendarConnection[];
        const env: GoogleConnectionEnvironment = { clientId, clientSecret, persistIdentity: async (connection) => {
            const { error } = await supabase.from("google_calendar_connections").update({
                primary_calendar_id: connection.primary_calendar_id, google_account_email: connection.google_account_email, identity_source: connection.identity_source,
            }).eq("owner_id", ownerId).eq("id", connection.id).is("google_account_id", null);
            if (error) throw unavailable("Unable to save Google identity");
        } };
        // Share prepared credentials with conflict reads so each account refreshes
        // at most once during this operation.
        const prepared = new Map<string, ReturnType<typeof prepareGoogleConnection>>();
        const prepare = (connection: GoogleCalendarConnection) => {
            let result = prepared.get(connection.id);
            if (!result) { result = prepareGoogleConnection(connection, env, fetcher); prepared.set(connection.id, result); }
            return result;
        };
        const connectionToken = async (connection: GoogleCalendarConnection) => {
            const existing = prepared.get(connection.id);
            if (existing) return (await existing).accessToken;
            if (!connection.google_account_id) return (await prepare(connection)).accessToken;
            return refreshGoogleAccessToken({ refreshToken: connection.refresh_token, clientId, clientSecret }, fetcher);
        };

        if (body.action === "disconnect") {
            if (body.connection_id !== undefined && typeof body.connection_id !== "string") throw new GoogleCalendarApiError("INVALID_REQUEST", 400, "Invalid connection ID");
            const removed = body.connection_id === undefined ? connections : connections.filter((connection) => connection.id === body.connection_id);
            if (body.connection_id !== undefined && !removed.length) throw new GoogleCalendarApiError("GOOGLE_CONNECTION_NOT_FOUND", 404, "Google connection was not found");
            // Revocation is best effort for credentials visible at request start.
            await Promise.all(removed.map(async (connection) => { try {
                await fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({ token: connection.refresh_token }) });
            } catch { /* Best effort: local metadata must still be removed. */ } }));
            const { error } = await supabase.rpc("delete_google_calendar_connections", { p_owner_id: ownerId, p_connection_id: body.connection_id ?? null });
            if (error?.message === "GOOGLE_CONNECTION_NOT_FOUND") throw new GoogleCalendarApiError("GOOGLE_CONNECTION_NOT_FOUND", 404, "Google connection was not found");
            if (error) throw unavailable("Unable to disconnect Google Calendar");
            return jsonResponse({ disconnected: true });
        }

        if (body.action === "list_calendars") return jsonResponse(await readGoogleConnections({ connections, action: "list_calendars", env, prepare }, fetcher));
        if (body.action === "busy" || body.action === "list_events") {
            const timeMin = typeof body.time_min === "string" ? new Date(body.time_min) : new Date(NaN);
            const timeMax = typeof body.time_max === "string" ? new Date(body.time_max) : new Date(NaN);
            const duration = timeMax.getTime() - timeMin.getTime();
            if (!Number.isFinite(duration) || duration <= 0 || (body.action === "list_events" && duration > 8 * 24 * 60 * 60_000)) {
                throw new GoogleCalendarApiError("INVALID_REQUEST", 400, "Invalid calendar window");
            }
            const result = await readGoogleConnections({ connections, action: body.action, env, prepare, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() }, fetcher);
            return jsonResponse({ ...result, ...(body.action === "busy" ? { refreshed_at: new Date().toISOString() } : {}) });
        }
        if (!["push_task", "resync_task", "unpush_task"].includes(String(body.action))) throw new GoogleCalendarApiError("INVALID_REQUEST", 400, "Unknown action");
        const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
        if (!taskId) throw new GoogleCalendarApiError("INVALID_REQUEST", 400, "Task ID is required");
        const { data: linkRow, error: linkError } = await supabase.from("google_calendar_task_links").select(linkColumns)
            .eq("owner_id", ownerId).eq("task_id", taskId).maybeSingle();
        if (linkError) throw unavailable("Unable to load task linkage");
        if (body.action === "unpush_task") {
            if (linkRow) {
                const connection = connections.find((connection) => connection.id === linkRow.connection_id);
                if (!connection) throw new GoogleCalendarApiError("GOOGLE_CONNECTION_NOT_FOUND", 404, "Google connection was not found");
                await deleteFocusEvent({ accessToken: await connectionToken(connection), calendarId: linkRow.calendar_id, eventId: linkRow.event_id }, fetcher);
            }
            const { error } = await supabase.from("google_calendar_task_links").delete().eq("owner_id", ownerId).eq("task_id", taskId);
            if (error) throw unavailable("Unable to remove task linkage");
            return jsonResponse({ removed: true });
        }
        if (body.action === "resync_task" && !linkRow) throw new GoogleCalendarApiError("GOOGLE_TASK_LINK_NOT_FOUND", 409, "Task is not linked to Google Calendar");
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const start = typeof body.scheduled_start === "string" ? new Date(body.scheduled_start) : new Date(NaN);
        const estimatePomos = Number(body.estimate_pomos);
        const workMinutes = Number(body.work_minutes);
        const end = new Date(start.getTime() + estimatePomos * workMinutes * 60_000);
        if (!title || !Number.isFinite(end.getTime()) || !Number.isInteger(estimatePomos) || estimatePomos <= 0 || !Number.isInteger(workMinutes) || workMinutes <= 0) {
            throw new GoogleCalendarApiError("INVALID_REQUEST", 400, "Task scheduling values are invalid");
        }
        // Idempotent pushes keep their original attribution even after a switch.
        if (body.action === "push_task" && linkRow) {
            const existing = linkPayload(linkRow);
            if (existing.scheduled_start === start.toISOString() && existing.estimate_pomos === estimatePomos && existing.work_minutes === workMinutes) {
                const original = connections.find((connection) => connection.id === linkRow.connection_id);
                if (original && original.identity_source === "legacy") {
                    try { await prepare(original); } catch { /* Identity adoption must not fail a no-op push. */ }
                }
                return jsonResponse({ link: existing });
            }
            throw new GoogleCalendarApiError("GOOGLE_TASK_OUT_OF_SYNC", 409, "Task is already linked and out of sync");
        }
        const connection = linkRow ? connections.find((connection) => connection.id === linkRow.connection_id)
            : connections.find((connection) => connection.is_scheduling_target);
        if (!connection) throw new GoogleCalendarApiError("GOOGLE_SCHEDULING_ACCOUNT_REQUIRED", 409, "Choose a Google scheduling account");
        if (connection.scope_level !== "schedule") throw new GoogleCalendarApiError("GOOGLE_SCOPE_REQUIRED", 403, "Scheduling permission is required");
        if (body.allow_conflict !== true) {
            const result = await readGoogleConnections({ connections, action: "busy", env, prepare, timeMin: start.toISOString(), timeMax: end.toISOString() }, fetcher);
            const incomplete = result.sources.find((source) => source.error_code);
            if (incomplete?.error_code) throw new GoogleCalendarApiError(incomplete.error_code,
                incomplete.error_code === "GOOGLE_TOKEN_INVALID" ? 401 : incomplete.error_code === "GOOGLE_RATE_LIMITED" ? 429 : 502,
                "Conflict check could not read every Google account. Reconnect or retry before scheduling.");
            const conflicts = result.intervals ?? [];
            if (conflicts.length) return jsonResponse({ error: "This focus block overlaps busy time", code: "CALENDAR_CONFLICT", conflicts }, 409);
        }
        const accessToken = await connectionToken(connection);
        // Resync must keep the exact calendar, not discover a replacement on a
        // newly selected scheduling connection.
        const calendarId = linkRow?.calendar_id ?? await ensureWorkTimeCalendar(accessToken, connection.worktime_calendar_id, fetcher);
        if (!linkRow && calendarId !== connection.worktime_calendar_id) {
            const { error } = await supabase.from("google_calendar_connections").update({ worktime_calendar_id: calendarId }).eq("owner_id", ownerId).eq("id", connection.id);
            if (error) throw unavailable("Unable to save WorkTime calendar");
        }
        const eventId = linkRow?.event_id ?? await deterministicGoogleEventId(ownerId, taskId);
        const eventInput = { accessToken, calendarId, eventId, title, taskId, start: start.toISOString(), end: end.toISOString() };
        if (body.action === "resync_task") {
            if (!await patchFocusEvent(eventInput, fetcher)) await insertFocusEvent(eventInput, fetcher);
        } else {
            try { await insertFocusEvent(eventInput, fetcher); }
            catch (error) {
                if (!(error instanceof GoogleCalendarApiError) || error.code !== "GOOGLE_EVENT_EXISTS") throw error;
                if (!await getFocusEvent({ accessToken, calendarId, eventId }, fetcher)) throw error;
            }
        }
        const { data: savedLink, error: saveError } = await supabase.from("google_calendar_task_links").upsert({
            owner_id: ownerId, connection_id: connection.id, task_id: taskId, calendar_id: calendarId, event_id: eventId,
            scheduled_start: start.toISOString(), scheduled_end: end.toISOString(), estimate_pomos: estimatePomos, work_minutes: workMinutes,
        }, { onConflict: "owner_id,task_id" }).select(linkColumns).single();
        if (saveError || !savedLink) throw unavailable("Unable to save task linkage");
        return jsonResponse({ link: linkPayload(savedLink) });
    } catch (error) { return errorResponse(error); }
}
