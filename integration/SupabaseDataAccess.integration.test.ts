import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { defaultAppState } from "../src/lib/engine";
import type { PushPlan } from "../src/lib/data/sync/types";
import { createLocalUser, localSupabaseConfig, type LocalUser } from "../tests/supabase/localSupabase";

// The tasks/pomodoro_logs primary keys are the global `id`, so these fixed ids
// must not overlap with other integration files (which use 2xxx/3xxx bases).
const TASK_ID = "00000000-0000-4000-8000-100000000001";
const LOG_ID = "00000000-0000-4000-8000-100000000002";
const FOREIGN_OWNER = "ffffffff-ffff-4000-8000-ffffffffffff";
const T0 = "2026-01-01T00:00:00.000Z";
const LATER = "2026-02-01T00:00:00.000Z";

const PM_STATE = { projects: {}, tasks: {}, meta: { initializedAt: T0 } };

let user: LocalUser | null = null;
afterEach(async () => { await user?.cleanup(); user = null; });

function emptyPlan(): PushPlan {
    return {
        baseRevision: 1,
        taskUpserts: [],
        taskTombstones: [],
        logUpserts: [],
        logTombstones: [],
        settings: null,
        timerState: null,
        pmState: null,
        fullWipe: false,
        acknowledged: {
            taskUpserts: {}, taskTombstones: {}, logUpserts: {}, logTombstones: {},
            settings: null, timerState: null, pmState: null, fullWipe: null,
        },
    };
}

// PostgREST serializes timestamptz columns with an offset (+00:00) rather than
// the "Z" the client authored, so compare timestamps by instant.
const epoch = (value: string | null): number | null => (value === null ? null : new Date(value).getTime());

describe("SupabaseDataAccess transport", () => {
    it("requires an authenticated session before pulling", async () => {
        const config = localSupabaseConfig();
        const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
        await expect(new SupabaseDataAccess(anon).pull(FOREIGN_OWNER)).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_NO_SESSION",
        });
    });

    it("returns an empty versioned snapshot for a fresh owner", async () => {
        user = await createLocalUser();
        const snapshot = await new SupabaseDataAccess(user.client).pull(user.userId);
        expect(snapshot.tasks).toEqual({});
        expect(snapshot.logs).toEqual({});
        expect(snapshot.settings).toEqual({ value: null, updatedAt: null });
        expect(snapshot.timerState).toEqual({ value: null, updatedAt: null, completed: false });
        expect(snapshot.pmState).toEqual({ value: null, updatedAt: null });
    });

    it("rejects a session that does not match the expected owner", async () => {
        user = await createLocalUser();
        await expect(new SupabaseDataAccess(user.client).pull(FOREIGN_OWNER)).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_OWNER_MISMATCH",
        });
    });

    it("round-trips a push plan through pull and replays idempotently", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        const task = {
            id: TASK_ID, name: "Pushed task", target_pomodoros: 2, completed_pomodoros: 0,
            created_at: T0, completed_at: null, break_skips: 0, archived: false,
        };
        const log = { id: LOG_ID, task_id: TASK_ID, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false };
        const settings = { work_minutes: 30, short_break_minutes: 6, long_break_minutes: 24, segment_length: 3 };
        const timerSlice = { active_task: TASK_ID, current_cycle_pomodoros: 1, timer: null };
        const plan: PushPlan = {
            ...emptyPlan(),
            taskUpserts: [{ value: task, updatedAt: T0 }],
            logUpserts: [log],
            settings: { value: settings, updatedAt: T0 },
            timerState: { value: timerSlice, updatedAt: T0, newGeneration: false },
            pmState: { value: PM_STATE, updatedAt: T0 },
        };

        await remote.push(user.userId, plan);

        const first = await remote.pull(user.userId);
        const pulledTask = first.tasks[TASK_ID].value;
        expect(pulledTask.id).toBe(task.id);
        expect(pulledTask.name).toBe(task.name);
        expect(pulledTask.target_pomodoros).toBe(task.target_pomodoros);
        expect(pulledTask.completed_pomodoros).toBe(task.completed_pomodoros);
        expect(epoch(pulledTask.created_at)).toBe(epoch(task.created_at));
        expect(pulledTask.completed_at).toBe(task.completed_at);
        expect(pulledTask.break_skips).toBe(task.break_skips);
        expect(pulledTask.archived).toBe(task.archived);
        expect(epoch(first.tasks[TASK_ID].updatedAt)).toBe(epoch(T0));
        const pulledLog = first.logs[LOG_ID];
        expect(pulledLog).toBeDefined();
        expect(pulledLog.id).toBe(log.id);
        expect(pulledLog.task_id).toBe(log.task_id);
        expect(pulledLog.duration_minutes).toBe(log.duration_minutes);
        expect(epoch(pulledLog.finished_at)).toBe(epoch(log.finished_at));
        expect(pulledLog.was_break).toBe(log.was_break);
        expect(pulledLog.break_skipped).toBe(log.break_skipped);
        expect(first.settings.value).toEqual(settings);
        expect(epoch(first.settings.updatedAt)).toBe(epoch(T0));
        expect(first.timerState.value).toEqual(timerSlice);
        expect(epoch(first.timerState.updatedAt)).toBe(epoch(T0));
        expect(first.timerState.completed).toBe(false);
        expect(first.pmState.value).toEqual(PM_STATE);
        expect(epoch(first.pmState.updatedAt)).toBe(epoch(T0));

        // Replaying the same plan creates no duplicate tasks, logs, or singletons.
        await remote.push(user.userId, plan);
        const logs = await user.client.from("pomodoro_logs").select("id");
        expect(logs.error).toBeNull();
        expect(logs.data).toHaveLength(1);
        const tasks = await user.client.from("tasks").select("id");
        expect(tasks.error).toBeNull();
        expect(tasks.data).toHaveLength(1);
        expect((await user.client.from("settings").select("owner_id")).data).toHaveLength(1);
        expect((await user.client.from("timer_state").select("owner_id")).data).toHaveLength(1);
        expect((await user.client.from("pm_state").select("owner_id")).data).toHaveLength(1);
    });

    it("refreshes an active session and rejects a refresh without a session", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        await expect(remote.refreshSession(user.userId)).resolves.toBeUndefined();

        const config = localSupabaseConfig();
        const anon = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
        await expect(new SupabaseDataAccess(anon).refreshSession(FOREIGN_OWNER)).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_REFRESH_FAILED",
        });
    });

    it("applies a full wipe while preserving an independent PM upsert", async () => {
        user = await createLocalUser();
        const remote = new SupabaseDataAccess(user.client);
        const seed: PushPlan = {
            ...emptyPlan(),
            taskUpserts: [{ value: { id: TASK_ID, name: "Pre-wipe task", target_pomodoros: 2, completed_pomodoros: 1, created_at: T0, completed_at: null, break_skips: 0, archived: false }, updatedAt: T0 }],
            logUpserts: [{ id: LOG_ID, task_id: TASK_ID, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false }],
            settings: { value: { work_minutes: 40, short_break_minutes: 7, long_break_minutes: 30, segment_length: 5 }, updatedAt: T0 },
            timerState: { value: { active_task: TASK_ID, current_cycle_pomodoros: 3, timer: null }, updatedAt: T0, newGeneration: false },
        };
        await remote.push(user.userId, seed);

        const defaults = defaultAppState();
        const wipePlan: PushPlan = {
            ...emptyPlan(),
            fullWipe: true,
            settings: { value: { ...defaults.settings }, updatedAt: LATER },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
            pmState: { value: PM_STATE, updatedAt: LATER },
        };
        await remote.push(user.userId, wipePlan);

        const snapshot = await remote.pull(user.userId);
        expect(snapshot.tasks).toEqual({});
        expect(snapshot.logs).toEqual({});
        expect(snapshot.settings.value).toEqual(defaults.settings);
        expect(snapshot.timerState.value).toEqual({ active_task: null, current_cycle_pomodoros: 0, timer: null });
        expect(epoch(snapshot.timerState.updatedAt)).toBe(epoch(LATER));
        expect(snapshot.timerState.completed).toBe(false);
        expect(snapshot.pmState.value).toEqual(PM_STATE);
    });

    it("rolls back the whole transition when a gated write fails", async () => {
        user = await createLocalUser();
        const client = user.client;
        const response = await client.rpc("persist_transition", {
            p_tasks: null,
            p_logs: [{ task_id: TASK_ID, duration_minutes: -1, finished_at: "2026-01-01T00:01:00.000Z", was_break: false, break_skipped: false }],
            p_settings: null,
            p_timer_data: { active_task: null, current_cycle_pomodoros: 0, timer: null },
            p_timer_new_generation: false,
            p_timer_updated_at: null,
        });
        expect(response.error).not.toBeNull();
        const timer = await client.from("timer_state").select("owner_id").maybeSingle();
        expect(timer.data).toBeNull();
        const logs = await client.from("pomodoro_logs").select("id");
        expect(logs.data).toHaveLength(0);
    });
});
