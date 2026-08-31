import type { SupabaseClient } from "@supabase/supabase-js";

export type GoogleCalendarScopeLevel = "readonly" | "schedule";

export interface GoogleCalendarSettings {
    scopeLevel: GoogleCalendarScopeLevel;
    selectedCalendarIds: string[];
    worktimeCalendarId: string | null;
    connectedAt: string;
    updatedAt: string;
}

export interface GoogleCalendarChoice {
    id: string;
    summary: string;
    primary: boolean;
    selected: boolean;
    accessRole: string;
}

export interface GoogleCalendarInterval {
    start: string;
    end: string;
}

export interface GoogleCalendarEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
}

export interface GoogleCalendarTaskLink {
    taskId: string;
    calendarId: string;
    eventId: string;
    scheduledStart: string;
    scheduledEnd: string;
    estimatePomos: number;
    workMinutes: number;
    updatedAt: string;
}

export interface GoogleCalendarPushInput {
    taskId: string;
    title: string;
    scheduledStart: string;
    estimatePomos: number;
    workMinutes: number;
    allowConflict?: boolean;
}

export type GoogleCalendarIntegrationErrorCode =
    | "INVALID_REQUEST"
    | "GOOGLE_CALENDAR_NOT_CONFIGURED"
    | "GOOGLE_SCOPE_REQUIRED"
    | "GOOGLE_TOKEN_INVALID"
    | "GOOGLE_RATE_LIMITED"
    | "GOOGLE_UPSTREAM_ERROR"
    | "GOOGLE_INVALID_RESPONSE"
    | "GOOGLE_CALENDAR_SELECTION_INVALID"
    | "GOOGLE_TASK_LINK_NOT_FOUND"
    | "GOOGLE_TASK_OUT_OF_SYNC"
    | "CALENDAR_CONFLICT"
    | "NETWORK_ERROR"
    | "UNKNOWN_ERROR";

export class GoogleCalendarIntegrationError extends Error {
    constructor(
        readonly code: GoogleCalendarIntegrationErrorCode,
        message: string,
        readonly retryAfterSeconds?: number,
        readonly conflicts: GoogleCalendarInterval[] = [],
    ) {
        super(message);
        this.name = "GoogleCalendarIntegrationError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface GoogleCalendarDataAccess {
    loadSettings(): Promise<GoogleCalendarSettings | null>;
    beginAuthorization(input: {
        scopeLevel: GoogleCalendarScopeLevel;
        returnTo: string;
        pendingTaskId?: string;
        pendingScheduledStart?: string;
    }): Promise<string>;
    listCalendars(): Promise<GoogleCalendarChoice[]>;
    updateSelectedCalendars(calendarIds: readonly string[]): Promise<void>;
    fetchEvents(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]>;
    fetchBusyIntervals(input: { timeMin: string; timeMax: string }): Promise<{ intervals: GoogleCalendarInterval[]; refreshedAt: string }>;
    loadTaskLink(taskId: string): Promise<GoogleCalendarTaskLink | null>;
    pushTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink>;
    resyncTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink>;
    unpushTask(taskId: string): Promise<void>;
    disconnect(): Promise<void>;
}

interface FunctionErrorBody {
    error?: unknown;
    code?: unknown;
    retry_after_seconds?: unknown;
    conflicts?: unknown;
}

const KNOWN_CODES = new Set<GoogleCalendarIntegrationErrorCode>([
    "INVALID_REQUEST", "GOOGLE_CALENDAR_NOT_CONFIGURED", "GOOGLE_SCOPE_REQUIRED",
    "GOOGLE_TOKEN_INVALID", "GOOGLE_RATE_LIMITED", "GOOGLE_UPSTREAM_ERROR",
    "GOOGLE_INVALID_RESPONSE", "GOOGLE_CALENDAR_SELECTION_INVALID",
    "GOOGLE_TASK_LINK_NOT_FOUND", "GOOGLE_TASK_OUT_OF_SYNC", "CALENDAR_CONFLICT",
]);

function validDateString(value: unknown): value is string {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function interval(value: unknown): GoogleCalendarInterval | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (!validDateString(record.start) || !validDateString(record.end)) return null;
    if (new Date(record.end).getTime() <= new Date(record.start).getTime()) return null;
    return { start: new Date(record.start).toISOString(), end: new Date(record.end).toISOString() };
}

function link(value: unknown): GoogleCalendarTaskLink | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (
        typeof record.task_id !== "string" || typeof record.calendar_id !== "string" || typeof record.event_id !== "string"
        || !validDateString(record.scheduled_start) || !validDateString(record.scheduled_end) || !validDateString(record.updated_at)
        || !Number.isInteger(record.estimate_pomos) || Number(record.estimate_pomos) <= 0
        || !Number.isInteger(record.work_minutes) || Number(record.work_minutes) <= 0
    ) return null;
    return {
        taskId: record.task_id,
        calendarId: record.calendar_id,
        eventId: record.event_id,
        scheduledStart: new Date(record.scheduled_start).toISOString(),
        scheduledEnd: new Date(record.scheduled_end).toISOString(),
        estimatePomos: Number(record.estimate_pomos),
        workMinutes: Number(record.work_minutes),
        updatedAt: new Date(record.updated_at).toISOString(),
    };
}

async function mapFunctionError(error: unknown): Promise<GoogleCalendarIntegrationError> {
    const candidate = error as { message?: unknown; context?: { json?: () => Promise<unknown> } } | null;
    let body: FunctionErrorBody = {};
    try {
        const parsed = await candidate?.context?.json?.();
        if (parsed && typeof parsed === "object") body = parsed as FunctionErrorBody;
    } catch {
        // Non-JSON function failures are mapped to a transport error.
    }
    const code = typeof body.code === "string" && KNOWN_CODES.has(body.code as GoogleCalendarIntegrationErrorCode)
        ? body.code as GoogleCalendarIntegrationErrorCode
        : "NETWORK_ERROR";
    const retry = typeof body.retry_after_seconds === "number" && Number.isFinite(body.retry_after_seconds)
        ? Math.max(0, Math.ceil(body.retry_after_seconds))
        : undefined;
    const conflicts = Array.isArray(body.conflicts) ? body.conflicts.map(interval).filter((value): value is GoogleCalendarInterval => value !== null) : [];
    const message = typeof body.error === "string" ? body.error
        : typeof candidate?.message === "string" && candidate.message ? candidate.message
        : "Unable to reach Google Calendar.";
    return new GoogleCalendarIntegrationError(code, message, retry, conflicts);
}

function transportError(message: string, cause: unknown): GoogleCalendarIntegrationError {
    return cause instanceof GoogleCalendarIntegrationError
        ? cause
        : new GoogleCalendarIntegrationError("NETWORK_ERROR", message);
}

export class SupabaseGoogleCalendarDataAccess implements GoogleCalendarDataAccess {
    constructor(private readonly client: SupabaseClient, private readonly ownerId: string) {}

    async loadSettings(): Promise<GoogleCalendarSettings | null> {
        let response;
        try {
            response = await this.client.from("google_calendar_settings")
                .select("scope_level, selected_calendar_ids, worktime_calendar_id, connected_at, updated_at")
                .eq("owner_id", this.ownerId)
                .maybeSingle();
        } catch (error) { throw transportError("Unable to load Google Calendar settings.", error); }
        if (response.error) throw new GoogleCalendarIntegrationError("UNKNOWN_ERROR", "Unable to load Google Calendar settings.");
        if (!response.data) return null;
        const row = response.data as Record<string, unknown>;
        if (
            (row.scope_level !== "readonly" && row.scope_level !== "schedule")
            || !Array.isArray(row.selected_calendar_ids)
            || (row.worktime_calendar_id !== null && typeof row.worktime_calendar_id !== "string")
            || !validDateString(row.connected_at)
            || !validDateString(row.updated_at)
        ) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google Calendar settings returned an invalid response.");
        return {
            scopeLevel: row.scope_level,
            selectedCalendarIds: row.selected_calendar_ids.filter((value): value is string => typeof value === "string"),
            worktimeCalendarId: typeof row.worktime_calendar_id === "string" ? row.worktime_calendar_id : null,
            connectedAt: new Date(row.connected_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
        };
    }

    async beginAuthorization(input: { scopeLevel: GoogleCalendarScopeLevel; returnTo: string; pendingTaskId?: string; pendingScheduledStart?: string }): Promise<string> {
        let response;
        try {
            response = await this.client.functions.invoke("google-calendar-auth", { method: "POST", body: {
                action: "start",
                scope_level: input.scopeLevel,
                return_to: input.returnTo,
                ...(input.pendingTaskId ? { pending_task_id: input.pendingTaskId } : {}),
                ...(input.pendingScheduledStart ? { pending_scheduled_start: input.pendingScheduledStart } : {}),
            } });
        } catch (error) { throw transportError("Unable to begin Google authorization.", error); }
        if (response.error) throw await mapFunctionError(response.error);
        const authorizationUrl = (response.data as { authorization_url?: unknown } | null)?.authorization_url;
        let parsed: URL;
        try { parsed = new URL(String(authorizationUrl)); } catch { throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google authorization returned an invalid URL."); }
        if (parsed.origin !== "https://accounts.google.com" || parsed.pathname !== "/o/oauth2/v2/auth") {
            throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google authorization returned an untrusted URL.");
        }
        return parsed.toString();
    }

    async listCalendars(): Promise<GoogleCalendarChoice[]> {
        const data = await this.invoke({ action: "list_calendars" });
        if (!Array.isArray(data.calendars)) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned an invalid calendar list.");
        return data.calendars.map((value) => {
            if (!value || typeof value !== "object") throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned an invalid calendar list.");
            const row = value as Record<string, unknown>;
            if (typeof row.id !== "string" || typeof row.summary !== "string" || typeof row.access_role !== "string") {
                throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned an invalid calendar list.");
            }
            return { id: row.id, summary: row.summary, primary: row.primary === true, selected: row.selected === true, accessRole: row.access_role };
        });
    }

    async updateSelectedCalendars(calendarIds: readonly string[]): Promise<void> {
        const selected = [...new Set(calendarIds.map((value) => value.trim()).filter(Boolean))];
        if (selected.length > 50) throw new GoogleCalendarIntegrationError("GOOGLE_CALENDAR_SELECTION_INVALID", "Select at most 50 calendars.");
        let response;
        try { response = await this.client.rpc("update_google_calendar_preferences", { p_selected_calendar_ids: selected }); }
        catch (error) { throw transportError("Unable to save Google Calendar preferences.", error); }
        if (response.error) throw new GoogleCalendarIntegrationError("UNKNOWN_ERROR", "Unable to save Google Calendar preferences.");
    }

    async fetchBusyIntervals(input: { timeMin: string; timeMax: string }): Promise<{ intervals: GoogleCalendarInterval[]; refreshedAt: string }> {
        const data = await this.invoke({ action: "busy", time_min: input.timeMin, time_max: input.timeMax });
        if (!Array.isArray(data.intervals) || !validDateString(data.refreshed_at)) {
            throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid busy time.");
        }
        const intervals = data.intervals.map(interval);
        if (intervals.some((value) => value === null)) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid busy time.");
        return { intervals: intervals as GoogleCalendarInterval[], refreshedAt: new Date(data.refreshed_at).toISOString() };
    }

    async fetchEvents(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]> {
        const data = await this.invoke({ action: "list_events", time_min: input.timeMin, time_max: input.timeMax });
        if (!Array.isArray(data.events)) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid calendar events.");
        return data.events.map((value) => {
            if (!value || typeof value !== "object") throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid calendar events.");
            const event = value as Record<string, unknown>;
            if (typeof event.id !== "string" || typeof event.title !== "string" || typeof event.allDay !== "boolean"
                || !validDateString(event.start) || !validDateString(event.end)) {
                throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid calendar events.");
            }
            return { id: event.id, title: event.title, start: event.start as string, end: event.end as string, allDay: event.allDay };
        });
    }

    async loadTaskLink(taskId: string): Promise<GoogleCalendarTaskLink | null> {
        let response;
        try {
            response = await this.client.from("google_calendar_task_links")
                .select("task_id, calendar_id, event_id, scheduled_start, scheduled_end, estimate_pomos, work_minutes, updated_at")
                .eq("owner_id", this.ownerId).eq("task_id", taskId).maybeSingle();
        } catch (error) { throw transportError("Unable to load Google task status.", error); }
        if (response.error) throw new GoogleCalendarIntegrationError("UNKNOWN_ERROR", "Unable to load Google task status.");
        if (!response.data) return null;
        const parsed = link(response.data);
        if (!parsed) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google task status returned an invalid response.");
        return parsed;
    }

    pushTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink> { return this.writeTask("push_task", input); }
    resyncTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink> { return this.writeTask("resync_task", input); }

    async unpushTask(taskId: string): Promise<void> { await this.invoke({ action: "unpush_task", task_id: taskId }); }
    async disconnect(): Promise<void> { await this.invoke({ action: "disconnect" }); }

    private async writeTask(action: "push_task" | "resync_task", input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink> {
        const data = await this.invoke({
            action,
            task_id: input.taskId,
            title: input.title.trim(),
            scheduled_start: input.scheduledStart,
            estimate_pomos: input.estimatePomos,
            work_minutes: input.workMinutes,
            allow_conflict: input.allowConflict === true,
        });
        const parsed = link(data.link);
        if (!parsed) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned an invalid task status.");
        return parsed;
    }

    private async invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        let response;
        try { response = await this.client.functions.invoke("google-calendar", { method: "POST", body }); }
        catch (error) { throw transportError("Unable to reach Google Calendar.", error); }
        if (response.error) throw await mapFunctionError(response.error);
        if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
            throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google Calendar returned an invalid response.");
        }
        return response.data as Record<string, unknown>;
    }
}
