import type { ActiveTimer, PMTask } from "../../state/types";

export function applyWorkStart(task: PMTask, nowIso: string): PMTask {
    const status = task.status === "Backlog" || task.status === "Next" ? "In Progress" : task.status;
    if (status === task.status && task.waiting == null) return task;
    return { ...task, status, waiting: null, updatedAt: nowIso };
}

export function findPMTaskByAppTaskId(tasks: Readonly<Record<string, PMTask>>, appTaskId: string): PMTask | null {
    const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    return Object.values(tasks)
        .filter((task) => task.appTaskId === appTaskId)
        .sort((a, b) => a.sortOrder - b.sortOrder || compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id))[0] ?? null;
}

export function workOccupantKey(timer: ActiveTimer | null): string | null {
    return timer?.kind === "Work" ? `${timer.task_id}|${timer.window_started_at ?? ""}` : null;
}
