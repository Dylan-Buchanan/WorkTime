import type { ActiveTimer, AppStateData } from "../../state/types";
import {
    addSeconds,
    appendLog,
    clampFraction,
    cloneAppState,
    EngineError,
    EngineResult,
    elapsedTimerSecs,
    fullCycleDurationSecs,
    plannedTimerSecs,
} from "./core";
import {
    cloneInProgressPomodoros,
    resumablePomodoroElapsedSecs,
    type InProgressPomodoroMap,
    withoutInProgressPomodoro,
} from "./pomodoroProgress";

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
export function startWorkTimer(
    state: AppStateData,
    now: Date,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<ActiveTimer> {
    const next = cloneAppState(state);
    const taskId = requireActiveTask(next);
    const progress = cloneInProgressPomodoros(inProgressPomodoros);

    if (next.current_cycle_pomodoros > 0) {
        const lastWork = [...next.logs].reverse().find((log) => !log.was_break);
        if (lastWork) {
            const cycleWindow = fullCycleDurationSecs(next.settings);
            if (cycleWindow > 0 && Math.trunc((now.getTime() - new Date(lastWork.finished_at).getTime()) / 1000) >= cycleWindow) {
                next.current_cycle_pomodoros = 0;
            }
        }
    }

    const workSecs = Math.max(0, Math.trunc(next.settings.work_minutes * 60));
    const savedBase = resumablePomodoroElapsedSecs(progress, taskId, workSecs);
    if (savedBase > 0) progress[taskId] = savedBase;
    else delete progress[taskId];
    const timer = makeTimer(taskId, "Work", workSecs - savedBase, now);
    next.timer = timer;
    return { state: next, value: { ...timer }, inProgressPomodoros: progress };
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
export function completeTimer(
    state: AppStateData,
    now: Date,
    logId: string,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<AppStateData> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active timer");
    if (now.getTime() < new Date(timer.ends_at).getTime()) throw new EngineError("Timer not finished yet");

    const planned = plannedTimerSecs(timer);
    const wasBreak = timer.kind !== "Work";
    appendLog(next, timer.task_id, planned / 60, now, wasBreak, logId);

    if (!wasBreak) {
        const task = next.tasks[timer.task_id];
        if (task) {
            const workSecs = next.settings.work_minutes * 60;
            const fraction = workSecs > 0 ? clampFraction(planned / workSecs) : 1;
            task.completed_pomodoros += fraction;
        }
        next.current_cycle_pomodoros += 1;
    }
    next.timer = null;
    return {
        state: next,
        value: cloneAppState(next),
        inProgressPomodoros: wasBreak
            ? cloneInProgressPomodoros(inProgressPomodoros)
            : withoutInProgressPomodoro(inProgressPomodoros, timer.task_id),
    };
}

/** Rust: stop_work_timer */
export function stopWorkTimer(
    state: AppStateData,
    now: Date,
    logId: string,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<AppStateData> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (!timer) throw new EngineError("No active timer");
    if (timer.kind !== "Work") throw new EngineError("Not a work timer");

    const elapsed = elapsedTimerSecs(timer, now);
    const workSecs = Math.max(0, Math.trunc(next.settings.work_minutes * 60));
    const fraction = workSecs > 0 ? clampFraction(elapsed / workSecs) : 0;
    const task = next.tasks[timer.task_id];
    if (task) {
        task.completed_pomodoros += fraction;
    }
    appendLog(next, timer.task_id, elapsed / 60, now, false, logId);
    next.timer = null;
    return {
        state: next,
        value: cloneAppState(next),
        inProgressPomodoros: withoutInProgressPomodoro(inProgressPomodoros, timer.task_id),
    };
}
