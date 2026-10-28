import { createClient } from "npm:@supabase/supabase-js@2";
import type { GoogleCalendarScopeLevel } from "../_shared/googleCalendarTypes.ts";
import { authorizeGoogleConnection } from "./googleConnectionAuthorization.ts";
import {
    buildGoogleAuthorizationUrl,
    createCodeChallenge,
    createCodeVerifier,
    createOAuthState,
    GoogleOAuthError,
    hashOAuthState,
    validateReturnUrl,
} from "./googleOAuth.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function bearerToken(request: Request): string | null {
    return request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function requiredEnvironment(): {
    supabaseUrl: string;
    serviceRoleKey: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    allowedOrigins: string[];
} | null {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    const redirectUri = Deno.env.get("GOOGLE_CALENDAR_REDIRECT_URI");
    const allowedOrigins = (Deno.env.get("GOOGLE_CALENDAR_ALLOWED_RETURN_ORIGINS") ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);
    return supabaseUrl && serviceRoleKey && clientId && clientSecret && redirectUri && allowedOrigins.length
        ? { supabaseUrl, serviceRoleKey, clientId, clientSecret, redirectUri, allowedOrigins }
        : null;
}

function redirectWith(returnTo: string, values: Record<string, string | undefined>): Response {
    const url = new URL(returnTo);
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) url.searchParams.set(key, value);
    }
    return Response.redirect(url.toString(), 302);
}

function scopeLevel(value: unknown): GoogleCalendarScopeLevel | null {
    return value === "readonly" || value === "schedule" ? value : null;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const env = requiredEnvironment();
    if (!env) return jsonResponse({ error: "Google Calendar integration is unavailable", code: "INTEGRATION_UNAVAILABLE" }, 500);
    const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    if (request.method === "POST") {
        const accessToken = bearerToken(request);
        if (!accessToken) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
        const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
        if (userError || !userData.user) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

        let body: Record<string, unknown>;
        try {
            const parsed = await request.json();
            body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch { body = {}; }
        const requestedScope = scopeLevel(body.scope_level);
        if (body.action !== "start" || !requestedScope || typeof body.return_to !== "string") {
            return jsonResponse({ error: "Invalid authorization request", code: "INVALID_REQUEST" }, 400);
        }
        let connectionId: string | null = null;
        if (body.connection_id !== undefined) {
            if (typeof body.connection_id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.connection_id)) {
                return jsonResponse({ error: "Invalid connection ID", code: "INVALID_REQUEST" }, 400);
            }
            const { data: connection, error } = await supabase.from("google_calendar_connections").select("id")
                .eq("owner_id", userData.user.id).eq("id", body.connection_id).maybeSingle();
            if (error) return jsonResponse({ error: "Unable to load Google connection", code: "INTEGRATION_UNAVAILABLE" }, 500);
            if (!connection) return jsonResponse({ error: "Google connection was not found", code: "GOOGLE_CONNECTION_NOT_FOUND" }, 404);
            connectionId = connection.id;
        }
        let returnTo: URL;
        try { returnTo = validateReturnUrl(body.return_to, env.allowedOrigins); }
        catch (error) {
            const status = error instanceof GoogleOAuthError ? error.status : 400;
            return jsonResponse({ error: "Return URL is not allowed", code: "INVALID_REQUEST" }, status);
        }
        let pendingTaskId: string | null = null;
        let pendingScheduledStart: string | null = null;
        if (body.pending_task_id !== undefined || body.pending_scheduled_start !== undefined) {
            const parsed = typeof body.pending_scheduled_start === "string" ? new Date(body.pending_scheduled_start) : null;
            if (
                requestedScope !== "schedule"
                || typeof body.pending_task_id !== "string"
                || !body.pending_task_id.trim()
                || !parsed
                || Number.isNaN(parsed.getTime())
            ) return jsonResponse({ error: "Invalid pending task", code: "INVALID_REQUEST" }, 400);
            pendingTaskId = body.pending_task_id.trim();
            pendingScheduledStart = parsed.toISOString();
        }

        const state = createOAuthState();
        const verifier = createCodeVerifier();
        const [stateHash, challenge] = await Promise.all([hashOAuthState(state), createCodeChallenge(verifier)]);
        await supabase.from("google_calendar_oauth_states").delete().lt("expires_at", new Date().toISOString());
        const { error: stateError } = await supabase.from("google_calendar_oauth_states").insert({
            state_hash: stateHash,
            owner_id: userData.user.id,
            connection_id: connectionId,
            code_verifier: verifier,
            requested_scope_level: requestedScope,
            return_to: returnTo.toString(),
            pending_task_id: pendingTaskId,
            pending_scheduled_start: pendingScheduledStart,
            expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        if (stateError) return jsonResponse({ error: "Unable to begin Google authorization", code: "INTEGRATION_UNAVAILABLE" }, 500);
        return jsonResponse({ authorization_url: buildGoogleAuthorizationUrl({
            clientId: env.clientId,
            redirectUri: env.redirectUri,
            state,
            codeChallenge: challenge,
            scopeLevel: requestedScope,
        }) }, 200);
    }

    if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
    }
    const requestUrl = new URL(request.url);
    const state = requestUrl.searchParams.get("state");
    if (!state) return jsonResponse({ error: "OAuth state is missing", code: "INVALID_REQUEST" }, 400);
    const stateHash = await hashOAuthState(state);
    const { data: oauthState, error: stateError } = await supabase
        .from("google_calendar_oauth_states")
        .delete()
        .eq("state_hash", stateHash)
        .select("owner_id, connection_id, code_verifier, requested_scope_level, return_to, pending_task_id, pending_scheduled_start, expires_at")
        .maybeSingle();
    if (stateError || !oauthState) return jsonResponse({ error: "OAuth state is invalid or expired", code: "INVALID_REQUEST" }, 400);
    const returnTo = String(oauthState.return_to);
    if (new Date(String(oauthState.expires_at)).getTime() <= Date.now()) {
        return redirectWith(returnTo, { google_calendar_error: "OAUTH_STATE_EXPIRED" });
    }
    if (requestUrl.searchParams.get("error")) {
        return redirectWith(returnTo, { google_calendar_error: "OAUTH_ACCESS_DENIED" });
    }
    const code = requestUrl.searchParams.get("code");
    if (!code) return redirectWith(returnTo, { google_calendar_error: "OAUTH_CODE_MISSING" });

    try {
        const { data: connections, error: connectionsError } = await supabase.from("google_calendar_connections")
            .select("*").eq("owner_id", oauthState.owner_id).order("connected_at").order("id");
        if (connectionsError) throw new GoogleOAuthError("CONNECTION_SAVE_FAILED", 500, "Unable to load Google connections");
        const { token, connectionId, identity, primaryCalendarId } = await authorizeGoogleConnection({
            connections: connections ?? [], targetConnectionId: oauthState.connection_id,
            persistIdentity: async (connection) => {
                const { error } = await supabase.from("google_calendar_connections").update({
                    primary_calendar_id: connection.primary_calendar_id, identity_source: connection.identity_source,
                }).eq("owner_id", oauthState.owner_id).eq("id", connection.id).is("google_account_id", null);
                if (error) throw new GoogleOAuthError("CONNECTION_SAVE_FAILED", 500, "Unable to save legacy identity");
            },
            code,
            codeVerifier: String(oauthState.code_verifier),
            clientId: env.clientId,
            clientSecret: env.clientSecret,
            redirectUri: env.redirectUri,
        });
        const { data: savedId, error: saveError } = await supabase.rpc("save_google_calendar_connection", {
            p_owner_id: oauthState.owner_id,
            p_connection_id: connectionId,
            p_google_account_id: identity.sub,
            p_google_account_email: identity.email,
            p_primary_calendar_id: primaryCalendarId,
            p_refresh_token: token.refreshToken,
            p_scope_level: token.scopeLevel,
        });
        if (saveError) {
            const code = ["GOOGLE_ACCOUNT_LIMIT_REACHED", "GOOGLE_CONNECTION_NOT_FOUND", "GOOGLE_ACCOUNT_MISMATCH"]
                .find((value) => saveError.message === value) ?? "CONNECTION_SAVE_FAILED";
            return redirectWith(returnTo, { google_calendar_error: code });
        }
        if (typeof savedId !== "string" || !savedId.trim()) {
            throw new GoogleOAuthError("CONNECTION_SAVE_FAILED", 500, "Google connection was not saved");
        }
        if (oauthState.requested_scope_level === "schedule" && token.scopeLevel !== "schedule") {
            return redirectWith(returnTo, {
                google_calendar: "connected",
                google_calendar_scope: token.scopeLevel,
                connection_id: String(savedId),
                google_calendar_error: "SCHEDULE_SCOPE_DENIED",
            });
        }
        return redirectWith(returnTo, {
            google_calendar: "connected",
            google_calendar_scope: token.scopeLevel,
            connection_id: String(savedId),
            pending_task_id: oauthState.pending_task_id ?? undefined,
            pending_scheduled_start: oauthState.pending_scheduled_start
                ? new Date(oauthState.pending_scheduled_start).toISOString()
                : undefined,
        });
    } catch (error) {
        const codeValue = error instanceof GoogleOAuthError ? error.code : "GOOGLE_OAUTH_FAILED";
        return redirectWith(returnTo, { google_calendar_error: codeValue });
    }
});
