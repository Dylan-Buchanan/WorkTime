import { afterEach, describe, expect, it } from "vitest";
import { SupabaseDataAccess } from "../src/lib/data/SupabaseDataAccess";
import { defaultAppState } from "../src/lib/engine";
import type { PushPlan } from "../src/lib/data/sync/types";
import { LocalStagingStore, type StorageLike } from "../src/lib/data/staging/LocalStagingStore";
import { SyncCoordinator } from "../src/lib/data/sync/SyncCoordinator";
import { createLocalUser, type LocalUser } from "../tests/supabase/localSupabase";

// The tasks/pomodoro_logs primary keys are the global `id`, so these fixed ids
// must not overlap with the other integration files (1xxx/2xxx bases).
const TASK_A = "00000000-0000-4000-8000-300000000001";
const TASK_B = "00000000-0000-4000-8000-300000000002";
const TASK_C = "00000000-0000-4000-8000-300000000003";
const LOG_ID = "00000000-0000-4000-8000-300000000004";
const LOG_ID_OLD = "00000000-0000-4000-8000-300000000005";
const HABIT_A = "00000000-0000-4000-8000-300000000010";
const HABIT_B = "00000000-0000-4000-8000-300000000011";
const HABIT_C = "00000000-0000-4000-8000-300000000014";
const COMPLETION_A = "00000000-0000-4000-8000-300000000012";
const COMPLETION_B = "00000000-0000-4000-8000-300000000013";
const TODO_A = "00000000-0000-4000-8000-300000000020";
const TODO_B = "00000000-0000-4000-8000-300000000021";
const TODO_COMPLETION_A = "00000000-0000-4000-8000-300000000022";
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
        habitUpserts: [],
        habitTombstones: [],
        habitCompletionUpserts: [],
        habitCompletionTombstones: [],
        todoUpserts: [],
        todoTombstones: [],
        todoCompletionUpserts: [],
        todoCompletionTombstones: [],
        settings: null,
        timerState: null,
        pmState: null,
        fullWipe: false,
        acknowledged: {
            taskUpserts: {},
            taskTombstones: {},
            logUpserts: {},
            logTombstones: {},
            habitUpserts: {},
            habitTombstones: {},
            habitCompletionUpserts: {},
            habitCompletionTombstones: {},
            todoUpserts: {},
            todoTombstones: {},
            todoCompletionUpserts: {},
            todoCompletionTombstones: {},
            settings: null,
            timerState: null,
            pmState: null,
            fullWipe: null,
        },
    };
}

function task(id: string, name: string) {
    return { id, name, target_pomodoros: 4, completed_pomodoros: 0, created_at: T0, completed_at: null, break_skips: 0, archived: false };
}

function log(id: string) {
    return { id, task_id: TASK_A, duration_minutes: 25, finished_at: "2026-01-01T00:26:00.000Z", was_break: false, break_skipped: false };
}

function habit(id: string, name: string, updatedAt = T0) {
    return { id, name, description: "A habit", color: "#ff0000", frequency: "daily", position: 1, isArchived: false, createdAt: T0, updatedAt };
}

function completion(id: string, habitId: string, bucket = "2026-01-01") {
    return { id, habitId, bucket, createdAt: T0, updatedAt: T0 };
}

function todo(id: string, title: string, updatedAt = T0) {
    return { id, title, rule: null, dueDate: null, estimate: 1, currentTaskId: null, position: 0, isArchived: false, createdAt: T0, updatedAt };
}

function todoCompletion(id: string, todoId: string) {
    return { id, todoId, bucket: `created:${T0}`, createdAt: T0, updatedAt: T0 };
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

    it("applies habit LWW, tombstones, completion identity, and wipe preservation", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);

        // Seed two habits and one completion.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitUpserts: [
                { value: habit(HABIT_A, "Old name"), updatedAt: T0 },
                { value: habit(HABIT_B, "Doomed habit"), updatedAt: T0 },
            ],
            habitCompletionUpserts: [completion(COMPLETION_A, HABIT_A)],
        });

        // A newer server row blocks a stale habit upsert (strict LWW gate).
        await owner.client.from("habits").update({ name: "Newer name" }).eq("owner_id", owner.userId).eq("id", HABIT_A);
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitUpserts: [{ value: habit(HABIT_A, "Stale name"), updatedAt: T0 }],
        });
        const habitARow = await owner.client.from("habits").select("name").eq("id", HABIT_A).single();
        expect(habitARow.error).toBeNull();
        expect(habitARow.data!.name).toBe("Newer name");

        // A guarded tombstone deletes a row that has not changed since seeding.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitTombstones: [{ id: HABIT_B, deletedAt: LATER }],
        });
        expect((await owner.client.from("habits").select("id").eq("id", HABIT_B)).data).toHaveLength(0);

        // A tombstone older than the row's updated_at cannot delete it; the
        // direct update stamped HABIT_A with the current wall clock, so a stale
        // deletion is rejected and the concurrent rename survives.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitTombstones: [{ id: HABIT_A, deletedAt: LATER }],
        });
        const habitASurvivor = await owner.client.from("habits").select("name").eq("id", HABIT_A).single();
        expect(habitASurvivor.error).toBeNull();
        expect(habitASurvivor.data!.name).toBe("Newer name");

        // Replaying the same (habit_id, bucket) is a no-op even with a new id.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitCompletionUpserts: [completion(COMPLETION_B, HABIT_A)],
        });
        const completions = await owner.client.from("habit_completions").select("id");
        expect(completions.error).toBeNull();
        expect(completions.data).toHaveLength(1);
        expect(completions.data![0].id).toBe(COMPLETION_A);

        // A completion tombstone deletes by (owner_id, id).
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitCompletionTombstones: [{ id: COMPLETION_A, deletedAt: LATER }],
        });
        expect((await owner.client.from("habit_completions").select("id")).data).toHaveLength(0);

        // A full wipe clears tasks/logs/settings/timer but preserves habits, and
        // an independent habit delta (a brand-new habit) still rides the wipe.
        await data.push(owner.userId, {
            ...emptyPlan(),
            taskUpserts: [{ value: task(TASK_A, "Doomed task"), updatedAt: T0 }],
            logUpserts: [log(LOG_ID)],
        });
        const defaults = defaultAppState();
        await data.push(owner.userId, {
            ...emptyPlan(),
            fullWipe: true,
            settings: { value: { ...defaults.settings }, updatedAt: LATER },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
            habitUpserts: [{ value: habit(HABIT_C, "Added during wipe", LATER), updatedAt: LATER }],
        });

        const snapshot = await data.pull(owner.userId);
        expect(snapshot.tasks).toEqual({});
        expect(snapshot.logs).toEqual({});
        // Habits survive the wipe and the independent habit delta applied.
        expect(snapshot.habits[HABIT_A].value.name).toBe("Newer name");
        expect(snapshot.habits[HABIT_C].value.name).toBe("Added during wipe");
        expect(Object.keys(snapshot.habits).sort()).toEqual([HABIT_A, HABIT_C].sort());
        expect(snapshot.habitCompletions).toEqual({});
    });

    it("keeps completion history when a newer remote habit edit beats the hard-delete cascade", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);

        // Seed a habit and one completion with an old client timestamp.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitUpserts: [{ value: habit(HABIT_A, "Original"), updatedAt: T0 }],
            habitCompletionUpserts: [completion(COMPLETION_A, HABIT_A)],
        });

        // A concurrent remote habit edit stamps updated_at with now() (newer
        // than any stale deletion stamp), reviving the habit.
        await owner.client
            .from("habits")
            .update({ name: "Concurrent rename" })
            .eq("owner_id", owner.userId)
            .eq("id", HABIT_A);
        const habitRow = await owner.client.from("habits").select("name, updated_at").eq("id", HABIT_A).single();
        expect(habitRow.error).toBeNull();
        expect(new Date(habitRow.data!.updated_at).getTime()).toBeGreaterThan(new Date(LATER).getTime());

        // The losing device pushes its hard-delete cascade: the habit tombstone
        // is LWW-gated and rejected, and the provenanced completion tombstone
        // must be skipped too so the completion history survives the revival.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitTombstones: [{ id: HABIT_A, deletedAt: LATER }],
            habitCompletionTombstones: [{ id: COMPLETION_A, deletedAt: LATER, habitId: HABIT_A }],
        });

        const survivor = await owner.client.from("habits").select("name").eq("id", HABIT_A).single();
        expect(survivor.error).toBeNull();
        expect(survivor.data!.name).toBe("Concurrent rename");
        const completions = await owner.client.from("habit_completions").select("id");
        expect(completions.error).toBeNull();
        expect(completions.data).toHaveLength(1);
        expect(completions.data![0].id).toBe(COMPLETION_A);

        // The next pull still carries the habit and its completion.
        const pulled = await data.pull(owner.userId);
        expect(pulled.habits[HABIT_A].value.name).toBe("Concurrent rename");
        expect(pulled.habitCompletions[COMPLETION_A].id).toBe(COMPLETION_A);
    });

    it("re-pushes a different-field habit merge with a strictly-later stamp through the real RPC", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);
        const t1 = "2026-01-15T00:00:00.000Z";

        // Seed the base habit row with an old client timestamp, then capture the
        // exact baseline the two devices would have pulled.
        await data.push(owner.userId, {
            ...emptyPlan(),
            habitUpserts: [{ value: habit(HABIT_A, "Base habit"), updatedAt: T0 }],
        });
        const baseline = await data.pull(owner.userId);
        expect(baseline.habits[HABIT_A].value.name).toBe("Base habit");
        expect(new Date(baseline.habits[HABIT_A].updatedAt).getTime()).toBe(new Date(T0).getTime());

        function makeStore(): LocalStagingStore {
            const map = new Map<string, string>();
            const storage: StorageLike = {
                getItem: (key) => map.get(key) ?? null,
                setItem: (key, value) => {
                    map.set(key, value);
                },
                removeItem: (key) => {
                    map.delete(key);
                },
            };
            return new LocalStagingStore(storage);
        }

        const storeA = makeStore();
        const storeB = makeStore();
        async function seedDevice(store: LocalStagingStore, name: string, color: string, stamp: string): Promise<void> {
            await store.update(owner.userId, (current) => ({
                ...current,
                initialized: true,
                lastSynced: baseline,
                habits: { [HABIT_A]: { ...habit(HABIT_A, name), color } },
                habitUpdatedAt: { [HABIT_A]: stamp },
            }));
        }

        // Device A edits the name (older stamp); device B edits the color (newer).
        await seedDevice(storeA, "From A", "#ff0000", t1);
        await seedDevice(storeB, "Base habit", "#000000", LATER);

        // B syncs first and its newer color-only edit wins the LWW gate.
        await new SyncCoordinator(owner.userId, storeB, data).sync({ reason: "manual" });
        const afterB = await data.pull(owner.userId);
        expect(afterB.habits[HABIT_A].value.color).toBe("#000000");

        // A pulls B's row, merges both edits, and must re-push with a stamp
        // strictly later than the stored LATER so the server accepts the
        // combined row (an equal stamp would be a silent no-op and A's name
        // edit would be lost on the next pull).
        await new SyncCoordinator(owner.userId, storeA, data).sync({ reason: "manual" });
        const recordA = storeA.read(owner.userId);
        expect(recordA.habitUpdatedAt[HABIT_A]).toBeUndefined();

        const final = await data.pull(owner.userId);
        expect(final.habits[HABIT_A].value.name).toBe("From A");
        expect(final.habits[HABIT_A].value.color).toBe("#000000");
        expect(new Date(final.habits[HABIT_A].updatedAt).getTime()).toBeGreaterThan(new Date(LATER).getTime());

        // A second sync observes a converged row and pushes nothing further.
        await new SyncCoordinator(owner.userId, storeA, data).sync({ reason: "manual" });
        const again = await data.pull(owner.userId);
        expect(again.habits[HABIT_A].value.name).toBe("From A");
        expect(again.habits[HABIT_A].value.color).toBe("#000000");
    });

    it("applies to-do LWW, tombstones, replay, and wipe preservation", async () => {
        const owner = track(await createLocalUser());
        const data = remote(owner);
        const seed = { ...emptyPlan(), todoUpserts: [
            { value: todo(TODO_A, "Survivor"), updatedAt: T0 },
            { value: todo(TODO_B, "Delete me"), updatedAt: T0 },
        ], todoCompletionUpserts: [todoCompletion(TODO_COMPLETION_A, TODO_A)] };
        await data.push(owner.userId, seed);
        await data.push(owner.userId, seed);
        expect((await owner.client.from("todos").select("id")).data).toHaveLength(2);
        expect((await owner.client.from("todo_completions").select("id")).data).toHaveLength(1);
        expect((await data.pull(owner.userId)).todoCompletions[TODO_COMPLETION_A].todoId).toBe(TODO_A);

        await owner.client.from("todos").update({ title: "Newer server title" }).eq("id", TODO_A);
        await data.push(owner.userId, {
            ...emptyPlan(), todoUpserts: [{ value: todo(TODO_A, "Stale client title"), updatedAt: T0 }],
            todoTombstones: [{ id: TODO_B, deletedAt: LATER }],
        });
        expect((await data.pull(owner.userId)).todos[TODO_A].value.title).toBe("Newer server title");
        expect((await data.pull(owner.userId)).todoCompletions[TODO_COMPLETION_A]).toBeDefined();
        expect((await owner.client.from("todos").select("id").eq("id", TODO_B)).data).toHaveLength(0);

        await data.push(owner.userId, {
            ...emptyPlan(), fullWipe: true,
            settings: { value: DEFAULT_SETTINGS, updatedAt: LATER },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: LATER, newGeneration: true },
        });
        expect((await data.pull(owner.userId)).todos[TODO_A].value.title).toBe("Newer server title");
        expect((await data.pull(owner.userId)).todoCompletions[TODO_COMPLETION_A]).toBeDefined();
    });

    it("removes the pre-completion apply_staged_sync signature", async () => {
        const owner = track(await createLocalUser());
        // The old 18-argument named-argument call must no longer resolve after
        // the forward-only migration adds the two completion parameters.
        const response = await owner.client.rpc("apply_staged_sync", {
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
            p_settings_data: null,
            p_settings_updated_at: null,
            p_timer_data: null,
            p_timer_updated_at: null,
            p_timer_new_generation: false,
            p_pm_data: null,
            p_pm_updated_at: null,
            p_full_wipe: false,
        });
        expect(response.error).not.toBeNull();
    });
});
