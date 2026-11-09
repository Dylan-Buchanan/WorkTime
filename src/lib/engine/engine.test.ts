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
    workStartOccupation,
    windowStartedAt,
    windowRemainingSecs,
    isWorkWindowLive,
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
        expect(DEFAULT_SETTINGS).toEqual({ work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4, start_of_day: "00:00", end_of_day: "22:00" });
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
        const custom: Settings = { work_minutes: 0, short_break_minutes: 7, long_break_minutes: 0, segment_length: 0, start_of_day: "06:30", end_of_day: "18:30" };
        const state = stateWithTask();
        expect(updateSettings(state, custom).value).toEqual(custom);
        const reset = resetAppState(state);
        expect(reset.state).toEqual(defaultAppState());
        expect(reset.value).toEqual(defaultAppState());
        expect(reset.value).not.toBe(reset.state);
    });
});

describe("task lifecycle commands", () => {
    it("switches tasks within the original work window", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2", 2);
        state.timer = timer();
        const result = setActiveTask(state, "t2", at(750), "log-1");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0.5);
        expect(result.state.logs).toEqual([{ id: "log-1", task_id: "t1", duration_minutes: 12.5, finished_at: at(750).toISOString(), was_break: false, break_skipped: false }]);
        expect(result.state.timer).toMatchObject({ task_id: "t2", planned_secs: 750, accumulated_secs: 0, started_at: at(750).toISOString(), ends_at: at(1500).toISOString(), window_started_at: T0.toISOString() });
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
        expect(result.state.timer).toMatchObject({ paused: true, paused_remaining_secs: 900, planned_secs: 900 });
    });

    it("conserves the remainder on successive switches without mutating input", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer();
        const before = structuredClone(state);
        const first = setActiveTask(state, "t2", at(300), "first");
        const second = setActiveTask(first.state, "t1", at(301), "second");
        expect(first.state.timer).toMatchObject({ planned_secs: 1200, ends_at: at(1500).toISOString() });
        expect(second.state.timer).toMatchObject({ planned_secs: 1199, ends_at: at(1500).toISOString(), window_started_at: T0.toISOString() });
        expect(second.state.tasks.t1.completed_pomodoros).toBe(0.2);
        expect(second.state.tasks.t2.completed_pomodoros).toBeCloseTo(1 / 1500);
        expect(second.state.logs.map(log => log.duration_minutes)).toEqual([5, 1 / 60]);
        expect(state).toEqual(before);
    });

    it("switches at t=0 without credit or logs and retains the full budget", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer();
        const result = setActiveTask(state, "t2", T0, "unused");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0);
        expect(result.state.logs).toEqual([]);
        expect(result.state.timer).toMatchObject({ planned_secs: 1500, ends_at: state.timer.ends_at });
    });

    it("clamps negative elapsed instead of increasing the window budget", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer({ started_at: at(100).toISOString() });
        const result = setActiveTask(state, "t2", T0, "unused");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0);
        expect(result.state.logs).toEqual([]);
        expect(result.state.timer?.planned_secs).toBe(1500);
    });

    it("finalizes, archives, and clears a work timer and selection", () => {
        const state = stateWithTask(2);
        state.tasks.t1.completed_pomodoros = 2.5;
        state.timer = timer();
        const result = finalizeTask(state, "t1", at(2000), "finalize");
        expect(result.value).toMatchObject({ target_pomodoros: 2, completed_pomodoros: 3.5, completed_at: at(2000).toISOString(), archived: true });
        expect(result.state.timer).toBeNull();
        expect(result.state.active_task).toBeNull();
    });

    it("retains a break timer while finalizing", () => {
        const state = stateWithTask();
        state.timer = timer({ kind: "ShortBreak", planned_secs: 300, ends_at: at(300).toISOString() });
        const result = finalizeTask(state, "t1", at(100), "finalize");
        expect(result.state.timer).not.toBeNull();
    });

    it("deletes and archives with Rust cleanup semantics", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer();
        const deleted = deleteTask(state, "t1");
        expect(deleted.state).toMatchObject({ active_task: null, timer: state.timer });
        expect(deleted.state.tasks).toEqual({ t2: state.tasks.t2 });
        const switchedAfterDelete = setActiveTask(deleted.state, "t2", at(100), "log-deleted");

        const archived = archiveTask(state, "t1");
        expect(archived.value.archived).toBe(true);
        expect(archived.state.active_task).toBe("t1");
        expect(archived.state.timer).toEqual(state.timer);
        const switchedAfterArchive = setActiveTask(archived.state, "t2", at(100), "log-archived");

        expect(switchedAfterDelete.state.logs[0].duration_minutes).toBeCloseTo(100 / 60);
        expect(switchedAfterDelete.state.tasks.t1).toBeUndefined();
        expect(switchedAfterArchive.state.logs[0].duration_minutes).toBeCloseTo(100 / 60);
        expect(switchedAfterArchive.state.tasks.t1.completed_pomodoros).toBeCloseTo(100 / 1500);
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

    it("starts a fresh window regardless of previous credited work", () => {
        const state = stateWithTask();
        state.tasks.t1.completed_pomodoros = 0.4;
        const started = startWorkTimer(state, T0);
        expect(started.value).toMatchObject({ planned_secs: 1500, window_started_at: T0.toISOString() });
        const completed = completeTimer(started.state, at(1500), "completed");
        expect(completed.state.tasks.t1.completed_pomodoros).toBe(1.4);
        expect(completed.state.current_cycle_pomodoros).toBe(1);
        expect(completed.state.logs[0].duration_minutes).toBe(25);
    });

    it("refuses to overwrite any existing timer", () => {
        for (const kind of ["Work", "ShortBreak", "LongBreak"] as const) {
            const state = { ...stateWithTask(), timer: timer({ kind }) };
            expect(() => startWorkTimer(state, T0)).toThrow(new EngineError("A timer is already running"));
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
        const result = stopWorkTimer(state, at(300), "log-6");
        expect(result.state.tasks.t1.completed_pomodoros).toBeCloseTo(0.6);
        expect(result.state.logs[0].duration_minutes).toBe(5);
        expect(result.state.logs[0].id).toBe("log-6");
        expect(result.state.tasks.t1.completed_at).toBeNull();
    });

    it("completes a break without work credit or cycle increments", () => {
        const state = stateWithTask();
        state.timer = timer({ kind: "ShortBreak", planned_secs: 300, ends_at: at(300).toISOString() });
        const result = completeTimer(state, at(300), "log-break");
        expect(result.state.tasks.t1.completed_pomodoros).toBe(0);
        expect(result.state.current_cycle_pomodoros).toBe(0);
        expect(result.state.logs[0]).toMatchObject({ was_break: true, duration_minutes: 5 });
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
        expect(() => finalizeTask(defaultAppState(), "missing", T0, "unused")).toThrowError("Task not found");
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


describe("work-window boundaries", () => {
    it("classifies starts and derives legacy window identity and remaining seconds", () => {
        expect(workStartOccupation(null)).toBe("free");
        expect(workStartOccupation(timer())).toBe("join");
        expect(workStartOccupation(timer({ kind: "ShortBreak" }))).toBe("blocked");
        expect(workStartOccupation(timer({ kind: "LongBreak" }))).toBe("blocked");
        expect(windowStartedAt(timer({ started_at: at(600).toISOString(), accumulated_secs: 600 }))).toBe(T0.toISOString());
        expect(windowStartedAt(timer({ window_started_at: at(-100).toISOString() }))).toBe(at(-100).toISOString());
        expect(windowRemainingSecs(timer(), at(600))).toBe(900);
        expect(windowRemainingSecs(timer(), at(2000))).toBe(0);
        expect(isWorkWindowLive(null, T0)).toBe(false);
        expect(isWorkWindowLive(timer({ kind: "ShortBreak" }), T0)).toBe(false);
        expect(isWorkWindowLive(timer(), at(1499))).toBe(true);
        expect(isWorkWindowLive(timer(), at(1500))).toBe(false);
        expect(isWorkWindowLive(timer({ paused: true }), at(9000))).toBe(true);
    });

    it.each([1500, 2000])("completes an expired switch at %s exactly once", (seconds) => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer();
        const switched = setActiveTask(state, "t2", at(seconds), "expired").state;
        expect(switched.timer).toBeNull();
        expect(switched.active_task).toBe("t2");
        expect(switched.current_cycle_pomodoros).toBe(1);
        expect(switched.tasks.t1.completed_pomodoros).toBe(1);
        expect(switched.logs).toHaveLength(1);
        expect(switched.logs[0].duration_minutes).toBe(25);
        expect(setActiveTask(switched, "t1", at(seconds), "unused").state.current_cycle_pomodoros).toBe(1);
    });

    it("reconciles a sub-second legacy span with zero whole seconds remaining", () => {
        const state = stateWithTask();
        state.tasks.t2 = task("t2");
        state.timer = timer({ planned_secs: undefined, ends_at: at(0.5).toISOString() });
        const result = setActiveTask(state, "t2", T0, "subsecond").state;
        expect(result.timer).toBeNull();
        expect(result.current_cycle_pomodoros).toBe(1);
        expect(result.logs).toHaveLength(1);
    });

    it("keeps a switched long pause frozen and resumes with the remaining budget", () => {
        const state = startWorkTimer(stateWithTask(), T0).state;
        state.tasks.t2 = task("t2");
        const paused = pauseTimer(state, at(600)).state;
        const switched = setActiveTask(paused, "t2", at(9000), "paused").state;
        expect(switched.timer).toMatchObject({ paused: true, planned_secs: 900, paused_remaining_secs: 900, accumulated_secs: 0, window_started_at: T0.toISOString() });
        expect(() => completeTimer(switched, at(20000), "unused")).toThrow("Timer not finished yet");
        const resumed = resumeTimer(switched, at(20000)).state;
        expect(resumed.timer).toMatchObject({ ends_at: at(20900).toISOString(), window_started_at: T0.toISOString() });
        expect(completeTimer(resumed, at(20900), "finish").state.tasks.t2.completed_pomodoros).toBe(0.6);
    });

    it("finalize banks a live slice before archiving without completing the cycle", () => {
        const state = startWorkTimer(stateWithTask(), T0).state;
        const result = finalizeTask(state, "t1", at(600), "finalize").state;
        expect(result.tasks.t1).toMatchObject({ archived: true, completed_pomodoros: 0.4 });
        expect(result.logs[0].duration_minutes).toBe(10);
        expect(result.timer).toBeNull();
        expect(result.current_cycle_pomodoros).toBe(0);
        expect(finalizeTask(state, "t1", T0, "unused").state.logs).toEqual([]);
    });

    it("finalize of an expired window uses capped completion accounting", () => {
        const state = startWorkTimer(stateWithTask(), T0).state;
        const result = finalizeTask(state, "t1", at(2000), "finalize").state;
        expect(result.tasks.t1).toMatchObject({ archived: true, completed_pomodoros: 1 });
        expect(result.logs[0].duration_minutes).toBe(25);
        expect(result.timer).toBeNull();
        expect(result.current_cycle_pomodoros).toBe(1);
    });

    it.each([[], [0], [300, 301, 301], [100, 500, 1000, 1499], [0.1, 0.2, 900.9, 1499.9]].map(schedule => [schedule]))(
        "conserves credit and logged minutes across schedule %j", (schedule: number[]) => {
            for (const finish of ["complete", "stop"] as const) {
                let state = startWorkTimer(stateWithTask(), T0).state;
                state.tasks.t2 = task("t2");
                schedule.forEach((seconds, index) => {
                    state = setActiveTask(state, index % 2 ? "t1" : "t2", at(seconds), `switch-${index}`).state;
                });
                state = finish === "complete" ? completeTimer(state, at(1500), "finish").state : stopWorkTimer(state, at(1500), "finish").state;
                const credit = Object.values(state.tasks).reduce((sum, value) => sum + value.completed_pomodoros, 0);
                const minutes = state.logs.reduce((sum, log) => sum + log.duration_minutes, 0);
                expect(credit).toBeLessThanOrEqual(1 + 1e-12);
                expect(minutes).toBeLessThanOrEqual(25 + 1e-12);
                expect(credit).toBeCloseTo(minutes / 25);
                if (finish === "complete") {
                    expect(credit).toBeCloseTo(1);
                    expect(minutes).toBeCloseTo(25);
                } else {
                    // End focus banks whole active seconds; fractional slices
                    // can leave less than one second unbanked per handoff.
                    expect(minutes * 60).toBeGreaterThanOrEqual(1500 - schedule.length - 1);
                }
            }
        },
    );
});
