import type { AppStateData, Settings, Task } from "../../state/types";
import {
    cloneAppState,
    defaultAppState,
    EngineResult,
    normalizePositiveInteger,
} from "./core";
import type { InProgressPomodoroMap } from "./pomodoroProgress";

/** Rust: get_state */
export function getState(state: AppStateData): EngineResult<boolean> {
    const next = cloneAppState(state);
    let mutated = false;

    for (const task of Object.values(next.tasks)) {
        if (task.completed_at !== null && !task.archived) {
            task.archived = true;
            mutated = true;
        }
    }

    if (next.active_task !== null && next.tasks[next.active_task]?.archived) {
        next.active_task = null;
        mutated = true;
    }

    return { state: next, value: mutated };
}

/** Rust: create_task */
export function createTask(
    state: AppStateData,
    name: string,
    targetPomodoros: number,
    now: Date,
    taskId: string,
): EngineResult<Task> {
    const next = cloneAppState(state);
    const task: Task = {
        id: taskId,
        name,
        target_pomodoros: normalizePositiveInteger(targetPomodoros),
        completed_pomodoros: 0,
        created_at: now.toISOString(),
        completed_at: null,
        break_skips: 0,
        archived: false,
    };
    next.tasks[taskId] = task;
    return { state: next, value: { ...task } };
}

/** Rust: update_settings */
export function updateSettings(state: AppStateData, settings: Settings): EngineResult<Settings> {
    const next = cloneAppState(state);
    next.settings = { ...settings };
    return { state: next, value: { ...next.settings } };
}

/** Rust: reset_app_state */
export function resetAppState(
    _state: AppStateData,
    _inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<AppStateData> {
    const next = defaultAppState();
    return { state: next, value: cloneAppState(next), inProgressPomodoros: {} };
}
