import { afterEach, describe, expect, it } from "vitest";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

const TASK_ID = "00000000-0000-4000-8000-000000000002";

let user: LocalUser | null = null;
afterEach(async () => { await user?.cleanup(); user = null; });

async function seedExpiredWorkTimer() {
    const client = user!.client;
    await client.from("tasks").upsert({ id: TASK_ID, name: "Race task", target_pomodoros: 4, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false });
    const timer = { task_id: TASK_ID, started_at: "2026-01-01T00:00:00.000Z", ends_at: "2026-01-01T00:25:00.000Z", kind: "Work", paused: false, paused_remaining_secs: 0, planned_secs: 1500, accumulated_secs: 0 };
    await client.from("timer_state").upsert({ data: { active_task: TASK_ID, current_cycle_pomodoros: 0, timer }, completed: false });
    return timer;
}

describe("timer completion guard migration", () => {
    it("defaults false and allows only one conditional winner", async () => {
        user = await createLocalUser();
        const timer = await seedExpiredWorkTimer();
        const first = await user.client.from("timer_state").update({ completed: true }).eq("owner_id", user.userId).eq("completed", false).contains("data", { timer }).select("owner_id");
        expect(first.error).toBeNull();
        expect(first.data).toHaveLength(1);
        const second = await user.client.from("timer_state").update({ completed: true }).eq("owner_id", user.userId).eq("completed", false).contains("data", { timer }).select("owner_id");
        expect(second.error).toBeNull();
        expect(second.data).toHaveLength(0);
    });

    it("applies exactly one completion when two data-access clients race", async () => {
        user = await createLocalUser();
        await seedExpiredWorkTimer();
        const options = { now: () => new Date("2026-01-01T00:26:00.000Z") };
        const first = new SupabaseDataAccess(user.client, options);
        const second = new SupabaseDataAccess(user.client, options);
        const results = await Promise.all([first.completeTimer(), second.completeTimer()]);
        expect(results.filter((result) => result.applied)).toHaveLength(1);

        const logs = await user.client.from("pomodoro_logs").select("*");
        expect(logs.error).toBeNull();
        expect(logs.data).toHaveLength(1);

        const task = await user.client.from("tasks").select("completed_pomodoros").single();
        expect(task.error).toBeNull();
        expect(task.data!.completed_pomodoros).toBe(1);

        const timer = await user.client.from("timer_state").select("data, completed").single();
        expect(timer.error).toBeNull();
        expect(timer.data!.completed).toBe(true);
        expect(timer.data!.data.timer).toBeNull();
        expect(timer.data!.data.current_cycle_pomodoros).toBe(1);
    });

    it("rolls back the whole completion transaction when a gated write fails", async () => {
        user = await createLocalUser();
        const timer = await seedExpiredWorkTimer();
        const response = await user.client.rpc("complete_timer", {
            p_expected_timer: timer,
            p_timer_data: { active_task: TASK_ID, current_cycle_pomodoros: 1, timer: null },
            p_log: { task_id: TASK_ID, duration_minutes: -1, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false },
            p_task: { id: TASK_ID, name: "Race task", target_pomodoros: 4, completed_pomodoros: 1, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false },
        });
        expect(response.error).not.toBeNull();
        const timerRow = await user.client.from("timer_state").select("completed, data").single();
        expect(timerRow.data!.completed).toBe(false);
        expect(timerRow.data!.data.timer).toEqual(timer);
        const logs = await user.client.from("pomodoro_logs").select("*");
        expect(logs.data).toHaveLength(0);
        const task = await user.client.from("tasks").select("completed_pomodoros").single();
        expect(task.data!.completed_pomodoros).toBe(0);
    });
});
