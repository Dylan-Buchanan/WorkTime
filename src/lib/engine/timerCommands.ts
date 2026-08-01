import type { ActiveTimer, AppStateData } from "../../state/types";
import {
    addSeconds,
    appendLog,
    clampFraction,
    cloneAppState,
    EngineError,
    EngineResult,
    fullCycleDurationSecs,
    plannedTimerSecs,
} from "./core";

function requireActiveTask(state: AppStateData): string {
    if (state.active_task === null) throw new EngineError("No active task");
    return state.active_task;
}

function makeTimer(taskId: string, kind: ActiveTimer["kind"], plannedSecs: number, now: Date): ActiveTimer {
    return {
        task_id: taskId,
        started_at: now.toISOString(),
        ends_at: addSeconds(now, plannedSecs),
        kind,
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: plannedSecs,
        accumulated_secs: 0,
    };
}

/** Rust: start_work_timer */
export function startWorkTimer(state: AppStateData, now: Date): EngineResult<ActiveTimer> {
    const next = cloneAppState(state);
    const taskId = requireActiveTask(next);

    if (next.current_cycle_pomodoros > 0) {
        const lastWork = [...next.logs].reverse().find((log) => !log.was_break);
        if (lastWork) {
            const cycleWindow = fullCycleDurationSecs(next.settings);
            if (cycleWindow > 0 && Math.trunc((now.getTime() - new Date(lastWork.finished_at).getTime()) / 1000) >= cycleWindow) {
                next.current_cycle_pomodoros = 0;
            }
        }
    }

    const timer = makeTimer(taskId, "Work", next.settings.work_minutes * 60, now);
    next.timer = timer;
    return { state: next, value: { ...timer } };
}

/** Rust: start_break_timer */
export function startBreakTimer(state: AppStateData, now: Date): EngineResult<ActiveTimer> {
    const next = cloneAppState(state);
    const taskId = requireActiveTask(next);
    const isLong = next.current_cycle_pomodoros >= next.settings.segment_length;
    if (isLong) next.current_cycle_pomodoros = 0;
    const kind = isLong ? "LongBreak" : "ShortBreak";
    const minutes = isLong ? next.settings.long_break_minutes : next.settings.short_break_minutes;
    const timer = makeTimer(taskId, kind, minutes * 60, now);
    next.timer = timer;
    return { state: next, value: { ...timer } };
}

/** Rust: complete_timer */
export function completeTimer(state: AppStateData, now: Date): EngineResult<AppStateData> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active timer");
    if (now.getTime() < new Date(timer.ends_at).getTime()) throw new EngineError("Timer not finished yet");

    const planned = plannedTimerSecs(timer);
    const wasBreak = timer.kind !== "Work";
    appendLog(next, timer.task_id, planned / 60, now, wasBreak);

    if (!wasBreak) {
        const task = next.tasks[timer.task_id];
        if (task) {
            const workSecs = next.settings.work_minutes * 60;
            const fraction = workSecs > 0 ? clampFraction(planned / workSecs) : 1;
            task.completed_pomodoros += fraction;
            if (task.completed_at === null && task.completed_pomodoros > task.target_pomodoros) {
                task.target_pomodoros = Math.ceil(task.completed_pomodoros);
            }
        }
        next.current_cycle_pomodoros += 1;
    }
    next.timer = null;
    return { state: next, value: cloneAppState(next) };
}

/** Rust: stop_work_timer */
export function stopWorkTimer(state: AppStateData, now: Date): EngineResult<AppStateData> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active timer");
    if (timer.kind !== "Work") throw new EngineError("Not a work timer");

    const planned = plannedTimerSecs(timer);
    const currentSegment = Math.max(0, Math.trunc((now.getTime() - new Date(timer.started_at).getTime()) / 1000));
    const elapsed = Math.min((timer.accumulated_secs ?? 0) + currentSegment, planned);
    const fraction = planned > 0 ? elapsed / planned : 0;
    const task = next.tasks[timer.task_id];
    if (task) {
        task.completed_pomodoros += fraction;
        if (task.completed_pomodoros > task.target_pomodoros) {
            task.target_pomodoros = Math.ceil(task.completed_pomodoros);
        }
    }
    appendLog(next, timer.task_id, elapsed / 60, now, false);
    next.timer = null;
    return { state: next, value: cloneAppState(next) };
}
