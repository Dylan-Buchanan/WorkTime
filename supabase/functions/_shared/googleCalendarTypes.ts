export type GoogleCalendarScopeLevel = "readonly" | "schedule";

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

export interface GoogleCalendarProvenance {
    connection_id: string;
    account_email: string | null;
}

export interface GoogleCalendarSource extends GoogleCalendarProvenance {
    calendar_count: number;
    busy_minutes: number;
    error_code: string | null;
}

export interface GoogleCalendarBusyBlock extends GoogleCalendarInterval, GoogleCalendarProvenance {
    calendar_id: string;
}

export interface GoogleCalendarChoicePayload extends GoogleCalendarProvenance {
    id: string;
    summary: string;
    primary: boolean;
    selected: boolean;
    access_role: string;
}

export interface GoogleCalendarEventsPayload {
    events: Array<GoogleCalendarEvent & GoogleCalendarProvenance>;
    sources: GoogleCalendarSource[];
}

export interface GoogleCalendarBusyPayload {
    intervals: GoogleCalendarInterval[];
    blocks: GoogleCalendarBusyBlock[];
    sources: GoogleCalendarSource[];
    refreshed_at: string;
}

export interface GoogleCalendarConnection {
    id: string;
    owner_id: string;
    google_account_id: string | null;
    google_account_email: string | null;
    primary_calendar_id: string | null;
    refresh_token: string;
    scope_level: GoogleCalendarScopeLevel;
    selected_calendar_ids: string[];
    worktime_calendar_id: string | null;
    is_scheduling_target: boolean;
    identity_source: "legacy" | "calendar_list" | "userinfo";
    connected_at: string;
    updated_at: string;
}

export interface GoogleCalendarTaskLinkPayload {
    connection_id: string;
    task_id: string;
    calendar_id: string;
    event_id: string;
    scheduled_start: string;
    scheduled_end: string;
    estimate_pomos: number;
    work_minutes: number;
    updated_at: string;
}

export type GoogleCalendarAction =
    | "list_calendars"
    | "list_events"
    | "busy"
    | "push_task"
    | "resync_task"
    | "unpush_task"
    | "disconnect";

export type GoogleCalendarErrorCode =
    | "AUTH_REQUIRED"
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
    | "METHOD_NOT_ALLOWED"
    | "INTEGRATION_UNAVAILABLE";
