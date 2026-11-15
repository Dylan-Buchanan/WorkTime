import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgingTodosBanner } from "./AgingTodosBanner";
import type { Todo, TodoCompletion } from "../lib/todos";
import { todoCompletionBucket } from "../lib/todos/integration";
import {
    AGING_TODO_DISMISSAL_STORAGE_KEY,
    dismissAgingTodo,
    getAgingTodoDismissals,
} from "../lib/todos/agingTodoDismissals";

const NOW = new Date(2026, 8, 20, 10, 0, 0);

function createdAtDaysBefore(days: number): string {
    return new Date(2026, 8, 20 - days, 9, 0, 0).toISOString();
}

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
    return {
        id,
        title: `To-do ${id}`,
        rule: null,
        dueDate: null,
        estimate: 1,
        currentTaskId: null,
        position: 0,
        isArchived: false,
        createdAt: createdAtDaysBefore(7),
        updatedAt: createdAtDaysBefore(7),
        ...overrides,
    };
}

function todoMap(todos: Todo[]): Record<string, Todo> {
    return Object.fromEntries(todos.map((todo) => [todo.id, todo]));
}

function completionMap(completions: TodoCompletion[]): Record<string, TodoCompletion> {
    return Object.fromEntries(completions.map((completion) => [completion.id, completion]));
}

function completionFor(todo: Todo): TodoCompletion {
    return {
        id: `completion-${todo.id}`,
        todoId: todo.id,
        bucket: todoCompletionBucket(todo),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
    };
}

function renderBanner(todos: Todo[], options: { enabled?: boolean; completions?: TodoCompletion[] } = {}) {
    return render(
        <AgingTodosBanner
            todos={todoMap(todos)}
            completions={completionMap(options.completions ?? [])}
            enabled={options.enabled ?? true}
        />,
    );
}

const dismissButton = () => screen.getByRole("button", { name: "Dismiss aging to-dos banner" });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("AgingTodosBanner", () => {
    it("stays hidden through day 6 and appears on day 7", () => {
        const sixDays = makeTodo("six", { createdAt: createdAtDaysBefore(6) });
        const { unmount } = renderBanner([sixDays]);
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
        unmount();

        renderBanner([makeTodo("seven", { createdAt: createdAtDaysBefore(7) })]);
        expect(screen.getByRole("region", { name: "Aging to-dos" })).toBeVisible();
        expect(screen.getByText("1 to-do has no due date and is getting stale")).toBeVisible();
    });

    it("combines qualifying to-dos into one banner with a few titles", () => {
        renderBanner([
            makeTodo("a", { title: "Oldest", createdAt: createdAtDaysBefore(10) }),
            makeTodo("b", { title: "Second", createdAt: createdAtDaysBefore(9) }),
            makeTodo("c", { title: "Third", createdAt: createdAtDaysBefore(8) }),
            makeTodo("d", { title: "Fourth", createdAt: createdAtDaysBefore(7) }),
        ]);

        expect(screen.getAllByRole("region", { name: "Aging to-dos" })).toHaveLength(1);
        expect(screen.getByText("4 to-dos have no due date and are getting stale")).toBeVisible();
        expect(screen.getByText('Still open: "Oldest", "Second", "Third" and 1 more')).toBeVisible();
        expect(screen.queryByText("Fourth")).toBeNull();
    });

    it("cannot be confused with the resume card's Dismiss control", () => {
        renderBanner([makeTodo("a")]);
        expect(dismissButton()).toBeVisible();
        expect(dismissButton()).toHaveAccessibleName("Dismiss aging to-dos banner");
        expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    });

    it("hides immediately on dismiss and stays hidden across a remount on the same day", () => {
        const todo = makeTodo("a");
        const first = renderBanner([todo]);
        fireEvent.click(dismissButton());
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
        expect(getAgingTodoDismissals().dismissals["a"]).toBeDefined();
        first.unmount();

        renderBanner([todo]);
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
    });

    it("re-raises on the next creation-anchored cadence day after a dismissal", () => {
        const todo = makeTodo("a", { createdAt: new Date(2026, 8, 13, 9, 0, 0).toISOString() });
        const first = renderBanner([todo]);
        fireEvent.click(dismissButton());
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
        first.unmount();

        vi.setSystemTime(new Date(2026, 8, 21, 10, 0, 0)); // day 8
        const second = renderBanner([todo]);
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
        second.unmount();

        vi.setSystemTime(new Date(2026, 8, 22, 10, 0, 0)); // day 9
        const third = renderBanner([todo]);
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
        third.unmount();

        vi.setSystemTime(new Date(2026, 8, 23, 10, 0, 0)); // day 10
        const fourth = renderBanner([todo]);
        expect(screen.getByTestId("aging-todos-banner")).toBeVisible();
        fourth.unmount();

        vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 0)); // day 11, still raised
        renderBanner([todo]);
        expect(screen.getByTestId("aging-todos-banner")).toBeVisible();
    });

    it("honours a dismissal recorded on day 8 by returning on day 10", () => {
        const todo = makeTodo("a", { createdAt: new Date(2026, 8, 13, 9, 0, 0).toISOString() });
        dismissAgingTodo("a", new Date(2026, 8, 21, 9, 0, 0).toISOString());

        vi.setSystemTime(new Date(2026, 8, 22, 10, 0, 0)); // day 9
        const first = renderBanner([todo]);
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
        first.unmount();

        vi.setSystemTime(new Date(2026, 8, 23, 10, 0, 0)); // day 10
        renderBanner([todo]);
        expect(screen.getByTestId("aging-todos-banner")).toBeVisible();
    });

    it("does not evaluate across a day boundary while the page stays mounted", () => {
        const todo = makeTodo("a", { createdAt: createdAtDaysBefore(6) });
        const view = renderBanner([todo]);
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();

        vi.setSystemTime(new Date(2026, 8, 21, 10, 0, 0)); // the to-do is now seven days old
        view.rerender(
            <AgingTodosBanner todos={todoMap([todo])} completions={completionMap([])} enabled />,
        );
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
    });

    it("ignores dated, archived, and completed to-dos", () => {
        const completed = makeTodo("completed");
        renderBanner(
            [
                makeTodo("undated", { title: "Needs attention" }),
                makeTodo("dated", { dueDate: "2026-09-20" }),
                makeTodo("archived", { isArchived: true }),
                completed,
            ],
            { completions: [completionFor(completed)] },
        );

        expect(screen.getByText("1 to-do has no due date and is getting stale")).toBeVisible();
        expect(screen.getByText('Still open: "Needs attention"')).toBeVisible();
        expect(screen.queryByText("To-do dated")).toBeNull();
        expect(screen.queryByText("To-do archived")).toBeNull();
        expect(screen.queryByText("To-do completed")).toBeNull();
    });

    it("does not evaluate to-dos until it is enabled", () => {
        renderBanner([makeTodo("a")], { enabled: false });
        expect(screen.queryByTestId("aging-todos-banner")).toBeNull();
    });

    it("tolerates corrupt stored dismissals without throwing", () => {
        localStorage.setItem(AGING_TODO_DISMISSAL_STORAGE_KEY, "{not json");
        expect(() => renderBanner([makeTodo("a")])).not.toThrow();
        expect(screen.getByTestId("aging-todos-banner")).toBeVisible();
    });

    it("keeps the banner visible when the dismissal cannot be persisted", () => {
        renderBanner([makeTodo("a")]);
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("storage blocked");
        });
        expect(() => fireEvent.click(dismissButton())).not.toThrow();
        expect(screen.getByTestId("aging-todos-banner")).toBeVisible();
    });

    it("writes only its own surface-local key", () => {
        renderBanner([makeTodo("a")]);
        const writes = vi.spyOn(Storage.prototype, "setItem");
        fireEvent.click(dismissButton());
        expect(writes.mock.calls.length).toBeGreaterThan(0);
        for (const [key] of writes.mock.calls) expect(key).toBe(AGING_TODO_DISMISSAL_STORAGE_KEY);
    });
});
