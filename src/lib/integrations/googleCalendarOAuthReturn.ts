import type { GoogleCalendarScopeLevel } from "../data/GoogleCalendarDataAccess";

export interface GoogleCalendarOAuthReturn {
    connectionId?: string | null;
    connected: boolean;
    scopeLevel: GoogleCalendarScopeLevel | null;
    errorCode: string | null;
    pendingTaskId: string | null;
    pendingScheduledStart: string | null;
}

const RETURN_KEYS = [
    "google_calendar", "google_calendar_scope", "google_calendar_error",
    "pending_task_id", "pending_scheduled_start", "connection_id",
] as const;

// Never written by this client, but if a stale or forged return URL carries
// Google account identity it must not survive consumption in the address bar.
const PURGED_IDENTITY_KEYS = ["account_email", "google_account_email", "google_account_id"] as const;

export function parseGoogleCalendarOAuthReturn(url: URL): GoogleCalendarOAuthReturn | null {
    if (!["google_calendar", "google_calendar_error"].some((key) => url.searchParams.has(key))) return null;
    const scope = url.searchParams.get("google_calendar_scope");
    const taskId = url.searchParams.get("pending_task_id")?.trim() || null;
    const rawStart = url.searchParams.get("pending_scheduled_start");
    const parsedStart = rawStart ? new Date(rawStart) : null;
    const validPair = taskId && parsedStart && !Number.isNaN(parsedStart.getTime());
    return {
        connectionId: url.searchParams.get("connection_id"),
        connected: url.searchParams.get("google_calendar") === "connected",
        scopeLevel: scope === "readonly" || scope === "schedule" ? scope : null,
        errorCode: url.searchParams.get("google_calendar_error"),
        pendingTaskId: validPair ? taskId : null,
        pendingScheduledStart: validPair ? parsedStart.toISOString() : null,
    };
}

export function consumeGoogleCalendarOAuthReturn(
    href: string = window.location.href,
    replace: (url: string) => void = (url) => window.history.replaceState(window.history.state, "", url),
): GoogleCalendarOAuthReturn | null {
    const url = new URL(href);
    const result = parseGoogleCalendarOAuthReturn(url);
    if (!result) return null;
    for (const key of [...RETURN_KEYS, ...PURGED_IDENTITY_KEYS]) url.searchParams.delete(key);
    replace(`${url.pathname}${url.search}${url.hash}`);
    return result;
}
