import type { Task } from "../../state/types";

/**
 * Owner-local elapsed seconds saved before a task's current active work
 * segment, or the full saved position while that task is inactive.
 */
export type InProgressPomodoroMap = Record<string, number>;

export function cloneInProgressPomodoros(progress: InProgressPomodoroMap): InProgressPomodoroMap {
    return { ...progress };
}

export function withoutInProgressPomodoro(
    progress: InProgressPomodoroMap,
    taskId: string,
): InProgressPomodoroMap {
    const next = cloneInProgressPomodoros(progress);
    delete next[taskId];
    return next;
}

export function resumablePomodoroElapsedSecs(
    progress: InProgressPomodoroMap,
    taskId: string,
    workSecs: number,
): number {
    const elapsed = progress[taskId];
    return Number.isInteger(elapsed) && elapsed > 0 && elapsed < workSecs ? elapsed : 0;
}

export function pruneInProgressPomodoros(
    progress: InProgressPomodoroMap,
    tasks: Record<string, Task>,
): InProgressPomodoroMap {
    const next: InProgressPomodoroMap = {};
    for (const [taskId, elapsed] of Object.entries(progress)) {
        const task = tasks[taskId];
        if (
            task &&
            !task.archived &&
            task.completed_at === null &&
            Number.isInteger(elapsed) &&
            elapsed >= 0
        ) {
            next[taskId] = elapsed;
        }
    }
    return next;
}
