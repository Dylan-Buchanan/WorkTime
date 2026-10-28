import type { GoogleCalendarConnection } from "../data/GoogleCalendarDataAccess";

export interface GoogleCalendarAccountIdentity {
    accountEmail?: string | null;
    primaryCalendarId?: string | null;
}

/**
 * A stable, human-readable label for an account chip or warning. Calendar-list
 * only connections may never gain an email, so the primary calendar id is a
 * legitimate fallback rather than a temporary one.
 */
export function googleAccountLabel(account: GoogleCalendarAccountIdentity | GoogleCalendarConnection | null | undefined): string {
    const email = account?.accountEmail?.trim();
    if (email) return email;
    const primary = account?.primaryCalendarId?.trim();
    if (primary) return primary;
    return "Unidentified";
}

export function googleAccountInitial(label: string): string {
    return label.trim().charAt(0).toUpperCase() || "?";
}
