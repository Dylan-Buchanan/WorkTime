import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { Todo } from "../lib/todos";
import { makeAppState } from "../test/mockTauri";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { TodoProvider, useTodos } from "./TodoContext";
import { AppStateProvider, useAppState } from "./AppStateContext";

const OWNER = "owner-1";
function todo(id: string, title = id): Todo {
    return { id, title, rule: { type: "one-off", date: "2026-08-12" }, dueDate: "2026-08-12", estimate: 1, currentTaskId: null,
        position: 0, isArchived: false, createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" };
}
function Probe() {
    const { state, createTodo, updateTodo, deleteTodo, setSelectedTodo } = useTodos();
    const id = Object.keys(state.todos)[0] ?? "";
    return <div>
        <span data-testid="count">{Object.keys(state.todos).length}</span>
        <span data-testid="title">{id ? state.todos[id].title : ""}</span>
        <span data-testid="selected">{state.ui.selected ?? ""}</span>
        <button onClick={() => createTodo({ title: "Created" })}>create</button>
        <button onClick={() => id && updateTodo(id, { title: "Updated" })}>update</button>
        <button onClick={() => id && setSelectedTodo(id)}>select</button>
        <button onClick={() => id && deleteTodo(id)}>delete</button>
    </div>;
}
function wrap(data: InMemoryDataAccess) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}>
        <TodoProvider><Probe /></TodoProvider>
    </SyncProvider></DataProvider></TauriCloseProvider>;
}

function IntegrationProbe() {
    const todos = useTodos();
    const app = useAppState();
    const todo = Object.values(todos.state.todos)[0];
    const [actionError, setActionError] = useState("");
    return <div>
        <span data-testid="todo-archived">{String(todo?.isArchived ?? false)}</span>
        <span data-testid="todo-link">{todo?.currentTaskId ?? ""}</span>
        <span data-testid="timer-task">{app.state?.timer?.task_id ?? ""}</span>
        <span data-testid="action-error">{actionError}</span>
        <button onClick={() => todo && void todos.startPomodoro(todo.id)}>start-todo</button>
        <button onClick={() => todo && void todos.completeTodo(todo.id).catch((error) => setActionError(error.message))}>complete-todo</button>
        <button onClick={() => app.state?.active_task && void app.finalizeTask(app.state.active_task)}>finalize-linked</button>
    </div>;
}
function wrapIntegration(data: InMemoryDataAccess) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}>
        <AppStateProvider><TodoProvider><IntegrationProbe /></TodoProvider></AppStateProvider>
    </SyncProvider></DataProvider></TauriCloseProvider>;
}

beforeEach(() => localStorage.clear());

describe("TodoContext", () => {
    it("hydrates staged to-dos and restores only local selection", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([todo("td1", "Hydrated")]);
        localStorage.setItem("todo_state_v1", JSON.stringify({ selected: "td1" }));
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("Hydrated"));
        expect(screen.getByTestId("selected")).toHaveTextContent("td1");
    });

    it("persists mutations without triggering a sync and reloads revisions without restaging", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const save = vi.spyOn(data, "saveTodos");
        const load = vi.spyOn(data, "loadTodos");
        render(wrap(data));
        await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
        save.mockClear();
        const syncCount = data.syncCalls.length;
        await act(async () => screen.getByText("create").click());
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(data.syncCalls).toHaveLength(syncCount);
        await act(async () => screen.getByText("update").click());
        await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("Updated"));
        await act(async () => screen.getByText("select").click());
        expect(JSON.parse(localStorage.getItem("todo_state_v1")!).selected).toBeTruthy();
        await act(async () => screen.getByText("delete").click());
        await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    });

    it("creates, links, starts, and reverse-completes a to-do pomodoro", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([todo("td1", "Integrated")]);
        render(wrapIntegration(data));
        await waitFor(() => expect(screen.getByTestId("todo-archived")).toHaveTextContent("false"));

        await act(async () => screen.getByText("start-todo").click());
        await waitFor(() => expect(screen.getByTestId("todo-link").textContent).not.toBe(""));
        expect(screen.getByTestId("timer-task").textContent).toBe(screen.getByTestId("todo-link").textContent);
        const linkedId = screen.getByTestId("todo-link").textContent!;
        expect((await data.fetchState()).state.tasks[linkedId]).toMatchObject({ name: "Integrated", target_pomodoros: 1 });

        await act(async () => screen.getByText("complete-todo").click());
        await waitFor(() => expect(screen.getByTestId("action-error")).toHaveTextContent("active timer"));
        expect(screen.getByTestId("todo-link")).toHaveTextContent(linkedId);

        await act(async () => screen.getByText("finalize-linked").click());
        await waitFor(() => expect(screen.getByTestId("todo-archived")).toHaveTextContent("true"));
        expect(screen.getByTestId("todo-link")).toHaveTextContent("");
    });

    it("reconciles a linked archived task after hydration", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const created = await data.createTask("Interrupted", 1);
        await data.archiveTask(created.value.id);
        await data.saveTodos([todo("td1", "Interrupted")]);
        const saved = await data.loadTodos();
        await data.saveTodos([{ ...saved[0], currentTaskId: created.value.id }]);

        render(wrapIntegration(data));
        await waitFor(() => expect(screen.getByTestId("todo-archived")).toHaveTextContent("true"));
        expect(screen.getByTestId("todo-link")).toHaveTextContent("");
    });
});
