import { describe, expect, it } from "vitest";
import type { ActiveTimer, PomodoroLogEntry, Task } from "../../../state/types";
import { defaultAppState } from "../../engine";
import type { StagedOwnerRecord, SyncSnapshot, TimerStateSlice } from "../staging/types";
import { buildPushPlan, commitAcknowledgedPush, isLiveTimer, mergePulledSnapshot, MergeError } from "./merge";

const NOW = new Date("2026-01-10T00:00:00.000Z");
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

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

function timerSlice(timer: ActiveTimer | null): TimerStateSlice {
    return { active_task: "t1", current_cycle_pomodoros: 0, timer };
}

function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    return {
        tasks: {},
        logs: {},
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
        schemaVersion: 1,
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
        ...overrides,
    };
}

function uninitializedRecord(overrides: Partial<StagedOwnerRecord> = {}): StagedOwnerRecord {
    return {
        schemaVersion: 1,
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
