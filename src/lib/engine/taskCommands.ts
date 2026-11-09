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
    windowRemainingSecs,
    windowStartedAt,
} from "./core";
import { completeTimer, stopWorkTimer } from "./timerCommands";

/** Rust: set_active_task */
export function setActiveTask(
    state: AppStateData,
    taskId: string,
    now: Date,
    logId: string,
): EngineResult<void> {
    let next = cloneAppState(state);
    taskOrThrow(next, taskId);
    const timer = next.timer;
    if (timer?.kind === "Work" && timer.task_id !== taskId) {
        const elapsed = elapsedTimerSecs(timer, now);
        const remainder = windowRemainingSecs(timer, now);
        if (remainder <= 0 || (!timer.paused && now.getTime() >= Date.parse(timer.ends_at))) {
            // A depleted paused/legacy segment may have an irrelevant future end.
            next = completeTimer(next, now, logId).state;
        } else {
            const workSecs = Math.max(0, Math.trunc(next.settings.work_minutes * 60));
            const oldTask = next.tasks[timer.task_id];
            if (elapsed > 0) {
                if (oldTask && workSecs > 0) oldTask.completed_pomodoros += clampFraction(elapsed / workSecs);
                appendLog(next, timer.task_id, elapsed / 60, now, false, logId);
            }
            next.timer = {
                ...timer,
                window_started_at: windowStartedAt(timer),
                task_id: taskId,
                planned_secs: remainder,
                accumulated_secs: 0,
                started_at: now.toISOString(),
                ends_at: timer.paused ? addSeconds(now, remainder) : timer.ends_at,
                paused_remaining_secs: timer.paused ? remainder : 0,
            };
        }
    }
    next.active_task = taskId;
    return { state: next, value: undefined };
}

/** Rust: delete_task */
export function deleteTask(state: AppStateData, taskId: string): EngineResult<void> {
    const next = cloneAppState(state);
    taskOrThrow(next, taskId);
    delete next.tasks[taskId];
    if (next.active_task === taskId) next.active_task = null;
    return { state: next, value: undefined };
}

/** Rust: archive_task */
export function archiveTask(state: AppStateData, taskId: string): EngineResult<Task> {
    const next = cloneAppState(state);
    const task = taskOrThrow(next, taskId);
    task.archived = true;
    return { state: next, value: { ...task } };
}

/** Rust: finalize_task */
export function finalizeTask(state: AppStateData, taskId: string, now: Date, logId: string): EngineResult<Task> {
    let next = cloneAppState(state);
    taskOrThrow(next, taskId);
    const timer = next.timer;
    if (timer?.task_id === taskId && timer.kind === "Work") {
        if (windowRemainingSecs(timer, now) <= 0 || (!timer.paused && now.getTime() >= Date.parse(timer.ends_at))) {
            next = completeTimer(next, now, logId).state;
        } else if (elapsedTimerSecs(timer, now) > 0) {
            next = stopWorkTimer(next, now, logId).state;
        } else next.timer = null;
    }
    const task = taskOrThrow(next, taskId);
    if (task.completed_at === null) task.completed_at = now.toISOString();
    task.archived = true;
    if (next.active_task === taskId) next.active_task = null;
    return { state: next, value: { ...task } };
}

/** Rust: set_task_target */
export function setTaskTarget(state: AppStateData, taskId: string, target: number): EngineResult<Task> {
    const next = cloneAppState(state);
    const task = taskOrThrow(next, taskId);
    task.target_pomodoros = normalizePositiveInteger(target);
    return { state: next, value: { ...task } };
}
