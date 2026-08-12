import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { completeTodoOccurrence, createTodoCompletion, isValidRule, normalizeRule, normalizeTodoEstimate, reconcileTodoTasks, todoCompletionBucket } from "../lib/todos";
import type { NewTodoInput, Todo, TodoCompletion, TodoRule } from "../lib/todos";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import { useOptionalAppState } from "./AppStateContext";

export interface TodoState {
    todos: Record<string, Todo>;
    completions: Record<string, TodoCompletion>;
    ui: { selected: string | null };
    meta: { initializedAt: string };
}

export interface TodoContextValue {
    state: TodoState;
    hydrated: boolean;
    createTodo(input: NewTodoInput): Todo;
    updateTodo(id: string, patch: Partial<Todo>): void;
    archiveTodo(id: string, archive?: boolean): void;
    completeTodo(id: string): Promise<void>;
    startPomodoro(id: string): Promise<void>;
    deleteTodo(id: string): Promise<void>;
    reorderTodos(idsInOrder: string[]): void;
    setSelectedTodo(id: string | null): void;
    refreshTodos(): Promise<void>;
}

const LS_KEY = "todo_state_v1";

function isoNow(): string { return new Date().toISOString(); }
function uuid(): string {
    try { return globalThis.crypto?.randomUUID?.() ?? fallbackUuid(); } catch { return fallbackUuid(); }
}
function fallbackUuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function defaultState(): TodoState {
    return { todos: {}, completions: {}, ui: { selected: null }, meta: { initializedAt: isoNow() } };
}
function normalizeTodo(value: unknown): Todo | null {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
    const createdAt = typeof value.createdAt === "string" && value.createdAt ? value.createdAt : isoNow();
    const candidateRule = value.rule as TodoRule | null | undefined;
    const rule = candidateRule && isValidRule(candidateRule) ? normalizeRule(candidateRule) : null;
    return {
        id: value.id,
        title: typeof value.title === "string" ? value.title : "Untitled to-do",
        rule,
        dueDate: typeof value.dueDate === "string" ? value.dueDate as Todo["dueDate"] : null,
        estimate: normalizeTodoEstimate(value.estimate),
        currentTaskId: typeof value.currentTaskId === "string" && value.currentTaskId ? value.currentTaskId : null,
        position: Number.isFinite(Number(value.position)) ? Number(value.position) : 0,
        isArchived: Boolean(value.isArchived),
        createdAt,
        updatedAt: typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt,
    };
}
function applyLoaded(loaded: { todos: Todo[]; completions: TodoCompletion[] } | null, selected: string | null): TodoState {
    const state = defaultState();
    for (const candidate of loaded?.todos ?? []) {
        const todo = normalizeTodo(candidate);
        if (todo) state.todos[todo.id] = todo;
    }
    for (const completion of loaded?.completions ?? []) {
        if (completion?.id && completion.todoId && completion.bucket && state.todos[completion.todoId]) {
            state.completions[completion.id] = completion;
        }
    }
    state.ui.selected = selected && state.todos[selected] ? selected : null;
    return state;
}
function serialize(todos: Record<string, Todo>, completions: Record<string, TodoCompletion>): string {
    return JSON.stringify({ todos: Object.values(todos), completions: Object.values(completions) });
}

const TodoContext = createContext<TodoContextValue | undefined>(undefined);

export const TodoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const app = useOptionalAppState();
    const { initialized, revision, sync } = useSync();
    const [state, setState] = useState<TodoState>(defaultState);
    const [hydrated, setHydrated] = useState(false);
    const stateRef = useRef(state);
    const lastSavedRef = useRef<string | null>(null);
    const pendingRef = useRef<string | null>(null);
    const suppressSaveRef = useRef(false);
    const lastReloadRef = useRef<string | null>(null);

    useLayoutEffect(() => { stateRef.current = state; }, [state]);

    const commitTodos = useCallback(async (todos: Record<string, Todo>, completions = stateRef.current.completions, selected = stateRef.current.ui.selected) => {
        const serialized = serialize(todos, completions);
        pendingRef.current = serialized;
        const nextState = { ...stateRef.current, todos, completions, ui: { selected: selected && todos[selected] ? selected : null } };
        stateRef.current = nextState;
        setState(nextState);
        try {
            await data.saveTodos(Object.values(todos), Object.values(completions));
            if (pendingRef.current === serialized) {
                lastSavedRef.current = serialized;
                pendingRef.current = null;
            }
        } catch (error) {
            if (pendingRef.current === serialized) pendingRef.current = null;
            throw error;
        }
    }, [data]);

    const readSelected = useCallback((): string | null => {
        try {
            const raw = window.localStorage.getItem(LS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return isRecord(parsed) && typeof parsed.selected === "string" ? parsed.selected : null;
        } catch { return null; }
    }, []);
    const load = useCallback(async (): Promise<{ todos: Todo[]; completions: TodoCompletion[] } | null> => {
        try { return await data.loadTodos(); }
        catch (error) { console.warn("[Todo] failed to load to-dos", error); return null; }
    }, [data]);

    useEffect(() => {
        let cancelled = false;
        void load().then((loaded) => {
            if (cancelled) return;
            const next = applyLoaded(loaded, readSelected());
            lastSavedRef.current = serialize(next.todos, next.completions);
            suppressSaveRef.current = true;
            setState(next);
            setHydrated(true);
        });
        return () => { cancelled = true; };
    }, [load, readSelected]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const serialized = serialize(state.todos, state.completions);
        if (suppressSaveRef.current && serialized === lastSavedRef.current) { suppressSaveRef.current = false; return; }
        if (serialized === lastSavedRef.current || serialized === pendingRef.current) return;
        pendingRef.current = serialized;
        void data.saveTodos(Object.values(state.todos), Object.values(state.completions)).then(() => {
            if (pendingRef.current === serialized) { lastSavedRef.current = serialized; pendingRef.current = null; }
        }).catch((error) => {
            if (pendingRef.current === serialized) pendingRef.current = null;
            console.warn("[Todo] failed to persist to-dos", error);
        });
    }, [data, hydrated, initialized, revision, state.completions, state.todos]);

    useEffect(() => {
        if (!hydrated) return;
        try { window.localStorage.setItem(LS_KEY, JSON.stringify({ selected: state.ui.selected })); } catch { /* best effort */ }
    }, [hydrated, state.ui.selected]);

    const reload = useCallback(async () => {
        const loaded = await load();
        const loadedSerialized = JSON.stringify(loaded);
        const currentSerialized = serialize(stateRef.current.todos, stateRef.current.completions);
        if (lastSavedRef.current !== null && currentSerialized !== lastSavedRef.current) return;
        if (loadedSerialized === currentSerialized || loadedSerialized === lastReloadRef.current) return;
        const next = applyLoaded(loaded, stateRef.current.ui.selected);
        lastReloadRef.current = loadedSerialized;
        lastSavedRef.current = serialize(next.todos, next.completions);
        suppressSaveRef.current = true;
        setState(next);
    }, [load]);
    useEffect(() => { if (hydrated) void reload(); }, [hydrated, reload, revision]);

    const createTodo = (input: NewTodoInput): Todo => {
        const timestamp = isoNow();
        const position = input.position ?? Object.values(state.todos).reduce((max, todo) => Math.max(max, todo.position), -1) + 1;
        const rule = input.rule ? normalizeRule(input.rule) : null;
        const todo: Todo = {
            id: uuid(), title: input.title.trim() || "Untitled to-do", rule,
            dueDate: input.dueDate ?? (rule?.type === "one-off" ? rule.date as Todo["dueDate"] : null),
            estimate: normalizeTodoEstimate(input.estimate), currentTaskId: null,
            position, isArchived: false, createdAt: timestamp, updatedAt: timestamp,
        };
        setState((previous) => ({ ...previous, todos: { ...previous.todos, [todo.id]: todo } }));
        return todo;
    };
    const updateTodo = (id: string, patch: Partial<Todo>) => setState((previous) => {
        const current = previous.todos[id];
        if (!current) return previous;
        return { ...previous, todos: { ...previous.todos, [id]: { ...current, ...patch, id, updatedAt: isoNow() } } };
    });
    const archiveTodo = (id: string, archive = true) => updateTodo(id, { isArchived: archive });
    const archiveLinkedTaskIfExists = useCallback(async (taskId: string) => {
        try { await data.archiveTask(taskId); }
        catch (error) {
            if (error instanceof Error && error.message.includes("Task not found")) return;
            throw error;
        }
    }, [data]);
    const completedOccurrenceState = useCallback((todo: Todo, at: Date) => {
        const bucket = todoCompletionBucket(todo);
        const completions = { ...stateRef.current.completions };
        if (!Object.values(completions).some((completion) => completion.todoId === todo.id && completion.bucket === bucket)) {
            const completion = createTodoCompletion(todo, at, uuid());
            completions[completion.id] = completion;
        }
        return {
            todos: { ...stateRef.current.todos, [todo.id]: completeTodoOccurrence(todo, at) },
            completions,
        };
    }, []);
    const completeTodo = useCallback(async (id: string) => {
        const todo = stateRef.current.todos[id];
        if (!todo || todo.isArchived) return;
        const linkedTaskId = todo.currentTaskId;
        if (linkedTaskId && app?.state?.timer?.task_id === linkedTaskId) {
            throw new Error("Stop or skip the active timer before completing this to-do");
        }
        const completed = completedOccurrenceState(todo, new Date());
        await commitTodos(completed.todos, completed.completions);
        if (linkedTaskId) await archiveLinkedTaskIfExists(linkedTaskId);
    }, [app, archiveLinkedTaskIfExists, commitTodos, completedOccurrenceState]);
    const completeTodoForTask = useCallback(async (taskId: string) => {
        const todo = Object.values(stateRef.current.todos)
            .find((candidate) => !candidate.isArchived && candidate.currentTaskId === taskId);
        if (!todo) return;
        const completed = completedOccurrenceState(todo, new Date());
        await commitTodos(completed.todos, completed.completions);
    }, [commitTodos, completedOccurrenceState]);
    const startPomodoro = useCallback(async (id: string) => {
        let todo = stateRef.current.todos[id];
        if (!todo || todo.isArchived) throw new Error("To-do is no longer active");
        if (app?.state?.timer) throw new Error("A timer is already running");

        let task = todo.currentTaskId ? app?.state?.tasks[todo.currentTaskId] : null;
        if (task && (task.archived || task.completed_at !== null)) {
            await completeTodoForTask(task.id);
            todo = stateRef.current.todos[id];
            if (!todo || todo.isArchived) throw new Error("This to-do occurrence is already complete");
            task = null;
        }
        if (!task) {
            if (!app) throw new Error("Pomodoro state is unavailable");
            task = await app.createTask(todo.title, todo.estimate);
            const linked = { ...todo, currentTaskId: task.id, updatedAt: isoNow() };
            await commitTodos({ ...stateRef.current.todos, [id]: linked });
        }
        await app!.startTaskWork(task.id);
    }, [app, commitTodos, completeTodoForTask]);
    const deleteTodo = useCallback(async (id: string) => {
        const todo = stateRef.current.todos[id];
        if (!todo) return;
        if (todo.currentTaskId && app?.state?.timer?.task_id === todo.currentTaskId) {
            throw new Error("Stop or skip the active timer before deleting this to-do");
        }
        const todos = { ...stateRef.current.todos };
        delete todos[id];
        const completions = Object.fromEntries(Object.entries(stateRef.current.completions)
            .filter(([, completion]) => completion.todoId !== id));
        await commitTodos(todos, completions, stateRef.current.ui.selected === id ? null : stateRef.current.ui.selected);
        if (todo.currentTaskId) await archiveLinkedTaskIfExists(todo.currentTaskId);
    }, [app?.state?.timer, archiveLinkedTaskIfExists, commitTodos]);
    const reorderTodos = (ids: string[]) => setState((previous) => {
        const todos = { ...previous.todos };
        ids.forEach((id, position) => { if (todos[id]) todos[id] = { ...todos[id], position, updatedAt: isoNow() }; });
        return { ...previous, todos };
    });
    const setSelectedTodo = (selected: string | null) => setState((previous) => ({ ...previous, ui: { selected } }));
    const refreshTodos = useCallback(async () => { await sync({ reason: "manual" }); await reload(); }, [reload, sync]);

    useEffect(() => {
        if (!app) return;
        return app.subscribeTaskCompletions((taskId) => { void completeTodoForTask(taskId); });
    }, [app, completeTodoForTask]);

    useEffect(() => {
        if (!hydrated || !app?.state) return;
        const before = stateRef.current.todos;
        const at = new Date();
        const result = reconcileTodoTasks(before, app.state.tasks, at);
        if (!result.changed) return;
        let completions = stateRef.current.completions;
        for (const todo of Object.values(before)) {
            const task = todo.currentTaskId ? app.state.tasks[todo.currentTaskId] : null;
            if (!todo.isArchived && task && (task.archived || task.completed_at !== null)) {
                const bucket = todoCompletionBucket(todo);
                if (!Object.values(completions).some((completion) => completion.todoId === todo.id && completion.bucket === bucket)) {
                    const completion = createTodoCompletion(todo, at, uuid());
                    completions = { ...completions, [completion.id]: completion };
                }
            }
        }
        void commitTodos(result.todos, completions);
    }, [app?.state, commitTodos, hydrated]);

    return <TodoContext.Provider value={{ state, hydrated, createTodo, updateTodo, archiveTodo, completeTodo, startPomodoro, deleteTodo, reorderTodos, setSelectedTodo, refreshTodos }}>{children}</TodoContext.Provider>;
};

export function useTodos(): TodoContextValue {
    const context = useContext(TodoContext);
    if (!context) throw new Error("useTodos must be inside TodoProvider");
    return context;
}

export function useOptionalTodos(): TodoContextValue | undefined {
    return useContext(TodoContext);
}

export { LS_KEY as TODO_UI_STORAGE_KEY };
