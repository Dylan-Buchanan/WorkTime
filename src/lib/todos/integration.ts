import type { Task } from "../../state/types";
import { localDateKey } from "./calendar";
import { nextOccurrence } from "./recurrence";
import type { LocalDateKey, Todo } from "./types";

export function normalizeTodoEstimate(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : 1;
}

/** Completes exactly one occurrence and severs its task link. */
export function completeTodoOccurrence(todo: Todo, now: Date, updatedAt = now.toISOString()): Todo {
    // A one-off rule describes the current occurrence, even when work finishes
    // before its due date. Only recurring rules can produce a successor.
    const next = todo.rule && todo.rule.type !== "one-off" ? nextOccurrence(todo.rule, now) : null;
    return {
        ...todo,
        dueDate: next ? localDateKey(next) as LocalDateKey : todo.dueDate,
        currentTaskId: null,
        isArchived: next ? false : true,
        updatedAt,
    };
}

export interface TodoTaskReconciliation {
    todos: Record<string, Todo>;
    changed: boolean;
}

/**
 * Heals task/to-do writes that were interrupted or arrived from another tab.
 * Missing task ids are stale references and are cleared without completing the
 * occurrence. Archived/completed tasks complete the linked occurrence once.
 */
export function reconcileTodoTasks(
    todos: Record<string, Todo>,
    tasks: Record<string, Task>,
    now: Date,
): TodoTaskReconciliation {
    let changed = false;
    const reconciled = { ...todos };
    for (const todo of Object.values(todos)) {
        if (todo.isArchived || !todo.currentTaskId) continue;
        const task = tasks[todo.currentTaskId];
        if (!task) {
            reconciled[todo.id] = { ...todo, currentTaskId: null, updatedAt: now.toISOString() };
            changed = true;
        } else if (task.archived || task.completed_at !== null) {
            reconciled[todo.id] = completeTodoOccurrence(todo, now);
            changed = true;
        }
    }
    return { todos: reconciled, changed };
}
