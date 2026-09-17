import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    canCorrectActivityRecord,
    correctActivityTimestamp as correctRecordTimestamp,
    countActivitiesToday,
    logActivity as logActivityCommand,
    removeActivityRecord,
} from "../lib/pets";
import type { NewPetActivityRecordInput, PetActivityCounts } from "../lib/pets";
import type { PetActivityRecord, PetActivityType } from "./types";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";
import { useToast } from "./ToastContext";

export interface PetActivityState {
    records: Record<string, PetActivityRecord>;
    meta: { initializedAt: string };
}

export interface PetActivityContextValue {
    state: PetActivityState;
    hydrated: boolean;
    /**
     * The single one-tap write path. Both the schedule inline checks and the
     * bottom potty bar call this; it appends one record and shows the undo toast.
     */
    logActivity(input: NewPetActivityRecordInput): PetActivityRecord;
    /** Deletes a record entirely; the log recomputes as if it never happened. */
    undoActivity(id: string): void;
    /** Edits a today-stamped record's timestamp in place. */
    correctActivityTimestamp(id: string, timestamp: string | Date): void;
    /** True while a record's timestamp is still today and therefore correctable. */
    canCorrectActivity(id: string): boolean;
    /** Done-today counts derived from the log, never stored. */
    todayCounts(): PetActivityCounts;
    refreshActivityRecords(): Promise<void>;
}

const ACTIVITY_TYPES: readonly PetActivityType[] = ["potty", "training", "playtime", "feeding"];

const ACTIVITY_LABELS: Record<PetActivityType, string> = {
    potty: "potty",
    training: "training",
    playtime: "playtime",
    feeding: "feeding",
};

function isoNow(): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function defaultState(): PetActivityState {
    return { records: {}, meta: { initializedAt: isoNow() } };
}

function normalizeActivityRecord(value: unknown): PetActivityRecord | null {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
    if (!ACTIVITY_TYPES.includes(value.activityType as PetActivityType)) return null;
    if (typeof value.timestamp !== "string" || Number.isNaN(new Date(value.timestamp).getTime())) return null;
    const record: PetActivityRecord = {
        id: value.id,
        activityType: value.activityType as PetActivityType,
        timestamp: value.timestamp,
        createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : isoNow(),
    };
    if (value.durationMinutes !== undefined) {
        if (typeof value.durationMinutes !== "number" || !Number.isFinite(value.durationMinutes) || value.durationMinutes < 0) {
            return null;
        }
        record.durationMinutes = value.durationMinutes;
    }
    return record;
}

function sortRecords(records: readonly PetActivityRecord[]): PetActivityRecord[] {
    return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function serializeRecords(records: readonly PetActivityRecord[]): string {
    return JSON.stringify(sortRecords(records));
}

function recordsToMap(records: readonly PetActivityRecord[]): Record<string, PetActivityRecord> {
    const map: Record<string, PetActivityRecord> = {};
    for (const record of records) map[record.id] = record;
    return map;
}

function applyLoadedState(loaded: readonly PetActivityRecord[] | null): PetActivityState {
    const state = defaultState();
    for (const candidate of loaded ?? []) {
        const record = normalizeActivityRecord(candidate);
        if (record) state.records[record.id] = record;
    }
    return state;
}

const PetActivityContext = createContext<PetActivityContextValue | undefined>(undefined);

/**
 * Owner-scoped pet activity log. All logging flows through `logActivity`, so
 * derived schedule state (interval anchor, next-due/overdue, done-today counts)
 * always recomputes from one append-only set of records. Persistence is staged
 * via `DataAccess.savePetActivityRecords`; this provider never syncs directly.
 */
export const PetActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const { initialized, revision, sync } = useSync();
    const { showToast } = useToast();
    const [state, setState] = useState<PetActivityState>(defaultState);
    const [hydrated, setHydrated] = useState(false);
    const stateRef = useRef(state);
    const lastServerSerializedRef = useRef<string | null>(null);
    const pendingServerSerializedRef = useRef<string | null>(null);
    const suppressServerSaveRef = useRef(false);
    const lastReloadedRef = useRef<string | null>(null);

    useLayoutEffect(() => {
        stateRef.current = state;
    }, [state]);

    const loadStagedRecords = useCallback(async (): Promise<PetActivityRecord[] | null> => {
        try {
            return await data.loadPetActivityRecords();
        } catch (error) {
            console.warn("[PetActivity] failed to load activity records", error);
            return null;
        }
    }, [data]);

    useEffect(() => {
        let cancelled = false;
        void loadStagedRecords().then((loaded) => {
            if (cancelled) return;
            const next = applyLoadedState(loaded);
            setState(next);
            setHydrated(true);
            lastServerSerializedRef.current = serializeRecords(Object.values(next.records));
            suppressServerSaveRef.current = true;
        });
        return () => { cancelled = true; };
    }, [loadStagedRecords]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const serialized = serializeRecords(Object.values(state.records));
        if (suppressServerSaveRef.current && serialized === lastServerSerializedRef.current) {
            suppressServerSaveRef.current = false;
            return;
        }
        if (serialized === lastServerSerializedRef.current) return;
        if (pendingServerSerializedRef.current === serialized) return;
        pendingServerSerializedRef.current = serialized;
        void data.savePetActivityRecords(Object.values(state.records)).then(() => {
            if (pendingServerSerializedRef.current === serialized) {
                lastServerSerializedRef.current = serialized;
                pendingServerSerializedRef.current = null;
            }
        }).catch((error) => {
            if (pendingServerSerializedRef.current === serialized) pendingServerSerializedRef.current = null;
            console.warn("[PetActivity] failed to persist activity records", error);
        });
    }, [data, hydrated, initialized, revision, state.records]);

    const reloadStagedRecords = useCallback(async () => {
        const loaded = await loadStagedRecords();
        const serialized = serializeRecords(loaded ?? []);
        const currentSerialized = serializeRecords(Object.values(stateRef.current.records));
        if (lastServerSerializedRef.current !== null && currentSerialized !== lastServerSerializedRef.current) return;
        if (serialized === currentSerialized) {
            lastReloadedRef.current = serialized;
            return;
        }
        if (serialized === lastReloadedRef.current) return;
        const next = applyLoadedState(loaded);
        lastReloadedRef.current = serialized;
        lastServerSerializedRef.current = serializeRecords(Object.values(next.records));
        suppressServerSaveRef.current = true;
        setState(next);
    }, [loadStagedRecords]);

    useEffect(() => {
        if (!hydrated) return;
        void reloadStagedRecords();
    }, [hydrated, reloadStagedRecords, revision]);

    const undoActivity = useCallback((id: string) => {
        setState((previous) => {
            const remaining = removeActivityRecord(Object.values(previous.records), id);
            return { ...previous, records: recordsToMap(remaining) };
        });
    }, []);

    const logActivity = (input: NewPetActivityRecordInput): PetActivityRecord => {
        const result = logActivityCommand(Object.values(stateRef.current.records), input, new Date(), uuid());
        setState((previous) => {
            const records = { ...previous.records };
            for (const record of result.records) records[record.id] = record;
            return { ...previous, records };
        });
        const record = result.record;
        showToast(`Logged ${ACTIVITY_LABELS[record.activityType]}`, {
            action: { label: "Undo", onAction: () => undoActivity(record.id) },
        });
        return record;
    };

    const correctActivityTimestamp = (id: string, timestamp: string | Date): void => {
        const next = correctRecordTimestamp(Object.values(stateRef.current.records), id, timestamp, new Date());
        const corrected = next.find((record) => record.id === id);
        if (!corrected) return;
        setState((previous) => ({ ...previous, records: { ...previous.records, [id]: corrected } }));
    };

    const canCorrectActivity = (id: string): boolean => {
        const record = state.records[id];
        return record ? canCorrectActivityRecord(record, new Date()) : false;
    };

    const todayCounts = (): PetActivityCounts => countActivitiesToday(Object.values(state.records), new Date());

    const refreshActivityRecords = useCallback(async () => {
        await sync({ reason: "manual" });
        await reloadStagedRecords();
    }, [reloadStagedRecords, sync]);

    const value: PetActivityContextValue = {
        state,
        hydrated,
        logActivity,
        undoActivity,
        correctActivityTimestamp,
        canCorrectActivity,
        todayCounts,
        refreshActivityRecords,
    };

    return <PetActivityContext.Provider value={value}>{children}</PetActivityContext.Provider>;
};

export function usePetActivity(): PetActivityContextValue {
    const context = useContext(PetActivityContext);
    if (!context) throw new Error("usePetActivity must be inside provider");
    return context;
}
