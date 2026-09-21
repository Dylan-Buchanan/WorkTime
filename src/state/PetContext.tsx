import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
    PetFixation, PetNapRecord, PetNotableEvent, PetProfile, PetScheduleItem,
    PetTrainingSkill, PetWeightEntry,
} from "./types";
import { useData } from "./DataContext";
import { useSync } from "./SyncContext";

export type PetTabId = "today" | "training" | "fixations" | "timeline";
export const PET_UI_STORAGE_KEY = "pet_state_v1";

export interface PetState {
    profile: PetProfile | null;
    scheduleItems: Record<string, PetScheduleItem>;
    naps: Record<string, PetNapRecord>;
    weights: Record<string, PetWeightEntry>;
    trainingSkills: Record<string, PetTrainingSkill>;
    fixations: Record<string, PetFixation>;
    notableEvents: Record<string, PetNotableEvent>;
    ui: { activeTab: PetTabId };
}

export interface PetContextValue {
    state: PetState;
    hydrated: boolean;
    setProfile(value: PetProfile | null): void;
    setScheduleItems(value: PetScheduleItem[]): void;
    setNaps(value: PetNapRecord[]): void;
    setWeights(value: PetWeightEntry[]): void;
    setTrainingSkills(value: PetTrainingSkill[]): void;
    setFixations(value: PetFixation[]): void;
    setNotableEvents(value: PetNotableEvent[]): void;
    setActiveTab(value: PetTabId): void;
    refreshPets(): Promise<void>;
    now(): Date;
    uuid(): string;
}

const TABS: readonly PetTabId[] = ["today", "training", "fixations", "timeline"];
const PetContext = createContext<PetContextValue | undefined>(undefined);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function rows<T extends { id: string }>(input: unknown, check?: (value: Record<string, unknown>) => boolean): Record<string, T> {
    const result: Record<string, T> = {};
    if (!Array.isArray(input)) return result;
    for (const value of input) {
        if (!isRecord(value) || typeof value.id !== "string" || !value.id) continue;
        if (check && !check(value)) continue;
        result[value.id] = value as unknown as T;
    }
    return result;
}

const text = (value: Record<string, unknown>, ...keys: string[]) => keys.every((key) => typeof value[key] === "string");
const activityType = (value: unknown) => value === "potty" || value === "training" || value === "playtime" || value === "feeding";
const scheduleCheck = (value: Record<string, unknown>) => {
    const recurrence = value.recurrence;
    return activityType(value.activityType) && text(value, "label", "createdAt", "updatedAt") &&
        (value.flexibility === "fixed" || value.flexibility === "flexible") &&
        typeof value.priority === "number" && Number.isFinite(value.priority) && typeof value.isActive === "boolean" &&
        isRecord(recurrence) && (
            (recurrence.mode === "fixed-time" && typeof recurrence.time === "string" && Number.isFinite(recurrence.startMinutes) && Number.isFinite(recurrence.endMinutes)) ||
            (recurrence.mode === "interval" && Number.isFinite(recurrence.minMinutes) && Number.isFinite(recurrence.maxMinutes))
        );
};
const napCheck = (value: Record<string, unknown>) => text(value, "start", "createdAt", "updatedAt") && (value.end === null || typeof value.end === "string");
const weightCheck = (value: Record<string, unknown>) => text(value, "timestamp", "createdAt", "updatedAt") && typeof value.weight === "number" && Number.isFinite(value.weight);
const skillCheck = (value: Record<string, unknown>) => text(value, "label", "notes", "createdAt", "updatedAt") &&
    (value.status === "introduced" || value.status === "progressing" || value.status === "reliable") &&
    (value.resolvedAt === null || typeof value.resolvedAt === "string");
const fixationCheck = (value: Record<string, unknown>) => text(value, "label", "notes", "resolutionNote", "createdAt", "updatedAt") && (value.resolvedAt === null || typeof value.resolvedAt === "string");
const eventCheck = (value: Record<string, unknown>) => text(value, "title", "notes", "timestamp", "createdAt", "updatedAt");

function validProfile(value: unknown): PetProfile | null {
    return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
        typeof value.birthDate === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string"
        ? value as unknown as PetProfile : null;
}

function defaultState(activeTab: PetTabId = "today"): PetState {
    return { profile: null, scheduleItems: {}, naps: {}, weights: {}, trainingSkills: {}, fixations: {}, notableEvents: {}, ui: { activeTab } };
}

function serverSlice(state: PetState) {
    return {
        profile: state.profile,
        scheduleItems: Object.values(state.scheduleItems),
        naps: Object.values(state.naps),
        weights: Object.values(state.weights),
        trainingSkills: Object.values(state.trainingSkills),
        fixations: Object.values(state.fixations),
        notableEvents: Object.values(state.notableEvents),
    };
}

type PetServerSlice = ReturnType<typeof serverSlice>;
type PetServerKey = keyof PetServerSlice;
type SerializedPetServerSlice = Record<PetServerKey, string>;

function serializeServerFields(slice: PetServerSlice): SerializedPetServerSlice {
    return {
        profile: JSON.stringify(slice.profile),
        scheduleItems: JSON.stringify(slice.scheduleItems),
        naps: JSON.stringify(slice.naps),
        weights: JSON.stringify(slice.weights),
        trainingSkills: JSON.stringify(slice.trainingSkills),
        fixations: JSON.stringify(slice.fixations),
        notableEvents: JSON.stringify(slice.notableEvents),
    };
}

function normalizeTab(value: unknown): PetTabId {
    const candidate = isRecord(value) && isRecord(value.ui) ? value.ui.activeTab : isRecord(value) ? value.activeTab : undefined;
    return TABS.includes(candidate as PetTabId) ? candidate as PetTabId : "today";
}

function localTab(): PetTabId {
    try {
        const raw = typeof window === "undefined" ? null : window.localStorage.getItem(PET_UI_STORAGE_KEY);
        return normalizeTab(raw ? JSON.parse(raw) : null);
    } catch { return "today"; }
}

function randomUuid(): string {
    try { return globalThis.crypto?.randomUUID?.() ?? fallbackUuid(); } catch { return fallbackUuid(); }
}
function fallbackUuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export const PetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const data = useData();
    const { initialized, revision, sync } = useSync();
    const [state, setState] = useState<PetState>(() => defaultState(localTab()));
    const [activeTab, setActiveTabState] = useState<PetTabId>(() => localTab());
    const [hydrated, setHydrated] = useState(false);
    const stateRef = useRef(state);
    const lastSaved = useRef<SerializedPetServerSlice | null>(null);
    const pending = useRef<Partial<SerializedPetServerSlice>>({});
    const suppressSave = useRef(false);
    const reloadedRevision = useRef(revision);

    useLayoutEffect(() => { stateRef.current = state; }, [state]);

    const load = useCallback(async (): Promise<PetState> => {
        const [profile, schedule, naps, weights, skills, fixations, events] = await Promise.all([
            data.loadPetProfile(), data.loadPetScheduleItems(), data.loadPetNapRecords(), data.loadPetWeightEntries(),
            data.loadPetTrainingSkills(), data.loadPetFixations(), data.loadPetNotableEvents(),
        ]);
        return {
            profile: validProfile(profile), scheduleItems: rows<PetScheduleItem>(schedule, scheduleCheck), naps: rows<PetNapRecord>(naps, napCheck),
            weights: rows<PetWeightEntry>(weights, weightCheck), trainingSkills: rows<PetTrainingSkill>(skills, skillCheck),
            fixations: rows<PetFixation>(fixations, fixationCheck), notableEvents: rows<PetNotableEvent>(events, eventCheck),
            ui: stateRef.current.ui,
        };
    }, [data]);

    useEffect(() => {
        let cancelled = false;
        void load().then((loaded) => {
            if (cancelled) return;
            loaded.ui.activeTab = activeTab;
            lastSaved.current = serializeServerFields(serverSlice(loaded));
            suppressSave.current = true;
            setState(loaded);
            setHydrated(true);
        }).catch((error) => {
            console.warn("[Pet] failed to hydrate", error);
            if (cancelled) return;
            lastSaved.current = serializeServerFields(serverSlice(defaultState(activeTab)));
            suppressSave.current = true;
            setHydrated(true);
        });
        return () => { cancelled = true; };
    }, [load]);

    useEffect(() => {
        if (!hydrated || !initialized) return;
        const slice = serverSlice(state);
        const serialized = serializeServerFields(slice);
        const baseline = lastSaved.current;
        if (suppressSave.current && baseline && (Object.keys(serialized) as PetServerKey[]).every((key) => serialized[key] === baseline[key])) {
            suppressSave.current = false;
            return;
        }

        const saves: Record<PetServerKey, () => Promise<void>> = {
            profile: () => data.savePetProfile(slice.profile),
            scheduleItems: () => data.savePetScheduleItems(slice.scheduleItems),
            naps: () => data.savePetNapRecords(slice.naps),
            weights: () => data.savePetWeightEntries(slice.weights),
            trainingSkills: () => data.savePetTrainingSkills(slice.trainingSkills),
            fixations: () => data.savePetFixations(slice.fixations),
            notableEvents: () => data.savePetNotableEvents(slice.notableEvents),
        };
        for (const key of Object.keys(saves) as PetServerKey[]) {
            if (serialized[key] === baseline?.[key] || serialized[key] === pending.current[key]) continue;
            const value = serialized[key];
            pending.current[key] = value;
            void saves[key]().then(() => {
                if (pending.current[key] !== value) return;
                delete pending.current[key];
                lastSaved.current = { ...(lastSaved.current ?? serialized), [key]: value };
            }).catch((error) => {
                if (pending.current[key] === value) delete pending.current[key];
                console.warn(`[Pet] failed to persist ${key}`, error);
            });
        }
    }, [data, hydrated, initialized, revision, state]);

    useEffect(() => {
        if (!hydrated) return;
        try { window.localStorage.setItem(PET_UI_STORAGE_KEY, JSON.stringify({ ui: { activeTab } })); } catch { /* best effort UI state */ }
    }, [activeTab, hydrated]);

    const reload = useCallback(async () => {
        const startedState = stateRef.current;
        const startedSerialized = JSON.stringify(serverSlice(stateRef.current));
        let loaded: PetState;
        try {
            loaded = await load();
        } catch (error) {
            console.warn("[Pet] failed to reload", error);
            return;
        }
        if (stateRef.current !== startedState) return;
        const currentSerialized = JSON.stringify(serverSlice(stateRef.current));
        if (currentSerialized !== startedSerialized) return;
        const currentFields = serializeServerFields(serverSlice(stateRef.current));
        if (lastSaved.current !== null && (Object.keys(currentFields) as PetServerKey[]).some((key) => currentFields[key] !== lastSaved.current?.[key])) return;
        const loadedSerialized = JSON.stringify(serverSlice(loaded));
        if (loadedSerialized === currentSerialized) return;
        lastSaved.current = serializeServerFields(serverSlice(loaded));
        suppressSave.current = true;
        setState(loaded);
    }, [load]);
    useEffect(() => {
        if (!hydrated || revision === reloadedRevision.current) return;
        reloadedRevision.current = revision;
        void reload();
    }, [hydrated, reload, revision]);

    const updateState = (change: (current: PetState) => PetState) => {
        const next = change(stateRef.current);
        stateRef.current = next;
        setState(next);
    };
    const setCollection = <K extends keyof Pick<PetState, "scheduleItems" | "naps" | "weights" | "trainingSkills" | "fixations" | "notableEvents">>(key: K, value: Array<PetState[K][string]>) =>
        updateState((current) => ({ ...current, [key]: rows(value) }));

    const value: PetContextValue = {
        state: { ...state, ui: { activeTab } }, hydrated,
        setProfile: (profile) => updateState((current) => ({ ...current, profile })),
        setScheduleItems: (items) => setCollection("scheduleItems", items),
        setNaps: (items) => setCollection("naps", items), setWeights: (items) => setCollection("weights", items),
        setTrainingSkills: (items) => setCollection("trainingSkills", items), setFixations: (items) => setCollection("fixations", items),
        setNotableEvents: (items) => setCollection("notableEvents", items),
        setActiveTab: setActiveTabState,
        refreshPets: async () => { await sync({ reason: "manual" }); await reload(); },
        now: () => new Date(), uuid: randomUuid,
    };
    return <PetContext.Provider value={value}>{children}</PetContext.Provider>;
};

export function usePets(): PetContextValue {
    const context = useContext(PetContext);
    if (!context) throw new Error("usePets must be inside provider");
    return context;
}
