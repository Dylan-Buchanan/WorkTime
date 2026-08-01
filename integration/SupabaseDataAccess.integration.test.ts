import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DataAccessAuthError } from "../src/lib/data/DataAccess";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { createLocalUser, localSupabaseConfig, type LocalUser } from "../tests/supabase/localSupabase";

let user: LocalUser | null = null;
afterEach(async () => { await user?.cleanup(); user = null; });

describe("SupabaseDataAccess", () => {
    it("requires an authenticated session before querying", async () => {
        const config = localSupabaseConfig();
        const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
        await expect(new SupabaseDataAccess(anon).fetchState()).rejects.toMatchObject({ name: "DataAccessAuthError", code: "DATA_ACCESS_NO_SESSION" });
    });

    it("round-trips the aggregate through the Phase 0 tables", async () => {
        user = await createLocalUser();
        const data = new SupabaseDataAccess(user.client, { createTaskId: () => "00000000-0000-4000-8000-000000000001" });
        const created = await data.createTask("Integration task", 2);
        await data.setActiveTask(created.value.id);
        const started = await data.startWorkTimer();
        expect(started.value.kind).toBe("Work");
        const loaded = await data.fetchState();
        expect(loaded.state.tasks[created.value.id].name).toBe("Integration task");
        expect(loaded.state.timer?.task_id).toBe(created.value.id);
        await data.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "now" } });
        expect(await data.loadPMState()).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "now" } });
    });

    it("rolls back the whole transition when a gated write fails", async () => {
        user = await createLocalUser();
        const client = user.client;
        const response = await client.rpc("persist_transition", {
            p_tasks: null,
            p_logs: [{ task_id: "00000000-0000-4000-8000-000000000099", duration_minutes: -1, finished_at: "2026-01-01T00:01:00.000Z", was_break: false, break_skipped: false }],
            p_settings: null,
            p_timer_data: { active_task: null, current_cycle_pomodoros: 0, timer: null },
            p_timer_new_generation: false,
        });
        expect(response.error).not.toBeNull();
        const timer = await client.from("timer_state").select("owner_id").maybeSingle();
        expect(timer.data).toBeNull();
        const logs = await client.from("pomodoro_logs").select("id");
        expect(logs.data).toHaveLength(0);
    });
});
