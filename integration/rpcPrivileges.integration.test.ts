import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { localSupabaseConfig } from "../tests/supabase/localSupabase";

function anonymousClient(): SupabaseClient {
    const config = localSupabaseConfig();
    return createClient(config.url, config.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

async function expectPermissionDenied(request: PromiseLike<{ error: { code?: string; message: string } | null }>): Promise<void> {
    const { error } = await request;
    expect(error).toMatchObject({ code: "42501" });
    expect(error?.message).toMatch(/permission denied for function/i);
}

describe("security-definer RPC privileges", () => {
    it("denies anonymous staged sync calls", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("apply_staged_sync", {
            p_task_upserts: null,
            p_task_tombstones: null,
            p_log_upserts: null,
            p_log_tombstones: null,
            p_habit_upserts: null,
            p_habit_tombstones: null,
            p_habit_completion_upserts: null,
            p_habit_completion_tombstones: null,
            p_todo_upserts: null,
            p_todo_tombstones: null,
            p_todo_completion_upserts: null,
            p_todo_completion_tombstones: null,
            p_settings_data: null,
            p_settings_updated_at: null,
            p_timer_data: null,
            p_timer_updated_at: null,
            p_timer_new_generation: false,
            p_pm_data: null,
            p_pm_updated_at: null,
            p_full_wipe: false,
        }));
    });

    it("denies anonymous transition persistence calls", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("persist_transition", {
            p_tasks: null,
            p_logs: null,
            p_settings: null,
            p_timer_data: null,
            p_timer_new_generation: false,
            p_timer_updated_at: null,
        }));
    });

    it("denies anonymous timer completion calls", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("complete_timer", {
            p_expected_timer: null,
            p_timer_data: null,
            p_log: null,
            p_task: null,
        }));
    });

    it("denies anonymous Shortcut credential writes", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("save_shortcut_settings", {
            p_shortcut_token: "not-authorized",
            p_team_name: "Not Authorized",
            p_included_statuses: ["In Dev"],
            p_default_project_id: null,
        }));
    });

    it("denies anonymous Shortcut preference writes", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("update_shortcut_preferences", {
            p_team_name: "Not Authorized",
            p_included_statuses: ["In Dev"],
            p_default_project_id: null,
        }));
    });

    it("denies anonymous Google Calendar preference writes", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("update_google_calendar_preferences", {
            p_selected_calendar_ids: ["primary"],
        }));
    });

    it("denies anonymous Google Calendar credential writes", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("save_google_calendar_connection", {
            p_owner_id: "00000000-0000-0000-0000-000000000000",
            p_refresh_token: "not-authorized",
            p_scope_level: "readonly",
        }));
    });

    it("denies anonymous GitHub credential writes", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("save_github_settings", {
            p_token: "not-authorized",
            p_github_username: "not-authorized",
        }));
    });

    it("denies anonymous GitHub repository preference writes", async () => {
        const client = anonymousClient();
        await expectPermissionDenied(client.rpc("update_github_repo_preferences", {
            p_full_name: "acme/worktime",
            p_selected: true,
            p_project_id: null,
            p_label_filter: null,
            p_include_closed: false,
        }));
    });
});
