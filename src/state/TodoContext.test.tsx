import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { Todo } from "../lib/todos";
import { makeAppState } from "../test/mockTauri";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { TodoProvider, useTodos } from "./TodoContext";

const OWNER = "owner-1";
function todo(id: string, title = id): Todo {
    return { id, title, rule: { type: "one-off", date: "2026-08-12" }, dueDate: "2026-08-12",
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
});
