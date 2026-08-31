import type { GoogleCalendarScopeLevel } from "../_shared/googleCalendarTypes.ts";

export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_SCHEDULE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleOAuthError extends Error {
    constructor(
        readonly code: string,
        readonly status: number,
        message: string,
        readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "GoogleOAuthError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

export function createOAuthState(): string {
    return base64Url(randomBytes(32));
}

export function createCodeVerifier(): string {
    return base64Url(randomBytes(64));
}

async function sha256(value: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function createCodeChallenge(verifier: string): Promise<string> {
    return base64Url(await sha256(verifier));
}

export async function hashOAuthState(state: string): Promise<string> {
    return [...await sha256(state)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function scopesForLevel(level: GoogleCalendarScopeLevel): string[] {
    return level === "schedule"
        ? [GOOGLE_CALENDAR_READONLY_SCOPE, GOOGLE_CALENDAR_SCHEDULE_SCOPE]
        : [GOOGLE_CALENDAR_READONLY_SCOPE];
}

export function scopeLevelFromGrantedScopes(scope: string): GoogleCalendarScopeLevel | null {
    const granted = new Set(scope.split(/\s+/).filter(Boolean));
    if (!granted.has(GOOGLE_CALENDAR_READONLY_SCOPE)) return null;
    return granted.has(GOOGLE_CALENDAR_SCHEDULE_SCOPE) ? "schedule" : "readonly";
}

export function validateReturnUrl(value: string, allowedOrigins: readonly string[]): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new GoogleOAuthError("RETURN_URL_INVALID", 400, "Return URL is invalid");
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new GoogleOAuthError("RETURN_URL_INVALID", 400, "Return URL is invalid");
    }
    const allowed = new Set(allowedOrigins.map((origin) => {
        try { return new URL(origin).origin; } catch { return ""; }
    }).filter(Boolean));
    if (!allowed.has(url.origin)) {
        throw new GoogleOAuthError("RETURN_URL_INVALID", 400, "Return origin is not allowed");
    }
    for (const key of [
        "google_calendar", "google_calendar_scope", "google_calendar_error",
        "pending_task_id", "pending_scheduled_start",
    ]) url.searchParams.delete(key);
    url.hash = "";
    return url;
}

export function buildGoogleAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scopeLevel: GoogleCalendarScopeLevel;
}): string {
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopesForLevel(input.scopeLevel).join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
}

interface GoogleTokenResponse {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
}

async function tokenRequest(
    body: URLSearchParams,
    fetcher: typeof fetch,
    invalidCredentialsCode?: string,
): Promise<GoogleTokenResponse> {
    let response: Response;
    try {
        response = await fetcher(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
    } catch {
        throw new GoogleOAuthError("GOOGLE_OAUTH_UNAVAILABLE", 502, "Google authorization is unavailable");
    }
    if (!response.ok) {
        if (invalidCredentialsCode && (response.status === 400 || response.status === 401)) {
            throw new GoogleOAuthError(invalidCredentialsCode, 401, "Google Calendar must be reconnected");
        }
        const retry = Number(response.headers.get("Retry-After"));
        throw new GoogleOAuthError(
            response.status === 429 ? "GOOGLE_RATE_LIMITED" : "GOOGLE_OAUTH_EXCHANGE_FAILED",
            response.status === 429 ? 429 : 502,
            "Google authorization failed",
            Number.isFinite(retry) ? Math.max(0, Math.ceil(retry)) : undefined,
        );
    }
    let value: unknown;
    try { value = await response.json(); } catch { value = null; }
    if (!value || typeof value !== "object") {
        throw new GoogleOAuthError("GOOGLE_OAUTH_INVALID_RESPONSE", 502, "Google authorization returned an invalid response");
    }
    return value as GoogleTokenResponse;
}

export async function exchangeGoogleAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    existingRefreshToken?: string | null;
}, fetcher: typeof fetch = fetch): Promise<{
    accessToken: string;
    refreshToken: string;
    scopeLevel: GoogleCalendarScopeLevel;
}> {
    const result = await tokenRequest(new URLSearchParams({
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
    }), fetcher);
    const accessToken = typeof result.access_token === "string" ? result.access_token : "";
    const refreshToken = typeof result.refresh_token === "string" && result.refresh_token.trim()
        ? result.refresh_token.trim()
        : input.existingRefreshToken?.trim() ?? "";
    const scopeLevel = typeof result.scope === "string" ? scopeLevelFromGrantedScopes(result.scope) : null;
    if (!accessToken || !refreshToken || !scopeLevel) {
        throw new GoogleOAuthError("GOOGLE_OAUTH_INVALID_RESPONSE", 502, "Google authorization returned incomplete credentials");
    }
    return { accessToken, refreshToken, scopeLevel };
}

export async function refreshGoogleAccessToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
}, fetcher: typeof fetch = fetch): Promise<string> {
    const result = await tokenRequest(new URLSearchParams({
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "refresh_token",
    }), fetcher, "GOOGLE_TOKEN_INVALID");
    if (typeof result.access_token !== "string" || !result.access_token) {
        throw new GoogleOAuthError("GOOGLE_TOKEN_INVALID", 401, "Google Calendar must be reconnected");
    }
    return result.access_token;
}
