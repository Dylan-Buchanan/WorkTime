import { describe, expect, it, vi } from "vitest";
import { LocalStagingStore, type StorageLike } from "./staging/LocalStagingStore";
import { StagingStorageError } from "./staging/types";
import type { SyncSnapshot } from "./staging/types";
import { StagedDataAccess } from "./StagedDataAccess";
import type { SyncExecutor, SyncOptions, SyncResult } from "./DataAccess";
import { makeActiveTimer, makeAppState, defaultSettings } from "../../test/mockTauri";
import { timerGenerationKey } from "./sync/timerCompletions";
import type { ActiveTimer, Habit, HabitCompletion } from "../../state/types";
import type { Todo, TodoCompletion } from "../todos";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

const TASK_T1 = {
    id: "t1",
    name: "Task",
    target_pomodoros: 2,
    completed_pomodoros: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    break_skips: 0,
    archived: false,
};

function H(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: `Habit ${id}`,
        description: "",
        color: "#ffffff",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function HC(id: string, habitId: string, overrides: Partial<HabitCompletion> = {}): HabitCompletion {
    return {
        id,
        habitId,
        bucket: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function TD(id: string, overrides: Partial<Todo> = {}): Todo {
    return { id, title: `Todo ${id}`, rule: null, dueDate: null, estimate: 1, currentTaskId: null, position: 0, isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

function TC(id: string, todoId: string): TodoCompletion {
    return { id, todoId, bucket: "2026-01-03", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
}

function throwingStorage(): StorageLike {
    return {
        getItem: () => null,
        setItem: () => {
            throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
    };
}

function makeSyncExecutor(): { executor: SyncExecutor; sync: ReturnType<typeof vi.fn> } {
    const sync = vi.fn<SyncExecutor["sync"]>();
    return { executor: { sync }, sync };
}

/** Seeds an expired work timer whose task is present so completion succeeds. */
async function seedExpiredTimer(store: LocalStagingStore, ownerId: string, timerOverrides: Record<string, unknown> = {}) {
    const timer = makeActiveTimer({
        task_id: "t1",
        started_at: "2026-01-01T00:00:00.000Z",
        ends_at: "2026-01-01T00:24:59.000Z",
        planned_secs: 25 * 60,
        ...timerOverrides,
    });
    await store.update(ownerId, (current) => ({
        ...current,
        state: makeAppState({
            tasks: { t1: { ...TASK_T1 } },
            active_task: "t1",
            timer,
        }),
    }));
    return timer;
}

/** An initialized baseline carrying the given timer row. */
function makeBaseline(timer: ActiveTimer | null, overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    return {
        tasks: { t1: { value: { ...TASK_T1 }, updatedAt: "2026-01-01T00:00:00.000Z" } },
        logs: {},
        habits: {},
        habitCompletions: {},
        todos: {},
        todoCompletions: {},
        settings: { value: { ...defaultSettings }, updatedAt: "2026-01-01T00:00:00.000Z" },
        timerState: {
            value: { active_task: "t1", current_cycle_pomodoros: 0, timer },
            updatedAt: "2026-01-01T00:00:00.000Z",
            completed: false,
        },
        pmState: { value: null, updatedAt: null },
        ...overrides,
    };
}

describe("StagedDataAccess", () => {
    it("executes representative commands locally with zero sync calls", async () => {
        const { executor, sync } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T00:00:00.000Z"),
            createTaskId: () => "task-1",
            createLogId: () => "log-1",
        });

        const created = await data.createTask("Local", 2);
        expect(created.value.id).toBe("task-1");
        await data.setActiveTask(created.value.id);
        const started = await data.startWorkTimer();
        expect(started.value.kind).toBe("Work");
        await data.pauseTimer();
        await data.resumeTimer();
        await data.updateSettings({ work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4, end_of_day: "22:00" });
        await data.setTaskTarget(created.value.id, 3);
        await data.finalizeTask(created.value.id);
        await data.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "2026-01-01T00:00:00.000Z" } });

        // Every command staged locally; the injected executor was never invoked.
        expect(sync).not.toHaveBeenCalled();
        const record = store.read(OWNER_A);
        expect(record.state.tasks[created.value.id]).toBeDefined();
        expect(record.taskUpdatedAt[created.value.id]).toBe("2026-01-01T00:00:00.000Z");
        expect(record.pmState).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "2026-01-01T00:00:00.000Z" } });
        expect(await data.loadPMState()).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "2026-01-01T00:00:00.000Z" } });
    });

    it("persists switched progress and resumes it through a new access instance", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const task2 = { ...TASK_T1, id: "t2", name: "Task 2" };
        await store.update(OWNER_A, (current) => ({
            ...current,
            state: makeAppState({
                tasks: { t1: { ...TASK_T1 }, t2: task2 },
                active_task: "t1",
                timer: makeActiveTimer({
                    task_id: "t1",
                    started_at: "2026-01-01T00:00:00.000Z",
                    ends_at: "2026-01-01T00:25:00.000Z",
                    planned_secs: 1500,
                }),
            }),
        }));
        const first = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T00:10:00.000Z"),
            createLogId: () => "log-switch",
        });

        await first.setActiveTask("t2");
        expect(store.read(OWNER_A).inProgressPomodoros).toEqual({ t1: 600 });
        expect(store.read(OWNER_A).state.timer).toMatchObject({ task_id: "t2", planned_secs: 1500 });
        await first.finalizeTask("t2");

        const reloaded = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T00:10:00.000Z"),
        });
        await reloaded.setActiveTask("t1");
        const resumed = await reloaded.startWorkTimer();
        expect(resumed.value).toMatchObject({ task_id: "t1", planned_secs: 900 });
        expect(store.read(OWNER_A).inProgressPomodoros).toEqual({ t1: 600 });
    });

    it("completes a resumed timer while keeping the completion journal shape unchanged", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        let now = new Date("2026-01-01T00:00:00.000Z");
        await store.update(OWNER_A, (current) => ({
            ...current,
            state: makeAppState({
                tasks: { t1: { ...TASK_T1, completed_pomodoros: 0.4 } },
                active_task: "t1",
            }),
            inProgressPomodoros: { t1: 600, t2: 300 },
        }));
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => now,
            createLogId: () => "log-resumed",
        });
        const started = await data.startWorkTimer();
        expect(started.value.planned_secs).toBe(900);
        now = new Date("2026-01-01T00:15:00.000Z");

        expect((await data.completeTimer(started.value)).applied).toBe(true);
        const record = store.read(OWNER_A);
        expect(record.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(record.inProgressPomodoros).toEqual({ t2: 300 });
        expect(record.pendingCompletions).toHaveLength(1);
        expect(record.pendingCompletions[0].expectedTimerState).toEqual({
            active_task: "t1",
            current_cycle_pomodoros: 0,
            timer: started.value,
        });
        expect(record.pendingCompletions[0].resultTimerState).toEqual({
            active_task: "t1",
            current_cycle_pomodoros: 1,
            timer: null,
        });
        expect(Object.keys(record.pendingCompletions[0].expectedTimerState).sort()).toEqual([
            "active_task", "current_cycle_pomodoros", "timer",
        ]);
    });

    it("reconciles an expired timer locally once and returns the reconciledTimer shape", async () => {
        const { executor, sync } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
            createLogId: () => "log-reconciled",
        });
        await seedExpiredTimer(store, OWNER_A);

        const first = await data.fetchState();
        expect(first.reconciledTimer).toEqual({ kind: "Work", taskId: "t1", applied: true });
        expect(first.state.logs).toHaveLength(1);
        expect(first.state.logs[0].id).toBe("log-reconciled");

        // A repeated fetchState must not create a second log for the same generation.
        const second = await data.fetchState();
        expect(second.reconciledTimer).toBeNull();
        expect(store.read(OWNER_A).state.logs).toHaveLength(1);
        expect(sync).not.toHaveBeenCalled();
    });

    it("returns applied=false for a completion race loser without adding a second log", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
            createLogId: () => "log-winner",
        });
        const timer = await seedExpiredTimer(store, OWNER_A);

        const winner = await data.completeTimer(timer);
        expect(winner.applied).toBe(true);

        const loser = await data.completeTimer(timer);
        expect(loser.applied).toBe(false);

        const mismatched = makeActiveTimer({ task_id: "t1", ends_at: "2026-01-01T01:30:00.000Z" });
        expect((await data.completeTimer(mismatched)).applied).toBe(false);

        expect(store.read(OWNER_A).state.logs).toHaveLength(1);
    });

    it("journals an exact completion record and rejects same-generation replay", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
            createLogId: () => "log-journal",
        });
        const timer = await seedExpiredTimer(store, OWNER_A);
        const completion = await data.completeTimer(timer);
        expect(completion.applied).toBe(true);

        const record = store.read(OWNER_A);
        expect(record.pendingCompletions).toHaveLength(1);
        const entry = record.pendingCompletions[0];
        expect(entry.generationKey).toBe(timerGenerationKey(timer));
        expect(entry.sequence).toBe(1);
        expect(entry.expectedTimer).toEqual(timer);
        expect(entry.expectedTimerState).toEqual({ active_task: "t1", current_cycle_pomodoros: 0, timer });
        expect(entry.resultTimerState).toEqual({ active_task: "t1", current_cycle_pomodoros: 1, timer: null });
        expect(entry.taskBefore).toEqual({ ...TASK_T1 });
        expect(entry.taskAfter?.completed_pomodoros).toBe(1);
        expect(entry.log.id).toBe("log-journal");
        expect(entry.localOnlyGeneration).toBe(true); // no baseline observed yet
        expect(entry.completedAt).toBe("2026-01-01T01:00:00.000Z");

        // A same-generation replay is rejected and creates no second log or entry.
        const replay = await data.completeTimer(timer);
        expect(replay.applied).toBe(false);
        const after = store.read(OWNER_A);
        expect(after.state.logs).toHaveLength(1);
        expect(after.pendingCompletions).toHaveLength(1);
    });

    it("keeps a single winner when two staged access instances share one store", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const first = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
            createLogId: () => "log-winner",
        });
        const second = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
            createLogId: () => "log-loser",
        });
        const timer = await seedExpiredTimer(store, OWNER_A);

        expect((await first.completeTimer(timer)).applied).toBe(true);
        expect((await second.completeTimer(timer)).applied).toBe(false);
        const record = store.read(OWNER_A);
        expect(record.state.logs).toHaveLength(1);
        expect(record.state.logs[0].id).toBe("log-winner");
        expect(record.pendingCompletions).toHaveLength(1);
    });

    it("records localOnlyGeneration only when the expected timer is not the last synced timer", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const timer = makeActiveTimer({
            task_id: "t1",
            started_at: "2026-01-01T00:00:00.000Z",
            ends_at: "2026-01-01T00:24:59.000Z",
            planned_secs: 25 * 60,
        });
        await store.update(OWNER_A, (current) => ({
            ...current,
            initialized: true,
            lastSynced: makeBaseline(timer),
            state: makeAppState({ tasks: { t1: { ...TASK_T1 } }, active_task: "t1", timer }),
        }));
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
        });

        await data.completeTimer(timer);
        expect(store.read(OWNER_A).pendingCompletions[0].localOnlyGeneration).toBe(false);

        // A different local generation that is absent from the baseline is local-only.
        const other = makeActiveTimer({
            task_id: "t1",
            started_at: "2026-01-01T00:50:00.000Z",
            ends_at: "2026-01-01T00:59:00.000Z",
            planned_secs: 25 * 60,
        });
        await store.update(OWNER_A, (current) => ({
            ...current,
            timerCompleted: false,
            state: { ...current.state, current_cycle_pomodoros: 1, timer: other },
        }));
        await data.completeTimer(other);
        const entries = store.read(OWNER_A).pendingCompletions;
        expect(entries).toHaveLength(2);
        expect(entries[1].localOnlyGeneration).toBe(true);
    });

    it("orders multiple chronological completions and preserves unresolved entries when a new timer starts", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        let logCounter = 0;
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-01T01:00:00.000Z"),
            createLogId: () => `log-${++logCounter}`,
        });
        const work = await seedExpiredTimer(store, OWNER_A);
        await data.completeTimer(work);

        // Starting a break generation resets the guard but not the journal.
        await data.startBreakTimer();
        expect(store.read(OWNER_A).pendingCompletions).toHaveLength(1);
        expect(store.read(OWNER_A).timerCompleted).toBe(false);

        // Let the break timer expire and complete it as a second journal entry.
        const breakTimer = store.read(OWNER_A).state.timer!;
        const expired = { ...breakTimer, ends_at: "2026-01-01T00:59:00.000Z" };
        await store.update(OWNER_A, (current) => ({ ...current, state: { ...current.state, timer: expired } }));
        const result = await data.completeTimer(expired);
        expect(result.applied).toBe(true);

        const entries = store.read(OWNER_A).pendingCompletions;
        expect(entries.map((entry) => entry.sequence)).toEqual([1, 2]);
        expect(entries[0].log.id).toBe("log-1");
        expect(entries[0].taskAfter).not.toBeNull();
        expect(entries[1].log.id).toBe("log-2");
        expect(entries[1].log.was_break).toBe(true);
        expect(entries[1].taskBefore).toBeNull();
        expect(entries[1].taskAfter).toBeNull();
    });

    it("stages task and log deletes with timestamped tombstones", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        await store.update(OWNER_A, (current) => ({
            ...current,
            state: makeAppState({
                tasks: { t1: { ...TASK_T1 } },
                logs: [{ id: "log-1", task_id: "t1", duration_minutes: 25, finished_at: "2026-01-01T00:25:00.000Z", was_break: false, break_skipped: false }],
            }),
            inProgressPomodoros: { t1: 600, t2: 300 },
        }));
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-02T00:00:00.000Z"),
        });

        await data.deleteTask("t1");
        let record = store.read(OWNER_A);
        expect(record.state.tasks.t1).toBeUndefined();
        expect(record.taskTombstones.t1).toEqual({ id: "t1", deletedAt: "2026-01-02T00:00:00.000Z" });
        expect(record.taskUpdatedAt.t1).toBeUndefined();
        expect(record.inProgressPomodoros).toEqual({ t2: 300 });

        await data.deletePomodoroLog("log-1");
        record = store.read(OWNER_A);
        expect(record.state.logs).toHaveLength(0);
        expect(record.logTombstones["log-1"]).toEqual({ id: "log-1", deletedAt: "2026-01-02T00:00:00.000Z" });
    });

    it("reset stages a full wipe, clears task/log staging, and preserves PM and habits", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-03T00:00:00.000Z"),
            createTaskId: () => "task-1",
        });
        await data.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "pm-time" } });
        await data.saveHabits([H("h1", { name: "Survivor habit" })], [HC("c1", "h1", { bucket: "2026-01-02" })]);
        await data.createTask("Doomed", 1);
        await store.update(OWNER_A, (current) => ({
            ...current,
            inProgressPomodoros: { "task-1": 600, other: 300 },
        }));

        const result = await data.resetAppState();
        const record = store.read(OWNER_A);

        expect(result.state).toEqual(makeAppState());
        expect(record.state).toEqual(makeAppState());
        expect(record.fullWipe).toEqual({ createdAt: "2026-01-03T00:00:00.000Z" });
        expect(record.timerCompleted).toBe(false);
        expect(record.taskUpdatedAt).toEqual({});
        expect(record.settingsUpdatedAt).toBeNull();
        expect(record.timerUpdatedAt).toBeNull();
        expect(record.taskTombstones).toEqual({});
        expect(record.logTombstones).toEqual({});
        expect(record.pendingCompletions).toEqual([]);
        expect(record.inProgressPomodoros).toEqual({});

        // PM state and its timestamp survive the wipe untouched.
        expect(await data.loadPMState()).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "pm-time" } });
        expect(record.pmUpdatedAt).toBe("2026-01-03T00:00:00.000Z");

        // Habits and completions are outside the wipe scope and survive too.
        expect(record.habits.h1.name).toBe("Survivor habit");
        expect(record.habitCompletions.c1.bucket).toBe("2026-01-02");
        expect(await data.loadHabits()).toEqual({
            habits: [H("h1", { name: "Survivor habit" })],
            completions: [HC("c1", "h1", { bucket: "2026-01-02" })],
        });
    });

    it("stages habit and completion saves with stamps, tombstones, and zero network calls", async () => {
        const { executor, sync } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-02T00:00:00.000Z"),
        });

        // Baseline already carries h1/c1 so unchanged rows never re-stamp.
        await store.update(OWNER_A, (current) => ({
            ...current,
            initialized: true,
            lastSynced: makeBaseline(null, {
                habits: { h1: { value: H("h1", { name: "Original" }), updatedAt: "2026-01-01T00:00:00.000Z" } },
                habitCompletions: { c1: HC("c1", "h1") },
            }),
            habits: { h1: H("h1", { name: "Original" }) },
            habitCompletions: { c1: HC("c1", "h1") },
        }));

        await data.saveHabits(
            [
                H("h1", { name: "Changed" }), // changed -> fresh stamp
                H("h2", { name: "New" }),     // new -> stamp
            ],
            [
                HC("c1", "h1"),                          // unchanged -> kept, no tombstone
                HC("c2", "h1", { bucket: "2026-01-03" }), // new
            ],
        );

        const record = store.read(OWNER_A);
        expect(sync).not.toHaveBeenCalled();
        expect(record.habits.h1.name).toBe("Changed");
        expect(record.habits.h2.name).toBe("New");
        expect(record.habitUpdatedAt.h1).toBe("2026-01-02T00:00:00.000Z");
        expect(record.habitUpdatedAt.h2).toBe("2026-01-02T00:00:00.000Z");
        expect(record.habitCompletions.c2.bucket).toBe("2026-01-03");
        expect(record.habitTombstones).toEqual({});
        expect(record.habitCompletionTombstones).toEqual({});

        // Removals stage id-keyed tombstones and clear stamps.
        await data.saveHabits([], []);
        const removed = store.read(OWNER_A);
        expect(removed.habits).toEqual({});
        expect(removed.habitCompletions).toEqual({});
        expect(removed.habitUpdatedAt).toEqual({});
        expect(removed.habitTombstones.h1).toEqual({ id: "h1", deletedAt: "2026-01-02T00:00:00.000Z" });
        expect(removed.habitTombstones.h2).toEqual({ id: "h2", deletedAt: "2026-01-02T00:00:00.000Z" });
        expect(removed.habitCompletionTombstones.c1).toEqual({ id: "c1", deletedAt: "2026-01-02T00:00:00.000Z", habitId: "h1" });
        expect(removed.habitCompletionTombstones.c2).toEqual({ id: "c2", deletedAt: "2026-01-02T00:00:00.000Z", habitId: "h1" });

        // Reintroducing an id clears its tombstone and re-stamps it.
        await data.saveHabits([H("h1", { name: "Back" })], [HC("c1", "h1")]);
        const back = store.read(OWNER_A);
        expect(back.habits.h1.name).toBe("Back");
        expect(back.habitTombstones.h1).toBeUndefined();
        expect(back.habitUpdatedAt.h1).toBe("2026-01-02T00:00:00.000Z");
        expect(back.habitCompletions.c1).toBeDefined();
        expect(back.habitCompletionTombstones.c1).toBeUndefined();

        // loadHabits returns fresh clones so callers cannot mutate the store.
        const loaded = await data.loadHabits();
        expect(loaded.habits.map((habit) => habit.id)).toEqual(["h1"]);
        expect(loaded.completions.map((completion) => completion.id)).toEqual(["c1"]);
        loaded.habits[0].name = "mutated";
        expect((await data.loadHabits()).habits[0].name).toBe("Back");
    });

    it("records cascade provenance only when a completion is removed with its habit", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-02T00:00:00.000Z"),
        });

        await store.update(OWNER_A, (current) => ({
            ...current,
            initialized: true,
            lastSynced: makeBaseline(null, {
                habits: { h1: { value: H("h1", { name: "Original" }), updatedAt: "2026-01-01T00:00:00.000Z" } },
                habitCompletions: { c1: HC("c1", "h1") },
            }),
            habits: { h1: H("h1", { name: "Original" }) },
            habitCompletions: { c1: HC("c1", "h1") },
        }));

        // Unchecking one completion while the habit stays in the desired set is
        // an individual delete with no cascade provenance.
        await data.saveHabits([H("h1", { name: "Original" })], []);
        const unchecked = store.read(OWNER_A);
        expect(unchecked.habitCompletionTombstones.c1).toEqual({
            id: "c1",
            deletedAt: "2026-01-02T00:00:00.000Z",
        });
        expect(unchecked.habitTombstones.h1).toBeUndefined();

        // Deleting the habit later does not retroactively tag the already-staged
        // uncheck: the completion was removed while the habit was still live, so
        // its tombstone must stay an unconditional identity delete even if the
        // habit is revived by another device.
        await data.saveHabits([], []);
        const deleted = store.read(OWNER_A);
        expect(deleted.habitTombstones.h1).toEqual({ id: "h1", deletedAt: "2026-01-02T00:00:00.000Z" });
        expect(deleted.habitCompletionTombstones.c1).toEqual({
            id: "c1",
            deletedAt: "2026-01-02T00:00:00.000Z",
        });
    });

    it("stages to-do upserts and tombstones without network access", async () => {
        const { executor, sync } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, { now: () => new Date("2026-01-02T00:00:00.000Z") });
        await data.saveTodos([TD("todo-1", { dueDate: "2026-01-03" })], [TC("completion-1", "todo-1")]);
        expect(sync).not.toHaveBeenCalled();
        expect(store.read(OWNER_A).todoUpdatedAt["todo-1"]).toBe("2026-01-02T00:00:00.000Z");
        const loaded = await data.loadTodos();
        expect(loaded.completions).toEqual([TC("completion-1", "todo-1")]);
        loaded.todos[0].title = "mutated";
        expect((await data.loadTodos()).todos[0].title).toBe("Todo todo-1");

        await data.saveTodos([], []);
        expect(store.read(OWNER_A).todoTombstones["todo-1"]).toEqual({
            id: "todo-1", deletedAt: "2026-01-02T00:00:00.000Z",
        });
    });

    it("isolates owners sharing one store and reads local writes immediately", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const a = new StagedDataAccess(OWNER_A, store, executor, { createTaskId: () => "task-a" });
        const b = new StagedDataAccess(OWNER_B, store, executor, { createTaskId: () => "task-b" });

        await a.createTask("For A", 1);
        expect(Object.keys(store.read(OWNER_B).state.tasks)).toHaveLength(0);

        const fetched = await a.fetchState();
        expect(fetched.state.tasks["task-a"].name).toBe("For A");

        await b.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "b" } });
        expect(await a.loadPMState()).toBeNull();
        expect(await b.loadPMState()).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "b" } });
    });

    it("uses the injected clock for stamps and retains UUIDs from factories", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor, {
            now: () => new Date("2026-01-04T05:06:07.000Z"),
            createTaskId: () => "task-fixed",
            createLogId: () => "log-fixed",
        });

        const created = await data.createTask("Stamped", 2);
        const record = store.read(OWNER_A);
        expect(created.value.id).toBe("task-fixed");
        expect(record.state.tasks["task-fixed"].created_at).toBe("2026-01-04T05:06:07.000Z");
        expect(record.taskUpdatedAt["task-fixed"]).toBe("2026-01-04T05:06:07.000Z");

        const timer = await seedExpiredTimer(store, OWNER_A, { ends_at: "2026-01-04T05:06:06.000Z" });
        await data.completeTimer(timer);
        const after = store.read(OWNER_A);
        expect(after.state.logs[0].id).toBe("log-fixed");
        expect(after.timerCompleted).toBe(true);
        expect(after.timerUpdatedAt).toBe("2026-01-04T05:06:07.000Z");
        expect(after.taskUpdatedAt.t1).toBe("2026-01-04T05:06:07.000Z");
    });

    it("notifies subscribers after local commands", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor);
        const listener = vi.fn();
        const unsubscribe = data.subscribe(listener);

        await data.createTask("Notify", 1);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        await data.createTask("Again", 1);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("rejects a command when the storage write fails without persisting", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(throwingStorage());
        const data = new StagedDataAccess(OWNER_A, store, executor);
        await expect(data.createTask("WillFail", 1)).rejects.toThrow(StagingStorageError);
    });

    it("leaves the record and revision unchanged when an engine command fails", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor);
        const before = store.read(OWNER_A);

        await expect(data.finalizeTask("missing")).rejects.toThrow(/Task not found/);
        await expect(data.deleteTask("missing")).rejects.toThrow(/Task not found/);

        const after = store.read(OWNER_A);
        expect(after.revision).toBe(before.revision);
        expect(after.state).toEqual(before.state);
        expect(after.taskTombstones).toEqual({});
    });

    it("stages commands safely while uninitialized and surfaces them as pending work", async () => {
        const { executor } = makeSyncExecutor();
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor);

        await data.createTask("BeforeBootstrap", 1);
        const record = store.read(OWNER_A);
        expect(data.isInitialized()).toBe(false);
        expect(record.initialized).toBe(false);
        expect(record.unbootstrapped).toBe(true);
        expect(Object.keys(record.state.tasks)).toHaveLength(1);
        // Pre-bootstrap edits are unsynced work: the badge/banner/close dialog
        // must see them even though no baseline exists yet.
        expect(data.pendingCount()).toBe(1);
    });

    it("sync delegates to the injected executor and surfaces its result", async () => {
        const { executor, sync } = makeSyncExecutor();
        const result: SyncResult = {
            state: makeAppState({ active_task: "t1" }),
            pmState: null,
            pendingCount: 0,
            initialized: true,
        };
        sync.mockResolvedValue(result);
        const store = new LocalStagingStore(window.localStorage);
        const data = new StagedDataAccess(OWNER_A, store, executor);

        const options: SyncOptions = { reason: "manual" };
        await expect(data.sync(options)).resolves.toEqual(result);
        expect(sync).toHaveBeenCalledWith(options);
    });
});
