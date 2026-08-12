import { describe, expect, it } from "vitest";
import type { Task } from "../../state/types";
import { completeTodoOccurrence, reconcileTodoTasks } from "./integration";
import type { Todo } from "./types";

const NOW = new Date("2026-08-11T12:00:00.000Z");

function todo(overrides: Partial<Todo> = {}): Todo {
    return {
        id: "td1", title: "Plan release", rule: null, dueDate: null,
        estimate: 1, currentTaskId: "task-1", position: 0, isArchived: false,
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: "task-1", name: "Plan release", target_pomodoros: 1,
        completed_pomodoros: 0, completed_at: null, break_skips: 0, archived: false,
        created_at: "2026-08-01T00:00:00.000Z", ...overrides,
    };
}

describe("to-do pomodoro integration", () => {
    it("rolls a recurring occurrence and clears its task link", () => {
        const result = completeTodoOccurrence(todo({ rule: { type: "weekly", weekdays: [3] }, dueDate: "2026-08-05" }), NOW);
        expect(result).toMatchObject({ dueDate: "2026-08-12", currentTaskId: null, isArchived: false });
    });

    it("archives a one-time occurrence", () => {
        expect(completeTodoOccurrence(todo(), NOW)).toMatchObject({ currentTaskId: null, isArchived: true });
    });

    it("reconciles terminal tasks once and clears stale task references", () => {
        const completed = reconcileTodoTasks({ td1: todo() }, { "task-1": task({ archived: true }) }, NOW);
        expect(completed.changed).toBe(true);
        expect(completed.todos.td1).toMatchObject({ currentTaskId: null, isArchived: true });
        expect(reconcileTodoTasks(completed.todos, { "task-1": task({ archived: true }) }, NOW).changed).toBe(false);

        const stale = reconcileTodoTasks({ td1: todo({ currentTaskId: "missing" }) }, {}, NOW);
        expect(stale.todos.td1).toMatchObject({ currentTaskId: null, isArchived: false });
    });
});
