import type { GoogleCalendarConnection } from "../_shared/googleCalendarTypes.ts";
import { listGoogleCalendars } from "../google-calendar/googleCalendarApi.ts";
import { exchangeGoogleAuthorizationCode, fetchGoogleIdentity, GoogleOAuthError, refreshGoogleAccessToken } from "./googleOAuth.ts";

export function matchGoogleConnection(input: {
    connections: GoogleCalendarConnection[];
    sub: string;
    email: string | null;
    primaryCalendarId: string | null;
    targetConnectionId?: string | null;
}): GoogleCalendarConnection | null {
    const { connections, sub, email, primaryCalendarId, targetConnectionId } = input;
    const target = targetConnectionId ? connections.find((connection) => connection.id === targetConnectionId) : null;
    if (targetConnectionId && !target) throw new GoogleOAuthError("GOOGLE_CONNECTION_NOT_FOUND", 404, "Google connection was not found");
    const legacy = connections.filter((connection) => !connection.google_account_id);
    const uniqueMatch = (matches: GoogleCalendarConnection[]) => {
        if (matches.length > 1) throw new GoogleOAuthError("GOOGLE_ACCOUNT_MISMATCH", 409, "Google account identity is ambiguous");
        return matches[0] ?? null;
    };
    const matched = uniqueMatch(connections.filter((connection) => connection.google_account_id === sub))
        ?? (email ? uniqueMatch(legacy.filter((connection) => connection.google_account_email?.toLowerCase() === email.toLowerCase())) : null)
        ?? (primaryCalendarId ? uniqueMatch(legacy.filter((connection) => connection.primary_calendar_id === primaryCalendarId)) : null);
    if (target && matched?.id !== target.id) throw new GoogleOAuthError("GOOGLE_ACCOUNT_MISMATCH", 409, "Choose the account belonging to this connection");
    if (!matched && legacy.some((connection) => !connection.primary_calendar_id)) {
        throw new GoogleOAuthError("GOOGLE_LEGACY_CONNECTION_UNVERIFIED", 409,
            "A legacy Google account could not be verified. Disconnect that account and reconnect it.");
    }
    if (!matched && connections.length >= 5) throw new GoogleOAuthError("GOOGLE_ACCOUNT_LIMIT_REACHED", 409, "Connect at most five Google accounts");
    return matched;
}

export async function authorizeGoogleConnection(input: {
    connections: GoogleCalendarConnection[];
    targetConnectionId?: string | null;
    persistIdentity?: (connection: GoogleCalendarConnection) => Promise<void>;
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}, fetcher: typeof fetch = fetch) {
    let matched: GoogleCalendarConnection | null = null;
    let identity: { sub: string; email: string | null } | undefined;
    let primaryCalendarId: string | null = null;
    const token = await exchangeGoogleAuthorizationCode({
        ...input,
        resolveExistingRefreshToken: async (accessToken) => {
            identity = await fetchGoogleIdentity(accessToken, fetcher);
            primaryCalendarId = (await listGoogleCalendars(accessToken, fetcher)).find((calendar) => calendar.primary)?.id ?? null;
            // An untouched migrated row has no primary id yet. Resolve it using
            // its own credential, never assume the sole legacy row is this user.
            const connections = await Promise.all(input.connections.map(async (connection) => {
                if (connection.google_account_id || connection.primary_calendar_id) return connection;
                try {
                    const legacyToken = await refreshGoogleAccessToken({ ...input, refreshToken: connection.refresh_token }, fetcher);
                    const primary = (await listGoogleCalendars(legacyToken, fetcher)).find((calendar) => calendar.primary);
                    if (!primary) return connection;
                    const resolved: GoogleCalendarConnection = { ...connection, primary_calendar_id: primary.id, identity_source: "calendar_list" };
                    await input.persistIdentity?.(resolved);
                    return resolved;
                } catch (error) {
                    if (error instanceof GoogleOAuthError && error.code === "GOOGLE_TOKEN_INVALID") return connection;
                    throw error;
                }
            }));
            matched = matchGoogleConnection({ connections, sub: identity.sub, email: identity.email, primaryCalendarId,
                targetConnectionId: input.targetConnectionId });
            return matched?.refresh_token ?? null;
        },
    }, fetcher);
    if (!identity) throw new GoogleOAuthError("GOOGLE_OAUTH_INVALID_RESPONSE", 502, "Google identity was not resolved");
    return { token, connectionId: (matched as GoogleCalendarConnection | null)?.id ?? null, identity, primaryCalendarId };
}
