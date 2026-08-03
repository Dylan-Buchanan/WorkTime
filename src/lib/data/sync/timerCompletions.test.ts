import { describe, expect, it } from "vitest";
import type { ActiveTimer, PomodoroLogEntry, Task } from "../../../state/types";
import { defaultAppState } from "../../engine";
import type { PendingTimerCompletion, StagedOwnerRecord, SyncSnapshot, TimerStateSlice } from "../staging/types";
import {
    applyCompletionLoser,
    applyCompletionWinner,
    completionMask,
    completionRpcPayload,
    timerGenerationKey,
} from "./timerCompletions";

const T1 = "2026-01-01T00:00:00.000Z";
const NOW = new Date("2026-01-10T00:26:00.000Z");

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
        finished_at: "2026-01-10T00:26:00.000Z",
        was_break: false,
        break_skipped: false,
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
        settings: { value: { ...defaultAppState().settings }, updatedAt: T1 },
        timerState: {
            value: { active_task: null, current_cycle_pomodoros: 0, timer: null },
            updatedAt: T1,
            completed: false,
        },
        pmState: { value: null, updatedAt: null },
        ...overrides,
    };
}

function record(overrides: Partial<StagedOwnerRecord> = {}): StagedOwnerRecord {
    const base = snapshot();
    return {
        schemaVersion: 1,
        ownerId: "owner-a",
        revision: 1,
        initialized: true,
        state: {
            tasks: {},
            logs: [],
            settings: { ...defaultAppState().settings },
            active_task: null,
            current_cycle_pomodoros: 0,
            timer: null,
        },
        pmState: null,
        taskUpdatedAt: {},
        settingsUpdatedAt: base.settings.updatedAt,
        timerUpdatedAt: base.timerState.updatedAt,
        pmUpdatedAt: base.pmState.updatedAt,
        timerCompleted: false,
        taskTombstones: {},
        logTombstones: {},
        fullWipe: null,
        pendingCompletions: [],
        unbootstrapped: false,
        lastSynced: base,
        ...overrides,
    };
}

function entry(overrides: Partial<PendingTimerCompletion> = {}): PendingTimerCompletion {
    const timer = TIMER();
    return {
        generationKey: timerGenerationKey(timer),
        sequence: 1,
        expectedTimer: timer,
        expectedTimerState: timerSlice(timer, 0),
        resultTimerState: timerSlice(null, 1),
        taskBefore: T("t1", { completed_pomodoros: 0 }),
        taskAfter: T("t1", { completed_pomodoros: 1 }),
        log: LOG("log-completion-1"),
        localOnlyGeneration: false,
        completedAt: "2026-01-10T00:26:00.000Z",
        ...overrides,
    };
}

/** A record that has locally applied the completion (state + journal + guard). */
function completedRecord(overrides: Partial<StagedOwnerRecord> = {}): StagedOwnerRecord {
    const e = entry();
    return record({
        state: {
            tasks: { t1: { ...(e.taskAfter as Task) } },
            logs: [{ ...e.log }],
            settings: { ...defaultAppState().settings },
            active_task: "t1",
            current_cycle_pomodoros: 1,
            timer: null,
        },
        taskUpdatedAt: { t1: e.completedAt },
        timerUpdatedAt: e.completedAt,
        timerCompleted: true,
        pendingCompletions: [e],
        ...overrides,
    });
}

describe("timerGenerationKey", () => {
    it("is canonical and independent of object key insertion order", () => {
        const base = TIMER();
        const reordered: ActiveTimer = {
            planned_secs: 1500,
            kind: "Work",
            accumulated_secs: 0,
            task_id: "t1",
            paused_remaining_secs: 0,
            started_at: "2026-01-10T00:00:00.000Z",
            ends_at: "2026-01-10T00:25:00.000Z",
            paused: false,
        };
        expect(timerGenerationKey(base)).toBe(timerGenerationKey(reordered));
    });

    it("distinguishes generations that differ in any field and is not random", () => {
        const a = timerGenerationKey(TIMER());
        expect(timerGenerationKey(TIMER({ ends_at: "2026-01-10T00:30:00.000Z" }))).not.toBe(a);
        expect(timerGenerationKey(TIMER({ kind: "ShortBreak" }))).not.toBe(a);
        expect(timerGenerationKey(TIMER({ paused: true }))).not.toBe(a);
        expect(timerGenerationKey(TIMER({ task_id: "t2" }))).not.toBe(a);
        // Repeating the same payload is stable.
        expect(timerGenerationKey(TIMER())).toBe(a);
    });
});

describe("completionRpcPayload", () => {
    it("retains the client log id and the exact expected timer JSON", () => {
        const e = entry();
        const payload = completionRpcPayload(e);
        expect(payload.p_log).toEqual(e.log);
        expect(payload.p_log?.id).toBe(e.log.id);
        expect(payload.p_expected_timer).toEqual(e.expectedTimer);
        expect(payload.p_timer_data).toEqual(e.resultTimerState);
        expect(payload.p_task).toEqual(e.taskAfter);
    });

    it("carries a null task for break completions", () => {
        const e = entry({ taskBefore: null, taskAfter: null });
        expect(completionRpcPayload(e).p_task).toBeNull();
    });
});

describe("applyCompletionWinner", () => {
    it("removes the journal entry and incorporates the completion into the baseline", () => {
        const completed = completedRecord();
        const resolved = applyCompletionWinner(completed, completed.pendingCompletions[0]);

        expect(resolved.pendingCompletions).toHaveLength(0);
        expect(resolved.lastSynced?.timerState).toEqual({
            value: completed.pendingCompletions[0].resultTimerState,
            updatedAt: completed.pendingCompletions[0].completedAt,
            completed: true,
        });
        expect(resolved.lastSynced?.logs["log-completion-1"]).toEqual(completed.pendingCompletions[0].log);
        expect(resolved.lastSynced?.tasks.t1).toEqual({
            value: completed.pendingCompletions[0].taskAfter,
            updatedAt: completed.pendingCompletions[0].completedAt,
        });
        // The locally applied completion state is preserved.
        expect(resolved.state.logs).toHaveLength(1);
        expect(resolved.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(resolved.timerCompleted).toBe(true);
    });

    it("is idempotent when the entry is already resolved", () => {
        const completed = completedRecord();
        const once = applyCompletionWinner(completed, completed.pendingCompletions[0]);
        const twice = applyCompletionWinner(once, completed.pendingCompletions[0]);
        expect(twice).toEqual(once);
    });

    it("resolves only the matching entry when multiple completions are journaled", () => {
        const e2 = entry({
            sequence: 2,
            generationKey: timerGenerationKey(TIMER({ started_at: "2026-01-10T00:30:00.000Z" })),
            expectedTimer: TIMER({ started_at: "2026-01-10T00:30:00.000Z" }),
            expectedTimerState: timerSlice(TIMER({ started_at: "2026-01-10T00:30:00.000Z" }), 1),
            resultTimerState: timerSlice(null, 2),
            log: LOG("log-completion-2", { finished_at: "2026-01-10T00:55:00.000Z" }),
            taskAfter: T("t1", { completed_pomodoros: 2 }),
        });
        const completed = completedRecord({
            pendingCompletions: [completedRecord().pendingCompletions[0], e2],
            state: {
                tasks: { t1: { ...(e2.taskAfter as Task) } },
                logs: [{ ...e2.log }],
                settings: { ...defaultAppState().settings },
                active_task: "t1",
                current_cycle_pomodoros: 2,
                timer: null,
            },
        });
        const resolved = applyCompletionWinner(completed, completed.pendingCompletions[0]);
        expect(resolved.pendingCompletions).toEqual([e2]);
        expect(resolved.lastSynced?.timerState.value).toEqual(completed.pendingCompletions[0].resultTimerState);
        expect(resolved.lastSynced?.logs["log-completion-2"]).toBeUndefined();
    });

    it("preserves a later live local timer and its completion guard", () => {
        const live = TIMER({
            started_at: "2026-01-10T00:26:30.000Z",
            ends_at: "2026-01-10T00:51:30.000Z",
            kind: "ShortBreak",
        });
        const completed = completedRecord({
            state: {
                ...completedRecord().state,
                timer: live,
                current_cycle_pomodoros: 1,
            },
            timerCompleted: false,
        });
        const resolved = applyCompletionWinner(completed, completed.pendingCompletions[0]);
        expect(resolved.state.timer).toEqual(live);
        expect(resolved.timerCompleted).toBe(false);
        expect(resolved.pendingCompletions).toHaveLength(0);
    });
});

describe("applyCompletionLoser", () => {
    it("cleans up a CAS loser: removes the exact log, reverts the task, adopts the remote winner", () => {
        const e = entry();
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Winner" }), updatedAt: "2026-01-10T00:27:00.000Z" } },
            timerState: {
                value: timerSlice(null, 0),
                updatedAt: "2026-01-10T00:27:00.000Z",
                completed: false,
            },
        });
        const completed = completedRecord({ lastSynced: remote });
        const resolved = applyCompletionLoser(completed, e, remote, NOW);

        expect(resolved.pendingCompletions).toHaveLength(0);
        expect(resolved.state.logs.find((log) => log.id === e.log.id)).toBeUndefined();
        expect(resolved.state.tasks.t1).toEqual(T("t1", { name: "Winner" }));
        expect(resolved.state.timer).toBeNull();
        expect(resolved.state.current_cycle_pomodoros).toBe(0);
        expect(resolved.timerCompleted).toBe(false);
        // The adopted remote task matches the baseline, so its stamp clears.
        expect(resolved.taskUpdatedAt.t1).toBeUndefined();
        expect(resolved.timerUpdatedAt).toBeNull();
    });

    it("reverts completion-derived task fields only while they still equal taskAfter", () => {
        const e = entry();
        const remote = snapshot();
        const edited = T("t1", { name: "Edited after completion", completed_pomodoros: 1 });
        const completed = completedRecord({
            state: {
                tasks: { t1: edited },
                logs: [{ ...e.log }],
                settings: { ...defaultAppState().settings },
                active_task: "t1",
                current_cycle_pomodoros: 1,
                timer: null,
            },
            lastSynced: remote,
        });
        const resolved = applyCompletionLoser(completed, e, remote, NOW);

        expect(resolved.state.tasks.t1).toEqual(edited); // the later edit survives
        expect(resolved.state.logs.find((log) => log.id === e.log.id)).toBeUndefined();
        expect(resolved.pendingCompletions).toHaveLength(0);
    });

    it("reverts the task to taskBefore when no remote row exists", () => {
        const e = entry();
        const remote = snapshot();
        const completed = completedRecord({ lastSynced: remote });
        const resolved = applyCompletionLoser(completed, e, remote, NOW);
        expect(resolved.state.tasks.t1).toEqual(e.taskBefore);
    });

    it("merges a remote winner with a post-completion local edit instead of replacing the task", () => {
        const e = entry();
        const remote = snapshot({
            tasks: {
                t1: { value: T("t1", { name: "Winner", completed_pomodoros: 1 }), updatedAt: "2026-01-10T00:27:00.000Z" },
            },
            timerState: {
                value: timerSlice(null, 1),
                updatedAt: "2026-01-10T00:27:00.000Z",
                completed: true,
            },
        });
        const edited = T("t1", { name: "Local rename", completed_pomodoros: 1 });
        const completed = completedRecord({
            state: {
                ...completedRecord().state,
                tasks: { t1: edited },
            },
            // The rename happened after the completion; the record stamps the
            // task with the edit time, which is newer than the remote row.
            taskUpdatedAt: { t1: "2026-01-10T00:28:00.000Z" },
            lastSynced: remote,
        });
        const resolved = applyCompletionLoser(completed, e, remote, NOW);

        // The remote winner's progress is adopted, but the post-completion
        // rename survives instead of being silently replaced.
        expect(resolved.state.tasks.t1).toEqual(edited);
        expect(resolved.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(resolved.pendingCompletions).toHaveLength(0);
        expect(resolved.state.logs.find((log) => log.id === e.log.id)).toBeUndefined();
    });

    it("keeps a later live local timer authoritative while still dropping the losing log", () => {
        const e = entry();
        const remote = snapshot({
            timerState: {
                value: timerSlice(null, 0),
                updatedAt: "2026-01-10T00:27:00.000Z",
                completed: false,
            },
        });
        const live = TIMER({
            started_at: "2026-01-10T00:26:30.000Z",
            ends_at: "2026-01-10T00:51:30.000Z",
            kind: "ShortBreak",
        });
        const completed = completedRecord({
            state: {
                ...completedRecord().state,
                timer: live,
            },
            timerCompleted: false,
            lastSynced: remote,
        });
        const resolved = applyCompletionLoser(completed, e, remote, NOW);

        expect(resolved.state.timer).toEqual(live);
        expect(resolved.timerCompleted).toBe(false);
        expect(resolved.state.logs.find((log) => log.id === e.log.id)).toBeUndefined();
        expect(resolved.state.tasks.t1).toEqual(e.taskBefore);
    });

    it("keeps a log the remote already carries (a CAS response lost after commit)", () => {
        const e = entry();
        const remote = snapshot({
            tasks: { t1: { value: T("t1", { name: "Winner" }), updatedAt: "2026-01-10T00:27:00.000Z" } },
            logs: { [e.log.id]: { ...e.log } },
            timerState: {
                value: timerSlice(null, 1),
                updatedAt: "2026-01-10T00:27:00.000Z",
                completed: true,
            },
        });
        const completed = completedRecord({ lastSynced: remote });
        const resolved = applyCompletionLoser(completed, e, remote, NOW);

        expect(resolved.state.logs.find((log) => log.id === e.log.id)).toBeDefined();
        expect(resolved.state.tasks.t1).toEqual(T("t1", { name: "Winner" }));
        expect(resolved.timerCompleted).toBe(true);
        expect(resolved.pendingCompletions).toHaveLength(0);
    });
});

describe("completionMask", () => {
    it("masks completion-owned task/log/timer values while unresolved", () => {
        const mask = completionMask(completedRecord());
        expect(mask.taskIds.has("t1")).toBe(true);
        expect(mask.logIds.has("log-completion-1")).toBe(true);
        expect(mask.maskTimer).toBe(true);
    });

    it("does not mask the timer once a new generation has started", () => {
        const withNewTimer = completedRecord({
            state: {
                ...completedRecord().state,
                timer: TIMER({ started_at: "2026-01-10T00:26:30.000Z", ends_at: "2026-01-10T00:51:30.000Z", kind: "ShortBreak" }),
            },
            timerCompleted: false,
        });
        const mask = completionMask(withNewTimer);
        expect(mask.maskTimer).toBe(false);
        expect(mask.taskIds.has("t1")).toBe(true);
        expect(mask.logIds.has("log-completion-1")).toBe(true);
    });

    it("is empty when the journal is empty", () => {
        const mask = completionMask(record());
        expect(mask.taskIds.size).toBe(0);
        expect(mask.logIds.size).toBe(0);
        expect(mask.maskTimer).toBe(false);
    });
});
