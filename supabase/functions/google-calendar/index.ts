import { createClient } from "npm:@supabase/supabase-js@2";
import { executeGoogleCalendarAction } from "./googleCalendarOperations.ts";

const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};
const failure = (code: string, error: string, status: number) => new Response(JSON.stringify({ code, error }), { status, headers });

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) return failure("INTEGRATION_UNAVAILABLE", "Google Calendar integration is unavailable", 500);
    const jwt = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!jwt) return failure("AUTH_REQUIRED", "Authentication required", 401);
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user) return failure("AUTH_REQUIRED", "Authentication required", 401);
    let body;
    try { body = await request.json(); } catch { return failure("INVALID_REQUEST", "Invalid request", 400); }
    if (!body || typeof body.action !== "string") return failure("INVALID_REQUEST", "Invalid request", 400);
    return executeGoogleCalendarAction({ supabase, ownerId: data.user.id, body, clientId, clientSecret });
});
