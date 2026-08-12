import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchShortcutStories, ShortcutApiError } from "./shortcutApi.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function bearerToken(request: Request): string | null {
    const match = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);

    const accessToken = bearerToken(request);
    if (!accessToken) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "Shortcut sync is unavailable", code: "SYNC_UNAVAILABLE" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

    const { data: settings, error: settingsError } = await supabase
        .from("shortcut_settings")
        .select("shortcut_token, team_name")
        .eq("owner_id", userData.user.id)
        .maybeSingle();
    if (settingsError) return jsonResponse({ error: "Unable to load Shortcut settings", code: "SETTINGS_READ_FAILED" }, 500);
    if (!settings || typeof settings.shortcut_token !== "string" || typeof settings.team_name !== "string") {
        return jsonResponse({ error: "Shortcut is not configured", code: "SHORTCUT_NOT_CONFIGURED" }, 409);
    }

    try {
        const stories = await fetchShortcutStories({
            token: settings.shortcut_token.trim(),
            teamName: settings.team_name.trim(),
        });
        const syncedAt = new Date().toISOString();
        const { error: updateError } = await supabase
            .from("shortcut_settings")
            .update({ last_synced_at: syncedAt })
            .eq("owner_id", userData.user.id);
        if (updateError) return jsonResponse({ error: "Unable to record Shortcut sync", code: "SYNC_STATE_UPDATE_FAILED" }, 500);
        return jsonResponse({ stories, synced_at: syncedAt }, 200);
    } catch (error) {
        if (error instanceof ShortcutApiError) {
            const body: Record<string, unknown> = { error: error.message, code: error.code };
            if (error.retryAfterSeconds !== undefined) body.retry_after_seconds = error.retryAfterSeconds;
            return jsonResponse(body, error.status);
        }
        return jsonResponse({ error: "Shortcut sync failed", code: "SYNC_FAILED" }, 500);
    }
});
