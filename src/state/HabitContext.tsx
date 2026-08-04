import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createHabit as makeHabit, createHabitCompletion } from "../lib/habits";
import type { NewHabitInput } from "../lib/habits";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import type { Habit, HabitCompletion, HabitFrequency } from "./types";

export type HabitPeriod = "day" | "week" | "month" | "year";

export interface HabitState {
    habits: Record<string, Habit>;
    completions: Record<string, HabitCompletion>;
    ui: {
        period: HabitPeriod;
        selected: string | null;
        expanded: Record<string, boolean>;
    };
    meta: {
        initializedAt: string;
    };
}

export interface HabitContextValue {
    state: HabitState;
    createHabit: (input: NewHabitInput) => Habit;
    updateHabit: (id: string, patch: Partial<Habit>) => void;
    archiveHabit: (id: string, archive?: boolean) => void;
    deleteHabit: (id: string) => void;
    checkCompletion: (habitId: string, bucket: string) => void;
    uncheckCompletion: (habitId: string, bucket: string) => void;
    reorderHabits: (idsInOrder: string[]) => void;
    setPeriod: (period: HabitPeriod) => void;
    setSelectedHabit: (id: string | null) => void;
    setHabitExpanded: (id: string, expanded: boolean) => void;
    toggleHabitExpanded: (id: string) => void;
    refreshHabits: () => Promise<void>;
}

const LS_KEY = "habit_state_v1";
const DEFAULT_COLOR = "#6366F1";
const PERIODS: readonly HabitPeriod[] = ["day", "week", "month", "year"];
const FREQUENCIES: readonly HabitFrequency[] = ["daily", "weekly", "monthly"];

function now(): string {
    return new Date().toISOString();
}

function uuid(): string {
    try {
        return globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
    } catch {
        return fallbackUuid();
    }
}

function fallbackUuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildDefaultState(): HabitState {
    return {
        habits: {},
        completions: {},
        ui: { period: "week", selected: null, expanded: {} },
        meta: { initializedAt: now() },
    };
}

function normalizeHabit(value: unknown, id: string): Habit | null {
    if (!isRecord(value)) return null;
    const frequency = FREQUENCIES.includes(value.frequency) ? value.frequency : "daily";
    const createdAt = typeof value.createdAt === "string" && value.createdAt ? value.createdAt : now();
    const updatedAt = typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt;
    return {
        id,
        name: typeof value.name === "string" ? value.name : "Untitled habit",
        description: typeof value.description === "string" ? value.description : "",
        color: typeof value.color === "string" && value.color ? value.color : DEFAULT_COLOR,
        frequency,
        position: Number.isFinite(Number(value.position)) ? Number(value.position) : 0,
        isArchived: Boolean(value.isArchived),
        createdAt,
        updatedAt,
    };
}

function normalizeLocalUI(input: unknown): HabitState["ui"] {
    const source = isRecord(input) && isRecord(input.ui) ? input.ui : isRecord(input) ? input : {};
    const period = PERIODS.includes(source.period) ? source.period : "week";
    const expanded: Record<string, boolean> = {};
    if (Array.isArray(source.expanded)) {
        source.expanded.forEach((id) => {
            if (typeof id === "string" && id) expanded[id] = true;
        });
    } else if (isRecord(source.expanded)) {
        Object.entries(source.expanded).forEach(([id, value]) => {
            if (typeof value === "boolean") expanded[id] = value;
        });
    }
    return {
        period,
        selected: typeof source.selected === "string" && source.selected ? source.selected : null,
        expanded,
    };
}

function serverSlice(state: HabitState): { habits: Habit[]; completions: HabitCompletion[] } {
    return {
        habits: Object.values(state.habits),
        completions: Object.values(state.completions),
    };
}

function serializeServerSlice(state: HabitState): string {
    return JSON.stringify(serverSlice(state));
}

function applyLoadedState(
    loaded: { habits: Habit[]; completions: HabitCompletion[] } | null,
    localUI: HabitState["ui"],
): HabitState {
    const base = buildDefaultState();
    const habits: Record<string, Habit> = {};
    for (const candidate of loaded?.habits ?? []) {
        const habit = normalizeHabit(candidate, candidate?.id);
        if (habit) habits[habit.id] = habit;
    }

    const completions: Record<string, HabitCompletion> = {};
    for (const candidate of loaded?.completions ?? []) {
        if (!isRecord(candidate)) continue;
        const id = typeof candidate.id === "string" ? candidate.id : "";
        const habitId = typeof candidate.habitId === "string" ? candidate.habitId : "";
        const bucket = typeof candidate.bucket === "string" ? candidate.bucket : "";
        if (!id || !habitId || !bucket || !habits[habitId]) continue;
        const createdAt = typeof candidate.createdAt === "string" && candidate.createdAt ? candidate.createdAt : now();
        completions[id] = {
            id,
            habitId,
            bucket,
            createdAt,
            updatedAt: typeof candidate.updatedAt === "string" && candidate.updatedAt ? candidate.updatedAt : createdAt,
        };
    }

    const expanded: Record<string, boolean> = {};
    Object.entries(localUI.expanded).forEach(([id, value]) => {
        if (value && habits[id]) expanded[id] = true;
    });
    return {
        habits,
        completions,
        ui: {
            ...localUI,
            selected: localUI.selected && habits[localUI.selected] ? localUI.selected : null,
            expanded,
        },
        meta: base.meta,
    };
}

const HabitContext = createContext<HabitContextValue | undefined>(undefined);

export const HabitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const { initialized, revision, sync } = useSync();
    const hasLocalStorage = (() => {
        try { return typeof window !== "undefined" && typeof window.localStorage !== "undefined"; } catch { return false; }
    })();
    const [state, setState] = useState<HabitState>(() => buildDefaultState());
    const [hydrated, setHydrated] = useState(false);
    const lastServerSerializedRef = useRef<string | null>(null);
    const pendingServerSerializedRef = useRef<string | null>(null);
    const suppressServerSaveRef = useRef(false);
    const lastReloadedHabitsRef = useRef<string | null>(null);
    const uiRef = useRef(state.ui);
    const stateRef = useRef(state);

    useLayoutEffect(() => {
        uiRef.current = state.ui;
        stateRef.current = state;
    }, [state]);

    const readLocalUI = useCallback((): HabitState["ui"] => {
        if (!hasLocalStorage) return normalizeLocalUI(undefined);
        try {
            const raw = window.localStorage.getItem(LS_KEY);
            return normalizeLocalUI(raw ? JSON.parse(raw) : undefined);
        } catch (err) {
            console.warn("[Habit] failed to parse local UI state", err);
            return normalizeLocalUI(undefined);
        }
    }, [hasLocalStorage]);

    const loadStagedHabits = useCallback(async (): Promise<{ habits: Habit[]; completions: HabitCompletion[] } | null> => {
        try {
            return await data.loadHabits();
        } catch (err) {
            console.warn("[Habit] failed to load habits", err);
            return null;
        }
    }, [data]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const localUI = readLocalUI();
            const loaded = await loadStagedHabits();
            if (cancelled) return;
            const next = applyLoadedState(loaded, localUI);
            setState(next);
            setHydrated(true);
            lastServerSerializedRef.current = serializeServerSlice(next);
            suppressServerSaveRef.current = true;
            if (hasLocalStorage) {
                try { window.localStorage.setItem(LS_KEY, JSON.stringify({ ui: next.ui })); } catch { /* UI is best effort. */ }
            }
        })();
        return () => { cancelled = true; };
    }, [hasLocalStorage, loadStagedHabits, readLocalUI]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const serialized = serializeServerSlice(state);
        if (suppressServerSaveRef.current && serialized === lastServerSerializedRef.current) {
            suppressServerSaveRef.current = false;
            return;
        }
        if (serialized === lastServerSerializedRef.current) return;
        if (pendingServerSerializedRef.current === serialized) return;
        pendingServerSerializedRef.current = serialized;
        const slice = serverSlice(state);
        void data.saveHabits(slice.habits, slice.completions).then(() => {
            if (pendingServerSerializedRef.current === serialized) {
                lastServerSerializedRef.current = serialized;
                pendingServerSerializedRef.current = null;
            }
        }).catch((err) => {
            if (pendingServerSerializedRef.current === serialized) pendingServerSerializedRef.current = null;
            console.warn("[Habit] failed to persist habits", err);
        });
    }, [data, hydrated, initialized, revision, state]);

    useEffect(() => {
        if (!hydrated || !hasLocalStorage) return;
        try { window.localStorage.setItem(LS_KEY, JSON.stringify({ ui: state.ui })); } catch (err) { console.warn("[Habit] failed to save local UI state", err); }
    }, [hasLocalStorage, hydrated, state.ui]);

    const reloadStagedHabits = useCallback(async () => {
        const loaded = await loadStagedHabits();
        const serialized = JSON.stringify(loaded);
        const currentSerialized = serializeServerSlice(stateRef.current);
        if (lastServerSerializedRef.current !== null && currentSerialized !== lastServerSerializedRef.current) return;
        if (serialized === currentSerialized) {
            lastReloadedHabitsRef.current = serialized;
            return;
        }
        if (serialized === lastReloadedHabitsRef.current) return;
        const next = applyLoadedState(loaded, uiRef.current);
        lastReloadedHabitsRef.current = serialized;
        lastServerSerializedRef.current = serializeServerSlice(next);
        suppressServerSaveRef.current = true;
        setState(next);
    }, [loadStagedHabits]);

    useEffect(() => {
        if (!hydrated) return;
        void reloadStagedHabits();
    }, [hydrated, reloadStagedHabits, revision]);

    const persist = useCallback((next: HabitState | ((previous: HabitState) => HabitState)) => {
        setState((previous) => typeof next === "function" ? next(previous) : next);
    }, []);

    const createHabit = (input: NewHabitInput): Habit => {
        const position = Object.values(state.habits).reduce((max, habit) => Math.max(max, habit.position), -1) + 1;
        const habit = makeHabit({ ...input, position: input.position ?? position }, new Date(), uuid());
        persist((previous) => ({ ...previous, habits: { ...previous.habits, [habit.id]: habit } }));
        return habit;
    };

    const updateHabit = (id: string, patch: Partial<Habit>) => {
        const habit = state.habits[id];
        if (!habit) return;
        persist((previous) => ({
            ...previous,
            habits: { ...previous.habits, [id]: { ...habit, ...patch, id, updatedAt: now() } },
        }));
    };

    const archiveHabit = (id: string, archive = true) => updateHabit(id, { isArchived: archive });

    const deleteHabit = (id: string) => {
        if (!state.habits[id]) return;
        persist((previous) => {
            const habits = { ...previous.habits };
            delete habits[id];
            const completions = Object.fromEntries(Object.entries(previous.completions).filter(([, completion]) => completion.habitId !== id));
            const expanded = { ...previous.ui.expanded };
            delete expanded[id];
            return {
                ...previous,
                habits,
                completions,
                ui: { ...previous.ui, selected: previous.ui.selected === id ? null : previous.ui.selected, expanded },
            };
        });
    };

    const checkCompletion = (habitId: string, bucket: string) => {
        if (!state.habits[habitId] || !bucket) return;
        if (Object.values(state.completions).some((completion) => completion.habitId === habitId && completion.bucket === bucket)) return;
        const completion = createHabitCompletion(habitId, bucket, new Date(), uuid());
        persist((previous) => ({ ...previous, completions: { ...previous.completions, [completion.id]: completion } }));
    };

    const uncheckCompletion = (habitId: string, bucket: string) => {
        persist((previous) => {
            const completions = Object.fromEntries(Object.entries(previous.completions).filter(([, completion]) => !(completion.habitId === habitId && completion.bucket === bucket)));
            return { ...previous, completions };
        });
    };

    const reorderHabits = (idsInOrder: string[]) => {
        persist((previous) => {
            const habits = { ...previous.habits };
            idsInOrder.forEach((id, index) => {
                const habit = habits[id];
                if (!habit) return;
                habits[id] = { ...habit, position: index, updatedAt: now() };
            });
            return { ...previous, habits };
        });
    };

    const setPeriod = (period: HabitPeriod) => persist((previous) => ({ ...previous, ui: { ...previous.ui, period } }));
    const setSelectedHabit = (id: string | null) => persist((previous) => ({ ...previous, ui: { ...previous.ui, selected: id } }));
    const setHabitExpanded = (id: string, expanded: boolean) => persist((previous) => ({ ...previous, ui: { ...previous.ui, expanded: { ...previous.ui.expanded, [id]: expanded } } }));
    const toggleHabitExpanded = (id: string) => setHabitExpanded(id, !state.ui.expanded[id]);

    const refreshHabits = useCallback(async () => {
        await sync({ reason: "manual" });
        await reloadStagedHabits();
    }, [reloadStagedHabits, sync]);

    const value: HabitContextValue = {
        state,
        createHabit,
        updateHabit,
        archiveHabit,
        deleteHabit,
        checkCompletion,
        uncheckCompletion,
        reorderHabits,
        setPeriod,
        setSelectedHabit,
        setHabitExpanded,
        toggleHabitExpanded,
        refreshHabits,
    };

    return <HabitContext.Provider value={value}>{children}</HabitContext.Provider>;
};

export function useHabits(): HabitContextValue {
    const context = useContext(HabitContext);
    if (!context) throw new Error("useHabits must be inside provider");
    return context;
}

export { LS_KEY as HABIT_UI_STORAGE_KEY, normalizeLocalUI };
