import { afterEach, describe, expect, it } from "vitest";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { defaultAppState } from "../src/lib/engine";
import type { PushPlan } from "../src/lib/data/sync/types";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

// The tasks/pomodoro_logs primary keys are the global `id`, so these fixed ids
// must not overlap with the other integration files (1xxx/2xxx bases).
const TASK_A = "00000000-0000-4000-8000-300000000001";
const TASK_B = "00000000-0000-4000-8000-300000000002";
const TASK_C = "00000000-0000-4000-8000-300000000003";
const LOG_ID = "00000000-0000-4000-8000-300000000004";
const LOG_ID_OLD = "00000000-0000-4000-8000-300000000005";
const T0 = "2026-01-01T00:00:00.000Z";
const LATER = "2026-02-01T00:00:00.000Z";

const DEFAULT_SETTINGS = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };

let users: LocalUser[] = [];
afterEach(async () => {
    await Promise.all(users.map((tracked) => tracked.cleanup()));
    users = [];
});

function track(user: LocalUser): LocalUser {
    users.push(user);
    return user;
}

function remote(user: LocalUser): SupabaseDataAccess {
    return new SupabaseDataAccess(user.client);
}

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

function task(id: string, name: string) {
    return { id, name, target_pomodoros: 4, completed_pomodoros: 0, created_at: T0, completed_at: null, break_skips: 0, archived: false };
}

function log(id: string) {
    return { id, task_id: TASK_A, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false };
}

describe("local-first staged sync transport", () => {
    it("applies an idempotent staged batch under RLS without touching another owner", async () => {
        const owner = track(await createLocalUser());
        const other = track(await createLocalUser());

        // Seed the rows the target plan will tombstone, and give the second
        // owner their own row so isolation is observable.
        await remote(owner).push(owner.userId, {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_A, "Owner task A"), updatedAt: T0 }],
            logUpserts: [log(LOG_ID_OLD)],
        });
        await remote(other).push(other.userId, {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_B, "Other owner task"), updatedAt: T0 }],
        });

        const plan: PushPlan = {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_C, "Owner task C"), updatedAt: T0 }],
            taskTombstones: [{ id: TASK_A, deletedAt: LATER }],
            logUpserts: [log(LOG_ID)],
            logTombstones: [{ id: LOG_ID_OLD, deletedAt: LATER }],
            settings: { value: { ...DEFAULT_SETTINGS }, updatedAt: T0 },
            timerState: { value: { active_task: TASK_C, current_cycle_pomodoros: 0, timer: null }, updatedAt: T0, newGeneration: false },
            pmState: { value: { projects: {}, tasks: {}, meta: { initializedAt: T0 } }, updatedAt: T0 },
        };
        await remote(owner).push(owner.userId, plan);
        await remote(owner).push(owner.userId, plan); // replay must produce no duplicate work

        const ownerTasks = await owner.client.from("tasks").select("id, name");
        expect(ownerTasks.error).toBeNull();
        expect(ownerTasks.data).toHaveLength(1);
        expect(ownerTasks.data![0].id).toBe(TASK_C);
        const ownerLogs = await owner.client.from("pomodoro_logs").select("id");
        expect(ownerLogs.error).toBeNull();
        expect(ownerLogs.data).toHaveLength(1);
        expect(ownerLogs.data![0].id).toBe(LOG_ID);
        expect((await owner.client.from("settings").select("owner_id")).data).toHaveLength(1);
        expect((await owner.client.from("timer_state").select("owner_id")).data).toHaveLength(1);
        expect((await owner.client.from("pm_state").select("owner_id")).data).toHaveLength(1);

        // The second owner's rows are untouched; nothing leaked between owners.
        const otherTasks = await other.client.from("tasks").select("id, name");
        expect(otherTasks.error).toBeNull();
        expect(otherTasks.data).toHaveLength(1);
        expect(otherTasks.data![0].name).toBe("Other owner task");
        expect((await other.client.from("pomodoro_logs").select("id")).data).toHaveLength(0);
        expect((await other.client.from("settings").select("owner_id")).data).toHaveLength(0);
        expect((await other.client.from("timer_state").select("owner_id")).data).toHaveLength(0);
        expect((await other.client.from("pm_state").select("owner_id")).data).toHaveLength(0);
    });

    it("rejects stale task and singleton upserts when a newer server row exists", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);
        const staleSettings = { ...DEFAULT_SETTINGS };
        const staleTimer = { active_task: TASK_A, current_cycle_pomodoros: 0, timer: null };
        const stalePm = { projects: {}, tasks: {}, meta: { initializedAt: T0 } };

        // Seed every mutable row with an old client timestamp.
        await data.push(owner.userId, {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_A, "Stale name"), updatedAt: T0 }],
            settings: { value: staleSettings, updatedAt: T0 },
            timerState: { value: staleTimer, updatedAt: T0, newGeneration: false },
            pmState: { value: stalePm, updatedAt: T0 },
        });

        // Advance every row directly; touch_updated_at stamps now() > T0.
        await owner.client.from("tasks").update({ name: "Newer name" }).eq("owner_id", owner.userId);
        await owner.client.from("settings").update({ data: { ...staleSettings, work_minutes: 30 } }).eq("owner_id", owner.userId);
        await owner.client.from("timer_state").update({ data: { active_task: TASK_A, current_cycle_pomodoros: 2, timer: null } }).eq("owner_id", owner.userId);
        await owner.client.from("pm_state").update({ data: { projects: {}, tasks: {}, meta: { initializedAt: "2026-03-01T00:00:00.000Z" } } }).eq("owner_id", owner.userId);

        // Re-push the stale snapshot: every LWW gate must reject it.
        await data.push(owner.userId, {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_A, "Stale name"), updatedAt: T0 }],
            settings: { value: staleSettings, updatedAt: T0 },
            timerState: { value: staleTimer, updatedAt: T0, newGeneration: false },
            pmState: { value: stalePm, updatedAt: T0 },
        });

        const taskRow = await owner.client.from("tasks").select("name").single();
        expect(taskRow.error).toBeNull();
        expect(taskRow.data!.name).toBe("Newer name");
        const settingsRow = await owner.client.from("settings").select("data").single();
        expect(settingsRow.data!.data.work_minutes).toBe(30);
        const timerRow = await owner.client.from("timer_state").select("data").single();
        expect(timerRow.data!.data.current_cycle_pomodoros).toBe(2);
        const pmRow = await owner.client.from("pm_state").select("data").single();
        expect(pmRow.data!.data.meta.initializedAt).toBe("2026-03-01T00:00:00.000Z");
    });

    it("propagates task and log tombstones with LWW gating", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);

        await data.push(owner.userId, {
            ...emptyPlan(),
            taskUpserts: [
                { value: task(TASK_A, "Wiped task"), updatedAt: T0 },
                { value: task(TASK_B, "Protected task"), updatedAt: T0 },
            ],
            logUpserts: [log(LOG_ID)],
        });

        // A tombstone newer than the row's updated_at deletes the task.
        await data.push(owner.userId, {
            ...emptyPlan(),
            taskTombstones: [{ id: TASK_A, deletedAt: LATER }],
        });
        const wiped = await owner.client.from("tasks").select("id").eq("id", TASK_A).eq("owner_id", owner.userId);
        expect(wiped.error).toBeNull();
        expect(wiped.data).toHaveLength(0);

        // A concurrent remote update (now() > deletedAt) survives the tombstone.
        await owner.client.from("tasks").update({ name: "Concurrent rename" }).eq("id", TASK_B).eq("owner_id", owner.userId);
        await data.push(owner.userId, {
            ...emptyPlan(),
            taskTombstones: [{ id: TASK_B, deletedAt: "2026-01-15T00:00:00.000Z" }],
        });
        const protectedRow = await owner.client.from("tasks").select("id, name").eq("id", TASK_B).eq("owner_id", owner.userId).single();
        expect(protectedRow.error).toBeNull();
        expect(protectedRow.data!.name).toBe("Concurrent rename");

        // A log tombstone deletes the immutable row by (owner_id, id).
        await data.push(owner.userId, {
            ...emptyPlan(),
            logTombstones: [{ id: LOG_ID, deletedAt: LATER }],
        });
        const logs = await owner.client.from("pomodoro_logs").select("id");
        expect(logs.error).toBeNull();
        expect(logs.data).toHaveLength(0);
    });

    it("rolls back a full wipe with an invalid payload and preserves PM on a valid wipe", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);

        // Seed pre-wipe rows.
        await data.push(owner.userId, {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_A, "Doomed task"), updatedAt: T0 }],
            logUpserts: [log(LOG_ID)],
            settings: { value: { ...DEFAULT_SETTINGS }, updatedAt: T0 },
            timerState: { value: { active_task: TASK_A, current_cycle_pomodoros: 0, timer: null }, updatedAt: T0, newGeneration: false },
        });

        // A full wipe with a null settings payload violates the required-defaults
        // guard; the whole batch (deletes + inserts) must roll back atomically.
        await expect(
            data.push(owner.userId, {
                ...emptyPlan(),
                fullWipe: true,
                settings: null,
                timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
            }),
        ).rejects.toThrow();

        const tasks = await owner.client.from("tasks").select("id");
        expect(tasks.data).toHaveLength(1);
        const logs = await owner.client.from("pomodoro_logs").select("id");
        expect(logs.data).toHaveLength(1);
        const settings = await owner.client.from("settings").select("data").single();
        expect(settings.data!.data.work_minutes).toBe(25);
        const timer = await owner.client.from("timer_state").select("data").single();
        expect(timer.data!.data.current_cycle_pomodoros).toBe(0);

        // A valid full wipe plus an independent PM upsert clears tasks/logs and
        // resets settings/timer to defaults (completed=false) while the PM row
        // keeps the upserted value.
        const defaults = defaultAppState();
        const pmValue = {
            projects: {
                p1: { id: "p1", name: "Survivor project", color: "#ffffff", isArchived: false, sortOrder: 0, createdAt: T0, updatedAt: T0 },
            },
            tasks: {},
            meta: { initializedAt: "2026-02-01T00:00:00.000Z" },
        };
        await data.push(owner.userId, {
            ...emptyPlan(),
            fullWipe: true,
            settings: { value: { ...defaults.settings }, updatedAt: LATER },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
            pmState: { value: pmValue, updatedAt: LATER },
        });

        const snapshot = await data.pull(owner.userId);
        expect(snapshot.tasks).toEqual({});
        expect(snapshot.logs).toEqual({});
        expect(snapshot.settings.value).toEqual(defaults.settings);
        expect(snapshot.timerState.value).toEqual({ active_task: null, current_cycle_pomodoros: 0, timer: null });
        expect(snapshot.timerState.completed).toBe(false);
        expect(snapshot.pmState.value).toEqual(pmValue);
    });

    it("pulls more than 1000 logs ordered by (finished_at, id) across pages", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);

        // Identical finished_at timestamps force the (finished_at, id) tiebreak
        // to stay stable across the api.max_rows/page boundary; an unordered or
        // single-column query would duplicate or drop rows here.
        const count = 1050;
        const logs = [];
        for (let i = 0; i < count; i += 1) {
            const id = `00000000-0000-4000-8000-4${String(i).padStart(11, "0")}`;
            logs.push({ id, task_id: TASK_A, duration_minutes: 25, finished_at: "2026-01-01T00:00:00.000Z", was_break: false, break_skipped: false });
        }
        await data.push(owner.userId, { ...emptyPlan(), logUpserts: logs });

        const snapshot = await data.pull(owner.userId);
        expect(Object.keys(snapshot.logs)).toHaveLength(count);
        for (const seeded of logs) {
            const pulled = snapshot.logs[seeded.id];
            expect(pulled).toBeDefined();
            expect(pulled.id).toBe(seeded.id);
            expect(pulled.task_id).toBe(seeded.task_id);
            expect(pulled.duration_minutes).toBe(seeded.duration_minutes);
            expect(new Date(pulled.finished_at).getTime()).toBe(new Date(seeded.finished_at).getTime());
            expect(pulled.was_break).toBe(seeded.was_break);
            expect(pulled.break_skipped).toBe(seeded.break_skipped);
        }
    });
});
