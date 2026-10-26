import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchLinearIssues, LinearApiError } from "./linearApi.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

interface Dependencies {
    createClient: (url: string, key: string, options: { auth: {
        persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean;
    } }) => SupabaseClient;
    env: (name: string) => string | undefined;
    fetchIssues?: typeof fetchLinearIssues;
}

// Keep the HTTP boundary testable without starting a Deno server or using a real key.
export function createLinearSyncHandler(dependencies: Dependencies): (request: Request) => Promise<Response> {
    return async (request) => {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
        if (request.method !== "POST") return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
        const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        if (!token) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

        const url = dependencies.env("SUPABASE_URL");
        const key = dependencies.env("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !key) return jsonResponse({ error: "Linear sync is unavailable", code: "SYNC_UNAVAILABLE" }, 500);

        try {
            const supabase = dependencies.createClient(url, key, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            });
            const { data: userData, error: userError } = await supabase.auth.getUser(token);
            if (userError || !userData.user) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
            const ownerId = userData.user.id;
            const { data: settings, error: settingsError } = await supabase
                .from("linear_settings")
                .select("linear_token, team_key")
                .eq("owner_id", ownerId)
                .maybeSingle();
            if (settingsError) return jsonResponse({ error: "Unable to load Linear settings", code: "SETTINGS_READ_FAILED" }, 500);
            if (!settings || typeof settings.linear_token !== "string" || !settings.linear_token.trim()) {
                return jsonResponse({ error: "Linear is not configured", code: "LINEAR_NOT_CONFIGURED" }, 409);
            }
            if (settings.team_key !== null && typeof settings.team_key !== "string") {
                return jsonResponse({ error: "Invalid Linear settings", code: "SETTINGS_READ_FAILED" }, 500);
            }

            const result = await (dependencies.fetchIssues ?? fetchLinearIssues)({ token: settings.linear_token, teamKey: settings.team_key });
            const syncedAt = new Date().toISOString();
            const { data: updated, error: updateError } = await supabase
                .from("linear_settings")
                .update({ last_synced_at: syncedAt })
                .eq("owner_id", ownerId)
                .select("owner_id")
                .maybeSingle();
            if (updateError || !updated) return jsonResponse({ error: "Unable to record Linear sync", code: "SYNC_STATE_UPDATE_FAILED" }, 500);
            return jsonResponse({ ...result, synced_at: syncedAt }, 200);
        } catch (error) {
            if (error instanceof LinearApiError) {
                const body: Record<string, unknown> = { error: error.message, code: error.code };
                if (error.retryAfterSeconds !== undefined) body.retry_after_seconds = error.retryAfterSeconds;
                return jsonResponse(body, error.status);
            }
            return jsonResponse({ error: "Linear sync failed", code: "SYNC_FAILED" }, 500);
        }
    };
}
