import { createClient } from "npm:@supabase/supabase-js@2";
import {
    fetchGitHubLabels,
    fetchGitHubRepositories,
    GitHubApiError,
    type GitHubLabel,
} from "../_shared/githubApi.ts";
import { githubRepoUpserts, reconcileGitHubRepos, type StoredGitHubRepo } from "./reconcile.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
};

interface RepoRow extends StoredGitHubRepo {
    owner_id: string;
    selected: boolean;
    project_id: string | null;
    label_filter: string | null;
    include_closed: boolean;
    updated_at: string;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function bearerToken(request: Request): string | null {
    const match = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
    }

    const accessToken = bearerToken(request);
    if (!accessToken) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
        return jsonResponse({ error: "GitHub enumeration is unavailable", code: "ENUMERATION_UNAVAILABLE" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
        return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
    }
    const ownerId = userData.user.id;

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
        const accessible = await fetchGitHubRepositories(settings.token.trim());
        const { data: storedData, error: storedError } = await supabase
            .from("github_repos")
            .select("full_name, is_stale")
            .eq("owner_id", ownerId);
        if (storedError || !Array.isArray(storedData)) {
            return jsonResponse({ error: "Unable to load GitHub repositories", code: "REPOSITORY_READ_FAILED" }, 500);
        }

        const labelsByRepo = new Map<string, GitHubLabel[]>();
        for (const repo of accessible) {
            labelsByRepo.set(repo.fullName, await fetchGitHubLabels(settings.token.trim(), repo.fullName));
        }

        const reconciliation = reconcileGitHubRepos(storedData as StoredGitHubRepo[], accessible.map((repo) => repo.fullName));
        if (accessible.length > 0) {
            const { error: upsertError } = await supabase.from("github_repos").upsert(
                githubRepoUpserts(ownerId, accessible.map((repo) => repo.fullName)),
                { onConflict: "owner_id,full_name" },
            );
            if (upsertError) {
                return jsonResponse({ error: "Unable to save GitHub repositories", code: "REPOSITORY_WRITE_FAILED" }, 500);
            }
        }
        if (reconciliation.missing.length > 0) {
            const { error: staleError } = await supabase
                .from("github_repos")
                .update({ is_stale: true })
                .eq("owner_id", ownerId)
                .in("full_name", reconciliation.missing);
            if (staleError) {
                return jsonResponse({ error: "Unable to save GitHub repositories", code: "REPOSITORY_WRITE_FAILED" }, 500);
            }
        }

        const { data: rows, error: rowsError } = await supabase
            .from("github_repos")
            .select("owner_id, full_name, selected, project_id, label_filter, include_closed, is_stale, updated_at")
            .eq("owner_id", ownerId)
            .order("full_name", { ascending: true });
        if (rowsError || !Array.isArray(rows)) {
            return jsonResponse({ error: "Unable to load GitHub repositories", code: "REPOSITORY_READ_FAILED" }, 500);
        }

        return jsonResponse({
            repos: (rows as RepoRow[]).map((row) => ({
                ...row,
                labels: labelsByRepo.get(row.full_name) ?? [],
            })),
        }, 200);
    } catch (error) {
        if (error instanceof GitHubApiError) {
            const body: Record<string, unknown> = { error: error.message, code: error.code };
            if (error.retryAfterSeconds !== undefined) body.retry_after_seconds = error.retryAfterSeconds;
            return jsonResponse(body, error.status);
        }
        return jsonResponse({ error: "GitHub enumeration failed", code: "ENUMERATION_FAILED" }, 500);
    }
});
