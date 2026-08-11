import { describe, expect, it } from "vitest";
import type { ActiveTimer, Habit, HabitCompletion, PomodoroLogEntry, Task } from "../../../state/types";
import { defaultAppState } from "../../engine";
import { LocalStagingStore } from "../staging/LocalStagingStore";
import type { StagedOwnerRecord, SyncSnapshot, TimerStateSlice } from "../staging/types";
import { buildPushPlan, commitAcknowledgedPush, isLiveTimer, mergePulledSnapshot, MergeError } from "./merge";
import type { Todo } from "../../todos";

const NOW = new Date("2026-01-10T00:00:00.000Z");
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";
const T3_LATER = "2026-01-03T00:00:00.001Z";

function T(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        name: `Task ${id}`,
        target_pomodoros: 2,
        completed_pomodoros: 0,
        created_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
        break_skips: 0,
        archived: false,
        ...overrides,
    };
}

function LOG(id: string, overrides: Partial<PomodoroLogEntry> = {}): PomodoroLogEntry {
    return {
        id,
        task_id: "t1",
        duration_minutes: 25,
        finished_at: "2026-01-01T00:25:00.000Z",
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

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
    return { id, title: `Todo ${id}`, rule: null, dueDate: null, position: 0, isArchived: false,
        createdAt: T1, updatedAt: T1, ...overrides };
}

/**
 * A pulled habit snapshot row: the domain `updatedAt` mirrors the transport
 * `updated_at` value exactly, as `SupabaseDataAccess.validateHabit` produces.
 */
function HROW(habit: Habit, updatedAt: string): NonNullable<SyncSnapshot["habits"][string]> {
    return { value: { ...habit, updatedAt }, updatedAt };
}

function timerSlice(timer: ActiveTimer | null): TimerStateSlice {
    return { active_task: "t1", current_cycle_pomodoros: 0, timer };
}

function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    return {
        tasks: {},
        logs: {},
        habits: {},
        habitCompletions: {},
        todos: {},
        settings: { value: { ...defaultAppState().settings }, updatedAt: T1 },
        timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: T1, completed: false },
        pmState: { value: null, updatedAt: null },
        ...overrides,
    };
}

/** Builds an initialized record whose local state exactly matches `baseline`. */
function recordFromBaseline(baseline: SyncSnapshot, overrides: Partial<StagedOwnerRecord> = {}): StagedOwnerRecord {
    const slice = baseline.timerState.value ?? { active_task: null, current_cycle_pomodoros: 0, timer: null };
    return {
        schemaVersion: 3,
        ownerId: "owner-a",
        revision: 1,
        initialized: true,
        state: {
            tasks: Object.fromEntries(Object.entries(baseline.tasks).map(([id, row]) => [id, { ...row.value }])),
            logs: Object.values(baseline.logs).map((log) => ({ ...log })),
            settings: { ...(baseline.settings.value ?? defaultAppState().settings) },
            active_task: slice.active_task ?? null,
            current_cycle_pomodoros: slice.current_cycle_pomodoros,
            timer: slice.timer ? { ...slice.timer } : null,
        },
        pmState: baseline.pmState.value ? { ...baseline.pmState.value } : null,
        taskUpdatedAt: {},
        settingsUpdatedAt: baseline.settings.updatedAt,
        timerUpdatedAt: baseline.timerState.updatedAt,
        pmUpdatedAt: baseline.pmState.updatedAt,
        timerCompleted: baseline.timerState.completed,
        taskTombstones: {},
        logTombstones: {},
        fullWipe: null,
        pendingCompletions: [],
        unbootstrapped: false,
        lastSynced: baseline,
        habits: Object.fromEntries(Object.entries(baseline.habits).map(([id, row]) => [id, { ...row.value }])),
        habitCompletions: Object.fromEntries(
            Object.entries(baseline.habitCompletions).map(([id, completion]) => [id, { ...completion }]),
        ),
        habitUpdatedAt: {},
        habitTombstones: {},
        habitCompletionTombstones: {},
        todos: Object.fromEntries(Object.entries(baseline.todos).map(([id, row]) => [id, { ...row.value }])),
        todoUpdatedAt: {},
        todoTombstones: {},
        ...overrides,
    };
}

function uninitializedRecord(overrides: Partial<StagedOwnerRecord> = {}): StagedOwnerRecord {
    return {
        schemaVersion: 3,
        ownerId: "owner-a",
        revision: 0,
        initialized: false,
        state: defaultAppState(),
        pmState: null,
        taskUpdatedAt: {},
        settingsUpdatedAt: null,
        timerUpdatedAt: null,
        pmUpdatedAt: null,
        timerCompleted: false,
        taskTombstones: {},
        logTombstones: {},
        fullWipe: null,
        pendingCompletions: [],
        unbootstrapped: false,
        lastSynced: null,
        habits: {},
        habitCompletions: {},
        habitUpdatedAt: {},
        habitTombstones: {},
        habitCompletionTombstones: {},
        todos: {},
        todoUpdatedAt: {},
        todoTombstones: {},
        ...overrides,
    };
}

describe("isLiveTimer", () => {
    it("protects only running, unexpired, unpaused timers", () => {
        const running = makeTimer({ ends_at: "2026-01-10T00:25:00.000Z" });
        expect(isLiveTimer(running, NOW)).toBe(true);

        expect(isLiveTimer({ ...running, paused: true }, NOW)).toBe(false);
        expect(isLiveTimer({ ...running, ends_at: "2026-01-09T00:25:00.000Z" }, NOW)).toBe(false);
        expect(isLiveTimer(null, NOW)).toBe(false);
    });

    it("fails safe for an invalid ends_at instead of treating the timer as live", () => {
        expect(isLiveTimer(makeTimer({ ends_at: "not-a-date" }), NOW)).toBe(false);
    });
});

describe("mergePulledSnapshot task matrix", () => {
    const base = snapshot({
        tasks: { t1: { value: T("t1", { name: "Base" }), updatedAt: T1 } },
    });

    it("keeps a local-only change pending against the pulled baseline", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Local");
        expect(merged.record.taskUpdatedAt.t1).toBe(T2);
        expect(merged.record.lastSynced).toBe(remote);
        expect(merged.remoteBaseline).toBe(remote);
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.taskUpserts).toEqual([{ value: T("t1", { name: "Local" }), updatedAt: T2 }]);
        expect(plan.acknowledged.taskUpserts.t1).toEqual({ value: T("t1", { name: "Local" }), updatedAt: T2 });

        const pushed = { ...remote, tasks: { t1: { value: T("t1", { name: "Local" }), updatedAt: T2 } } };
        const committed = commitAcknowledgedPush(merged.record, plan, pushed);
        expect(committed.taskUpdatedAt.t1).toBeUndefined();
        expect(committed.lastSynced).toBe(pushed);
    });

    it("preserves a local edit when the remote deletes the baseline task", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const remote = snapshot();

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Local");
        expect(merged.record.taskUpdatedAt.t1).toBe(T2);
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).taskUpserts).toEqual([
            { value: T("t1", { name: "Local" }), updatedAt: T2 },
        ]);
    });

    it("adopts a remote-only change with nothing left to push", () => {
        const record = recordFromBaseline(base);
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote" }), updatedAt: T3 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Remote");
        expect(merged.record.taskUpdatedAt.t1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);

        const plan = buildPushPlan(merged.record);
        expect(plan.taskUpserts).toEqual([]);
        expect(plan.fullWipe).toBe(false);
    });

    it("lets the later updated_at win a same-field conflict", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote" }), updatedAt: T3 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Remote");
        expect(merged.pendingCount).toBe(0);
    });

    it("keeps local when the local updated_at is newer in a same-field conflict", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T3 },
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote" }), updatedAt: T2 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Local");
        expect(merged.record.taskUpdatedAt.t1).toBe(T3);
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.taskUpserts).toEqual([{ value: T("t1", { name: "Local" }), updatedAt: T3 }]);
    });

    it("preserves different-field changes from both branches", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Base", target_pomodoros: 5 }), updatedAt: T3 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1).toEqual(T("t1", { name: "Local", target_pomodoros: 5 }));
        expect(merged.record.taskUpdatedAt.t1).toBe(T3); // max(local T2, remote T3)
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.taskUpserts).toEqual([
            { value: T("t1", { name: "Local", target_pomodoros: 5 }), updatedAt: T3 },
        ]);
    });

    it("chooses remote on an exact updated_at tie", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote" }), updatedAt: T2 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Remote");
        expect(merged.record.taskUpdatedAt.t1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
    });

    it("treats remote absence of a baseline row as a remote deletion", () => {
        const record = recordFromBaseline(base);
        const remote = snapshot();

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1).toBeUndefined();
        expect(merged.record.taskTombstones.t1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
    });

    it("does not delete a task independently created locally after the baseline", () => {
        const record = recordFromBaseline(base, {
            state: {
                ...recordFromBaseline(base).state,
                tasks: { t1: T("t1", { name: "Base" }), t2: T("t2", { name: "New" }) },
            },
            taskUpdatedAt: { t2: T2 },
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t2).toEqual(T("t2", { name: "New" }));
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.taskUpserts).toEqual([{ value: T("t2", { name: "New" }), updatedAt: T2 }]);
    });

    it("keeps a newer local tombstone pending against a still-present remote row", () => {
        const record = recordFromBaseline(base, {
            state: {
                ...recordFromBaseline(base).state,
                tasks: {},
            },
            taskTombstones: { t1: { id: "t1", deletedAt: T2 } },
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1).toBeUndefined();
        expect(merged.record.taskTombstones.t1).toEqual({ id: "t1", deletedAt: T2 });
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.taskTombstones).toEqual([{ id: "t1", deletedAt: T2 }]);
    });

    it("revives a task when a newer remote update beats the local tombstone", () => {
        const record = recordFromBaseline(base, {
            state: {
                ...recordFromBaseline(base).state,
                tasks: {},
            },
            taskTombstones: { t1: { id: "t1", deletedAt: T2 } },
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Revived" }), updatedAt: T3 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.name).toBe("Revived");
        expect(merged.record.taskTombstones.t1).toBeUndefined();
        expect(merged.record.taskUpdatedAt.t1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
    });

    it("drops the tombstone when the remote already deleted the row", () => {
        const record = recordFromBaseline(base, {
            state: {
                ...recordFromBaseline(base).state,
                tasks: {},
            },
            taskTombstones: { t1: { id: "t1", deletedAt: T2 } },
        });
        const remote = snapshot();

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1).toBeUndefined();
        expect(merged.record.taskTombstones.t1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
    });

    it("fails safely on an invalid local timestamp instead of ordering NaN", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: "not-a-date" },
        });
        const remote = base;
        expect(() => mergePulledSnapshot(record, remote, NOW)).toThrow(MergeError);
        expect(() => mergePulledSnapshot(record, remote, NOW)).toThrow(/Invalid timestamp/);
    });

    it("merges created_at divergence under the same field rule", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { created_at: "2026-01-02T00:00:00.000Z" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { created_at: "2026-01-03T00:00:00.000Z" }), updatedAt: T3 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.tasks.t1.created_at).toBe("2026-01-03T00:00:00.000Z");
    });
});

describe("mergePulledSnapshot habit matrix", () => {
    const base = snapshot({
        habits: { h1: HROW(H("h1", { name: "Base" }), T1) },
    });

    it("preserves different-field changes from both branches", () => {
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Local" }) },
            habitUpdatedAt: { h1: T2 },
        });
        const remote = snapshot({
            habits: { h1: HROW(H("h1", { name: "Base", color: "#000000" }), T3) },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.habits.h1.name).toBe("Local");
        expect(merged.record.habits.h1.color).toBe("#000000");
        // The synthesized row differs from the pulled remote row, so its
        // transport stamp must be strictly later than the remote T3 for the
        // RPC LWW gate to accept the re-push; the domain updatedAt mirrors it.
        expect(merged.record.habits.h1.updatedAt).toBe(T3_LATER);
        expect(merged.record.habitUpdatedAt.h1).toBe(T3_LATER);
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.habitUpserts).toEqual([
            { value: H("h1", { name: "Local", color: "#000000", updatedAt: T3_LATER }), updatedAt: T3_LATER },
        ]);
        expect(plan.acknowledged.habitUpserts.h1).toEqual({
            value: H("h1", { name: "Local", color: "#000000", updatedAt: T3_LATER }),
            updatedAt: T3_LATER,
        });
    });

    it("lets the later updated_at win a same-field conflict and the remote wins an exact tie", () => {
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Local" }) },
            habitUpdatedAt: { h1: T2 },
        });
        const remote = snapshot({
            habits: { h1: HROW(H("h1", { name: "Remote" }), T3) },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.habits.h1.name).toBe("Remote");
        expect(merged.pendingCount).toBe(0);

        // A local stamp newer than the remote keeps local and stays pending.
        const localNewer = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Local" }) },
            habitUpdatedAt: { h1: T3 },
        });
        const remoteOlder = snapshot({
            habits: { h1: HROW(H("h1", { name: "Remote" }), T2) },
        });
        const merged2 = mergePulledSnapshot(localNewer, remoteOlder, NOW);
        expect(merged2.record.habits.h1.name).toBe("Local");
        expect(merged2.record.habitUpdatedAt.h1).toBe(T3);
        expect(merged2.pendingCount).toBe(1);
        expect(buildPushPlan(merged2.record).habitUpserts).toEqual([
            { value: H("h1", { name: "Local", updatedAt: T3 }), updatedAt: T3 },
        ]);

        // An exact timestamp tie chooses the remote value.
        const tied = snapshot({
            habits: { h1: HROW(H("h1", { name: "Remote" }), T2) },
        });
        const merged3 = mergePulledSnapshot(record, tied, NOW);
        expect(merged3.record.habits.h1.name).toBe("Remote");
        expect(merged3.record.habitUpdatedAt.h1).toBeUndefined();
        expect(merged3.pendingCount).toBe(0);
    });

    it("keeps a locally created habit and adopts a remote-only habit", () => {
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Base" }), h2: H("h2", { name: "Local" }) },
            habitUpdatedAt: { h2: T2 },
        });
        const remote = snapshot({
            habits: {
                h1: HROW(H("h1", { name: "Base" }), T1),
                h3: HROW(H("h3", { name: "Remote" }), T3),
            },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.habits.h2.name).toBe("Local");
        expect(merged.record.habits.h3.name).toBe("Remote");
        expect(merged.record.habitUpdatedAt.h2).toBe(T2);
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).habitUpserts).toEqual([
            { value: H("h2", { name: "Local" }), updatedAt: T2 },
        ]);
    });

    it("treats remote absence of a baseline habit as a remote deletion", () => {
        const record = recordFromBaseline(base);
        const merged = mergePulledSnapshot(record, snapshot(), NOW);
        expect(merged.record.habits.h1).toBeUndefined();
        expect(merged.record.habitTombstones.h1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
    });

    it("keeps a newer local habit tombstone pending and revives on a newer remote row", () => {
        const record = recordFromBaseline(base, {
            habits: {},
            habitTombstones: { h1: { id: "h1", deletedAt: T2 } },
        });

        const merged = mergePulledSnapshot(record, base, NOW);
        expect(merged.record.habits.h1).toBeUndefined();
        expect(merged.record.habitTombstones.h1).toEqual({ id: "h1", deletedAt: T2 });
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).habitTombstones).toEqual([{ id: "h1", deletedAt: T2 }]);

        const revived = mergePulledSnapshot(
            record,
            snapshot({ habits: { h1: HROW(H("h1", { name: "Revived" }), T3) } }),
            NOW,
        );
        expect(revived.record.habits.h1.name).toBe("Revived");
        expect(revived.record.habitTombstones.h1).toBeUndefined();
        expect(revived.record.habitUpdatedAt.h1).toBeUndefined();
        expect(revived.pendingCount).toBe(0);
    });

    it("preserves a local habit edit when the remote deletes the baseline habit", () => {
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Local" }) },
            habitUpdatedAt: { h1: T2 },
        });
        const merged = mergePulledSnapshot(record, snapshot(), NOW);
        expect(merged.record.habits.h1.name).toBe("Local");
        expect(merged.record.habitUpdatedAt.h1).toBe(T2);
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).habitUpserts).toEqual([
            { value: H("h1", { name: "Local" }), updatedAt: T2 },
        ]);
    });

    it("fails safely on an invalid habit timestamp instead of ordering NaN", () => {
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Local" }) },
            habitUpdatedAt: { h1: "not-a-date" },
        });
        expect(() => mergePulledSnapshot(record, base, NOW)).toThrow(MergeError);
    });

    it("throws for a changed unstamped habit when building the push plan", () => {
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Changed but unstamped" }) },
        });
        expect(() => buildPushPlan(record)).toThrow(/no updated_at stamp/);
    });
});

describe("habit completion union", () => {
    it("unions local and remote completions, dedups by id, and lets the remote win same-id rows", () => {
        const base = snapshot({ habitCompletions: { c0: HC("c0", "h1") } });
        const record = recordFromBaseline(base, {
            habitCompletions: {
                c0: HC("c0", "h1"),
                c1: HC("c1", "h1", { bucket: "2026-01-02" }),
            },
        });
        const remote = snapshot({
            habitCompletions: {
                c0: HC("c0", "h1", { updatedAt: T3 }),
                c2: HC("c2", "h1", { bucket: "2026-01-03" }),
            },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(Object.keys(merged.record.habitCompletions).sort()).toEqual(["c0", "c1", "c2"]);
        expect(merged.record.habitCompletions.c0.updatedAt).toBe(T3); // remote same-id wins
        expect(merged.pendingCount).toBe(1); // only the locally-new c1 stays pending

        const plan = buildPushPlan(merged.record);
        expect(plan.habitCompletionUpserts).toEqual([HC("c1", "h1", { bucket: "2026-01-02" })]);
        expect(plan.acknowledged.habitCompletionUpserts.c1).toEqual(HC("c1", "h1", { bucket: "2026-01-02" }));
    });

    it("prefers the pulled server completion when a local id occupies the same bucket", () => {
        const base = snapshot({ habitCompletions: { cA: HC("cA", "h1") } });
        const record = recordFromBaseline(base, {
            habitCompletions: { cB: HC("cB", "h1") },
        });
        const remote = snapshot({ habitCompletions: { cA: HC("cA", "h1") } });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(Object.keys(merged.record.habitCompletions)).toEqual(["cA"]);
        expect(merged.record.habitCompletions.cA.id).toBe("cA");
        expect(merged.record.habitCompletions.cB).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
        expect(buildPushPlan(merged.record).habitCompletionUpserts).toEqual([]);
    });

    it("keeps a completion tombstone pending while the pulled remote still carries the id", () => {
        const base = snapshot({ habitCompletions: { c1: HC("c1", "h1") } });
        const record = recordFromBaseline(base, {
            habitCompletions: {},
            habitCompletionTombstones: { c1: { id: "c1", deletedAt: T2 } },
        });

        const merged = mergePulledSnapshot(record, base, NOW);
        expect(merged.record.habitCompletions.c1).toBeUndefined();
        expect(merged.record.habitCompletionTombstones.c1).toEqual({ id: "c1", deletedAt: T2 });
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).habitCompletionTombstones).toEqual([{ id: "c1", deletedAt: T2 }]);
    });

    it("drops a completion tombstone once the remote no longer carries the id", () => {
        const base = snapshot({ habitCompletions: { c1: HC("c1", "h1") } });
        const record = recordFromBaseline(base, {
            habitCompletions: {},
            habitCompletionTombstones: { c1: { id: "c1", deletedAt: T2 } },
        });

        const merged = mergePulledSnapshot(record, snapshot(), NOW);
        expect(merged.record.habitCompletionTombstones.c1).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
        expect(buildPushPlan(merged.record).habitCompletionTombstones).toEqual([]);
    });

    it("clears cascaded completion tombstones when a newer remote habit update revives the habit", () => {
        const base = snapshot({
            habits: { h1: HROW(H("h1", { name: "Base" }), T1) },
            habitCompletions: { c1: HC("c1", "h1"), c2: HC("c2", "h1", { bucket: "2026-01-02" }) },
        });
        const record = recordFromBaseline(base, {
            habits: {},
            habitTombstones: { h1: { id: "h1", deletedAt: T2 } },
            habitCompletions: {},
            habitCompletionTombstones: {
                c1: { id: "c1", deletedAt: T2, habitId: "h1" },
                c2: { id: "c2", deletedAt: T2, habitId: "h1" },
            },
        });
        const remote = snapshot({
            habits: { h1: HROW(H("h1", { name: "Revived" }), T3) },
            habitCompletions: { c1: HC("c1", "h1"), c2: HC("c2", "h1", { bucket: "2026-01-02" }) },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        // The newer remote update revives the habit...
        expect(merged.record.habits.h1.name).toBe("Revived");
        expect(merged.record.habitTombstones.h1).toBeUndefined();
        // ...and the cascaded completion tombstones are suppressed so the
        // history survives instead of being pushed as identity deletes.
        expect(merged.record.habitCompletions.c1.id).toBe("c1");
        expect(merged.record.habitCompletions.c2.id).toBe("c2");
        expect(merged.record.habitCompletionTombstones).toEqual({});
        expect(merged.pendingCount).toBe(0);

        const plan = buildPushPlan(merged.record);
        expect(plan.habitTombstones).toEqual([]);
        expect(plan.habitCompletionTombstones).toEqual([]);
    });

    it("keeps cascaded completion tombstones pending while the habit deletion still wins", () => {
        const base = snapshot({
            habits: { h1: HROW(H("h1", { name: "Base" }), T1) },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        const record = recordFromBaseline(base, {
            habits: {},
            habitTombstones: { h1: { id: "h1", deletedAt: T2 } },
            habitCompletions: {},
            habitCompletionTombstones: { c1: { id: "c1", deletedAt: T2, habitId: "h1" } },
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.habits.h1).toBeUndefined();
        expect(merged.record.habitTombstones.h1).toEqual({ id: "h1", deletedAt: T2 });
        // The cascade provenance survives the merge so the RPC can gate the
        // identity delete against the parent habit.
        expect(merged.record.habitCompletionTombstones.c1).toEqual({ id: "c1", deletedAt: T2, habitId: "h1" });
        expect(merged.pendingCount).toBe(2); // habit tombstone + completion tombstone

        const plan = buildPushPlan(merged.record);
        expect(plan.habitTombstones).toEqual([{ id: "h1", deletedAt: T2 }]);
        expect(plan.habitCompletionTombstones).toEqual([{ id: "c1", deletedAt: T2, habitId: "h1" }]);
        expect(plan.acknowledged.habitCompletionTombstones.c1).toEqual({ deletedAt: T2, habitId: "h1" });
    });

    it("keeps an individual uncheck tombstone pending even when the habit survives", () => {
        const base = snapshot({
            habits: { h1: HROW(H("h1", { name: "Base" }), T1) },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        const record = recordFromBaseline(base, {
            habits: {},
            habitTombstones: { h1: { id: "h1", deletedAt: T2 } },
            habitCompletions: {},
            habitCompletionTombstones: { c1: { id: "c1", deletedAt: T2 } },
        });
        const remote = snapshot({
            habits: { h1: HROW(H("h1", { name: "Revived" }), T3) },
            habitCompletions: { c1: HC("c1", "h1") },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.habits.h1.name).toBe("Revived");
        // An unprovenanced tombstone has no cascade provenance, so it stays
        // pending even though the habit survived.
        expect(merged.record.habitCompletionTombstones.c1).toEqual({ id: "c1", deletedAt: T2 });
        expect(merged.record.habitCompletions.c1).toBeUndefined();
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).habitCompletionTombstones).toEqual([{ id: "c1", deletedAt: T2 }]);
    });
});

describe("singleton whole-row merges", () => {
    const base = snapshot({
        settings: { value: { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 }, updatedAt: T1 },
    });

    const localSettings = { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 };

    it("adopts a remote settings change with nothing pending", () => {
        const record = recordFromBaseline(base);
        const remote = snapshot({
            settings: { value: { ...localSettings, work_minutes: 30 }, updatedAt: T3 },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.settings.work_minutes).toBe(30);
        expect(merged.record.settingsUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);
        expect(buildPushPlan(merged.record).settings).toBeNull();
    });

    it("keeps a local settings change pending and pushes it", () => {
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, settings: { ...localSettings } },
            settingsUpdatedAt: T2,
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.settings).toEqual(localSettings);
        expect(merged.record.settingsUpdatedAt).toBe(T2);
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        expect(plan.settings).toEqual({ value: localSettings, updatedAt: T2 });
    });

    it("resolves a settings conflict by updated_at with remote winning ties", () => {
        const local = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, settings: { ...localSettings } },
            settingsUpdatedAt: T2,
        });
        const remoteNewer = snapshot({
            settings: { value: { ...localSettings, work_minutes: 30 }, updatedAt: T3 },
        });

        const merged = mergePulledSnapshot(local, remoteNewer, NOW);
        expect(merged.record.state.settings.work_minutes).toBe(30);
        expect(merged.record.settingsUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);

        // Local stamp newer than remote wins.
        const localNewer = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, settings: { ...localSettings } },
            settingsUpdatedAt: T3,
        });
        const remoteOlder = snapshot({
            settings: { value: { ...localSettings, work_minutes: 30 }, updatedAt: T2 },
        });
        const merged2 = mergePulledSnapshot(localNewer, remoteOlder, NOW);
        expect(merged2.record.state.settings).toEqual(localSettings);
        expect(merged2.record.settingsUpdatedAt).toBe(T3);
        expect(merged2.pendingCount).toBe(1);
        expect(buildPushPlan(merged2.record).settings).toEqual({ value: localSettings, updatedAt: T3 });

        // Exact tie chooses remote.
        const tied = snapshot({
            settings: { value: { ...localSettings, work_minutes: 30 }, updatedAt: T2 },
        });
        const merged3 = mergePulledSnapshot(local, tied, NOW);
        expect(merged3.record.state.settings.work_minutes).toBe(30);
    });

    it("distinguishes a never-existing settings row from the default UI value", () => {
        const absent = snapshot({
            settings: { value: null, updatedAt: null },
            timerState: { value: null, updatedAt: null, completed: false },
            pmState: { value: null, updatedAt: null },
        });
        const record = recordFromBaseline(absent);

        const merged = mergePulledSnapshot(record, absent, NOW);
        expect(merged.record.state.settings).toEqual(defaultAppState().settings);
        expect(merged.record.settingsUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);
        expect(buildPushPlan(merged.record).settings).toBeNull();
    });

    it("pushes a local settings change even when the server row never existed", () => {
        const absent = snapshot({
            settings: { value: null, updatedAt: null },
            timerState: { value: null, updatedAt: null, completed: false },
            pmState: { value: null, updatedAt: null },
        });
        const record = recordFromBaseline(absent, {
            state: { ...recordFromBaseline(absent).state, settings: { ...localSettings } },
            settingsUpdatedAt: T2,
        });

        const merged = mergePulledSnapshot(record, absent, NOW);
        expect(merged.record.state.settings).toEqual(localSettings);
        expect(merged.record.settingsUpdatedAt).toBe(T2);
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).settings).toEqual({ value: localSettings, updatedAt: T2 });
    });

    it("merges PM as a whole-row singleton and keeps its timestamp", () => {
        const pm = { projects: {}, tasks: {}, meta: { initializedAt: T1 } };
        const basePm = snapshot({ pmState: { value: null, updatedAt: null } });
        const record = recordFromBaseline(basePm, {
            pmState: { ...pm, meta: { initializedAt: "2026-01-04T00:00:00.000Z" } },
            pmUpdatedAt: T2,
        });
        const remotePm = snapshot({
            pmState: { value: { ...pm }, updatedAt: T3 },
        });

        // Local stamp T2 is older than remote T3, so the remote PM wins.
        const merged = mergePulledSnapshot(record, remotePm, NOW);
        expect(merged.record.pmState).toEqual({ ...pm });
        expect(merged.record.pmUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);
        expect(buildPushPlan(merged.record).pmState).toBeNull();
    });
});

describe("log union, ordering, and tombstones", () => {
    const baseLog = LOG("log-0", { finished_at: "2026-01-01T00:25:00.000Z" });

    it("unions local and remote logs, dedups by id, and sorts by finished_at then id", () => {
        const base = snapshot({ logs: { "log-0": { ...baseLog } } });
        const record = recordFromBaseline(base, {
            state: {
                ...recordFromBaseline(base).state,
                logs: [baseLog, LOG("log-1", { finished_at: "2026-01-01T00:20:00.000Z" })],
            },
        });
        const remote = snapshot({
            logs: {
                "log-0": { ...baseLog },
                "log-2": LOG("log-2", { finished_at: "2026-01-01T00:30:00.000Z" }),
            },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.logs.map((log) => log.id)).toEqual(["log-1", "log-0", "log-2"]);
        expect(merged.pendingCount).toBe(1);

        const plan = buildPushPlan(merged.record);
        // Only the locally-new log is pushed; the remote-adopted log is already in the baseline.
        expect(plan.logUpserts).toEqual([LOG("log-1", { finished_at: "2026-01-01T00:20:00.000Z" })]);
        expect(plan.acknowledged.logUpserts["log-1"].id).toBe("log-1");
    });

    it("keeps a log tombstone pending while the pulled baseline still has the log", () => {
        const base = snapshot({ logs: { "log-0": { ...baseLog } } });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, logs: [] },
            logTombstones: { "log-0": { id: "log-0", deletedAt: T2 } },
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.logs).toHaveLength(0);
        expect(merged.record.logTombstones["log-0"]).toEqual({ id: "log-0", deletedAt: T2 });
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).logTombstones).toEqual([{ id: "log-0", deletedAt: T2 }]);
    });

    it("clears a log tombstone once the remote no longer carries the log", () => {
        const base = snapshot({ logs: { "log-0": { ...baseLog } } });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, logs: [] },
            logTombstones: { "log-0": { id: "log-0", deletedAt: T2 } },
        });
        const remote = snapshot();

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.logTombstones["log-0"]).toBeUndefined();
        expect(merged.pendingCount).toBe(0);
        expect(buildPushPlan(merged.record).logTombstones).toEqual([]);
    });

    it("retains a brand-new remote log unless its immutable id is explicitly tombstoned", () => {
        const base = snapshot();
        const remoteLog = LOG("log-remote", { finished_at: "2026-01-02T00:25:00.000Z" });
        const remote = snapshot({ logs: { "log-remote": { ...remoteLog } } });
        const record = recordFromBaseline(base, {
            logTombstones: { "log-remote": { id: "log-remote", deletedAt: T2 } },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.logs).toHaveLength(0);
        expect(merged.record.logTombstones["log-remote"]).toEqual({ id: "log-remote", deletedAt: T2 });
        expect(merged.pendingCount).toBe(1);
    });
});

describe("full wipe", () => {
    const pm = { projects: {}, tasks: {}, meta: { initializedAt: "2026-01-04T00:00:00.000Z" } };
    const W = "2026-01-05T00:00:00.000Z";

    it("ignores remote app state, keeps engine defaults and the marker, and merges PM", () => {
        const base = snapshot({
            tasks: { t1: { value: T("t1", { name: "Doomed" }), updatedAt: T3 } },
            logs: { "log-0": { ...LOG("log-0") } },
            settings: { value: { work_minutes: 45, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 }, updatedAt: T3 },
        });
        const record = recordFromBaseline(base, {
            fullWipe: { createdAt: W },
            timerCompleted: false,
            state: defaultAppState(),
            taskUpdatedAt: {},
            settingsUpdatedAt: null,
            timerUpdatedAt: null,
            taskTombstones: {},
            logTombstones: {},
            pmState: { ...pm },
            pmUpdatedAt: "2026-01-04T00:00:00.000Z",
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state).toEqual(defaultAppState());
        expect(merged.record.fullWipe).toEqual({ createdAt: W });
        expect(merged.record.lastSynced).toBe(remote);
        // PM merges normally and survives the wipe.
        expect(merged.record.pmState).toEqual({ ...pm });
        expect(merged.record.pmUpdatedAt).toBe("2026-01-04T00:00:00.000Z");
        expect(merged.pendingCount).toBe(2); // wipe + PM

        const plan = buildPushPlan(merged.record);
        expect(plan.fullWipe).toBe(true);
        expect(plan.taskUpserts).toEqual([]);
        expect(plan.logUpserts).toEqual([]);
        // Default settings/timer payloads required by the transactional RPC.
        expect(plan.settings).toEqual({ value: defaultAppState().settings, updatedAt: W });
        expect(plan.timerState).toEqual({
            value: { active_task: null, current_cycle_pomodoros: 0, timer: null },
            updatedAt: W,
            newGeneration: true,
        });
        expect(plan.pmState).toEqual({ value: { ...pm }, updatedAt: "2026-01-04T00:00:00.000Z" });
        expect(plan.acknowledged.fullWipe).toEqual({ createdAt: W });

        // After a successful wipe push the marker and default stamps clear.
        const pushed = snapshot({
            tasks: {},
            logs: {},
            settings: { value: defaultAppState().settings, updatedAt: W },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: W, completed: false },
            pmState: { value: { ...pm }, updatedAt: "2026-01-04T00:00:00.000Z" },
        });
        const committed = commitAcknowledgedPush(merged.record, plan, pushed);
        expect(committed.fullWipe).toBeNull();
        expect(committed.settingsUpdatedAt).toBeNull();
        expect(committed.timerUpdatedAt).toBeNull();
        expect(committed.pmUpdatedAt).toBeNull();
        expect(committed.lastSynced).toBe(pushed);
    });

    it("does not synthesize a PM deletion when the wipe carries no PM change", () => {
        const record = recordFromBaseline(snapshot(), {
            fullWipe: { createdAt: W },
            state: defaultAppState(),
        });
        const merged = mergePulledSnapshot(record, snapshot(), NOW);
        expect(merged.record.pmState).toBeNull();
        expect(merged.pendingCount).toBe(1);
        expect(buildPushPlan(merged.record).pmState).toBeNull();
    });

    it("rides habit and completion deltas on a full wipe and never resets them", () => {
        const base = snapshot({
            habits: { h1: { value: H("h1", { name: "Survivor" }), updatedAt: T1 } },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        const record = recordFromBaseline(base, {
            fullWipe: { createdAt: W },
            state: defaultAppState(),
            taskUpdatedAt: {},
            settingsUpdatedAt: null,
            timerUpdatedAt: null,
            taskTombstones: {},
            logTombstones: {},
            habits: { h1: H("h1", { name: "Renamed" }), h2: H("h2", { name: "New" }) },
            habitUpdatedAt: { h1: T2, h2: T2 },
            habitCompletions: { c1: HC("c1", "h1"), c2: HC("c2", "h1", { bucket: "2026-01-02" }) },
        });
        const remote = base;

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state).toEqual(defaultAppState());
        expect(merged.record.fullWipe).toEqual({ createdAt: W });
        // Habits and completions are outside the wipe scope: they merge against
        // the pull and their deltas still ride the wipe plan.
        expect(merged.record.habits.h1.name).toBe("Renamed");
        expect(merged.record.habits.h2.name).toBe("New");
        expect(merged.record.habitCompletions.c2.bucket).toBe("2026-01-02");
        // wipe (1) + h1 rename + h2 creation (2) + new completion c2 (1).
        expect(merged.pendingCount).toBe(4);

        const plan = buildPushPlan(merged.record);
        expect(plan.fullWipe).toBe(true);
        expect(plan.habitUpserts).toEqual([
            { value: H("h1", { name: "Renamed", updatedAt: T2 }), updatedAt: T2 },
            { value: H("h2", { name: "New" }), updatedAt: T2 },
        ]);
        expect(plan.habitCompletionUpserts).toEqual([HC("c2", "h1", { bucket: "2026-01-02" })]);
        expect(plan.acknowledged.habitUpserts.h1).toEqual({
            value: H("h1", { name: "Renamed", updatedAt: T2 }),
            updatedAt: T2,
        });

        // The pushed wipe baseline keeps habits/completions and clears only
        // tasks/logs plus the default singleton rows.
        const pushed = snapshot({
            tasks: {},
            logs: {},
            settings: { value: defaultAppState().settings, updatedAt: W },
            timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: W, completed: false },
            habits: {
                h1: { value: H("h1", { name: "Renamed", updatedAt: T2 }), updatedAt: T2 },
                h2: { value: H("h2", { name: "New" }), updatedAt: T2 },
            },
            habitCompletions: {
                c1: HC("c1", "h1"),
                c2: HC("c2", "h1", { bucket: "2026-01-02" }),
            },
        });
        const committed = commitAcknowledgedPush(merged.record, plan, pushed);
        expect(committed.fullWipe).toBeNull();
        expect(committed.habitUpdatedAt.h1).toBeUndefined();
        expect(committed.habitUpdatedAt.h2).toBeUndefined();
        expect(committed.habits.h1.name).toBe("Renamed");
        expect(committed.lastSynced?.habits.h1.value.name).toBe("Renamed");
        expect(committed.lastSynced?.habitCompletions.c2.id).toBe("c2");
    });
});

describe("live-timer protection", () => {
    const runningTimer = makeTimer({ ends_at: "2026-01-10T00:25:00.000Z" });
    const remoteTimer = makeTimer({ ends_at: "2026-01-03T00:25:00.000Z" });

    function baseWithTimer(): { base: SyncSnapshot; record: StagedOwnerRecord } {
        const base = snapshot({
            tasks: { t1: { value: T("t1"), updatedAt: T1 } },
            timerState: { value: timerSlice(null), updatedAt: T1, completed: false },
        });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, active_task: "t1", timer: runningTimer },
            timerUpdatedAt: T2,
        });
        return { base, record };
    }

    it("keeps a live local timer regardless of a newer remote timestamp", () => {
        const { record } = baseWithTimer();
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote" }), updatedAt: T3 } },
            timerState: { value: timerSlice(remoteTimer), updatedAt: T3, completed: false },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.timer).toEqual(runningTimer);
        expect(merged.record.timerUpdatedAt).toBe(T2);
        expect(merged.record.timerCompleted).toBe(false);
        // Tasks still merge while the timer is protected.
        expect(merged.record.state.tasks.t1.name).toBe("Remote");
        expect(merged.pendingCount).toBe(1); // only the protected timer

        const plan = buildPushPlan(merged.record);
        expect(plan.timerState).toEqual({ value: timerSlice(runningTimer), updatedAt: T2, newGeneration: true });
        expect(plan.taskUpserts).toEqual([]);
    });

    it("does not protect a paused timer against a newer remote row", () => {
        const { record } = baseWithTimer();
        record.state.timer = { ...runningTimer, paused: true };
        const remote = snapshot({
            timerState: { value: timerSlice(remoteTimer), updatedAt: T3, completed: false },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.timer).toEqual(remoteTimer);
        expect(merged.record.timerUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);
    });

    it("does not protect an expired timer against a newer remote row", () => {
        const { record } = baseWithTimer();
        record.state.timer = { ...runningTimer, ends_at: "2026-01-09T00:25:00.000Z" };
        const remote = snapshot({
            timerState: { value: timerSlice(remoteTimer), updatedAt: T3, completed: false },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.timer).toEqual(remoteTimer);
        expect(merged.record.timerUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);
    });

    it("keeps a newer local timer row when no remote change exists", () => {
        const { record } = baseWithTimer();
        const remote = snapshot({
            timerState: { value: timerSlice(null), updatedAt: T1, completed: false },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.timer).toEqual(runningTimer);
        expect(merged.record.timerUpdatedAt).toBe(T2);
        expect(merged.pendingCount).toBe(1);
    });

    it("does not report a live local timer as pending when the pull only reorders JSON keys", () => {
        // Postgres JSONB stores objects with its own key ordering, so a pulled
        // row is semantically equal to the acknowledged local value but
        // serializes differently. A live timer must not be seen as pending or
        // make the push plan throw for a missing updated_at stamp.
        const serverTimer: ActiveTimer = {
            kind: "Work",
            paused: false,
            ends_at: "2026-01-10T00:25:00.000Z",
            task_id: "t1",
            started_at: "2026-01-01T00:00:00.000Z",
            planned_secs: 25 * 60,
            accumulated_secs: 0,
            paused_remaining_secs: 0,
        };
        const base = snapshot({
            timerState: { value: timerSlice(serverTimer), updatedAt: T2, completed: false },
        });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, active_task: "t1", timer: runningTimer },
            timerUpdatedAt: null,
        });
        const remote = snapshot({
            timerState: { value: timerSlice(serverTimer), updatedAt: T2, completed: false },
        });

        const merged = mergePulledSnapshot(record, remote, NOW);
        expect(merged.record.state.timer).toEqual(runningTimer);
        expect(merged.record.timerUpdatedAt).toBeNull();
        expect(merged.pendingCount).toBe(0);
        expect(() => buildPushPlan(merged.record)).not.toThrow();
    });
});

describe("buildPushPlan and commit", () => {
    it("throws a bootstrap error before the first successful pull", () => {
        expect(() => buildPushPlan(uninitializedRecord())).toThrow(MergeError);
        expect(() => buildPushPlan(uninitializedRecord())).toThrow(/bootstrap/);
        expect(() => buildPushPlan(uninitializedRecord({ initialized: true, lastSynced: null }))).toThrow(/bootstrap/);
    });

    it("produces identical retry plans and idempotent commits", () => {
        const base = snapshot({
            tasks: { t1: { value: T("t1", { name: "Base" }), updatedAt: T1 } },
            logs: { "log-0": { ...LOG("log-0") } },
        });
        const record = recordFromBaseline(base, {
            state: {
                ...recordFromBaseline(base).state,
                tasks: { t1: T("t1", { name: "Local" }), t2: T("t2", { name: "New" }) },
                logs: [LOG("log-0"), LOG("log-1", { finished_at: "2026-01-02T00:25:00.000Z" })],
                settings: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
            },
            taskUpdatedAt: { t1: T2, t2: T2 },
            settingsUpdatedAt: T2,
        });

        const plan1 = buildPushPlan(record);
        const plan2 = buildPushPlan(record);
        expect(plan2).toEqual(plan1);
        expect(plan1.baseRevision).toBe(record.revision);
        expect(plan1.taskUpserts).toHaveLength(2);
        expect(plan1.logUpserts).toHaveLength(1);
        expect(plan1.settings).toEqual({
            value: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
            updatedAt: T2,
        });

        const pushed = snapshot({
            tasks: {
                t1: { value: T("t1", { name: "Local" }), updatedAt: T2 },
                t2: { value: T("t2", { name: "New" }), updatedAt: T2 },
            },
            logs: { "log-0": { ...LOG("log-0") }, "log-1": { ...LOG("log-1", { finished_at: "2026-01-02T00:25:00.000Z" }) } },
            settings: { value: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 }, updatedAt: T2 },
        });
        const committed = commitAcknowledgedPush(record, plan1, pushed);
        expect(committed.taskUpdatedAt).toEqual({});
        expect(committed.settingsUpdatedAt).toBeNull();
        expect(committed.lastSynced).toBe(pushed);

        // Re-committing the same plan on the committed record is a no-op.
        const recommitted = commitAcknowledgedPush(committed, plan1, pushed);
        expect(recommitted).toEqual(committed);
    });

    it("leaves an edit made after the plan was built pending against the new baseline", () => {
        const base = snapshot({
            tasks: { t1: { value: T("t1", { name: "Base" }), updatedAt: T1 } },
        });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: { t1: T("t1", { name: "Local" }) } },
            taskUpdatedAt: { t1: T2 },
        });
        const plan = buildPushPlan(record);

        // Simulate a concurrent edit that lands after the plan was built.
        const edited: StagedOwnerRecord = {
            ...record,
            revision: record.revision + 1,
            state: { ...record.state, tasks: { t1: T("t1", { name: "EditedAfterPlan" }) } },
        };
        const pushed = { ...base, tasks: { t1: { value: T("t1", { name: "Local" }), updatedAt: T2 } } };
        const committed = commitAcknowledgedPush(edited, plan, pushed);

        expect(committed.taskUpdatedAt.t1).toBe(T2);
        expect(committed.state.tasks.t1.name).toBe("EditedAfterPlan");
        expect(committed.lastSynced).toBe(pushed);

        // An unrelated acked entity still clears.
        const clean = commitAcknowledgedPush(record, plan, pushed);
        expect(clean.taskUpdatedAt.t1).toBeUndefined();
    });

    it("does not clear a tombstone that changed after the plan was built", () => {
        const base = snapshot({
            tasks: { t1: { value: T("t1"), updatedAt: T1 } },
        });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, tasks: {} },
            taskTombstones: { t1: { id: "t1", deletedAt: T2 } },
        });
        const plan = buildPushPlan(record);

        const changed: StagedOwnerRecord = {
            ...record,
            taskTombstones: { t1: { id: "t1", deletedAt: T3 } },
        };
        const pushed = { ...base, tasks: {} };
        const committed = commitAcknowledgedPush(changed, plan, pushed);
        expect(committed.taskTombstones.t1).toEqual({ id: "t1", deletedAt: T3 });
    });

    it("leaves a habit edit made after the plan was built pending against the new baseline", () => {
        const base = snapshot({
            habits: { h1: { value: H("h1", { name: "Base" }), updatedAt: T1 } },
        });
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Local" }) },
            habitUpdatedAt: { h1: T2 },
        });
        const plan = buildPushPlan(record);
        expect(plan.habitUpserts).toEqual([{ value: H("h1", { name: "Local" }), updatedAt: T2 }]);

        // A concurrent edit that lands after the plan was built must not be
        // cleared even though the old value was acknowledged.
        const edited: StagedOwnerRecord = {
            ...record,
            revision: record.revision + 1,
            habits: { h1: H("h1", { name: "EditedAfterPlan" }) },
        };
        const pushed = { ...base, habits: { h1: { value: H("h1", { name: "Local" }), updatedAt: T2 } } };
        const committed = commitAcknowledgedPush(edited, plan, pushed);
        expect(committed.habitUpdatedAt.h1).toBe(T2);
        expect(committed.habits.h1.name).toBe("EditedAfterPlan");
        expect(committed.lastSynced?.habits.h1).toEqual({ value: H("h1", { name: "Local" }), updatedAt: T2 });

        // The exact acknowledged value/stamp clears on the unedited record.
        const clean = commitAcknowledgedPush(record, plan, pushed);
        expect(clean.habitUpdatedAt.h1).toBeUndefined();
    });

    it("does not clear a habit tombstone that changed after the plan was built", () => {
        const base = snapshot({
            habits: { h1: { value: H("h1"), updatedAt: T1 } },
        });
        const record = recordFromBaseline(base, {
            habits: {},
            habitTombstones: { h1: { id: "h1", deletedAt: T2 } },
        });
        const plan = buildPushPlan(record);

        const changed: StagedOwnerRecord = {
            ...record,
            habitTombstones: { h1: { id: "h1", deletedAt: T3 } },
        };
        const pushed = { ...base, habits: {} };
        const committed = commitAcknowledgedPush(changed, plan, pushed);
        expect(committed.habitTombstones.h1).toEqual({ id: "h1", deletedAt: T3 });
    });

    it("builds a plan with a completed-generation timer flag only when the guard is set", () => {
        const base = snapshot({
            timerState: { value: timerSlice(null), updatedAt: T1, completed: false },
        });
        const record = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, active_task: "t1", timer: makeTimer() },
            timerUpdatedAt: T2,
            timerCompleted: false,
        });
        expect(buildPushPlan(record).timerState?.newGeneration).toBe(true);

        const completed = recordFromBaseline(base, {
            state: { ...recordFromBaseline(base).state, current_cycle_pomodoros: 1 },
            timerUpdatedAt: T2,
            timerCompleted: true,
        });
        expect(buildPushPlan(completed).timerState?.newGeneration).toBe(false);
    });
});

describe("first-pull bootstrap merge", () => {
    it("initializes an uninitialized record and keeps local edits pending against the pull", () => {
        const local: StagedOwnerRecord = uninitializedRecord({
            state: {
                tasks: { t2: T("t2", { name: "Local" }) },
                logs: [],
                settings: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
                active_task: null,
                current_cycle_pomodoros: 0,
                timer: null,
            },
            taskUpdatedAt: { t2: T2 },
            settingsUpdatedAt: T2,
        });
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote" }), updatedAt: T3 } },
            settings: { value: defaultAppState().settings, updatedAt: T1 },
        });

        const merged = mergePulledSnapshot(local, remote, NOW);
        expect(merged.record.initialized).toBe(true);
        expect(merged.record.lastSynced).toBe(remote);
        expect(merged.record.state.tasks.t1.name).toBe("Remote");
        expect(merged.record.state.tasks.t2.name).toBe("Local");
        expect(merged.record.state.settings.work_minutes).toBe(50);
        expect(merged.pendingCount).toBe(2); // local task + local settings

        const plan = buildPushPlan(merged.record);
        expect(plan.taskUpserts).toEqual([{ value: T("t2", { name: "Local" }), updatedAt: T2 }]);
        expect(plan.settings).toEqual({
            value: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
            updatedAt: T2,
        });
        expect(plan.fullWipe).toBe(false);
    });
});

describe("pending count parity", () => {
    it("matches the persisted store count for habit and completion deltas", async () => {
        const base = snapshot({
            habits: { h1: { value: H("h1", { name: "Base" }), updatedAt: T1 } },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        const record = recordFromBaseline(base, {
            habits: { h1: H("h1", { name: "Changed" }), h2: H("h2", { name: "New" }) },
            habitUpdatedAt: { h1: T2, h2: T2 },
            habitCompletions: { c1: HC("c1", "h1"), c2: HC("c2", "h1", { bucket: "2026-01-02" }) },
        });

        const merged = mergePulledSnapshot(record, base, NOW);
        expect(merged.pendingCount).toBe(3);

        // Persisting the exact merged record into a real staging store and
        // re-reading it must report the same entity-based pending count.
        const store = new LocalStagingStore(window.localStorage);
        await store.update("owner-a", () => merged.record);
        expect(store.pendingCount("owner-a")).toBe(merged.pendingCount);
    });
});

describe("to-do staged merge", () => {
    it("builds and acknowledges LWW to-do upserts", () => {
        const base = snapshot();
        const record = recordFromBaseline(base, {
            todos: { td1: TD("td1", { dueDate: "2026-01-05", updatedAt: T2 }) },
            todoUpdatedAt: { td1: T2 },
        });
        const plan = buildPushPlan(record);
        expect(plan.todoUpserts).toEqual([{ value: record.todos.td1, updatedAt: T2 }]);
        const pushed = snapshot({ todos: { td1: { value: record.todos.td1, updatedAt: T2 } } });
        const committed = commitAcknowledgedPush(record, plan, pushed);
        expect(committed.todoUpdatedAt).toEqual({});
        expect(buildPushPlan(committed).todoUpserts).toEqual([]);
    });

    it("keeps a newer remote to-do over an older local edit", () => {
        const baseTodo = TD("td1", { title: "Base", updatedAt: T1 });
        const base = snapshot({ todos: { td1: { value: baseTodo, updatedAt: T1 } } });
        const record = recordFromBaseline(base, {
            todos: { td1: TD("td1", { title: "Local", updatedAt: T2 }) }, todoUpdatedAt: { td1: T2 },
        });
        const remoteTodo = TD("td1", { title: "Remote", updatedAt: T3 });
        const merged = mergePulledSnapshot(record, snapshot({ todos: { td1: { value: remoteTodo, updatedAt: T3 } } }), NOW);
        expect(merged.record.todos.td1.title).toBe("Remote");
        expect(merged.record.todoUpdatedAt).toEqual({});
    });
});

function makeTimer(overrides: Partial<ActiveTimer> = {}): ActiveTimer {
    return {
        task_id: "t1",
        started_at: "2026-01-01T00:00:00.000Z",
        ends_at: "2026-01-10T00:25:00.000Z",
        kind: "Work",
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: 25 * 60,
        accumulated_secs: 0,
        ...overrides,
    };
}
