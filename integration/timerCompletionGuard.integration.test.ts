import { afterEach, describe, expect, it } from "vitest";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";
import type { ActiveTimer } from "../src/state/types";
import type { PendingTimerCompletion } from "../src/lib/data/staging/types";

const TASK_ID = "00000000-0000-4000-8000-200000000001";
const LOG_ID = "00000000-0000-4000-8000-200000000002";

let user: LocalUser | null = null;
afterEach(async () => { await user?.cleanup(); user = null; });

async function seedExpiredWorkTimer(): Promise<ActiveTimer> {
    const client = user!.client;
    // The LWW-gated completion task write compares against tasks.updated_at, so
    // seed an explicit pre-completion timestamp instead of the now() default.
    await client.from("tasks").upsert({ id: TASK_ID, name: "Race task", target_pomodoros: 4, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false });
    const timer: ActiveTimer = { task_id: TASK_ID, started_at: "2026-01-01T00:00:00.000Z", ends_at: "2026-01-01T00:25:00.000Z", kind: "Work", paused: false, paused_remaining_secs: 0, planned_secs: 1500, accumulated_secs: 0 };
    await client.from("timer_state").upsert({ data: { active_task: TASK_ID, current_cycle_pomodoros: 0, timer }, completed: false });
    return timer;
}

function task(name: string, completed: number) {
    return { id: TASK_ID, name, target_pomodoros: 4, completed_pomodoros: completed, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false };
}

/** One journaled completion for the seeded expired work timer. */
function completionEntry(timer: ActiveTimer): PendingTimerCompletion {
    return {
        generationKey: "generation",
        sequence: 1,
        expectedTimer: timer,
        expectedTimerState: { active_task: TASK_ID, current_cycle_pomodoros: 0, timer },
        resultTimerState: { active_task: TASK_ID, current_cycle_pomodoros: 1, timer: null },
        taskBefore: task("Race task", 0),
        taskAfter: task("Race task", 1),
        log: { id: LOG_ID, task_id: TASK_ID, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false },
        localOnlyGeneration: false,
        completedAt: "2026-01-01T00:26:00.000Z",
    };
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

    it("applies exactly one completion when two transport clients race", async () => {
        user = await createLocalUser();
        const timer = await seedExpiredWorkTimer();
        const entry = completionEntry(timer);
        const first = new SupabaseDataAccess(user.client);
        const second = new SupabaseDataAccess(user.client);
        const results = await Promise.all([
            first.completeTimer(user.userId, entry),
            second.completeTimer(user.userId, entry),
        ]);
        expect(results.filter((applied) => applied)).toHaveLength(1);

        const logs = await user.client.from("pomodoro_logs").select("*");
        expect(logs.error).toBeNull();
        expect(logs.data).toHaveLength(1);

        const taskRow = await user.client.from("tasks").select("completed_pomodoros").single();
        expect(taskRow.error).toBeNull();
        expect(taskRow.data!.completed_pomodoros).toBe(1);

        const timerRow = await user.client.from("timer_state").select("data, completed, updated_at").single();
        expect(timerRow.error).toBeNull();
        expect(timerRow.data!.completed).toBe(true);
        expect(timerRow.data!.data.timer).toBeNull();
        expect(timerRow.data!.data.current_cycle_pomodoros).toBe(1);
        expect(new Date(timerRow.data!.updated_at).toISOString()).toBe(entry.completedAt);
    });

    it("does not overwrite a task edited after the completion was journaled", async () => {
        user = await createLocalUser();
        const timer = await seedExpiredWorkTimer();
        const entry = completionEntry(timer);

        // Another client edits the task AFTER the local completion was
        // journaled but before its CAS replay. The explicit timestamp is newer
        // than the completion's completedAt, so the LWW-gated task write must
        // be rejected while the log and timer claim still apply.
        const edited = await user.client
            .from("tasks")
            .update({ name: "Renamed later", updated_at: "2026-01-01T00:30:00.000Z" })
            .eq("id", TASK_ID)
            .eq("owner_id", user.userId)
            .select("name, completed_pomodoros, updated_at")
            .single();
        expect(edited.error).toBeNull();
        expect(new Date(edited.data!.updated_at).toISOString()).toBe("2026-01-01T00:30:00.000Z");

        const remote = new SupabaseDataAccess(user.client);
        expect(await remote.completeTimer(user.userId, entry)).toBe(true);

        // The newer rename survives and the stale completion snapshot did not
        // erase it or revert the row's progress.
        const taskRow = await user.client.from("tasks").select("name, completed_pomodoros").single();
        expect(taskRow.error).toBeNull();
        expect(taskRow.data!.name).toBe("Renamed later");
        expect(taskRow.data!.completed_pomodoros).toBe(0);

        // The completion itself still landed: the log is written and the timer
        // is claimed.
        const logs = await user.client.from("pomodoro_logs").select("id");
        expect(logs.error).toBeNull();
        expect(logs.data).toHaveLength(1);
        const timerRow = await user.client.from("timer_state").select("completed, data").single();
        expect(timerRow.error).toBeNull();
        expect(timerRow.data!.completed).toBe(true);
        expect(timerRow.data!.data.timer).toBeNull();
    });

    it("installs a local-only generation and resets the completion guard", async () => {
        user = await createLocalUser();
        const timer: ActiveTimer = { task_id: TASK_ID, started_at: "2026-01-02T00:00:00.000Z", ends_at: "2026-01-02T00:25:00.000Z", kind: "Work", paused: false, paused_remaining_secs: 0, planned_secs: 1500, accumulated_secs: 0 };
        const remote = new SupabaseDataAccess(user.client);
        await remote.installTimerGeneration(user.userId, completionEntry(timer));
        const snapshot = await remote.pull(user.userId);
        expect(snapshot.timerState.value).toEqual({ active_task: TASK_ID, current_cycle_pomodoros: 0, timer });
        expect(snapshot.timerState.completed).toBe(false);
    });

    it("does not overwrite a concurrent timer row started after the client's pull", async () => {
        user = await createLocalUser();
        // Another tab started a timer AFTER this client's pull, stamping the row
        // with an updated_at newer than the local completion it is installing.
        const concurrent: ActiveTimer = { task_id: TASK_ID, started_at: "2026-01-02T00:10:00.000Z", ends_at: "2026-01-02T00:35:00.000Z", kind: "Work", paused: false, paused_remaining_secs: 0, planned_secs: 1500, accumulated_secs: 0 };
        await user.client.from("timer_state").upsert({ data: { active_task: TASK_ID, current_cycle_pomodoros: 0, timer: concurrent }, completed: false, updated_at: "2026-01-02T00:30:00.000Z" });

        const remote = new SupabaseDataAccess(user.client);
        // The local generation completed at 00:20, older than the concurrent
        // row's 00:30 stamp, so the LWW-gated install must be rejected.
        await remote.installTimerGeneration(user.userId, { ...completionEntry(concurrent), completedAt: "2026-01-02T00:20:00.000Z" });

        const timerRow = await user.client.from("timer_state").select("data, completed, updated_at").single();
        expect(timerRow.error).toBeNull();
        expect(timerRow.data!.data.timer).toEqual(concurrent);
        expect(new Date(timerRow.data!.updated_at).toISOString()).toBe("2026-01-02T00:30:00.000Z");
        expect(timerRow.data!.completed).toBe(false);
    });

    it("lets a newer local generation install win the LWW gate", async () => {
        user = await createLocalUser();
        const concurrent: ActiveTimer = { task_id: TASK_ID, started_at: "2026-01-02T00:10:00.000Z", ends_at: "2026-01-02T00:35:00.000Z", kind: "Work", paused: false, paused_remaining_secs: 0, planned_secs: 1500, accumulated_secs: 0 };
        await user.client.from("timer_state").upsert({ data: { active_task: TASK_ID, current_cycle_pomodoros: 0, timer: concurrent }, completed: false, updated_at: "2026-01-02T00:10:00.000Z" });

        const remote = new SupabaseDataAccess(user.client);
        const local: ActiveTimer = { task_id: TASK_ID, started_at: "2026-01-02T01:00:00.000Z", ends_at: "2026-01-02T01:25:00.000Z", kind: "Work", paused: false, paused_remaining_secs: 0, planned_secs: 1500, accumulated_secs: 0 };
        // The local generation completed at 01:20, newer than the concurrent
        // row's 00:10 stamp, so the LWW-gated install applies and restamps.
        await remote.installTimerGeneration(user.userId, { ...completionEntry(local), completedAt: "2026-01-02T01:20:00.000Z" });

        const timerRow = await user.client.from("timer_state").select("data, completed, updated_at").single();
        expect(timerRow.error).toBeNull();
        expect(timerRow.data!.data.timer).toEqual(local);
        expect(new Date(timerRow.data!.updated_at).toISOString()).toBe("2026-01-02T01:20:00.000Z");
        expect(timerRow.data!.completed).toBe(false);
    });

    it("rolls back the whole completion transaction when a gated write fails", async () => {
        user = await createLocalUser();
        const timer = await seedExpiredWorkTimer();
        const response = await user.client.rpc("complete_timer", {
            p_expected_timer: timer,
            p_timer_data: { active_task: TASK_ID, current_cycle_pomodoros: 1, timer: null },
            p_log: { task_id: TASK_ID, duration_minutes: -1, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false },
            p_task: task("Race task", 1),
        });
        expect(response.error).not.toBeNull();
        const timerRow = await user.client.from("timer_state").select("completed, data").single();
        expect(timerRow.data!.completed).toBe(false);
        expect(timerRow.data!.data.timer).toEqual(timer);
        const logs = await user.client.from("pomodoro_logs").select("*");
        expect(logs.data).toHaveLength(0);
        const taskRow = await user.client.from("tasks").select("completed_pomodoros").single();
        expect(taskRow.data!.completed_pomodoros).toBe(0);
    });
});
