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

export interface GoogleCalendarTaskLinkPayload {
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
