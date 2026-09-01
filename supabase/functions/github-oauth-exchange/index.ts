import { createClient } from "npm:@supabase/supabase-js@2";
import {
    buildGitHubAuthorizationUrl,
    exchangeGitHubAuthorizationCode,
    fetchGitHubUsername,
    GitHubOAuthError,
} from "./githubOAuth.ts";

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
    return request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function githubEnvironment(): { clientId: string; clientSecret: string; redirectUri: string } | null {
    const clientId = Deno.env.get("INTEGRATION_GITHUB_OAUTH_CLIENT_ID")?.trim();
    const clientSecret = Deno.env.get("INTEGRATION_GITHUB_OAUTH_CLIENT_SECRET")?.trim();
    const redirectUri = Deno.env.get("INTEGRATION_GITHUB_OAUTH_REDIRECT_URI")?.trim();
    return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);

    const accessToken = bearerToken(request);
    if (!accessToken) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "GitHub authorization failed", code: "EXCHANGE_FAILED" }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

    const github = githubEnvironment();
    if (!github) return jsonResponse({ error: "GitHub is not configured", code: "GITHUB_NOT_CONFIGURED" }, 503);

    let body: Record<string, unknown>;
    try {
        const value: unknown = await request.json();
        body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch {
        body = {};
    }

    try {
        if (body.action === "start") {
            if (typeof body.state !== "string" || !body.state.trim()) {
                return jsonResponse({ error: "OAuth state is required", code: "INVALID_REQUEST" }, 400);
            }
            return jsonResponse({ authorization_url: buildGitHubAuthorizationUrl({
                clientId: github.clientId,
                redirectUri: github.redirectUri,
                state: body.state,
            }) }, 200);
        }

        if (body.action !== "exchange" || typeof body.code !== "string" || !body.code.trim()) {
            return jsonResponse({ error: "Invalid authorization request", code: "INVALID_REQUEST" }, 400);
        }
        const token = await exchangeGitHubAuthorizationCode({
            code: body.code,
            clientId: github.clientId,
            clientSecret: github.clientSecret,
            redirectUri: github.redirectUri,
        });
        const githubUsername = await fetchGitHubUsername(token);
        const { error: saveError } = await supabase.from("github_settings").upsert({
            owner_id: userData.user.id,
            token,
            github_username: githubUsername,
        }, { onConflict: "owner_id" });
        if (saveError) {
            return jsonResponse({ error: "Unable to save GitHub connection", code: "SETTINGS_SAVE_FAILED" }, 500);
        }
        return jsonResponse({ github_username: githubUsername }, 200);
    } catch (error) {
        if (error instanceof GitHubOAuthError) {
            return jsonResponse({ error: error.message, code: error.code }, error.status);
        }
        return jsonResponse({ error: "GitHub authorization failed", code: "EXCHANGE_FAILED" }, 500);
    }
});
