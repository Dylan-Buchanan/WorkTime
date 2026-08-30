import type { AppStateData, Task } from "../../state/types";
import {
    addSeconds,
    appendLog,
    clampFraction,
    cloneAppState,
    elapsedTimerSecs,
    EngineResult,
    normalizePositiveInteger,
    taskOrThrow,
} from "./core";
import {
    cloneInProgressPomodoros,
    resumablePomodoroElapsedSecs,
    type InProgressPomodoroMap,
    withoutInProgressPomodoro,
} from "./pomodoroProgress";

/** Rust: set_active_task */
export function setActiveTask(
    state: AppStateData,
    taskId: string,
    now: Date,
    logId: string,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<void> {
    const next = cloneAppState(state);
    let progress = cloneInProgressPomodoros(inProgressPomodoros);
    taskOrThrow(next, taskId);

    const timer = next.timer;
    if (timer && timer.kind === "Work" && timer.task_id !== taskId) {
        const elapsed = elapsedTimerSecs(timer, now);
        const workSecs = Math.max(0, Math.trunc(next.settings.work_minutes * 60));
        const savedBase = resumablePomodoroElapsedSecs(progress, timer.task_id, workSecs);
        const oldTask = next.tasks[timer.task_id];

        if (elapsed > 0) {
            if (oldTask && workSecs > 0) {
                oldTask.completed_pomodoros += clampFraction(elapsed / workSecs);
            }
            appendLog(next, timer.task_id, elapsed / 60, now, false, logId);
        }

        const savedTotal = Math.min(workSecs, savedBase + elapsed);
        if (
            oldTask &&
            !oldTask.archived &&
            oldTask.completed_at === null &&
            savedTotal > 0 &&
            savedTotal < workSecs
        ) progress[timer.task_id] = savedTotal;
        else delete progress[timer.task_id];

        const targetBase = resumablePomodoroElapsedSecs(progress, taskId, workSecs);
        if (targetBase > 0) progress[taskId] = targetBase;
        else delete progress[taskId];
        const remaining = workSecs - targetBase;
        if (remaining > 0) {
            next.timer = {
                ...timer,
                task_id: taskId,
                planned_secs: remaining,
                accumulated_secs: 0,
                started_at: now.toISOString(),
                ends_at: addSeconds(now, remaining),
                paused_remaining_secs: timer.paused ? remaining : 0,
            };
        } else {
            next.timer = null;
        }
    }

    next.active_task = taskId;
    return { state: next, value: undefined, inProgressPomodoros: progress };
}

/** Rust: delete_task */
export function deleteTask(
    state: AppStateData,
    taskId: string,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<void> {
    const next = cloneAppState(state);
    taskOrThrow(next, taskId);
    delete next.tasks[taskId];
    if (next.active_task === taskId) next.active_task = null;
    return {
        state: next,
        value: undefined,
        inProgressPomodoros: withoutInProgressPomodoro(inProgressPomodoros, taskId),
    };
}

/** Rust: archive_task */
export function archiveTask(
    state: AppStateData,
    taskId: string,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<Task> {
    const next = cloneAppState(state);
    const task = taskOrThrow(next, taskId);
    task.archived = true;
    return {
        state: next,
        value: { ...task },
        inProgressPomodoros: withoutInProgressPomodoro(inProgressPomodoros, taskId),
    };
}

/** Rust: finalize_task */
export function finalizeTask(
    state: AppStateData,
    taskId: string,
    now: Date,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<Task> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (timer?.task_id === taskId && timer.kind === "Work") next.timer = null;

    const task = taskOrThrow(next, taskId);
    if (task.completed_at === null) {
        task.completed_at = now.toISOString();
    }
    task.archived = true;
    if (next.active_task === taskId) next.active_task = null;
    return {
        state: next,
        value: { ...task },
        inProgressPomodoros: withoutInProgressPomodoro(inProgressPomodoros, taskId),
    };
}

/** Rust: set_task_target */
export function setTaskTarget(state: AppStateData, taskId: string, target: number): EngineResult<Task> {
    const next = cloneAppState(state);
    const task = taskOrThrow(next, taskId);
    task.target_pomodoros = normalizePositiveInteger(target);
    return { state: next, value: { ...task } };
}
