import { describe, expect, it, vi } from "vitest";
import type { ActiveTimer, Habit, HabitCompletion, PomodoroLogEntry, Task } from "../../../state/types";
import { defaultAppState } from "../../engine";
import { LocalStagingStore, stagingKey, type StorageLike } from "../staging/LocalStagingStore";
import type { PendingTimerCompletion, SyncSnapshot, TimerStateSlice } from "../staging/types";
import { DataAccessAuthError } from "../DataAccess";
import type { PushPlan, SyncRemote } from "./types";
import { timerGenerationKey } from "./timerCompletions";
import { timestampMs } from "./merge";
import { SyncCoordinator } from "./SyncCoordinator";

const OWNER = "owner-a";
const NOW = new Date("2026-01-10T00:26:00.000Z");
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";
const WIPE = "2026-01-05T00:00:00.000Z";

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function T(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        name: `Task ${id}`,
        target_pomodoros: 2,
        completed_pomodoros: 0,
        created_at: T0,
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
        finished_at: "2026-01-10T00:26:00.000Z",
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
        createdAt: T0,
        updatedAt: T0,
        ...overrides,
    };
}

function HC(id: string, habitId: string, overrides: Partial<HabitCompletion> = {}): HabitCompletion {
    return {
        id,
        habitId,
        bucket: "2026-01-01",
        createdAt: T0,
        updatedAt: T0,
        ...overrides,
    };
}

function TIMER(overrides: Partial<ActiveTimer> = {}): ActiveTimer {
    return {
        task_id: "t1",
        started_at: "2026-01-10T00:00:00.000Z",
        ends_at: "2026-01-10T00:25:00.000Z",
        kind: "Work",
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: 25 * 60,
        accumulated_secs: 0,
        ...overrides,
    };
}

function timerSlice(timer: ActiveTimer | null, cycle = 0): TimerStateSlice {
    return { active_task: "t1", current_cycle_pomodoros: cycle, timer };
}

function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    return {
        tasks: {},
        logs: {},
        habits: {},
        habitCompletions: {},
        todos: {},
        settings: { value: { ...defaultAppState().settings }, updatedAt: T0 },
        timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: T0, completed: false },
        pmState: { value: null, updatedAt: null },
        ...overrides,
    };
}

function makeStorage(): StorageLike {
    const map = new Map<string, string>();
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
}

/** Applies a plan's acknowledged values to the fake server snapshot. */
function applyPlanToServer(server: SyncSnapshot, plan: PushPlan): void {
    const ack = plan.acknowledged;
    for (const [id, value] of Object.entries(ack.taskUpserts)) {
        server.tasks[id] = { value: clone(value.value), updatedAt: value.updatedAt };
    }
    for (const id of Object.keys(ack.taskTombstones)) {
        delete server.tasks[id];
    }
    for (const [id, log] of Object.entries(ack.logUpserts)) {
        server.logs[id] = clone(log);
    }
    for (const id of Object.keys(ack.logTombstones)) {
        delete server.logs[id];
    }
    for (const [id, value] of Object.entries(ack.habitUpserts)) {
        // Mirror the RPC's strict `excluded.updated_at > habits.updated_at`
        // LWW gate so the fake can model a rejected stale/equal-stamp upsert.
        const existing = server.habits[id];
        if (!existing || timestampMs(value.updatedAt) > timestampMs(existing.updatedAt)) {
            server.habits[id] = { value: clone(value.value), updatedAt: value.updatedAt };
        }
    }
    for (const id of Object.keys(ack.habitTombstones)) {
        delete server.habits[id];
    }
    for (const [id, completion] of Object.entries(ack.habitCompletionUpserts)) {
        // Mirror the RPC's `on conflict (habit_id, bucket) do nothing`: a
        // second id for an already-occupied bucket is replayed as a no-op.
        const key = `${completion.habitId}\u0000${completion.bucket}`;
        const occupied = Object.values(server.habitCompletions).some(
            (existing) => `${existing.habitId}\u0000${existing.bucket}` === key,
        );
        if (!occupied) server.habitCompletions[id] = clone(completion);
    }
    for (const [id, tombstone] of Object.entries(ack.habitCompletionTombstones)) {
        // Mirror the RPC guard: a provenanced (cascaded) completion tombstone
        // is skipped when the parent habit was updated after the deletion stamp,
        // so a revived habit keeps its completion history.
        if (tombstone.habitId !== undefined) {
            const habit = server.habits[tombstone.habitId];
            if (habit && timestampMs(habit.updatedAt) > timestampMs(tombstone.deletedAt)) continue;
        }
        delete server.habitCompletions[id];
    }
    if (ack.settings) server.settings = clone(ack.settings);
    if (ack.timerState) {
        server.timerState = {
            value: clone(ack.timerState.value),
            updatedAt: ack.timerState.updatedAt,
            completed: !plan.timerState?.newGeneration,
        };
    }
    if (ack.pmState) server.pmState = clone(ack.pmState);
    if (ack.fullWipe) {
        server.tasks = {};
        server.logs = {};
        // Habits and habit completions survive a full wipe on the real server,
        // so the fake models the same behavior and never clears them here.
        if (plan.settings) server.settings = clone(plan.settings);
        if (plan.timerState) {
            server.timerState = {
                value: clone(plan.timerState.value),
                updatedAt: plan.timerState.updatedAt,
                completed: false,
            };
        }
    }
}

/**
 * A transport fake that models a real server well enough for the coordinator:
 * `pull` returns the current server state, the CAS applies a winner when the
 * expected timer matches, and `push` applies the acknowledged plan values. The
 * methods stay typed as `vi.fn` mocks so tests can program failures and deferrals.
 */
function makeRemote(initialServer: SyncSnapshot) {
    const server = clone(initialServer);
    const remote = {
        pull: vi.fn<SyncRemote["pull"]>(async () => clone(server)),
        installTimerGeneration: vi.fn<SyncRemote["installTimerGeneration"]>(
            async (_expectedOwnerId, entry) => {
                server.timerState = {
                    value: clone(entry.expectedTimerState),
                    updatedAt: entry.completedAt,
                    completed: false,
                };
            },
        ),
        completeTimer: vi.fn<SyncRemote["completeTimer"]>(async (_expectedOwnerId, entry) => {
            const current = server.timerState.value;
            if (current === null || current.timer === null) return false;
            if (JSON.stringify(current.timer) !== JSON.stringify(entry.expectedTimer)) return false;
            if (entry.log) server.logs[entry.log.id] = clone(entry.log);
            if (entry.taskAfter) {
                server.tasks[entry.taskAfter.id] = { value: clone(entry.taskAfter), updatedAt: entry.completedAt };
            }
            server.timerState = {
                value: clone(entry.resultTimerState),
                updatedAt: entry.completedAt,
                completed: true,
            };
            return true;
        }),
        push: vi.fn<SyncRemote["push"]>(async (_expectedOwnerId, plan) => {
            applyPlanToServer(server, plan);
        }),
        refreshSession: vi.fn<SyncRemote["refreshSession"]>(async () => {}),
    };
    return { remote, server };
}

function completionEntry(overrides: Partial<PendingTimerCompletion> = {}): PendingTimerCompletion {
    const timer = TIMER();
    return {
        generationKey: timerGenerationKey(timer),
        sequence: 1,
        expectedTimer: timer,
        expectedTimerState: timerSlice(timer, 0),
        resultTimerState: timerSlice(null, 1),
        taskBefore: T("t1", { completed_pomodoros: 0 }),
        taskAfter: T("t1", { completed_pomodoros: 1 }),
        log: LOG("log-1"),
        localOnlyGeneration: false,
        completedAt: NOW.toISOString(),
        ...overrides,
    };
}

/** Persists an initialized record whose local state already applied `entry`. */
async function seedCompletion(store: LocalStagingStore, entry: PendingTimerCompletion, baseline: SyncSnapshot): Promise<void> {
    await store.update(OWNER, (current) => ({
        ...current,
        initialized: true,
        lastSynced: clone(baseline),
        state: {
            ...current.state,
            tasks: entry.taskAfter ? { [entry.taskAfter.id]: clone(entry.taskAfter) } : {},
            logs: [clone(entry.log)],
            active_task: entry.resultTimerState.active_task,
            current_cycle_pomodoros: entry.resultTimerState.current_cycle_pomodoros,
            timer: entry.resultTimerState.timer,
        },
        taskUpdatedAt: entry.taskAfter ? { [entry.taskAfter.id]: entry.completedAt } : {},
        timerUpdatedAt: entry.completedAt,
        timerCompleted: true,
        pendingCompletions: [clone(entry)],
    }));
}

describe("SyncCoordinator", () => {
    it("never writes before a successful bootstrap pull and leaves initialized unchanged", async () => {
        const { remote } = makeRemote(snapshot());
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t1: T("t1") } },
            taskUpdatedAt: { t1: T1 },
        }));
        remote.pull.mockRejectedValue(new Error("network down"));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await expect(coordinator.sync({ reason: "manual" })).rejects.toThrow("network down");

        expect(remote.pull).toHaveBeenCalledWith(OWNER);
        expect(remote.push).not.toHaveBeenCalled();
        expect(remote.completeTimer).not.toHaveBeenCalled();
        expect(remote.installTimerGeneration).not.toHaveBeenCalled();

        const record = store.read(OWNER);
        expect(record.initialized).toBe(false);
        expect(record.state.tasks.t1).toBeDefined();
        expect(record.taskUpdatedAt.t1).toBe(T1);
    });

    it("pulls before any write, merges, then pushes only the delta and advances the baseline", async () => {
        const { remote } = makeRemote(snapshot({ tasks: { t1: { value: T("t1"), updatedAt: T1 } } }));
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t2: T("t2") } },
            taskUpdatedAt: { t2: T1 },
        }));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const result = await coordinator.sync({ reason: "manual" });

        expect(remote.push).toHaveBeenCalledTimes(1);
        const plan = remote.push.mock.calls[0][1];
        expect(plan.taskUpserts).toEqual([{ value: T("t2"), updatedAt: T1 }]);

        const record = store.read(OWNER);
        expect(record.initialized).toBe(true);
        expect(record.lastSynced?.tasks.t1).toEqual({ value: T("t1"), updatedAt: T1 });
        expect(record.lastSynced?.tasks.t2).toEqual({ value: T("t2"), updatedAt: T1 });
        expect(record.state.tasks.t1).toBeDefined();
        expect(result.pendingCount).toBe(0);
        expect(result.state.tasks.t2).toEqual(T("t2"));
    });

    it("retries an identical sync without pushing duplicate work", async () => {
        const { remote } = makeRemote(snapshot({ tasks: { t1: { value: T("t1"), updatedAt: T1 } } }));
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t2: T("t2") } },
            taskUpdatedAt: { t2: T1 },
        }));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await coordinator.sync({ reason: "manual" });
        expect(remote.push).toHaveBeenCalledTimes(1);

        await coordinator.sync({ reason: "manual" });
        expect(remote.push).toHaveBeenCalledTimes(1); // no duplicate work
        expect(remote.pull).toHaveBeenCalledTimes(2);
    });

    it("retains pending data when the push fails after a successful pull", async () => {
        const { remote } = makeRemote(snapshot());
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t1: T("t1") } },
            taskUpdatedAt: { t1: T1 },
        }));
        remote.push.mockRejectedValue(new Error("db down"));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await expect(coordinator.sync({ reason: "manual" })).rejects.toThrow("db down");

        const record = store.read(OWNER);
        expect(record.initialized).toBe(true); // pulled baseline persisted
        expect(record.taskUpdatedAt.t1).toBe(T1);
        expect(store.pendingCount(OWNER)).toBe(1);
    });

    it("pushes unrelated staged changes when a completion retry fails", async () => {
        const entry = completionEntry();
        const baseline = snapshot();
        const { remote } = makeRemote(baseline);
        remote.completeTimer.mockRejectedValue(new Error("completion unavailable"));
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, baseline);
        await store.update(OWNER, (current) => ({
            ...current,
            pmState: { projects: {}, tasks: {}, meta: { initializedAt: T2 } },
            pmUpdatedAt: T2,
        }));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await expect(coordinator.sync({ reason: "manual" })).rejects.toThrow("completion unavailable");
        expect(remote.push).toHaveBeenCalledTimes(1);
        expect(remote.push.mock.calls[0][1].pmState).toEqual({
            value: { projects: {}, tasks: {}, meta: { initializedAt: T2 } },
            updatedAt: T2,
        });
        expect(store.read(OWNER).pendingCompletions).toHaveLength(1);
    });

    it("keeps a malformed completion timestamp pending instead of resolving it as a loser", async () => {
        const entry = completionEntry({ localOnlyGeneration: true, completedAt: "not-a-timestamp" });
        const baseline = snapshot();
        const { remote } = makeRemote(baseline);
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, baseline);

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await expect(coordinator.sync({ reason: "manual" })).rejects.toThrow(/Invalid timestamp/);
        expect(store.read(OWNER).pendingCompletions).toHaveLength(1);
    });

    it("resolves a completion winner and incorporates it into the baseline", async () => {
        const entry = completionEntry();
        const baseline = snapshot({
            tasks: { t1: { value: entry.taskBefore as Task, updatedAt: T1 } },
            timerState: { value: entry.expectedTimerState, updatedAt: T1, completed: false },
        });
        const { remote } = makeRemote(baseline);
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, baseline);

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const result = await coordinator.sync({ reason: "manual" });

        expect(remote.completeTimer).toHaveBeenCalledTimes(1);
        expect(remote.installTimerGeneration).not.toHaveBeenCalled();
        const record = store.read(OWNER);
        expect(record.pendingCompletions).toHaveLength(0);
        expect(record.lastSynced?.timerState.completed).toBe(true);
        expect(record.lastSynced?.logs["log-1"]).toEqual(entry.log);
        expect(record.lastSynced?.tasks.t1).toEqual({ value: entry.taskAfter, updatedAt: entry.completedAt });
        expect(record.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(result.state.tasks.t1.completed_pomodoros).toBe(1);
    });

    it("installs a local-only generation before its CAS when the local timer wins LWW", async () => {
        const entry = completionEntry({ localOnlyGeneration: true });
        const empty = snapshot();
        const { remote } = makeRemote(empty);
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, empty);

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await coordinator.sync({ reason: "manual" });

        expect(remote.installTimerGeneration).toHaveBeenCalledTimes(1);
        expect(remote.completeTimer).toHaveBeenCalledTimes(1);
        expect(store.read(OWNER).pendingCompletions).toHaveLength(0);
        expect(store.read(OWNER).lastSynced?.timerState.completed).toBe(true);
    });

    it("re-pulls before installing a generation when the pull saw no timer row", async () => {
        const entry = completionEntry({ localOnlyGeneration: true });
        // The seeded baseline observed no timer row, so the install decision must
        // be re-validated against a fresh pull before touching the server.
        const noTimerBaseline = snapshot({ timerState: { value: null, updatedAt: null, completed: false } });
        const concurrent = TIMER({ started_at: "2026-01-10T00:10:00.000Z", ends_at: "2026-01-10T00:35:00.000Z" });
        const concurrentState = snapshot({
            timerState: { value: timerSlice(concurrent, 0), updatedAt: "2026-01-10T01:00:00.000Z", completed: false },
        });
        const { remote } = makeRemote(noTimerBaseline);
        let pulls = 0;
        remote.pull.mockImplementation(async () => {
            pulls += 1;
            // The first pull sees the empty baseline; a concurrent tab then
            // starts a timer (newer than the local completion) before install.
            return clone(pulls === 1 ? noTimerBaseline : concurrentState);
        });
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, noTimerBaseline);

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        await coordinator.sync({ reason: "manual" });

        // The concurrent timer row is newer than the local completion, so the
        // re-pull blocks the install and the CAS loses; the concurrent timer wins.
        expect(remote.installTimerGeneration).not.toHaveBeenCalled();
        const record = store.read(OWNER);
        expect(record.pendingCompletions).toHaveLength(0);
        expect(record.state.timer).toEqual(concurrent);
        expect(record.lastSynced?.timerState.updatedAt).toBe("2026-01-10T01:00:00.000Z");
    });

    it("treats a local-only completion as a CAS loser when the remote timer wins LWW", async () => {
        const entry = completionEntry({ localOnlyGeneration: true });
        const remoteTimer = TIMER({ started_at: "2026-01-10T00:20:00.000Z", ends_at: "2026-01-10T00:45:00.000Z" });
        const remoteState = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote winner" }), updatedAt: "2026-01-10T00:30:00.000Z" } },
            timerState: { value: timerSlice(remoteTimer, 0), updatedAt: "2026-01-10T00:30:00.000Z", completed: false },
        });
        const { remote } = makeRemote(remoteState);
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, remoteState);

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => new Date("2026-01-10T01:00:00.000Z") });
        await coordinator.sync({ reason: "manual" });

        expect(remote.installTimerGeneration).not.toHaveBeenCalled();
        const record = store.read(OWNER);
        expect(record.pendingCompletions).toHaveLength(0);
        expect(record.state.logs.find((log) => log.id === entry.log.id)).toBeUndefined();
        expect(record.state.tasks.t1.name).toBe("Remote winner");
    });

    it("resolves a CAS loser by removing its log and adopting the remote winner", async () => {
        const entry = completionEntry();
        const baseline = snapshot({
            tasks: { t1: { value: entry.taskBefore as Task, updatedAt: T1 } },
            timerState: { value: entry.expectedTimerState, updatedAt: T1, completed: false },
        });
        const remoteTimer = TIMER({ started_at: "2026-01-10T00:20:00.000Z", ends_at: "2026-01-10T00:45:00.000Z" });
        const remoteState = snapshot({
            tasks: { t1: { value: T("t1", { name: "Remote winner" }), updatedAt: "2026-01-10T00:30:00.000Z" } },
            timerState: { value: timerSlice(remoteTimer, 0), updatedAt: "2026-01-10T00:30:00.000Z", completed: false },
        });
        const { remote } = makeRemote(remoteState);
        const store = new LocalStagingStore(makeStorage());
        await seedCompletion(store, entry, baseline);

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => new Date("2026-01-10T01:00:00.000Z") });
        await coordinator.sync({ reason: "manual" });

        expect(remote.completeTimer).toHaveBeenCalledTimes(1);
        const record = store.read(OWNER);
        expect(record.pendingCompletions).toHaveLength(0);
        expect(record.state.logs.find((log) => log.id === entry.log.id)).toBeUndefined();
        expect(record.state.tasks.t1.name).toBe("Remote winner");
        expect(record.state.tasks.t1.completed_pomodoros).toBe(0);
    });

    it("pushes a full wipe in one atomic plan and preserves PM, habits, and completions", async () => {
        const pm = { projects: {}, tasks: {}, meta: { initializedAt: T1 } };
        const { remote, server } = makeRemote(
            snapshot({
                tasks: { t1: { value: T("t1"), updatedAt: T1 } },
                logs: { "log-0": LOG("log-0") },
                habits: { h1: { value: H("h1", { name: "Survivor" }), updatedAt: T1 } },
                habitCompletions: { c1: HC("c1", "h1") },
            }),
        );
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            fullWipe: { createdAt: WIPE },
            pmState: clone(pm),
            pmUpdatedAt: T1,
            state: defaultAppState(),
            taskUpdatedAt: {},
            settingsUpdatedAt: null,
            timerUpdatedAt: null,
        }));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const result = await coordinator.sync({ reason: "manual" });

        expect(remote.push).toHaveBeenCalledTimes(1);
        const plan = remote.push.mock.calls[0][1];
        expect(plan.fullWipe).toBe(true);
        expect(plan.taskUpserts).toEqual([]);

        const record = store.read(OWNER);
        expect(record.fullWipe).toBeNull();
        expect(record.pmState).toEqual(pm);
        expect(record.state).toEqual(defaultAppState());
        expect(result.pmState).toEqual(pm);
        // The fake server dropped the seeded tasks/logs and kept PM.
        expect(server.tasks).toEqual({});
        expect(server.logs).toEqual({});
        expect(server.pmState.value).toEqual(pm);
        // Habits and completions survive the wipe and are never cleared.
        expect(server.habits.h1).toEqual({ value: H("h1", { name: "Survivor" }), updatedAt: T1 });
        expect(server.habitCompletions.c1).toEqual(HC("c1", "h1"));
        expect(record.lastSynced?.habits.h1.value.name).toBe("Survivor");
        expect(record.lastSynced?.habitCompletions.c1.id).toBe("c1");
    });

    it("syncs a staged habit to zero pending work and advances the baseline", async () => {
        const { remote } = makeRemote(snapshot());
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            habits: { h1: H("h1", { name: "New habit" }) },
            habitUpdatedAt: { h1: T1 },
        }));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const result = await coordinator.sync({ reason: "manual" });

        expect(remote.push).toHaveBeenCalledTimes(1);
        const plan = remote.push.mock.calls[0][1];
        expect(plan.habitUpserts).toEqual([{ value: H("h1", { name: "New habit" }), updatedAt: T1 }]);
        expect(plan.habitCompletionUpserts).toEqual([]);
        expect(plan.taskUpserts).toEqual([]);

        const record = store.read(OWNER);
        expect(record.initialized).toBe(true);
        expect(record.lastSynced?.habits.h1).toEqual({ value: H("h1", { name: "New habit" }), updatedAt: T1 });
        expect(record.habitUpdatedAt.h1).toBeUndefined();
        expect(result.pendingCount).toBe(0);
        expect(store.pendingCount(OWNER)).toBe(0);
    });

    it("resolves two-device habit edits deterministically by LWW", async () => {
        const baseline = snapshot({ habits: { h1: { value: H("h1", { name: "Base" }), updatedAt: T0 } } });
        const { remote, server } = makeRemote(baseline);
        const storeA = new LocalStagingStore(makeStorage());
        const storeB = new LocalStagingStore(makeStorage());
        const storeC = new LocalStagingStore(makeStorage());

        async function seedDevice(store: LocalStagingStore, name: string): Promise<void> {
            await store.update(OWNER, (current) => ({
                ...current,
                initialized: true,
                lastSynced: clone(baseline),
                habits: { h1: H("h1", { name }) },
            }));
        }
        await seedDevice(storeA, "Base");
        await seedDevice(storeB, "Base");
        await seedDevice(storeC, "Base");

        // Device A edits first (older stamp), then device B edits (newer stamp).
        await storeA.update(OWNER, (current) => ({
            ...current,
            habits: { h1: H("h1", { name: "From A" }) },
            habitUpdatedAt: { h1: T1 },
        }));
        await storeB.update(OWNER, (current) => ({
            ...current,
            habits: { h1: H("h1", { name: "From B" }) },
            habitUpdatedAt: { h1: T2 },
        }));

        const coordinatorA = new SyncCoordinator(OWNER, storeA, remote, { now: () => NOW });
        const coordinatorB = new SyncCoordinator(OWNER, storeB, remote, { now: () => NOW });

        // B syncs first, pushing the newer row to the shared server.
        await coordinatorB.sync({ reason: "manual" });
        expect(server.habits.h1.value.name).toBe("From B");

        // A then pulls B's newer row and adopts it without pushing a stale delta.
        await coordinatorA.sync({ reason: "manual" });
        const recordA = storeA.read(OWNER);
        expect(recordA.habits.h1.name).toBe("From B");
        expect(recordA.habitUpdatedAt.h1).toBeUndefined();
        expect(storeA.pendingCount(OWNER)).toBe(0);
        expect(server.habits.h1.value.name).toBe("From B");

        // A third device editing at an exact timestamp tie converges on the
        // remote row (remote wins ties) with nothing left to push.
        await storeC.update(OWNER, (current) => ({
            ...current,
            habits: { h1: H("h1", { name: "From C" }) },
            habitUpdatedAt: { h1: T2 }, // exact tie with the server row
        }));
        const coordinatorC = new SyncCoordinator(OWNER, storeC, remote, { now: () => NOW });
        await coordinatorC.sync({ reason: "manual" });
        const recordC = storeC.read(OWNER);
        expect(recordC.habits.h1.name).toBe("From B");
        expect(recordC.habitUpdatedAt.h1).toBeUndefined();
        expect(storeC.pendingCount(OWNER)).toBe(0);
    });

    it("re-pushes a different-field habit merge with a strictly-later stamp so both edits survive", async () => {
        const baseline = snapshot({
            habits: { h1: { value: H("h1", { name: "Base", color: "#ffffff" }), updatedAt: T0 } },
        });
        const { remote, server } = makeRemote(baseline);
        const storeA = new LocalStagingStore(makeStorage());
        const storeB = new LocalStagingStore(makeStorage());

        async function seedDevice(store: LocalStagingStore, habit: Habit, stamp: string): Promise<void> {
            await store.update(OWNER, (current) => ({
                ...current,
                initialized: true,
                lastSynced: clone(baseline),
                habits: { h1: habit },
                habitUpdatedAt: { h1: stamp },
            }));
        }
        // Device A edits the name (older stamp); device B edits the color (newer).
        await seedDevice(storeA, H("h1", { name: "From A", color: "#ffffff" }), T1);
        await seedDevice(storeB, H("h1", { name: "Base", color: "#000000" }), T2);

        // B syncs first, pushing the newer color-only edit to the shared server.
        const coordinatorB = new SyncCoordinator(OWNER, storeB, remote, { now: () => NOW });
        await coordinatorB.sync({ reason: "manual" });
        expect(server.habits.h1.value.color).toBe("#000000");

        // A merges both field edits and must re-push with a stamp strictly
        // later than B's so the server LWW gate accepts the combined row;
        // otherwise the equal-stamp upsert is a silent no-op and A's name edit
        // is lost on the next pull.
        const coordinatorA = new SyncCoordinator(OWNER, storeA, remote, { now: () => NOW });
        await coordinatorA.sync({ reason: "manual" });
        expect(server.habits.h1.value.name).toBe("From A");
        expect(server.habits.h1.value.color).toBe("#000000");
        expect(timestampMs(server.habits.h1.updatedAt)).toBeGreaterThan(timestampMs(T2));

        const recordA = storeA.read(OWNER);
        expect(recordA.habitUpdatedAt.h1).toBeUndefined();
        expect(storeA.pendingCount(OWNER)).toBe(0);

        // A second pull observes the converged row with nothing left to push.
        const pushes = remote.push.mock.calls.length;
        await coordinatorA.sync({ reason: "manual" });
        expect(remote.push.mock.calls.length).toBe(pushes);
        expect(storeA.pendingCount(OWNER)).toBe(0);
    });

    it("converges a same-bucket completion conflict to one canonical server completion", async () => {
        const baseline = snapshot({ habits: { h1: { value: H("h1"), updatedAt: T0 } } });
        const { remote, server } = makeRemote(baseline);
        const storeA = new LocalStagingStore(makeStorage());
        const storeB = new LocalStagingStore(makeStorage());

        // Device A checks the bucket first and its completion reaches the server.
        await storeA.update(OWNER, (current) => ({
            ...current,
            initialized: true,
            lastSynced: clone(baseline),
            habits: { h1: H("h1") },
            habitCompletions: { cA: HC("cA", "h1") },
        }));
        const coordinatorA = new SyncCoordinator(OWNER, storeA, remote, { now: () => NOW });
        await coordinatorA.sync({ reason: "manual" });
        expect(server.habitCompletions.cA).toEqual(HC("cA", "h1"));

        // Device B independently checked the same bucket with a different id.
        // Its local id can never be inserted (the (habit_id, bucket) key is
        // occupied), so the merge must drop it and adopt the pulled server row.
        await storeB.update(OWNER, (current) => ({
            ...current,
            initialized: true,
            lastSynced: clone(baseline),
            habits: { h1: H("h1") },
            habitCompletions: { cB: HC("cB", "h1") },
        }));
        const coordinatorB = new SyncCoordinator(OWNER, storeB, remote, { now: () => NOW });
        await coordinatorB.sync({ reason: "manual" });

        const recordB = storeB.read(OWNER);
        expect(recordB.habitCompletions.cA).toEqual(HC("cA", "h1"));
        expect(recordB.habitCompletions.cB).toBeUndefined();
        expect(storeB.pendingCount(OWNER)).toBe(0);

        // B pushed nothing and the server keeps exactly one canonical completion.
        expect(remote.push).toHaveBeenCalledTimes(1);
        expect(Object.keys(server.habitCompletions)).toEqual(["cA"]);
        expect(server.habitCompletions.cA).toEqual(HC("cA", "h1"));

        // A second B sync leaves zero pending work with no retried ghost upsert.
        const pushes = remote.push.mock.calls.length;
        await coordinatorB.sync({ reason: "manual" });
        expect(remote.push.mock.calls.length).toBe(pushes);
        expect(storeB.pendingCount(OWNER)).toBe(0);
    });

    it("refreshes the session once and retries the whole attempt from persisted staging", async () => {
        const { remote, server } = makeRemote(snapshot({ tasks: { t1: { value: T("t1"), updatedAt: T1 } } }));
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t2: T("t2") } },
            taskUpdatedAt: { t2: T1 },
        }));
        remote.pull
            .mockRejectedValueOnce(new DataAccessAuthError("DATA_ACCESS_NO_SESSION"))
            .mockResolvedValue(clone(server));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const result = await coordinator.sync({ reason: "manual" });

        expect(remote.refreshSession).toHaveBeenCalledTimes(1);
        expect(remote.refreshSession).toHaveBeenCalledWith(OWNER);
        expect(remote.pull).toHaveBeenCalledTimes(2);
        expect(remote.push).toHaveBeenCalledTimes(1);
        expect(result.initialized).toBe(true);
        expect(store.read(OWNER).initialized).toBe(true);
        expect(store.read(OWNER).state.tasks.t2).toBeDefined();
    });

    it("surfaces the auth error when the session refresh fails", async () => {
        const { remote } = makeRemote(snapshot());
        remote.pull.mockRejectedValue(new DataAccessAuthError("DATA_ACCESS_NO_SESSION"));
        remote.refreshSession.mockRejectedValue(new DataAccessAuthError("DATA_ACCESS_REFRESH_FAILED"));

        const coordinator = new SyncCoordinator(OWNER, new LocalStagingStore(makeStorage()), remote, { now: () => NOW });
        await expect(coordinator.sync({ reason: "manual" })).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_REFRESH_FAILED",
        });
        expect(remote.refreshSession).toHaveBeenCalledTimes(1);
    });

    it("does not retry the attempt a second time when the refreshed retry also fails", async () => {
        const { remote } = makeRemote(snapshot());
        remote.pull.mockRejectedValue(new DataAccessAuthError("DATA_ACCESS_NO_SESSION"));
        remote.refreshSession.mockResolvedValue(undefined);

        const coordinator = new SyncCoordinator(OWNER, new LocalStagingStore(makeStorage()), remote, { now: () => NOW });
        await expect(coordinator.sync({ reason: "manual" })).rejects.toMatchObject({
            name: "DataAccessAuthError",
            code: "DATA_ACCESS_NO_SESSION",
        });
        expect(remote.refreshSession).toHaveBeenCalledTimes(1);
        expect(remote.pull).toHaveBeenCalledTimes(2);
    });

    it("leaves a newer edit made during the push pending against the acknowledged baseline", async () => {
        const { remote } = makeRemote(snapshot());
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            initialized: true,
            lastSynced: snapshot(),
            state: {
                ...current.state,
                settings: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
            },
            settingsUpdatedAt: T1,
        }));

        let releasePush!: () => void;
        remote.push.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releasePush = resolve;
                }),
        );

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const syncPromise = coordinator.sync({ reason: "manual" });

        await vi.waitFor(() => expect(remote.push).toHaveBeenCalledTimes(1));
        await store.update(OWNER, (current) => ({
            ...current,
            state: {
                ...current.state,
                settings: { work_minutes: 60, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
            },
            settingsUpdatedAt: T2,
        }));
        releasePush();

        const result = await syncPromise;
        expect(result.pendingCount).toBe(1);
        const record = store.read(OWNER);
        expect(record.settingsUpdatedAt).toBe(T2); // newer edit still pending
        expect(record.state.settings.work_minutes).toBe(60);
        expect(record.lastSynced?.settings.value?.work_minutes).toBe(50); // old value acknowledged
    });

    it("coalesces simultaneous triggers into one attempt", async () => {
        const { remote, server } = makeRemote(snapshot());
        const store = new LocalStagingStore(makeStorage());

        let releasePull!: () => void;
        const gate = new Promise<void>((resolve) => {
            releasePull = resolve;
        });
        remote.pull.mockImplementation(async () => {
            await gate;
            return clone(server);
        });

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const first = coordinator.sync({ reason: "manual" });
        const second = coordinator.sync({ reason: "focus" });
        const third = coordinator.sync({ reason: "pagehide", bestEffort: true });
        releasePull();

        const [a, b, c] = await Promise.all([first, second, third]);
        expect(remote.pull).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
        expect(c).toEqual(a);
        expect(store.read(OWNER).initialized).toBe(true);
    });

    it("swallows best-effort errors while keeping data-safety failures for normal triggers", async () => {
        const { remote } = makeRemote(snapshot());
        const store = new LocalStagingStore(makeStorage());
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t1: T("t1") } },
            taskUpdatedAt: { t1: T1 },
        }));
        remote.push.mockRejectedValue(new Error("db down"));

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const bestEffort = await coordinator.sync({ reason: "pagehide", bestEffort: true });
        expect(bestEffort.pendingCount).toBe(1); // error swallowed, pending retained

        await expect(coordinator.sync({ reason: "manual" })).rejects.toThrow("db down");
    });

    it("never acknowledges a replacement record after a storage clear during sync", async () => {
        const storage = makeStorage();
        const { remote } = makeRemote(snapshot());
        const store = new LocalStagingStore(storage);
        await store.update(OWNER, (current) => ({
            ...current,
            state: { ...current.state, tasks: { t1: T("t1") } },
            taskUpdatedAt: { t1: T1 },
        }));
        remote.push.mockImplementation(async () => {
            storage.removeItem(stagingKey(OWNER));
        });

        const coordinator = new SyncCoordinator(OWNER, store, remote, { now: () => NOW });
        const result = await coordinator.sync({ reason: "manual" });

        expect(remote.push).toHaveBeenCalledTimes(1);
        const record = store.read(OWNER);
        expect(record.initialized).toBe(false);
        expect(record.taskUpdatedAt).toEqual({});
        expect(Object.keys(record.state.tasks)).toHaveLength(0);
        expect(result.initialized).toBe(false);
    });
});
