import type { SupabaseClient } from "@supabase/supabase-js";

export type GoogleCalendarScopeLevel = "readonly" | "schedule";

export interface GoogleCalendarSettings {
    connectionId?: string;
    scopeLevel: GoogleCalendarScopeLevel;
    selectedCalendarIds: string[];
    worktimeCalendarId: string | null;
    connectedAt: string;
    updatedAt: string;
}

export interface GoogleCalendarConnection extends GoogleCalendarSettings {
    connectionId: string;
    accountId: string | null;
    accountEmail: string | null;
    primaryCalendarId: string | null;
    isSchedulingTarget: boolean;
    identitySource: "legacy" | "calendar_list" | "userinfo";
}

export interface GoogleCalendarSource {
    connectionId: string;
    accountEmail: string | null;
    calendarCount: number;
    busyMinutes: number;
    errorCode: string | null;
}

export interface GoogleCalendarBusyBlock extends GoogleCalendarInterval {
    connectionId: string;
    accountEmail: string | null;
    calendarId: string;
}

export interface GoogleCalendarBusyResult {
    intervals: GoogleCalendarInterval[];
    refreshedAt: string;
    blocks?: GoogleCalendarBusyBlock[];
    sources?: GoogleCalendarSource[];
}

export interface GoogleCalendarChoice {
    connectionId?: string;
    accountEmail?: string | null;
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
    connectionId?: string;
    accountEmail?: string | null;
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
}

export interface GoogleCalendarTaskLink {
    connectionId?: string;
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
    | "GOOGLE_CONNECTION_NOT_FOUND"
    | "GOOGLE_ACCOUNT_LIMIT_REACHED"
    | "GOOGLE_ACCOUNT_MISMATCH"
    | "GOOGLE_SCHEDULING_ACCOUNT_REQUIRED"
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
    loadConnections(): Promise<GoogleCalendarConnection[]>;
    setSchedulingConnection(connectionId: string): Promise<void>;
    loadSettings(): Promise<GoogleCalendarSettings | null>;
    beginAuthorization(input: {
        scopeLevel: GoogleCalendarScopeLevel;
        connectionId?: string;
        returnTo: string;
        pendingTaskId?: string;
        pendingScheduledStart?: string;
    }): Promise<string>;
    listCalendars(): Promise<GoogleCalendarChoice[]>;
    updateSelectedCalendars(calendarIds: readonly string[], connectionId?: string): Promise<void>;
    fetchEvents(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]>;
    fetchBusyIntervals(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarBusyResult>;
    loadTaskLink(taskId: string): Promise<GoogleCalendarTaskLink | null>;
    pushTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink>;
    resyncTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink>;
    unpushTask(taskId: string): Promise<void>;
    disconnect(connectionId?: string): Promise<void>;
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
    "GOOGLE_CONNECTION_NOT_FOUND", "GOOGLE_ACCOUNT_LIMIT_REACHED", "GOOGLE_ACCOUNT_MISMATCH", "GOOGLE_SCHEDULING_ACCOUNT_REQUIRED",
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
        ...(typeof record.connection_id === "string" ? { connectionId: record.connection_id } : {}),
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
        return (await this.loadConnections()).find((connection) => connection.isSchedulingTarget) ?? null;
    }

    async loadConnections(): Promise<GoogleCalendarConnection[]> {
        let response;
        try {
            response = await this.client.from("google_calendar_connections")
                .select("id, google_account_id, google_account_email, primary_calendar_id, scope_level, selected_calendar_ids, worktime_calendar_id, is_scheduling_target, identity_source, connected_at, updated_at")
                .eq("owner_id", this.ownerId)
                .order("connected_at").order("id");
        } catch (error) { throw transportError("Unable to load Google Calendar settings.", error); }
        if (response.error) throw new GoogleCalendarIntegrationError("UNKNOWN_ERROR", "Unable to load Google Calendar settings.");
        if (!Array.isArray(response.data)) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google connections returned an invalid response.");
        return response.data.map((row: Record<string, unknown>) => {
            if (
                typeof row.id !== "string" || typeof row.is_scheduling_target !== "boolean"
                || (row.google_account_id !== null && typeof row.google_account_id !== "string")
                || (row.google_account_email !== null && typeof row.google_account_email !== "string")
                || (row.primary_calendar_id !== null && typeof row.primary_calendar_id !== "string")
                || !["legacy", "calendar_list", "userinfo"].includes(String(row.identity_source))
                || (row.scope_level !== "readonly" && row.scope_level !== "schedule")
                || !Array.isArray(row.selected_calendar_ids)
                || (row.worktime_calendar_id !== null && typeof row.worktime_calendar_id !== "string")
                || !validDateString(row.connected_at)
                || !validDateString(row.updated_at)
            ) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google Calendar settings returned an invalid response.");
            return {
                connectionId: row.id,
                accountId: row.google_account_id as string | null,
                accountEmail: row.google_account_email as string | null,
                primaryCalendarId: row.primary_calendar_id as string | null,
                isSchedulingTarget: row.is_scheduling_target,
                identitySource: row.identity_source as GoogleCalendarConnection["identitySource"],
                scopeLevel: row.scope_level,
                selectedCalendarIds: row.selected_calendar_ids.filter((value): value is string => typeof value === "string"),
                worktimeCalendarId: typeof row.worktime_calendar_id === "string" ? row.worktime_calendar_id : null,
                connectedAt: new Date(row.connected_at).toISOString(),
                updatedAt: new Date(row.updated_at).toISOString(),
            };
        });
    }

    async beginAuthorization(input: { scopeLevel: GoogleCalendarScopeLevel; connectionId?: string; returnTo: string; pendingTaskId?: string; pendingScheduledStart?: string }): Promise<string> {
        let response;
        try {
            response = await this.client.functions.invoke("google-calendar-auth", { method: "POST", body: {
                action: "start",
                scope_level: input.scopeLevel,
                return_to: input.returnTo,
                ...(input.connectionId ? { connection_id: input.connectionId } : {}),
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
            return { id: row.id, summary: row.summary, primary: row.primary === true, selected: row.selected === true, accessRole: row.access_role,
                connectionId: typeof row.connection_id === "string" ? row.connection_id : undefined,
                accountEmail: typeof row.account_email === "string" ? row.account_email : null };
        });
    }

    async updateSelectedCalendars(calendarIds: readonly string[], connectionId?: string): Promise<void> {
        const selected = [...new Set(calendarIds.map((value) => value.trim()).filter(Boolean))];
        if (selected.length > 50) throw new GoogleCalendarIntegrationError("GOOGLE_CALENDAR_SELECTION_INVALID", "Select at most 50 calendars.");
        const id = connectionId ?? (await this.loadSettings())?.connectionId;
        if (!id) throw new GoogleCalendarIntegrationError("GOOGLE_SCHEDULING_ACCOUNT_REQUIRED", "Choose a Google scheduling account.");
        let response;
        try { response = await this.client.rpc("update_google_calendar_preferences", { p_connection_id: id, p_selected_calendar_ids: selected }); }
        catch (error) { throw transportError("Unable to save Google Calendar preferences.", error); }
        if (response.error) throw new GoogleCalendarIntegrationError("UNKNOWN_ERROR", "Unable to save Google Calendar preferences.");
    }

    async setSchedulingConnection(connectionId: string): Promise<void> {
        let response;
        try { response = await this.client.rpc("set_google_calendar_scheduling_connection", { p_connection_id: connectionId }); }
        catch (error) { throw transportError("Unable to change Google scheduling account.", error); }
        if (response.error) throw new GoogleCalendarIntegrationError("GOOGLE_CONNECTION_NOT_FOUND", "Unable to change Google scheduling account.");
    }

    async fetchBusyIntervals(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarBusyResult> {
        const data = await this.invoke({ action: "busy", time_min: input.timeMin, time_max: input.timeMax });
        if (!Array.isArray(data.intervals) || !validDateString(data.refreshed_at)) {
            throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid busy time.");
        }
        const intervals = data.intervals.map(interval);
        if (intervals.some((value) => value === null)) throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid busy time.");
        return { intervals: intervals as GoogleCalendarInterval[], refreshedAt: new Date(data.refreshed_at).toISOString(),
            sources: this.sources(data.sources),
            blocks: Array.isArray(data.blocks) ? data.blocks.map((value) => {
                const block = value as Record<string, unknown>;
                const bounds = interval(block);
                if (!bounds || typeof block.connection_id !== "string" || typeof block.calendar_id !== "string") throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid busy sources.");
                return { ...bounds, connectionId: block.connection_id, calendarId: block.calendar_id, accountEmail: typeof block.account_email === "string" ? block.account_email : null };
            }) : [],
        };
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
            return { id: event.id, title: event.title, start: event.start as string, end: event.end as string, allDay: event.allDay,
                connectionId: typeof event.connection_id === "string" ? event.connection_id : undefined,
                accountEmail: typeof event.account_email === "string" ? event.account_email : null };
        });
    }

    async loadTaskLink(taskId: string): Promise<GoogleCalendarTaskLink | null> {
        let response;
        try {
            response = await this.client.from("google_calendar_task_links")
                .select("connection_id, task_id, calendar_id, event_id, scheduled_start, scheduled_end, estimate_pomos, work_minutes, updated_at")
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
    async disconnect(connectionId?: string): Promise<void> { await this.invoke({ action: "disconnect", ...(connectionId ? { connection_id: connectionId } : {}) }); }

    private sources(value: unknown): GoogleCalendarSource[] {
        if (!Array.isArray(value)) return [];
        return value.map((source: Record<string, unknown>) => {
            if (!source || typeof source !== "object" || typeof source.connection_id !== "string" || typeof source.calendar_count !== "number" || typeof source.busy_minutes !== "number") {
                throw new GoogleCalendarIntegrationError("GOOGLE_INVALID_RESPONSE", "Google returned invalid calendar sources.");
            }
            return { connectionId: source.connection_id, accountEmail: typeof source.account_email === "string" ? source.account_email : null,
                calendarCount: source.calendar_count, busyMinutes: source.busy_minutes, errorCode: typeof source.error_code === "string" ? source.error_code : null };
        });
    }

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
