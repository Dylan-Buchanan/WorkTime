import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isValidRule, normalizeRule } from "../lib/todos";
import type { NewTodoInput, Todo, TodoRule } from "../lib/todos";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";

export interface TodoState {
    todos: Record<string, Todo>;
    ui: { selected: string | null };
    meta: { initializedAt: string };
}

export interface TodoContextValue {
    state: TodoState;
    hydrated: boolean;
    createTodo(input: NewTodoInput): Todo;
    updateTodo(id: string, patch: Partial<Todo>): void;
    archiveTodo(id: string, archive?: boolean): void;
    deleteTodo(id: string): void;
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
    return { todos: {}, ui: { selected: null }, meta: { initializedAt: isoNow() } };
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
        position: Number.isFinite(Number(value.position)) ? Number(value.position) : 0,
        isArchived: Boolean(value.isArchived),
        createdAt,
        updatedAt: typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt,
    };
}
function applyLoaded(loaded: Todo[] | null, selected: string | null): TodoState {
    const state = defaultState();
    for (const candidate of loaded ?? []) {
        const todo = normalizeTodo(candidate);
        if (todo) state.todos[todo.id] = todo;
    }
    state.ui.selected = selected && state.todos[selected] ? selected : null;
    return state;
}
function serialize(todos: Record<string, Todo>): string { return JSON.stringify(Object.values(todos)); }

const TodoContext = createContext<TodoContextValue | undefined>(undefined);

export const TodoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const { initialized, revision, sync } = useSync();
    const [state, setState] = useState<TodoState>(defaultState);
    const [hydrated, setHydrated] = useState(false);
    const stateRef = useRef(state);
    const lastSavedRef = useRef<string | null>(null);
    const pendingRef = useRef<string | null>(null);
    const suppressSaveRef = useRef(false);
    const lastReloadRef = useRef<string | null>(null);

    useLayoutEffect(() => { stateRef.current = state; }, [state]);

    const readSelected = useCallback((): string | null => {
        try {
            const raw = window.localStorage.getItem(LS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return isRecord(parsed) && typeof parsed.selected === "string" ? parsed.selected : null;
        } catch { return null; }
    }, []);
    const load = useCallback(async (): Promise<Todo[] | null> => {
        try { return await data.loadTodos(); }
        catch (error) { console.warn("[Todo] failed to load to-dos", error); return null; }
    }, [data]);

    useEffect(() => {
        let cancelled = false;
        void load().then((loaded) => {
            if (cancelled) return;
            const next = applyLoaded(loaded, readSelected());
            lastSavedRef.current = serialize(next.todos);
            suppressSaveRef.current = true;
            setState(next);
            setHydrated(true);
        });
        return () => { cancelled = true; };
    }, [load, readSelected]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const serialized = serialize(state.todos);
        if (suppressSaveRef.current && serialized === lastSavedRef.current) { suppressSaveRef.current = false; return; }
        if (serialized === lastSavedRef.current || serialized === pendingRef.current) return;
        pendingRef.current = serialized;
        void data.saveTodos(Object.values(state.todos)).then(() => {
            if (pendingRef.current === serialized) { lastSavedRef.current = serialized; pendingRef.current = null; }
        }).catch((error) => {
            if (pendingRef.current === serialized) pendingRef.current = null;
            console.warn("[Todo] failed to persist to-dos", error);
        });
    }, [data, hydrated, initialized, revision, state.todos]);

    useEffect(() => {
        if (!hydrated) return;
        try { window.localStorage.setItem(LS_KEY, JSON.stringify({ selected: state.ui.selected })); } catch { /* best effort */ }
    }, [hydrated, state.ui.selected]);

    const reload = useCallback(async () => {
        const loaded = await load();
        const loadedSerialized = JSON.stringify(loaded);
        const currentSerialized = serialize(stateRef.current.todos);
        if (lastSavedRef.current !== null && currentSerialized !== lastSavedRef.current) return;
        if (loadedSerialized === currentSerialized || loadedSerialized === lastReloadRef.current) return;
        const next = applyLoaded(loaded, stateRef.current.ui.selected);
        lastReloadRef.current = loadedSerialized;
        lastSavedRef.current = serialize(next.todos);
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
    const deleteTodo = (id: string) => setState((previous) => {
        if (!previous.todos[id]) return previous;
        const todos = { ...previous.todos }; delete todos[id];
        return { ...previous, todos, ui: { selected: previous.ui.selected === id ? null : previous.ui.selected } };
    });
    const reorderTodos = (ids: string[]) => setState((previous) => {
        const todos = { ...previous.todos };
        ids.forEach((id, position) => { if (todos[id]) todos[id] = { ...todos[id], position, updatedAt: isoNow() }; });
        return { ...previous, todos };
    });
    const setSelectedTodo = (selected: string | null) => setState((previous) => ({ ...previous, ui: { selected } }));
    const refreshTodos = useCallback(async () => { await sync({ reason: "manual" }); await reload(); }, [reload, sync]);

    return <TodoContext.Provider value={{ state, hydrated, createTodo, updateTodo, archiveTodo, deleteTodo, reorderTodos, setSelectedTodo, refreshTodos }}>{children}</TodoContext.Provider>;
};

export function useTodos(): TodoContextValue {
    const context = useContext(TodoContext);
    if (!context) throw new Error("useTodos must be inside TodoProvider");
    return context;
}

export { LS_KEY as TODO_UI_STORAGE_KEY };
