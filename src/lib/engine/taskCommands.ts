import type { AppStateData, Task } from "../../state/types";
import {
    addSeconds,
    appendLog,
    clampFraction,
    cloneAppState,
    elapsedTimerSecs,
    EngineResult,
    normalizePositiveInteger,
    plannedTimerSecs,
    taskOrThrow,
} from "./core";

/** Rust: set_active_task */
export function setActiveTask(state: AppStateData, taskId: string, now: Date, logId: string): EngineResult<void> {
    const next = cloneAppState(state);
    taskOrThrow(next, taskId);

    const timer = next.timer;
    if (timer && timer.kind === "Work" && timer.task_id !== taskId) {
        const planned = plannedTimerSecs(timer);
        const elapsed = elapsedTimerSecs(timer, now);

        if (elapsed > 0) {
            const workSecs = next.settings.work_minutes * 60;
            const oldTask = next.tasks[timer.task_id];
            if (oldTask && workSecs > 0) {
                oldTask.completed_pomodoros += clampFraction(elapsed / workSecs);
                if (oldTask.completed_pomodoros > oldTask.target_pomodoros) {
                    oldTask.target_pomodoros = Math.ceil(oldTask.completed_pomodoros);
                }
            }
            appendLog(next, timer.task_id, elapsed / 60, now, false, logId);
        }

        const remaining = planned - elapsed;
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
export function finalizeTask(state: AppStateData, taskId: string, now: Date): EngineResult<Task> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (timer?.task_id === taskId && timer.kind === "Work") next.timer = null;

    const task = taskOrThrow(next, taskId);
    if (task.completed_at === null) {
        task.target_pomodoros = Math.ceil(task.completed_pomodoros);
        task.completed_at = now.toISOString();
    }
    task.archived = true;
    if (next.active_task === taskId) next.active_task = null;
    return { state: next, value: { ...task } };
}

/** Rust: set_task_target */
export function setTaskTarget(state: AppStateData, taskId: string, target: number): EngineResult<Task> {
    const next = cloneAppState(state);
    const task = taskOrThrow(next, taskId);
    task.target_pomodoros = normalizePositiveInteger(target);
    if (task.completed_pomodoros > task.target_pomodoros) {
        task.target_pomodoros = Math.ceil(task.completed_pomodoros);
    }
    return { state: next, value: { ...task } };
}
