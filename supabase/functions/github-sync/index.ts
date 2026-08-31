import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchGitHubIssues, GitHubApiError } from "../_shared/githubApi.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

interface RepoRow {
    full_name: string;
    project_id: string | null;
    label_filter: string | null;
    include_closed: boolean;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function bearerToken(request: Request): string | null {
    const match = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestRepoFullName(request: Request): Promise<string | null> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return null;
    }
    if (!isRecord(body) || Object.keys(body).some((key) => key !== "full_name")) return null;
    if (typeof body.full_name !== "string") return null;
    const fullName = body.full_name.trim();
    return /^[^/\s]+\/[^/\s]+$/.test(fullName) ? fullName : null;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
    }

    const accessToken = bearerToken(request);
    if (!accessToken) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

    const fullName = await requestRepoFullName(request);
    if (!fullName) {
        return jsonResponse({ error: "A valid repository full_name is required", code: "INVALID_REQUEST" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "GitHub sync is unavailable", code: "SYNC_UNAVAILABLE" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
        return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
    }
    const ownerId = userData.user.id;

    const { data: repoData, error: repoError } = await supabase
        .from("github_repos")
        .select("full_name, project_id, label_filter, include_closed")
        .eq("owner_id", ownerId)
        .eq("full_name", fullName)
        .maybeSingle();
    if (repoError) {
        return jsonResponse({ error: "Unable to load GitHub repository", code: "REPOSITORY_READ_FAILED" }, 500);
    }
    if (!repoData) {
        return jsonResponse({ error: "GitHub repository was not found", code: "GITHUB_REPO_NOT_FOUND" }, 404);
    }
    const repo = repoData as Partial<RepoRow>;
    if (
        repo.full_name !== fullName
        || (repo.project_id !== null && typeof repo.project_id !== "string")
        || (repo.label_filter !== null && typeof repo.label_filter !== "string")
        || typeof repo.include_closed !== "boolean"
    ) {
        return jsonResponse({ error: "Unable to load GitHub repository", code: "REPOSITORY_READ_FAILED" }, 500);
    }

    const { data: settings, error: settingsError } = await supabase
        .from("github_settings")
        .select("token")
        .eq("owner_id", ownerId)
        .maybeSingle();
    if (settingsError) {
        return jsonResponse({ error: "Unable to load GitHub settings", code: "SETTINGS_READ_FAILED" }, 500);
    }
    if (!settings || typeof settings.token !== "string" || !settings.token.trim()) {
        return jsonResponse({ error: "GitHub is not configured", code: "GITHUB_NOT_CONFIGURED" }, 409);
    }

    try {
        const issues = await fetchGitHubIssues(settings.token.trim(), fullName, {
            includeClosed: repo.include_closed,
            labelFilter: repo.label_filter,
        });
        const syncedAt = new Date().toISOString();
        const { error: updateError } = await supabase
            .from("github_settings")
            .update({ last_synced_at: syncedAt })
            .eq("owner_id", ownerId);
        if (updateError) {
            return jsonResponse({ error: "Unable to record GitHub sync", code: "SYNC_STATE_UPDATE_FAILED" }, 500);
        }
        return jsonResponse({
            issues,
            repo: {
                full_name: fullName,
                project_id: repo.project_id,
                label_filter: repo.label_filter,
                include_closed: repo.include_closed,
            },
            synced_at: syncedAt,
        }, 200);
    } catch (error) {
        if (error instanceof GitHubApiError) {
            const body: Record<string, unknown> = { error: error.message, code: error.code };
            if (error.retryAfterSeconds !== undefined) body.retry_after_seconds = error.retryAfterSeconds;
            return jsonResponse(body, error.status);
        }
        return jsonResponse({ error: "GitHub sync failed", code: "SYNC_FAILED" }, 500);
    }
});
