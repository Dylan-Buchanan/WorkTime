import { createClient } from "npm:@supabase/supabase-js@2";
import type { GoogleCalendarTaskLinkPayload } from "../_shared/googleCalendarTypes.ts";
import { GoogleOAuthError, refreshGoogleAccessToken } from "../google-calendar-auth/googleOAuth.ts";
import {
    deleteFocusEvent,
    deterministicGoogleEventId,
    ensureWorkTimeCalendar,
    fetchGoogleCalendarEvents,
    fetchGoogleBusyIntervals,
    getFocusEvent,
    GoogleCalendarApiError,
    insertFocusEvent,
    listGoogleCalendars,
    patchFocusEvent,
} from "./googleCalendarApi.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function bearerToken(request: Request): string | null {
    return request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function errorResponse(error: unknown): Response {
    if (error instanceof GoogleCalendarApiError || error instanceof GoogleOAuthError) {
        const body: Record<string, unknown> = { error: error.message, code: error.code };
        if (error.retryAfterSeconds !== undefined) body.retry_after_seconds = error.retryAfterSeconds;
        return jsonResponse(body, error.status);
    }
    return jsonResponse({ error: "Google Calendar operation failed", code: "GOOGLE_UPSTREAM_ERROR" }, 500);
}

function linkPayload(row: Record<string, unknown>): GoogleCalendarTaskLinkPayload {
    return {
        task_id: String(row.task_id),
        calendar_id: String(row.calendar_id),
        event_id: String(row.event_id),
        scheduled_start: new Date(String(row.scheduled_start)).toISOString(),
        scheduled_end: new Date(String(row.scheduled_end)).toISOString(),
        estimate_pomos: Number(row.estimate_pomos),
        work_minutes: Number(row.work_minutes),
        updated_at: new Date(String(row.updated_at)).toISOString(),
    };
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
        return jsonResponse({ error: "Google Calendar integration is unavailable", code: "INTEGRATION_UNAVAILABLE" }, 500);
    }
    const jwt = bearerToken(request);
    if (!jwt) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid request", code: "INVALID_REQUEST" }, 400); }
    if (typeof body.action !== "string") return jsonResponse({ error: "Invalid request", code: "INVALID_REQUEST" }, 400);
    const ownerId = userData.user.id;

    const { data: settings, error: settingsError } = await supabase
        .from("google_calendar_settings")
        .select("refresh_token, scope_level, selected_calendar_ids, worktime_calendar_id")
        .eq("owner_id", ownerId)
        .maybeSingle();
    if (settingsError) return jsonResponse({ error: "Unable to load Google Calendar settings", code: "INTEGRATION_UNAVAILABLE" }, 500);
    if (!settings || typeof settings.refresh_token !== "string") {
        return jsonResponse({ error: "Google Calendar is not connected", code: "GOOGLE_CALENDAR_NOT_CONFIGURED" }, 409);
    }

    if (body.action === "disconnect") {
        try {
            await fetch("https://oauth2.googleapis.com/revoke", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ token: settings.refresh_token }),
            });
        } catch {
            // Revocation is best-effort; local access metadata is still removed.
        }
        await supabase.from("google_calendar_oauth_states").delete().eq("owner_id", ownerId);
        await supabase.from("google_calendar_task_links").delete().eq("owner_id", ownerId);
        const { error: deleteError } = await supabase.from("google_calendar_settings").delete().eq("owner_id", ownerId);
        if (deleteError) return jsonResponse({ error: "Unable to disconnect Google Calendar", code: "INTEGRATION_UNAVAILABLE" }, 500);
        return jsonResponse({ disconnected: true });
    }

    try {
        const accessToken = await refreshGoogleAccessToken({
            refreshToken: settings.refresh_token,
            clientId,
            clientSecret,
        });
        const selectedIds = Array.isArray(settings.selected_calendar_ids)
            ? settings.selected_calendar_ids.filter((value: unknown): value is string => typeof value === "string")
            : [];

        if (body.action === "list_calendars") {
            const calendars = (await listGoogleCalendars(accessToken)).map(({ id, summary, primary, selected, accessRole }) => ({
                id, summary, primary, selected, access_role: accessRole,
            }));
            return jsonResponse({ calendars });
        }

        if (body.action === "busy") {
            const timeMin = typeof body.time_min === "string" ? new Date(body.time_min) : new Date(NaN);
            const timeMax = typeof body.time_max === "string" ? new Date(body.time_max) : new Date(NaN);
            if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime()) || timeMax <= timeMin) {
                return jsonResponse({ error: "Invalid busy-time window", code: "INVALID_REQUEST" }, 400);
            }
            const intervals = await fetchGoogleBusyIntervals({
                accessToken,
                calendarIds: selectedIds,
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
            });
            return jsonResponse({ intervals, refreshed_at: new Date().toISOString() });
        }

        if (body.action === "list_events") {
            const timeMin = typeof body.time_min === "string" ? new Date(body.time_min) : new Date(NaN);
            const timeMax = typeof body.time_max === "string" ? new Date(body.time_max) : new Date(NaN);
            const duration = timeMax.getTime() - timeMin.getTime();
            if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime()) || duration <= 0 || duration > 8 * 24 * 60 * 60 * 1000) {
                return jsonResponse({ error: "Invalid calendar event window", code: "INVALID_REQUEST" }, 400);
            }
            const events = await fetchGoogleCalendarEvents({
                accessToken,
                calendarIds: selectedIds,
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
            });
            return jsonResponse({ events });
        }

        if (!["push_task", "resync_task", "unpush_task"].includes(body.action)) {
            return jsonResponse({ error: "Unknown action", code: "INVALID_REQUEST" }, 400);
        }
        const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
        if (!taskId) return jsonResponse({ error: "Task ID is required", code: "INVALID_REQUEST" }, 400);
        const { data: linkRow, error: linkError } = await supabase
            .from("google_calendar_task_links")
            .select("task_id, calendar_id, event_id, scheduled_start, scheduled_end, estimate_pomos, work_minutes, updated_at")
            .eq("owner_id", ownerId)
            .eq("task_id", taskId)
            .maybeSingle();
        if (linkError) return jsonResponse({ error: "Unable to load task linkage", code: "INTEGRATION_UNAVAILABLE" }, 500);

        if (body.action === "unpush_task") {
            if (linkRow) await deleteFocusEvent({ accessToken, calendarId: linkRow.calendar_id, eventId: linkRow.event_id });
            const { error: unlinkError } = await supabase.from("google_calendar_task_links").delete().eq("owner_id", ownerId).eq("task_id", taskId);
            if (unlinkError) return jsonResponse({ error: "Unable to remove task linkage", code: "INTEGRATION_UNAVAILABLE" }, 500);
            return jsonResponse({ removed: true });
        }

        if (settings.scope_level !== "schedule") {
            return jsonResponse({ error: "Scheduling permission is required", code: "GOOGLE_SCOPE_REQUIRED" }, 403);
        }
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const start = typeof body.scheduled_start === "string" ? new Date(body.scheduled_start) : new Date(NaN);
        const estimatePomos = Number(body.estimate_pomos);
        const workMinutes = Number(body.work_minutes);
        if (!title || Number.isNaN(start.getTime()) || !Number.isInteger(estimatePomos) || estimatePomos <= 0 || !Number.isInteger(workMinutes) || workMinutes <= 0) {
            return jsonResponse({ error: "Task scheduling values are invalid", code: "INVALID_REQUEST" }, 400);
        }
        const end = new Date(start.getTime() + estimatePomos * workMinutes * 60_000);
        if (body.action === "push_task" && linkRow) {
            const existing = linkPayload(linkRow);
            if (
                existing.scheduled_start === start.toISOString()
                && existing.estimate_pomos === estimatePomos
                && existing.work_minutes === workMinutes
            ) return jsonResponse({ link: existing });
            return jsonResponse({ error: "Task is already linked and out of sync", code: "GOOGLE_TASK_OUT_OF_SYNC" }, 409);
        }
        if (body.action === "resync_task" && !linkRow) {
            return jsonResponse({ error: "Task is not linked to Google Calendar", code: "GOOGLE_TASK_LINK_NOT_FOUND" }, 409);
        }
        if (body.allow_conflict !== true) {
            const conflicts = await fetchGoogleBusyIntervals({
                accessToken,
                calendarIds: selectedIds,
                timeMin: start.toISOString(),
                timeMax: end.toISOString(),
            });
            if (conflicts.length) return jsonResponse({ error: "This focus block overlaps busy time", code: "CALENDAR_CONFLICT", conflicts }, 409);
        }

        const calendarId = await ensureWorkTimeCalendar(
            accessToken,
            typeof settings.worktime_calendar_id === "string" ? settings.worktime_calendar_id : null,
        );
        if (calendarId !== settings.worktime_calendar_id) {
            const { error: calendarSaveError } = await supabase
                .from("google_calendar_settings")
                .update({ worktime_calendar_id: calendarId })
                .eq("owner_id", ownerId);
            if (calendarSaveError) return jsonResponse({ error: "Unable to save WorkTime calendar", code: "INTEGRATION_UNAVAILABLE" }, 500);
        }
        const eventId = await deterministicGoogleEventId(ownerId, taskId);
        const eventInput = {
            accessToken, calendarId, eventId, title, taskId,
            start: start.toISOString(), end: end.toISOString(),
        };
        if (body.action === "resync_task") {
            if (!await patchFocusEvent(eventInput)) await insertFocusEvent(eventInput);
        } else {
            try { await insertFocusEvent(eventInput); }
            catch (error) {
                if (!(error instanceof GoogleCalendarApiError) || error.code !== "GOOGLE_EVENT_EXISTS") throw error;
                if (!await getFocusEvent({ accessToken, calendarId, eventId })) throw error;
            }
        }
        const { data: savedLink, error: saveLinkError } = await supabase
            .from("google_calendar_task_links")
            .upsert({
                owner_id: ownerId,
                task_id: taskId,
                calendar_id: calendarId,
                event_id: eventId,
                scheduled_start: start.toISOString(),
                scheduled_end: end.toISOString(),
                estimate_pomos: estimatePomos,
                work_minutes: workMinutes,
            }, { onConflict: "owner_id,task_id" })
            .select("task_id, calendar_id, event_id, scheduled_start, scheduled_end, estimate_pomos, work_minutes, updated_at")
            .single();
        if (saveLinkError || !savedLink) return jsonResponse({ error: "Unable to save task linkage", code: "INTEGRATION_UNAVAILABLE" }, 500);
        return jsonResponse({ link: linkPayload(savedLink) });
    } catch (error) {
        return errorResponse(error);
    }
});
