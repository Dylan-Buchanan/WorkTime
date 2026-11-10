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
        <span data-testid="description">{id ? state.todos[id].description : ""}</span>
        <button onClick={() => createTodo({ title: "Notes", description: "  Context\nDetails  " })}>create-notes</button>
        <button onClick={() => updateTodo(id, { description: " Updated " })}>edit-notes</button>
        <button onClick={() => updateTodo(id, { description: "  \n " })}>clear-notes</button>

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
        <span data-testid="todo-completions">{Object.keys(todos.state.completions).length}</span>
        <span data-testid="timer-task">{app.state?.timer?.task_id ?? ""}</span>
        <span data-testid="action-error">{actionError}</span>
        <button onClick={() => todo && void todos.startPomodoro(todo.id).catch((error) => setActionError(error.message))}>start-todo</button>
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

async function agendaContext(data: InMemoryDataAccess) {
    let currentTodos: ReturnType<typeof useTodos> | undefined;
    let currentApp: ReturnType<typeof useAppState> | undefined;
    function AgendaProbe() {
        currentTodos = useTodos();
        currentApp = useAppState();
        return null;
    }
    render(<TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}>
        <AppStateProvider><TodoProvider><AgendaProbe /></TodoProvider></AppStateProvider>
    </SyncProvider></DataProvider></TauriCloseProvider>);
    await waitFor(() => {
        expect(currentTodos?.hydrated).toBe(true);
        expect(currentApp?.state).toBeTruthy();
        expect(currentTodos?.state.todos.td1).toBeTruthy();
    });
    return { todos: () => currentTodos!, app: () => currentApp! };
}

describe("TodoContext agenda completion", () => {
    it.each([false, true])("defers a running linked finalize, completes one occurrence and cleans up after natural Work completion (recurring=%s)", async recurring => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 12, 9));
        try {
            const data = new InMemoryDataAccess(makeAppState());
            const task = (await data.createTask("Agenda work", 2)).value;
            await data.setActiveTask(task.id);
            await data.startWorkTimer();
            const original = structuredClone(data.store.state.timer!);
            await data.saveTodos([{ ...todo("td1"), currentTaskId: task.id,
                ...(recurring ? { rule: { type: "weekly" as const, weekdays: [3, 5] } } : {}) }], []);
            const context = await agendaContext(data);
            await act(async () => expect(await context.todos().completeTodoFromAgenda("td1")).toBe("deferred"));
            const stored = await data.loadTodos();
            expect(stored.completions).toHaveLength(1);
            expect(stored.completions[0]).toMatchObject({ todoId: "td1", bucket: "2026-08-12" });
            expect(stored.todos[0]).toMatchObject({ currentTaskId: null, isArchived: !recurring,
                dueDate: recurring ? "2026-08-14" : "2026-08-12" });
            expect(data.store.state.timer).toEqual(original);
            expect(data.store.state.tasks[task.id].completed_at).toBeNull();
            expect(context.todos().deferredTodoTasks).toEqual({ td1: task.id });
            expect(context.app().pendingFinalizeTaskIds).toEqual([task.id]);

            vi.setSystemTime(new Date(original.ends_at));
            await waitFor(() => expect(data.store.state.tasks[task.id].completed_at).toEqual(expect.any(String)), { timeout: 2500 });
            await waitFor(() => expect(context.todos().deferredTodoTasks).toEqual({}));
            expect(data.store.state.tasks[task.id].archived).toBe(true);
            expect(data.store.state.timer).toMatchObject({ kind: "ShortBreak", task_id: task.id });
            expect((await data.loadTodos()).completions).toEqual(stored.completions);
            expect((await data.loadTodos()).todos[0]).toEqual(stored.todos[0]);
        } finally { vi.useRealTimers(); }
    });

    it("completes immediately with one completion when no currentTaskId exists", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([todo("td1")], []);
        const context = await agendaContext(data);
        await act(async () => expect(await context.todos().completeTodoFromAgenda("td1")).toBe("completed"));
        expect((await data.loadTodos()).completions).toHaveLength(1);
        expect((await data.loadTodos()).todos[0].isArchived).toBe(true);
        expect(context.todos().deferredTodoTasks).toEqual({});
        expect(data.store.state.timer).toBeNull();
    });

    it("finalizes a linked task immediately while leaving its owned break unchanged", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const task = (await data.createTask("Break owner", 2)).value;
        await data.setActiveTask(task.id);
        await data.startBreakTimer();
        const original = structuredClone(data.store.state.timer);
        await data.saveTodos([{ ...todo("td1"), currentTaskId: task.id }], []);
        const context = await agendaContext(data);
        await act(async () => expect(await context.todos().completeTodoFromAgenda("td1")).toBe("completed"));
        expect(data.store.state.timer).toEqual(original);
        expect(data.store.state.tasks[task.id]).toMatchObject({ completed_at: expect.any(String), archived: true });
        expect((await data.loadTodos()).completions).toHaveLength(1);
        expect(context.todos().deferredTodoTasks).toEqual({});
    });

    it("keeps the existing completeTodo guard for a running linked task", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const task = (await data.createTask("Running", 2)).value;
        await data.setActiveTask(task.id);
        await data.startWorkTimer();
        await data.saveTodos([{ ...todo("td1"), currentTaskId: task.id }], []);
        const context = await agendaContext(data);
        await act(async () => {
            await expect(context.todos().completeTodo("td1")).rejects.toThrow("Stop or skip the active timer before completing this to-do");
        });
        expect((await data.loadTodos()).completions).toHaveLength(0);
        expect(context.todos().deferredTodoTasks).toEqual({});
        expect(data.store.state.tasks[task.id].completed_at).toBeNull();
    });
});

describe("TodoContext", () => {
    it("normalizes, persists and clears descriptions", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const load = vi.spyOn(data, "loadTodos");
        const view = render(wrap(data));
        await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
        await act(async () => screen.getByText("create-notes").click());
        await waitFor(async () => expect((await data.loadTodos()).todos[0]?.description).toBe("Context\nDetails"));
        await act(async () => screen.getByText("edit-notes").click());
        await waitFor(async () => expect((await data.loadTodos()).todos[0].description).toBe("Updated"));
        view.unmount();
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("description")).toHaveTextContent("Updated"));
        await act(async () => screen.getByText("clear-notes").click());
        await waitFor(async () => expect((await data.loadTodos()).todos[0].description).toBe(""));
    });

    it("hydrates staged to-dos and restores only local selection", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveTodos([todo("td1", "Hydrated")], []);
        localStorage.setItem("todo_state_v1", JSON.stringify({ selected: "td1" }));
        render(wrap(data));
        await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("Hydrated"));
        expect(screen.getByTestId("selected")).toHaveTextContent("td1");
        expect(screen.getByTestId("description").textContent).toBe("");
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
        await data.saveTodos([todo("td1", "Integrated")], []);
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
        expect(screen.getByTestId("todo-completions")).toHaveTextContent("1");
    });

    it("reconciles a linked archived task after hydration", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const created = await data.createTask("Interrupted", 1);
        await data.archiveTask(created.value.id);
        await data.saveTodos([todo("td1", "Interrupted")], []);
        const saved = await data.loadTodos();
        await data.saveTodos([{ ...saved.todos[0], currentTaskId: created.value.id }], []);

        render(wrapIntegration(data));
        await waitFor(() => expect(screen.getByTestId("todo-archived")).toHaveTextContent("true"));
        expect(screen.getByTestId("todo-link")).toHaveTextContent("");
        expect(screen.getByTestId("todo-completions")).toHaveTextContent("1");
    });
});


describe("to-do start occupation", () => {
    it.each(["Work", "ShortBreak"] as const)("joins work or refuses a break from the to-do path: %s", async kind => {
        const data = new InMemoryDataAccess(makeAppState());
        const running = (await data.createTask("Running", 2)).value;
        await data.setActiveTask(running.id);
        if (kind === "Work") await data.startWorkTimer();
        else await data.startBreakTimer();
        const original = data.store.state.timer!;
        await data.saveTodos([todo("td1", "Second path")], []);
        render(wrapIntegration(data));
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent(running.id));
        await act(async () => screen.getByText("start-todo").click());
        if (kind === "Work") {
            await waitFor(() => expect(screen.getByTestId("todo-link").textContent).not.toBe(""));
            expect(data.store.state.timer?.task_id).toBe(screen.getByTestId("todo-link").textContent);
            expect(data.store.state.timer?.ends_at).toBe(original.ends_at);
            expect(screen.getByTestId("action-error")).toBeEmptyDOMElement();
        } else {
            await waitFor(() => expect(screen.getByTestId("action-error")).toHaveTextContent("A break is running"));
            expect(data.store.state.timer).toEqual(original);
            expect(screen.getByTestId("todo-link")).toBeEmptyDOMElement();
        }
    });
});
