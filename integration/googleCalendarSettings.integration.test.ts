import { afterEach, describe, expect, it } from "vitest";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

const users: LocalUser[] = [];
afterEach(async () => { await Promise.all(users.splice(0).map((user) => user.cleanup())); });

describe("Google Calendar settings storage", () => {
    it("keeps refresh tokens and OAuth state service-only", async () => {
        const owner = await createLocalUser();
        users.push(owner);
        const saved = await owner.admin.rpc("save_google_calendar_connection", {
            p_owner_id: owner.userId, p_refresh_token: "google-refresh-secret", p_scope_level: "readonly",
        });
        expect(saved.error).toBeNull();
        const visible = await owner.client.from("google_calendar_settings")
            .select("owner_id, scope_level, selected_calendar_ids, worktime_calendar_id, connected_at, updated_at").single();
        expect(visible.error).toBeNull();
        expect(visible.data).toMatchObject({ owner_id: owner.userId, scope_level: "readonly", selected_calendar_ids: [] });
        const secretRead = await owner.client.from("google_calendar_settings").select("refresh_token");
        expect(secretRead.error).not.toBeNull();
        const adminSecret = await owner.admin.from("google_calendar_settings").select("refresh_token").eq("owner_id", owner.userId).single();
        expect(adminSecret.data?.refresh_token).toBe("google-refresh-secret");
        const browserWrite = await owner.client.rpc("save_google_calendar_connection", {
            p_owner_id: owner.userId, p_refresh_token: "stolen", p_scope_level: "schedule",
        });
        expect(browserWrite.error).toMatchObject({ code: "42501" });

        await owner.admin.from("google_calendar_oauth_states").insert({
            state_hash: "a".repeat(64), owner_id: owner.userId, code_verifier: "v".repeat(64),
            requested_scope_level: "schedule", return_to: "https://worktime.test/projects",
            pending_task_id: "task-1", pending_scheduled_start: "2026-08-29T14:00:00Z",
            expires_at: "2026-08-29T15:00:00Z",
        });
        const oauthRead = await owner.client.from("google_calendar_oauth_states").select("state_hash, code_verifier");
        expect(oauthRead.error).not.toBeNull();
    });

    it("enforces selected-calendar and linkage owner boundaries", async () => {
        const owner = await createLocalUser();
        const other = await createLocalUser();
        users.push(owner, other);
        await owner.admin.rpc("save_google_calendar_connection", {
            p_owner_id: owner.userId, p_refresh_token: "secret", p_scope_level: "schedule",
        });
        const preferences = await owner.client.rpc("update_google_calendar_preferences", {
            p_selected_calendar_ids: ["team", "primary", "team"],
        });
        expect(preferences.error).toBeNull();
        const selected = await owner.client.from("google_calendar_settings").select("selected_calendar_ids").single();
        expect(selected.data?.selected_calendar_ids).toEqual(["primary", "team"]);

        const seeded = await owner.admin.from("google_calendar_task_links").insert({
            owner_id: owner.userId, task_id: "task-1", calendar_id: "calendar", event_id: "event",
            scheduled_start: "2026-08-29T14:00:00Z", scheduled_end: "2026-08-29T14:25:00Z",
            estimate_pomos: 1, work_minutes: 25,
        });
        expect(seeded.error).toBeNull();
        const visible = await owner.client.from("google_calendar_task_links").select("task_id, event_id");
        expect(visible.data).toEqual([{ task_id: "task-1", event_id: "event" }]);
        const hidden = await other.client.from("google_calendar_task_links").select("task_id, event_id");
        expect(hidden.data).toEqual([]);
        const browserInsert = await owner.client.from("google_calendar_task_links").insert({
            task_id: "task-2", calendar_id: "calendar", event_id: "event-2",
            scheduled_start: "2026-08-29T15:00:00Z", scheduled_end: "2026-08-29T15:25:00Z",
            estimate_pomos: 1, work_minutes: 25,
        });
        expect(browserInsert.error).not.toBeNull();
    });
});
