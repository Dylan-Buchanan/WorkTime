import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import type { Goal, GoalCadence, GoalCheckIn, GoalMetric, GoalTracker } from "./types";
import type { LocalDateKey } from "../lib/todos/types";
import { localDateKey } from "../lib/todos/calendar";
import { normalizeGoalCadence } from "../lib/goals/cadence";
import { resolveCadenceAnchorAt } from "../lib/goals/periods";
import { createGoal as makeGoal, createGoalTracker, isGoal, isGoalCheckIn, isGoalDateKey, isGoalTracker } from "../lib/goals/factories";

export const GOAL_UI_STORAGE_KEY = "goals_state_v1";
export interface GoalUIState {
    selectedTrackerId: string | null;
    expandedGoalIds: Record<string, boolean>;
}
export interface GoalState {
    trackers: Record<string, GoalTracker>;
    goals: Record<string, Goal>;
    checkIns: Record<string, GoalCheckIn>;
    ui: GoalUIState;
}
export interface NewGoalTrackerInput {
    name: string;
    purpose: string;
    cadence: GoalCadence;
    color: string;
    cadenceAnchorAt?: LocalDateKey;
}
export interface NewGoalInput {
    trackerId: string;
    title: string;
    notes?: string;
    projectId?: string | null;
    metric?: GoalMetric | null;
    sortOrder?: number;
}
export interface GoalContextValue {
    state: GoalState;
    hydrated: boolean;
    revision: number;
    createTracker(input: NewGoalTrackerInput): GoalTracker;
    updateTracker(id: string, patch: Partial<Omit<GoalTracker, "id" | "createdAt" | "lastBuiltPeriodStart">>): void;
    archiveTracker(id: string, archived?: boolean): void;
    selectTracker(id: string | null): void;
    createGoal(input: NewGoalInput): Goal;
    updateGoal(id: string, patch: Partial<Omit<Goal, "id" | "trackerId" | "createdAt">>): void;
    setGoalLifecycle(id: string, lifecycle: Goal["lifecycle"]): void;
    reorderGoals(trackerId: string, idsInOrder: readonly string[]): void;
    upsertCheckIns(checkIns: readonly GoalCheckIn[]): void;
    saveCheckIns(checkIns: readonly GoalCheckIn[]): Promise<void>;
    stampBuiltPeriod(trackerId: string, periodStart: LocalDateKey): Promise<void>;
    persist(): Promise<void>;
    refreshGoals(): Promise<void>;
    setGoalExpanded(id: string, expanded: boolean): void;
}

type Slice = Omit<GoalState, "ui">;
const emptySlice = (): Slice => ({ trackers: {}, goals: {}, checkIns: {} });
const emptyUI = (): GoalUIState => ({ selectedTrackerId: null, expandedGoalIds: {} });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const pair = (row: GoalCheckIn) => JSON.stringify([row.goalId, row.periodStart]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = <T extends { id: string },>(rows: Record<string, T>): T[] => Object.values(rows).sort((a, b) => a.id.localeCompare(b.id));
function serialized(slice: Slice): string {
    return JSON.stringify({ trackers: sorted(slice.trackers), goals: sorted(slice.goals), checkIns: sorted(slice.checkIns) });
}
function maximumKey(...keys: (LocalDateKey | null)[]): LocalDateKey | null {
    return keys.reduce<LocalDateKey | null>((max, key) => key && (!max || key > max) ? key : max, null);
}
function today(now: Date): LocalDateKey {
    const key = localDateKey(now);
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
}
function readUI(): GoalUIState {
    try {
        const value = JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY) ?? "null");
        if (!value || typeof value !== "object") return emptyUI();
        return {
            selectedTrackerId: typeof value.selectedTrackerId === "string" ? value.selectedTrackerId : null,
            expandedGoalIds: Object.fromEntries(Object.entries(value.expandedGoalIds && typeof value.expandedGoalIds === "object" && !Array.isArray(value.expandedGoalIds) ? value.expandedGoalIds : {})
                .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")),
        };
    } catch (error) {
        console.warn("[Goals] Failed to read local UI state", error);
        return emptyUI();
    }
}

function loadedSlice(loaded: { trackers: GoalTracker[]; goals: Goal[]; checkIns: GoalCheckIn[] }, strict = false): Slice {
    const valid = loaded.trackers.every(isGoalTracker) && loaded.goals.every(isGoal) && loaded.checkIns.every(isGoalCheckIn);
    if (!valid) {
        // Never turn display validation into a full-set save that omits stored rows.
        const error = new RangeError("Invalid staged goals; saving is blocked until the stored rows are repaired");
        if (strict) throw error;
        console.warn("[Goals] Invalid rows hidden from view", error);
    }
    return {
        trackers: Object.fromEntries(loaded.trackers.filter(isGoalTracker).map(row => [row.id, clone(row)])),
        goals: Object.fromEntries(loaded.goals.filter(isGoal).map(row => [row.id, clone(row)])),
        checkIns: Object.fromEntries(loaded.checkIns.filter(isGoalCheckIn).map(row => [row.id, clone(row)])),
    };
}

// Overlay only rows edited relative to the accepted baseline. Untouched remote
// rows survive. Check-ins reconcile identity using the latest staged natural key.
function reconcile(staged: Slice, local: Slice, baseline: Slice): Slice {
    const next = clone(staged);
    for (const kind of ["trackers", "goals"] as const) {
        for (const row of Object.values(local[kind])) {
            if (!same(row, baseline[kind][row.id])) {
                if (kind === "trackers") {
                    const tracker = row as GoalTracker;
                    next.trackers[row.id] = { ...clone(tracker), lastBuiltPeriodStart: maximumKey(tracker.lastBuiltPeriodStart, staged.trackers[row.id]?.lastBuiltPeriodStart ?? null) };
                } else next.goals[row.id] = clone(row as Goal);
            }
        }
    }
    const stagedPairs = new Map(Object.values(staged.checkIns).map(row => [pair(row), row]));
    const baselinePairs = new Map(Object.values(baseline.checkIns).map(row => [pair(row), row]));
    for (const row of Object.values(local.checkIns)) {
        const key = pair(row);
        if (same(row, baselinePairs.get(key))) continue;
        const existing = stagedPairs.get(key);
        for (const candidate of Object.values(next.checkIns)) {
            if (pair(candidate) === key) delete next.checkIns[candidate.id];
        }
        const accepted = { ...clone(row), id: existing?.id ?? row.id };
        if (next.checkIns[accepted.id] && pair(next.checkIns[accepted.id]) !== key) throw new RangeError("Check-in ID belongs to a different natural key");
        next.checkIns[accepted.id] = accepted;
    }
    return next;
}

const GoalContext = createContext<GoalContextValue | undefined>(undefined);
export const GoalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const { initialized, revision, sync } = useSync();
    const [state, setState] = useState<GoalState>(() => ({ ...emptySlice(), ui: emptyUI() }));
    const [hydrated, setHydrated] = useState(false);
    const stateRef = useRef(state);
    const baselineRef = useRef<Slice>(emptySlice());
    const lastSavedSerializedRef = useRef<string | null>(null);
    const pendingSerializedRef = useRef<string | null>(null);
    const suppressSaveRef = useRef(false);
    const readyRef = useRef(false);
    const mountedRef = useRef(true);
    const queueRef = useRef<Promise<void>>(Promise.resolve());

    // All saves and revision reloads share this ordering boundary. This is not
    // multi-tab CAS: DataAccess cannot predicate a write on the preceding read.
    const enqueue = useCallback((operation: () => Promise<void>): Promise<void> => {
        const result = queueRef.current.then(operation);
        queueRef.current = result.catch(() => {});
        return result;
    }, []);
    const publish = useCallback((next: GoalState) => {
        stateRef.current = next;
        if (mountedRef.current) setState(next);
    }, []);
    const accept = useCallback((accepted: Slice, localAtRead: Slice) => {
        const next = reconcile(accepted, stateRef.current, localAtRead);
        baselineRef.current = accepted;
        lastSavedSerializedRef.current = serialized(accepted);
        suppressSaveRef.current = true;
        publish({ ...next, ui: stateRef.current.ui });
    }, [publish]);

    useEffect(() => {
        mountedRef.current = true;
        let cancelled = false;
        void (async () => {
            try {
                const loaded = loadedSlice(await data.loadGoals());
                if (cancelled) return;
                baselineRef.current = loaded;
                lastSavedSerializedRef.current = serialized(loaded);
                suppressSaveRef.current = true;
                readyRef.current = true;
                publish({ ...loaded, ui: readUI() });
                setHydrated(true);
            } catch (error) { console.warn("[Goals] Failed to hydrate goals", error); }
        })();
        return () => { cancelled = true; mountedRef.current = false; };
    }, [data, publish]);

    const save = useCallback((stamp?: { trackerId: string; periodStart: LocalDateKey }): Promise<void> => enqueue(async () => {
        if (!readyRef.current || !data.isInitialized()) throw new Error("Goals are not initialized");
        const staged = loadedSlice(await data.loadGoals(), true);
        const localAtWrite = clone(stateRef.current);
        const next = reconcile(staged, localAtWrite, baselineRef.current);
        if (stamp) {
            const tracker = next.trackers[stamp.trackerId];
            if (!tracker) throw new RangeError("Unknown goal tracker");
            next.trackers[tracker.id] = { ...tracker, lastBuiltPeriodStart: maximumKey(tracker.lastBuiltPeriodStart, stamp.periodStart), updatedAt: new Date().toISOString() };
        }
        await data.saveGoals(sorted(next.trackers), sorted(next.goals), sorted(next.checkIns));
        // Advance to exactly what was written; replay edits made during the await.
        // In particular, an unwritten edit must never become the saved baseline.
        accept(next, localAtWrite);
    }), [accept, data, enqueue]);

    const reload = useCallback(() => enqueue(async () => {
        const loaded = loadedSlice(await data.loadGoals());
        const local = stateRef.current;
        const next = reconcile(loaded, local, baselineRef.current);
        baselineRef.current = loaded;
        lastSavedSerializedRef.current = serialized(loaded);
        suppressSaveRef.current = true;
        publish({ ...next, ui: local.ui });
    }), [data, enqueue, publish]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const slice = serialized(state);
        if (suppressSaveRef.current && slice === lastSavedSerializedRef.current) {
            suppressSaveRef.current = false;
            return;
        }
        if (slice === lastSavedSerializedRef.current || slice === pendingSerializedRef.current) return;
        pendingSerializedRef.current = slice;
        void save().catch(error => console.warn("[Goals] Failed to save goals", error)).finally(() => {
            if (pendingSerializedRef.current === slice) pendingSerializedRef.current = null;
        });
    }, [hydrated, initialized, revision, save, state]);

    useEffect(() => {
        if (hydrated) void reload().catch(error => console.warn("[Goals] Failed to reload goals", error));
    }, [hydrated, reload, revision]);
    useEffect(() => {
        if (!hydrated) return;
        try { localStorage.setItem(GOAL_UI_STORAGE_KEY, JSON.stringify(state.ui)); }
        catch (error) { console.warn("[Goals] Failed to save local UI state", error); }
    }, [hydrated, state.ui]);

    function mutate(change: (previous: GoalState) => GoalState) {
        if (!readyRef.current) throw new Error("Goals have not hydrated");
        publish(change(stateRef.current));
    }
    const createTracker: GoalContextValue["createTracker"] = input => {
        const now = new Date();
        const anchor = resolveCadenceAnchorAt(input.cadence, today(now));
        if (input.cadenceAnchorAt !== undefined && input.cadenceAnchorAt !== anchor) throw new RangeError("Cadence anchor must match the creation boundary");
        const sortOrder = Math.max(-1, ...Object.values(stateRef.current.trackers).map(row => row.sortOrder)) + 1;
        const tracker = createGoalTracker({ ...input, cadenceAnchorAt: anchor, sortOrder }, now, crypto.randomUUID());
        mutate(previous => ({ ...previous, trackers: { ...previous.trackers, [tracker.id]: tracker } }));
        return tracker;
    };
    const updateTracker: GoalContextValue["updateTracker"] = (id, patch) => {
        if ("lastBuiltPeriodStart" in patch) throw new RangeError("Use stampBuiltPeriod to change the build key");
        const previous = stateRef.current.trackers[id];
        if (!previous) throw new RangeError("Unknown goal tracker");
        const cadence = normalizeGoalCadence(patch.cadence ?? previous.cadence);
        const changed = !same(cadence, previous.cadence);
        const anchor = changed ? resolveCadenceAnchorAt(cadence, today(new Date())) : previous.cadenceAnchorAt;
        if (patch.cadenceAnchorAt !== undefined && patch.cadenceAnchorAt !== anchor) throw new RangeError("Cadence anchor must match the rule boundary");
        const row: GoalTracker = { ...previous, ...patch, name: (patch.name ?? previous.name).trim(), cadence, cadenceAnchorAt: anchor, id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() };
        if (!isGoalTracker(row)) throw new RangeError("Invalid goal tracker");
        mutate(current => ({ ...current, trackers: { ...current.trackers, [id]: row } }));
    };
    const createGoal: GoalContextValue["createGoal"] = input => {
        if (!stateRef.current.trackers[input.trackerId]) throw new RangeError("Unknown goal tracker");
        const sortOrder = Math.max(-1, ...Object.values(stateRef.current.goals).filter(row => row.trackerId === input.trackerId).map(row => row.sortOrder)) + 1;
        const goal = makeGoal({ ...input, sortOrder: input.sortOrder ?? sortOrder }, new Date(), crypto.randomUUID());
        mutate(previous => ({ ...previous, goals: { ...previous.goals, [goal.id]: goal } }));
        return goal;
    };
    const updateGoal: GoalContextValue["updateGoal"] = (id, patch) => {
        const previous = stateRef.current.goals[id];
        if (!previous) throw new RangeError("Unknown goal");
        const row: Goal = { ...previous, ...clone(patch), title: (patch.title ?? previous.title).trim(), id, trackerId: previous.trackerId, createdAt: previous.createdAt, updatedAt: new Date().toISOString() };
        if (patch.lifecycle !== undefined && patch.lifecycle !== previous.lifecycle) {
            row.achievedAt = patch.lifecycle === "achieved" ? row.updatedAt : null;
            row.droppedAt = patch.lifecycle === "dropped" ? row.updatedAt : null;
        }
        if (!isGoal(row)) throw new RangeError("Invalid goal");
        mutate(current => ({ ...current, goals: { ...current.goals, [id]: row } }));
    };
    const upsertCheckIns: GoalContextValue["upsertCheckIns"] = rows => {
        if (!rows.every(isGoalCheckIn) || rows.some(row => !stateRef.current.goals[row.goalId])) throw new RangeError("Invalid goal check-in");
        mutate(previous => {
            const checkIns = { ...previous.checkIns };
            for (const row of rows) {
                const existing = Object.values(checkIns).find(candidate => pair(candidate) === pair(row));
                if (existing) delete checkIns[existing.id];
                const next = { ...clone(row), id: existing?.id ?? row.id };
                if (checkIns[next.id] && pair(checkIns[next.id]) !== pair(next)) throw new RangeError("Check-in ID belongs to a different natural key");
                checkIns[next.id] = next;
            }
            return { ...previous, checkIns };
        });
    };
    const value: GoalContextValue = {
        state, hydrated, revision, createTracker, updateTracker, createGoal, updateGoal, upsertCheckIns,
        archiveTracker: (id, archived = true) => updateTracker(id, { isArchived: archived }),
        selectTracker: id => mutate(previous => ({ ...previous, ui: { ...previous.ui, selectedTrackerId: id } })),
        setGoalExpanded: (id, expanded) => mutate(previous => ({ ...previous, ui: { ...previous.ui, expandedGoalIds: { ...previous.ui.expandedGoalIds, [id]: expanded } } })),
        setGoalLifecycle: (id, lifecycle) => updateGoal(id, { lifecycle, achievedAt: lifecycle === "achieved" ? new Date().toISOString() : null, droppedAt: lifecycle === "dropped" ? new Date().toISOString() : null }),
        reorderGoals: (trackerId, ids) => {
            const unique = [...new Set(ids)];
            if (unique.some(id => stateRef.current.goals[id]?.trackerId !== trackerId)) throw new RangeError("Invalid goal order");
            mutate(previous => {
                const goals = { ...previous.goals };
                unique.forEach((id, index) => { goals[id] = { ...goals[id], sortOrder: index, updatedAt: new Date().toISOString() }; });
                return { ...previous, goals };
            });
        },
        saveCheckIns: async rows => { upsertCheckIns(rows); await save(); },
        stampBuiltPeriod: (trackerId, periodStart) => {
            if (!isGoalDateKey(periodStart)) return Promise.reject(new RangeError("Invalid build period"));
            return save({ trackerId, periodStart });
        },
        persist: () => save(),
        refreshGoals: async () => { await sync({ reason: "manual" }); await reload(); },
    };
    return <GoalContext.Provider value={value}>{children}</GoalContext.Provider>;
};

export function useGoals(): GoalContextValue {
    const context = useContext(GoalContext);
    if (!context) throw new Error("useGoals must be inside GoalProvider");
    return context;
}
