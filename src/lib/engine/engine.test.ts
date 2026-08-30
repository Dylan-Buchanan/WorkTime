import { describe, expect, it } from "vitest";
import type { ActiveTimer, AppStateData, PomodoroLogEntry, Settings, Task } from "../../state/types";
import {
    archiveTask,
    completeTimer,
    createTask,
    DEFAULT_SETTINGS,
    deleteTask,
    defaultAppState,
    EngineError,
    finalizeTask,
    fullCycleDurationSecs,
    getState,
    pauseTimer,
    resetAppState,
    resumeTimer,
    setActiveTask,
    setTaskTarget,
    skipBreak,
    startBreakTimer,
    startWorkTimer,
    stopWorkTimer,
    updateSettings,
} from ".";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function task(id: string, target = 4): Task {
    return {
        id,
        name: id,
        target_pomodoros: target,
        completed_pomodoros: 0,
        created_at: T0.toISOString(),
        completed_at: null,
        break_skips: 0,
        archived: false,
    };
}

function stateWithTask(target = 4): AppStateData {
    const state = defaultAppState();
    state.tasks.t1 = task("t1", target);
    state.active_task = "t1";
    return state;
}

function timer(overrides: Partial<ActiveTimer> = {}): ActiveTimer {
    return {
        task_id: "t1",
        started_at: T0.toISOString(),
        ends_at: at(1500).toISOString(),
        kind: "Work",
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: 1500,
        accumulated_secs: 0,
        ...overrides,
    };
}

describe("engine core and state commands", () => {
    it("provides fresh defaults and the Rust cycle formula", () => {
        expect(DEFAULT_SETTINGS).toEqual({ work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4, end_of_day: "22:00" });
        expect(fullCycleDurationSecs(DEFAULT_SETTINGS)).toBe(135 * 60);
        expect(fullCycleDurationSecs({ ...DEFAULT_SETTINGS, segment_length: 0 })).toBe(25 * 60 + 20 * 60);
        expect(defaultAppState()).toEqual({ tasks: {}, logs: [], settings: DEFAULT_SETTINGS, active_task: null, current_cycle_pomodoros: 0, timer: null });
    });

    it("archives completed tasks and clears an archived active selection", () => {
        const state = stateWithTask();
        state.tasks.t1.completed_at = at(60).toISOString();
        const before = structuredClone(state);
        const result = getState(state);
        expect(result.value).toBe(true);
        expect(result.state.tasks.t1.archived).toBe(true);
        expect(result.state.active_task).toBeNull();
        expect(state).toEqual(before);
    });

    it("returns a cloned no-op for getState", () => {
        const state = stateWithTask();
        const result = getState(state);
        expect(result.value).toBe(false);
        expect(result.state).toEqual(state);
        expect(result.state).not.toBe(state);
        expect(result.state.tasks).not.toBe(state.tasks);
    });

    it("creates deterministic tasks with a minimum target", () => {
        const result = createTask(defaultAppState(), "New", 0, T0, "fixed-id");
        expect(result.value).toEqual(result.state.tasks["fixed-id"]);
        expect(result.value).toMatchObject({ id: "fixed-id", name: "New", target_pomodoros: 1, completed_pomodoros: 0, completed_at: null, break_skips: 0, archived: false });
        expect(result.value.created_at).toBe(T0.toISOString());
    });

    it("replaces settings exactly and resets to fresh defaults", () => {
        const custom: Settings = { work_minutes: 0, short_break_minutes: 7, long_break_minutes: 0, segment_length: 0, end_of_day: "18:30" };
        const state = stateWithTask();
        expect(updateSettings(state, custom).value).toEqual(custom);
        const reset = resetAppState(state, { t1: 600 });
        expect(reset.state).toEqual(defaultAppState());
        expect(reset.value).toEqual(defaultAppState());
        expect(reset.value).not.toBe(reset.state);
        expect(reset.inProgressPomodoros).toEqual({});
    });
});

describe("task lifecycle commands", () => {
    it("switches tasks by saving progress and giving a fresh target a full timer", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2", 2);
        state.timer = timer();
        const result = setActiveTask(state, "t2", at(750), "log-1");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0.5);
        expect(result.state.logs).toEqual([{ id: "log-1", task_id: "t1", duration_minutes: 12.5, finished_at: at(750).toISOString(), was_break: false, break_skipped: false }]);
        expect(result.inProgressPomodoros).toEqual({ t1: 750 });
        expect(result.state.timer).toMatchObject({ task_id: "t2", planned_secs: 1500, accumulated_secs: 0, started_at: at(750).toISOString(), ends_at: at(2250).toISOString() });
        expect(result.state.active_task).toBe("t2");
    });

    it("preserves the original target when switching tasks adds overage", () => {
        const state = stateWithTask(1);
        state.tasks.t1.completed_pomodoros = 0.75;
        state.tasks.t2 = task("t2", 2);
        state.timer = timer();

        const result = setActiveTask(state, "t2", at(750), "log-overage-switch");

        expect(result.state.tasks.t1.completed_pomodoros).toBe(1.25);
        expect(result.state.tasks.t1.target_pomodoros).toBe(1);
    });

    it("does not prorate when selecting the same timer task", () => {
        const state = stateWithTask();
        state.timer = timer();
        const result = setActiveTask(state, "t1", at(600), "log-2");
        expect(result.state.logs).toHaveLength(0);
        expect(result.state.timer).toEqual(state.timer);
    });

    it("uses accumulated time when switching a paused timer", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer({ paused: true, accumulated_secs: 600, paused_remaining_secs: 900 });
        const result = setActiveTask(state, "t2", at(1800), "log-3");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0.4);
        expect(result.inProgressPomodoros).toEqual({ t1: 600 });
        expect(result.state.timer).toMatchObject({ paused: true, paused_remaining_secs: 1500, planned_secs: 1500 });
    });

    it("resumes and re-saves cumulative progress without double-crediting", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer({ planned_secs: 900, ends_at: at(900).toISOString() });
        const progress = { t1: 600, t2: 300 };
        const stateBefore = structuredClone(state);
        const progressBefore = structuredClone(progress);

        const result = setActiveTask(state, "t2", at(300), "log-repeat", progress);

        expect(result.state.tasks.t1.completed_pomodoros).toBe(0.2);
        expect(result.state.logs[0].duration_minutes).toBe(5);
        expect(result.inProgressPomodoros).toEqual({ t1: 900, t2: 300 });
        expect(result.state.timer).toMatchObject({ task_id: "t2", planned_secs: 1200, ends_at: at(1500).toISOString() });
        expect(state).toEqual(stateBefore);
        expect(progress).toEqual(progressBefore);
    });

    it("retains the saved base when switching immediately after resume", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer({ planned_secs: 900, ends_at: at(900).toISOString() });

        const result = setActiveTask(state, "t2", T0, "unused", { t1: 600, t2: 300 });

        expect(result.state.tasks.t1.completed_pomodoros).toBe(0);
        expect(result.state.logs).toEqual([]);
        expect(result.inProgressPomodoros).toEqual({ t1: 600, t2: 300 });
    });

    it("does not infer saved progress from a pre-upgrade shortened timer", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer({ planned_secs: 750, ends_at: at(750).toISOString() });

        const result = setActiveTask(state, "t2", at(100), "log-upgrade", {});

        expect(result.inProgressPomodoros).toEqual({ t1: 100 });
        expect(result.state.tasks.t1.completed_pomodoros).toBeCloseTo(100 / 1500);
    });

    it("finalizes, archives, and clears a work timer and selection", () => {
        const state = stateWithTask(2);
        state.tasks.t1.completed_pomodoros = 2.5;
        state.timer = timer();
        const result = finalizeTask(state, "t1", at(2000));
        expect(result.value).toMatchObject({ target_pomodoros: 2, completed_pomodoros: 2.5, completed_at: at(2000).toISOString(), archived: true });
        expect(result.state.timer).toBeNull();
        expect(result.state.active_task).toBeNull();
    });

    it("retains a break timer while finalizing", () => {
        const state = stateWithTask();
        state.timer = timer({ kind: "ShortBreak", planned_secs: 300, ends_at: at(300).toISOString() });
        const result = finalizeTask(state, "t1", at(100));
        expect(result.state.timer).not.toBeNull();
    });

    it("deletes and archives with Rust cleanup semantics", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer();
        const deleted = deleteTask(state, "t1", { t1: 600, t2: 300 });
        expect(deleted.state).toMatchObject({ active_task: null, timer: state.timer });
        expect(deleted.state.tasks).toEqual({ t2: state.tasks.t2 });
        expect(deleted.inProgressPomodoros).toEqual({ t2: 300 });
        const switchedAfterDelete = setActiveTask(deleted.state, "t2", at(100), "log-deleted", deleted.inProgressPomodoros);
        expect(switchedAfterDelete.inProgressPomodoros).toEqual({ t2: 300 });

        const archived = archiveTask(state, "t1", { t1: 600, t2: 300 });
        expect(archived.value.archived).toBe(true);
        expect(archived.state.active_task).toBe("t1");
        expect(archived.state.timer).toEqual(state.timer);
        expect(archived.inProgressPomodoros).toEqual({ t2: 300 });
        const switchedAfterArchive = setActiveTask(archived.state, "t2", at(100), "log-archived", archived.inProgressPomodoros);
        expect(switchedAfterArchive.inProgressPomodoros).toEqual({ t2: 300 });

        const finalized = finalizeTask(state, "t1", at(2000), { t1: 600, t2: 300 });
        expect(finalized.inProgressPomodoros).toEqual({ t2: 300 });
    });

    it("allows estimates below completed progress while preserving the minimum target", () => {
        const state = stateWithTask();
        state.tasks.t1.completed_pomodoros = 2.5;
        expect(setTaskTarget(state, "t1", 1).value.target_pomodoros).toBe(1);
        expect(setTaskTarget(state, "t1", 0).value.target_pomodoros).toBe(1);
    });
});

describe("timer lifecycle commands", () => {
    it("starts work and resets an expired cycle at the equality boundary", () => {
        const state = stateWithTask();
        state.current_cycle_pomodoros = 2;
        state.logs.push({ id: "log-0", task_id: "t1", duration_minutes: 25, finished_at: at(-135 * 60).toISOString(), was_break: false, break_skipped: false });
        const result = startWorkTimer(state, T0);
        expect(result.state.current_cycle_pomodoros).toBe(0);
        expect(result.value).toMatchObject({ kind: "Work", planned_secs: 1500, started_at: T0.toISOString(), ends_at: at(1500).toISOString() });
    });

    it("starts and completes the remaining part of a saved pomodoro", () => {
        const state = stateWithTask();
        state.tasks.t1.completed_pomodoros = 0.4;
        const started = startWorkTimer(state, T0, { t1: 600, t2: 300 });
        expect(started.value).toMatchObject({ planned_secs: 900, ends_at: at(900).toISOString() });
        expect(started.inProgressPomodoros).toEqual({ t1: 600, t2: 300 });

        const completed = completeTimer(started.state, at(900), "log-resumed", started.inProgressPomodoros);
        expect(completed.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(completed.state.current_cycle_pomodoros).toBe(1);
        expect(completed.state.logs[0].duration_minutes).toBe(15);
        expect(completed.inProgressPomodoros).toEqual({ t2: 300 });
    });

    it("starts fresh and removes non-resumable saved positions", () => {
        for (const saved of [0, -1, 1500, Number.POSITIVE_INFINITY, 600.5]) {
            const result = startWorkTimer(stateWithTask(), T0, { t1: saved, t2: 300 });
            expect(result.value.planned_secs).toBe(1500);
            expect(result.inProgressPomodoros).toEqual({ t2: 300 });
        }
    });

    it("selects short and long breaks", () => {
        const short = stateWithTask();
        short.current_cycle_pomodoros = 3;
        expect(startBreakTimer(short, T0).value).toMatchObject({ kind: "ShortBreak", planned_secs: 300 });
        const long = stateWithTask();
        long.current_cycle_pomodoros = 4;
        const result = startBreakTimer(long, T0);
        expect(result.value).toMatchObject({ kind: "LongBreak", planned_secs: 1200 });
        expect(result.state.current_cycle_pomodoros).toBe(0);
    });

    it("completes work with one pomodoro and logs planned duration", () => {
        const state = stateWithTask();
        state.timer = timer();
        const result = completeTimer(state, at(1500), "log-4");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(result.state.current_cycle_pomodoros).toBe(1);
        expect(result.state.logs[0]).toMatchObject({ id: "log-4", duration_minutes: 25, was_break: false });
        expect(result.state.timer).toBeNull();
    });

    it("preserves the original target when a completed timer adds overage", () => {
        const state = stateWithTask(1);
        state.tasks.t1.completed_pomodoros = 1;
        state.timer = timer();

        const result = completeTimer(state, at(1500), "log-overage-complete");

        expect(result.state.tasks.t1.completed_pomodoros).toBe(2);
        expect(result.state.tasks.t1.target_pomodoros).toBe(1);
    });

    it("does not auto-extend a finalized task on completion", () => {
        const state = stateWithTask(1);
        state.tasks.t1.completed_at = at(-100).toISOString();
        state.timer = timer();
        const result = completeTimer(state, at(1500), "log-5");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(result.state.tasks.t1.target_pomodoros).toBe(1);
    });

    it("stops resumed work using the configured full-duration denominator", () => {
        const state = stateWithTask();
        state.tasks.t1.completed_pomodoros = 0.4;
        state.timer = timer({ planned_secs: 900, ends_at: at(900).toISOString() });
        const result = stopWorkTimer(state, at(300), "log-6", { t1: 600, t2: 300 });
        expect(result.state.tasks.t1.completed_pomodoros).toBeCloseTo(0.6);
        expect(result.state.logs[0].duration_minutes).toBe(5);
        expect(result.state.logs[0].id).toBe("log-6");
        expect(result.state.tasks.t1.completed_at).toBeNull();
        expect(result.inProgressPomodoros).toEqual({ t2: 300 });
    });

    it("preserves saved work progress when completing a break", () => {
        const state = stateWithTask();
        state.timer = timer({ kind: "ShortBreak", planned_secs: 300, ends_at: at(300).toISOString() });
        const result = completeTimer(state, at(300), "log-break", { t1: 600, t2: 300 });
        expect(result.inProgressPomodoros).toEqual({ t1: 600, t2: 300 });
    });

    it("preserves the original target when a stopped timer adds fractional overage", () => {
        const state = stateWithTask(1);
        state.tasks.t1.completed_pomodoros = 0.75;
        state.timer = timer();

        const result = stopWorkTimer(state, at(750), "log-overage-stop");

        expect(result.state.tasks.t1.completed_pomodoros).toBe(1.25);
        expect(result.state.tasks.t1.target_pomodoros).toBe(1);
    });
});

describe("pause, resume, and skip-break commands", () => {
    it("freezes active seconds on pause and resumes after a wall-clock gap", () => {
        const state = stateWithTask();
        state.timer = timer();
        const paused = pauseTimer(state, at(600));
        expect(paused.value).toMatchObject({ paused: true, accumulated_secs: 600, paused_remaining_secs: 900 });
        const resumed = resumeTimer(paused.state, at(900));
        expect(resumed.value).toMatchObject({ paused: false, accumulated_secs: 600, paused_remaining_secs: 0, started_at: at(900).toISOString(), ends_at: at(1800).toISOString() });
    });

    it("preserves only active progress across pause, resume, and stop", () => {
        const state = stateWithTask();
        state.timer = timer();
        const paused = pauseTimer(state, at(600));
        const resumed = resumeTimer(paused.state, at(2400));
        const result = stopWorkTimer(resumed.state, at(3150), "log-7");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0.9);
    });

    it("skips a break with a zero-duration log", () => {
        const state = stateWithTask();
        state.timer = timer({ kind: "ShortBreak", planned_secs: 300, ends_at: at(300).toISOString() });
        const result = skipBreak(state, at(60), "log-8");
        expect(result.state.tasks.t1.break_skips).toBe(1);
        expect(result.state.logs[0]).toMatchObject({ id: "log-8", duration_minutes: 0, was_break: true, break_skipped: true });
        expect(result.state.timer).toBeNull();
    });
});

describe("engine errors and purity", () => {
    it("uses the EngineError type without changing messages", () => {
        expect(new EngineError("example").name).toBe("EngineError");
        expect(new EngineError("example").message).toBe("example");
    });

    it("reports exact command errors", () => {
        expect(() => startWorkTimer(defaultAppState(), T0)).toThrowError("No active task");
        expect(() => startBreakTimer(defaultAppState(), T0)).toThrowError("No active task");
        expect(() => completeTimer(defaultAppState(), T0, "unused")).toThrowError("No active timer");
        expect(() => stopWorkTimer(defaultAppState(), T0, "unused")).toThrowError("No active timer");
        expect(() => pauseTimer(defaultAppState(), T0)).toThrowError("No active timer");
        expect(() => resumeTimer(defaultAppState(), T0)).toThrowError("No active timer");
        expect(() => skipBreak(defaultAppState(), T0, "unused")).toThrowError("No active break");
        expect(() => setActiveTask(defaultAppState(), "missing", T0, "unused")).toThrowError("Task not found");
        expect(() => deleteTask(defaultAppState(), "missing")).toThrowError("Task not found");
        expect(() => archiveTask(defaultAppState(), "missing")).toThrowError("Task not found");
        expect(() => finalizeTask(defaultAppState(), "missing", T0)).toThrowError("Task not found");
        expect(() => setTaskTarget(defaultAppState(), "missing", 1)).toThrowError("Task not found");
    });

    it("rejects invalid timer transitions without mutating the input", () => {
        const state = stateWithTask();
        state.timer = timer({ ends_at: at(10).toISOString() });
        const before = structuredClone(state);
        expect(() => completeTimer(state, at(1), "unused")).toThrowError("Timer not finished yet");
        expect(() => pauseTimer(state, at(10))).toThrowError("Timer already finished");
        expect(state).toEqual(before);

        state.timer = timer({ paused: true, paused_remaining_secs: 100 });
        const pausedBefore = structuredClone(state);
        expect(() => pauseTimer(state, at(1))).toThrowError("Already paused");
        expect(state).toEqual(pausedBefore);
        state.timer = timer({ kind: "ShortBreak", planned_secs: 300, ends_at: at(300).toISOString() });
        expect(() => stopWorkTimer(state, at(1), "unused")).toThrowError("Not a work timer");
        expect(() => skipBreak({ ...state, timer: timer() }, at(1), "unused")).toThrowError("Not on a break");
        expect(() => resumeTimer({ ...state, timer: timer() }, at(1))).toThrowError("Timer not paused");
    });
});

describe("log ordering contract", () => {
    it("orders equal finished_at logs deterministically by id", () => {
        const logs: PomodoroLogEntry[] = [
            { id: "log-b", task_id: "t1", duration_minutes: 5, finished_at: "2026-01-01T00:25:00.000Z", was_break: true, break_skipped: false },
            { id: "log-c", task_id: "t1", duration_minutes: 25, finished_at: "2026-01-01T01:00:00.000Z", was_break: false, break_skipped: false },
            { id: "log-a", task_id: "t1", duration_minutes: 25, finished_at: "2026-01-01T00:25:00.000Z", was_break: false, break_skipped: false },
        ];
        const sorted = [...logs].sort((a, b) => a.finished_at.localeCompare(b.finished_at) || a.id.localeCompare(b.id));
        expect(sorted.map((l) => l.id)).toEqual(["log-a", "log-b", "log-c"]);
        expect(sorted.map((l) => l.finished_at)).toEqual([
            "2026-01-01T00:25:00.000Z",
            "2026-01-01T00:25:00.000Z",
            "2026-01-01T01:00:00.000Z",
        ]);
    });
});
