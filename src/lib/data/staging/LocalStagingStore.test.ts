import { describe, expect, it, vi } from "vitest";
import { makeAppState } from "../../../test/mockTauri";
import type { Habit, HabitCompletion } from "../../../state/types";
import {
    LocalStagingStore,
    STAGING_STORAGE_PREFIX,
    stagingKey,
    stagingOwnerId,
    type StorageLike,
} from "./LocalStagingStore";
import { MAX_PENDING_COMPLETIONS, STAGING_SCHEMA_VERSION, StagingStorageError, type StagedOwnerRecord, type SyncSnapshot } from "./types";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

const BASE_TASK = {
    id: "t1",
    name: "Task",
    target_pomodoros: 2,
    completed_pomodoros: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    break_skips: 0,
    archived: false,
};

const BASE_LOG = {
    id: "log-0",
    task_id: "t1",
    duration_minutes: 25,
    finished_at: "2026-01-01T00:25:00.000Z",
    was_break: false,
    break_skipped: false,
};

function H(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: `Habit ${id}`,
        description: "",
        color: "#ffffff",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function HC(id: string, habitId: string, overrides: Partial<HabitCompletion> = {}): HabitCompletion {
    return {
        id,
        habitId,
        bucket: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeBaseline(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    const state = makeAppState({ tasks: { t1: { ...BASE_TASK } }, logs: [{ ...BASE_LOG }] });
    return {
        tasks: { t1: { value: { ...BASE_TASK }, updatedAt: "2026-01-01T00:00:00.000Z" } },
        logs: { "log-0": { ...BASE_LOG } },
        habits: {},
        habitCompletions: {},
        settings: { value: { ...state.settings }, updatedAt: "2026-01-01T00:00:00.000Z" },
        timerState: {
            value: { active_task: null, current_cycle_pomodoros: 0, timer: null },
            updatedAt: "2026-01-01T00:00:00.000Z",
            completed: false,
        },
        pmState: { value: null, updatedAt: null },
        ...overrides,
    };
}

/**
 * Persists an initialized record whose local state exactly matches the baseline
 * so pending counts start at zero.
 */
async function seedInitialized(store: LocalStagingStore, ownerId: string, baseline?: SyncSnapshot): Promise<StagedOwnerRecord> {
    const lastSynced = baseline ?? makeBaseline();
    await store.update(ownerId, (current) => ({
        ...current,
        initialized: true,
        state: makeAppState({
            tasks: { t1: { ...BASE_TASK } },
            logs: [{ ...BASE_LOG }],
            settings: { ...(lastSynced.settings.value ?? makeAppState().settings) },
        }),
        settingsUpdatedAt: lastSynced.settings.updatedAt,
        timerUpdatedAt: lastSynced.timerState.updatedAt,
        lastSynced,
    }));
    return store.read(ownerId);
}

function corruptStorage(entries: Record<string, string>): StorageLike {
    const data = new Map(Object.entries(entries));
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value);
        },
        removeItem: (key) => {
            data.delete(key);
        },
    };
}

function throwingStorage(): StorageLike {
    return {
        getItem: () => null,
        setItem: () => {
            throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
    };
}

describe("LocalStagingStore", () => {
    it("keeps owner records isolated and observes localStorage.clear", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await store.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, active_task: "a" } }));
        await store.update(OWNER_B, (r) => ({ ...r, state: { ...r.state, active_task: "b" } }));

        expect(store.read(OWNER_A).state.active_task).toBe("a");
        expect(store.read(OWNER_B).state.active_task).toBe("b");
        expect(window.localStorage.getItem(stagingKey(OWNER_A))).not.toBeNull();
        expect(window.localStorage.getItem(stagingKey(OWNER_B))).not.toBeNull();

        // Clearing storage after the store instance was constructed must produce
        // a fresh uninitialized record on the next read (no stale cache).
        window.localStorage.clear();
        const record = store.read(OWNER_A);
        expect(record.initialized).toBe(false);
        expect(record.revision).toBe(0);
        expect(record.ownerId).toBe(OWNER_A);
        expect(record.state.active_task).toBeNull();
        expect(record.lastSynced).toBeNull();
    });

    it("discards every local delta and restores the last synced baseline", async () => {
        const baseline = makeBaseline({
            habits: { h1: { value: H("h1", { name: "Baseline habit" }), updatedAt: "2026-01-01T00:00:00.000Z" } },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        const store = new LocalStagingStore(window.localStorage);
        await seedInitialized(store, OWNER_A, baseline);
        await store.update(OWNER_A, (record) => ({
            ...record,
            state: makeAppState({ tasks: {}, logs: [], active_task: null }),
            pmState: { projects: {}, tasks: {}, meta: { initializedAt: "2026-01-02T00:00:00.000Z" } },
            taskUpdatedAt: { local: "2026-01-02T00:00:00.000Z" },
            settingsUpdatedAt: "2026-01-02T00:00:00.000Z",
            timerUpdatedAt: "2026-01-02T00:00:00.000Z",
            pmUpdatedAt: "2026-01-02T00:00:00.000Z",
            taskTombstones: { t1: { id: "t1", deletedAt: "2026-01-02T00:00:00.000Z" } },
            logTombstones: { "log-0": { id: "log-0", deletedAt: "2026-01-02T00:00:00.000Z" } },
            fullWipe: { createdAt: "2026-01-02T00:00:00.000Z" },
            pendingCompletions: [],
            habits: {},
            habitCompletions: {},
            habitUpdatedAt: {},
            habitTombstones: { h1: { id: "h1", deletedAt: "2026-01-02T00:00:00.000Z" } },
            habitCompletionTombstones: { c1: { id: "c1", deletedAt: "2026-01-02T00:00:00.000Z" } },
        }));

        const beforeRevision = store.read(OWNER_A).revision;
        const restored = await store.discardPendingChanges(OWNER_A);

        expect(restored.revision).toBe(beforeRevision + 1);
        expect(restored.state.tasks).toEqual({ t1: BASE_TASK });
        expect(restored.state.logs).toEqual([BASE_LOG]);
        expect(restored.habits).toEqual({ h1: baseline.habits.h1.value });
        expect(restored.habitCompletions).toEqual({ c1: baseline.habitCompletions.c1 });
        expect(restored.pmState).toBeNull();
        expect(restored.taskTombstones).toEqual({});
        expect(restored.logTombstones).toEqual({});
        expect(restored.habitTombstones).toEqual({});
        expect(restored.habitCompletionTombstones).toEqual({});
        expect(restored.fullWipe).toBeNull();
        expect(restored.pendingCompletions).toEqual([]);
        expect(store.pendingCount(OWNER_A)).toBe(0);
    });

    it("returns pre-bootstrap edits to a fresh uninitialized record", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await store.update(OWNER_A, (record) => ({
            ...record,
            state: makeAppState({ tasks: { t1: BASE_TASK } }),
        }));
        expect(store.pendingCount(OWNER_A)).toBe(1);

        const restored = await store.discardPendingChanges(OWNER_A);

        expect(restored.initialized).toBe(false);
        expect(restored.unbootstrapped).toBe(false);
        expect(restored.lastSynced).toBeNull();
        expect(restored.state).toEqual(makeAppState());
        expect(store.pendingCount(OWNER_A)).toBe(0);
    });

    it("returns a fresh non-initialized default for an absent record", () => {
        const store = new LocalStagingStore(window.localStorage);
        const record = store.read(OWNER_A);
        expect(record.ownerId).toBe(OWNER_A);
        expect(record.initialized).toBe(false);
        expect(record.revision).toBe(0);
        expect(record.schemaVersion).toBe(STAGING_SCHEMA_VERSION);
        expect(record.state.tasks).toEqual({});
        expect(record.state.logs).toEqual([]);
        expect(record.pmState).toBeNull();
        expect(record.pendingCompletions).toEqual([]);
        expect(record.lastSynced).toBeNull();
        expect(record.habits).toEqual({});
        expect(record.habitCompletions).toEqual({});
        expect(record.habitUpdatedAt).toEqual({});
        expect(record.habitTombstones).toEqual({});
        expect(record.habitCompletionTombstones).toEqual({});
    });

    it("increments revision on every update and re-reads the latest record", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await store.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, current_cycle_pomodoros: 1 } }));
        await store.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, current_cycle_pomodoros: 2 } }));
        const record = store.read(OWNER_A);
        expect(record.revision).toBe(2);
        expect(record.state.current_cycle_pomodoros).toBe(2);
    });

    it("notifies same-tab subscribers after a successful update and unsubscribes cleanly", async () => {
        const store = new LocalStagingStore(window.localStorage);
        const listener = vi.fn();
        const otherOwnerListener = vi.fn();
        const unsubscribe = store.subscribe(OWNER_A, listener);
        store.subscribe(OWNER_B, otherOwnerListener);

        await store.update(OWNER_A, (r) => r);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(otherOwnerListener).not.toHaveBeenCalled();

        unsubscribe();
        await store.update(OWNER_A, (r) => r);
        expect(listener).toHaveBeenCalledTimes(1);

        store.replaceFromExternal(OWNER_A);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when persistence fails and surfaces a blocking error", async () => {
        const store = new LocalStagingStore(throwingStorage());
        const listener = vi.fn();
        store.subscribe(OWNER_A, listener);
        await expect(store.update(OWNER_A, (r) => r)).rejects.toThrow(StagingStorageError);
        expect(listener).not.toHaveBeenCalled();
    });

    it("fails closed when the completion journal exceeds its safety bound", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await expect(
            store.update(OWNER_A, (record) => ({
                ...record,
                pendingCompletions: new Array(MAX_PENDING_COMPLETIONS + 1).fill({}),
            })),
        ).rejects.toThrow(/maximum/);
        expect(window.localStorage.getItem(stagingKey(OWNER_A))).toBeNull();
    });

    it("rejects invalid JSON, unknown schema versions, and owner mismatches", async () => {
        const store = new LocalStagingStore(window.localStorage);
        const key = stagingKey(OWNER_A);

        window.localStorage.setItem(key, "{not json");
        expect(() => store.read(OWNER_A)).toThrow(/not valid JSON/);

        // Only numeric literal versions 1 and 2 are accepted: 0, 3, missing,
        // and arbitrary unknown values all fail closed before any v2 validation.
        for (const version of [0, 3, 999]) {
            window.localStorage.setItem(key, JSON.stringify({ schemaVersion: version, ownerId: OWNER_A }));
            expect(() => store.read(OWNER_A)).toThrow(/Unsupported staging schema version/);
        }
        window.localStorage.setItem(key, JSON.stringify({ ownerId: OWNER_A }));
        expect(() => store.read(OWNER_A)).toThrow(/Unsupported staging schema version/);

        window.localStorage.clear();
        await store.update(OWNER_A, (r) => r);
        const tampered = JSON.parse(window.localStorage.getItem(key) as string) as { ownerId: string };
        tampered.ownerId = OWNER_B;
        window.localStorage.setItem(key, JSON.stringify(tampered));
        expect(() => store.read(OWNER_A)).toThrow(/owner mismatch/);
    });

    it("rejects an update that produces a record for a different owner", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await expect(store.update(OWNER_A, (r) => ({ ...r, ownerId: OWNER_B }))).rejects.toThrow(StagingStorageError);
    });

    it("counts entity deltas and surfaces pre-bootstrap edits before a baseline exists", async () => {
        const store = new LocalStagingStore(window.localStorage);

        // Uninitialized default: zero pending before any edit, and it must never
        // be confused with a full wipe.
        expect(store.pendingCount(OWNER_A)).toBe(0);
        expect(store.hasPending(OWNER_A)).toBe(false);
        await store.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, active_task: "t1" } }));
        // A pre-bootstrap edit is unsynced work: it surfaces as one pending item
        // even though no baseline exists to diff against.
        expect(store.pendingCount(OWNER_A)).toBe(1);
        expect(store.hasPending(OWNER_A)).toBe(true);

        await seedInitialized(store, OWNER_A);
        expect(store.pendingCount(OWNER_A)).toBe(0);

        // New task upsert.
        await store.update(OWNER_A, (r) => ({
            ...r,
            state: {
                ...r.state,
                tasks: { ...r.state.tasks, t2: { ...BASE_TASK, id: "t2", name: "New" } },
            },
            taskUpdatedAt: { ...r.taskUpdatedAt, t2: "2026-01-02T00:00:00.000Z" },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(1);

        // Task tombstone for the baseline task.
        await store.update(OWNER_A, (r) => ({
            ...r,
            state: {
                ...r.state,
                tasks: Object.fromEntries(Object.entries(r.state.tasks).filter(([id]) => id !== "t1")),
            },
            taskTombstones: { ...r.taskTombstones, t1: { id: "t1", deletedAt: "2026-01-03T00:00:00.000Z" } },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(2);

        // New log.
        await store.update(OWNER_A, (r) => ({
            ...r,
            state: {
                ...r.state,
                logs: [...r.state.logs, { ...BASE_LOG, id: "log-1", finished_at: "2026-01-02T00:25:00.000Z" }],
            },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(3);

        // Changed settings singleton.
        await store.update(OWNER_A, (r) => ({
            ...r,
            state: { ...r.state, settings: { ...r.state.settings, work_minutes: 50 } },
            settingsUpdatedAt: "2026-01-04T00:00:00.000Z",
        }));
        expect(store.pendingCount(OWNER_A)).toBe(4);

        // Changed timer singleton.
        await store.update(OWNER_A, (r) => ({
            ...r,
            state: { ...r.state, current_cycle_pomodoros: 1 },
            timerUpdatedAt: "2026-01-05T00:00:00.000Z",
        }));
        expect(store.pendingCount(OWNER_A)).toBe(5);

        // Changed PM singleton.
        await store.update(OWNER_A, (r) => ({
            ...r,
            pmState: { projects: {}, tasks: {}, meta: { initializedAt: "2026-01-06T00:00:00.000Z" } },
            pmUpdatedAt: "2026-01-06T00:00:00.000Z",
        }));
        expect(store.pendingCount(OWNER_A)).toBe(6);

        // Log tombstone for the baseline log.
        await store.update(OWNER_A, (r) => ({
            ...r,
            state: { ...r.state, logs: r.state.logs.filter((log) => log.id !== "log-0") },
            logTombstones: { ...r.logTombstones, "log-0": { id: "log-0", deletedAt: "2026-01-07T00:00:00.000Z" } },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(7);
    });

    it("counts a full wipe as one scoped change plus PM and each habit/completion delta", async () => {
        const store = new LocalStagingStore(window.localStorage);
        const baseline = makeBaseline({
            habits: {
                h1: { value: H("h1", { name: "Base h1" }), updatedAt: "2026-01-01T00:00:00.000Z" },
                doomed: { value: H("doomed", { name: "Doomed" }), updatedAt: "2026-01-01T00:00:00.000Z" },
            },
            habitCompletions: {
                c1: HC("c1", "h1"),
                doomedC: HC("doomedC", "doomed"),
            },
        });
        await seedInitialized(store, OWNER_A, baseline);
        await store.update(OWNER_A, (r) => ({
            ...r,
            habits: {
                h1: { ...baseline.habits.h1.value },
                doomed: { ...baseline.habits.doomed.value },
            },
            habitCompletions: {
                c1: { ...baseline.habitCompletions.c1 },
                doomedC: { ...baseline.habitCompletions.doomedC },
            },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(0);

        // Wipe replaces app state but must not be counted per removed row.
        await store.update(OWNER_A, (r) => ({
            ...r,
            fullWipe: { createdAt: "2026-01-10T00:00:00.000Z" },
            timerCompleted: false,
            state: makeAppState(),
        }));
        expect(store.pendingCount(OWNER_A)).toBe(1);

        // PM changing independently adds exactly one more.
        await store.update(OWNER_A, (r) => ({
            ...r,
            pmState: { projects: {}, tasks: {}, meta: { initializedAt: "2026-01-11T00:00:00.000Z" } },
            pmUpdatedAt: "2026-01-11T00:00:00.000Z",
        }));
        expect(store.pendingCount(OWNER_A)).toBe(2);

        // Two habit upserts each count as one item, not one collapsed habit.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habits: { h1: H("h1", { name: "Staged during wipe" }), h2: H("h2", { name: "Second habit" }) },
            habitUpdatedAt: { h1: "2026-01-12T00:00:00.000Z", h2: "2026-01-12T00:00:00.000Z" },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(4);

        // A habit tombstone over a baseline habit counts as one more item.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habitTombstones: { doomed: { id: "doomed", deletedAt: "2026-01-13T00:00:00.000Z" } },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(5);

        // A completion upsert and a completion tombstone each add one item.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habitCompletions: { c1: HC("c1", "h1"), c2: HC("c2", "h1", { bucket: "2026-01-02" }) },
            habitCompletionTombstones: { doomedC: { id: "doomedC", deletedAt: "2026-01-14T00:00:00.000Z" } },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(7);
    });

    it("counts habit upserts, tombstones, completion upserts, and completion tombstones as one item each", async () => {
        const store = new LocalStagingStore(window.localStorage);
        const baseline = makeBaseline({
            habits: { h1: { value: H("h1", { name: "Base" }), updatedAt: "2026-01-01T00:00:00.000Z" } },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        await store.update(OWNER_A, (current) => ({
            ...current,
            initialized: true,
            state: makeAppState(),
            lastSynced: baseline,
        }));
        expect(store.pendingCount(OWNER_A)).toBe(0);

        // A habit that differs from the baseline and carries a new stamp.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habits: { h1: H("h1", { name: "Changed" }) },
            habitUpdatedAt: { h1: "2026-01-02T00:00:00.000Z" },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(1);

        // Removing the baseline habit is represented only by its tombstone.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habits: {},
            habitUpdatedAt: {},
            habitTombstones: { h1: { id: "h1", deletedAt: "2026-01-03T00:00:00.000Z" } },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(1);

        // A new/changed completion value.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habitCompletions: { c1: HC("c1", "h1", { bucket: "2026-01-02" }) },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(2);

        // Removing the baseline completion is represented only by its tombstone.
        await store.update(OWNER_A, (r) => ({
            ...r,
            habitCompletions: {},
            habitCompletionTombstones: { c1: { id: "c1", deletedAt: "2026-01-04T00:00:00.000Z" } },
        }));
        expect(store.pendingCount(OWNER_A)).toBe(2);
    });

    it("round-trips a populated v2 record losslessly through serialize then parse", async () => {
        const store = new LocalStagingStore(window.localStorage);
        const baseline = makeBaseline({
            habits: { h1: { value: H("h1"), updatedAt: "2026-01-01T00:00:00.000Z" } },
            habitCompletions: { c1: HC("c1", "h1") },
        });
        await store.update(OWNER_A, (current) => ({
            ...current,
            initialized: true,
            state: makeAppState(),
            lastSynced: baseline,
            habits: { h1: H("h1", { name: "Saved" }) },
            habitUpdatedAt: { h1: "2026-01-02T00:00:00.000Z" },
            habitCompletions: { c1: HC("c1", "h1", { bucket: "2026-01-02" }) },
        }));

        const record = store.read(OWNER_A);
        expect(record.schemaVersion).toBe(2);
        expect(record.habits.h1.name).toBe("Saved");
        expect(record.habitUpdatedAt.h1).toBe("2026-01-02T00:00:00.000Z");
        expect(record.habitCompletions.c1.bucket).toBe("2026-01-02");
        expect(record.lastSynced?.habits.h1.value.name).toBe("Habit h1");
        expect(record.lastSynced?.habitCompletions.c1.id).toBe("c1");

        // Re-parsing the serialized bytes yields an identical record.
        expect(store.read(OWNER_A)).toEqual(record);
    });

    it("migrates a complete v1 record in memory and never creates a v2 storage key", async () => {
        const store = new LocalStagingStore(window.localStorage);
        // Persist a fully-populated record, then degrade it to the legacy v1
        // shape by stripping the five new top-level fields and both snapshot
        // maps while keeping every legacy field populated.
        await store.update(OWNER_A, (current) => ({
            ...current,
            initialized: true,
            state: makeAppState({
                tasks: { t1: { ...BASE_TASK, name: "Legacy task" } },
                logs: [{ ...BASE_LOG }],
                settings: { work_minutes: 50, short_break_minutes: 5, long_break_minutes: 20, segment_length: 4 },
            }),
            settingsUpdatedAt: "2026-01-02T00:00:00.000Z",
            timerUpdatedAt: "2026-01-02T00:00:00.000Z",
            pmState: { projects: {}, tasks: {}, meta: { initializedAt: "2026-01-02T00:00:00.000Z" } },
            pmUpdatedAt: "2026-01-02T00:00:00.000Z",
            taskTombstones: { t1: { id: "t1", deletedAt: "2026-01-03T00:00:00.000Z" } },
            logTombstones: { "log-0": { id: "log-0", deletedAt: "2026-01-03T00:00:00.000Z" } },
            lastSynced: makeBaseline(),
        }));
        const key = stagingKey(OWNER_A);
        const degraded = JSON.parse(window.localStorage.getItem(key) as string) as Record<string, unknown>;
        delete degraded.habits;
        delete degraded.habitCompletions;
        delete degraded.habitUpdatedAt;
        delete degraded.habitTombstones;
        delete degraded.habitCompletionTombstones;
        delete (degraded.lastSynced as Record<string, unknown>).habits;
        delete (degraded.lastSynced as Record<string, unknown>).habitCompletions;
        degraded.schemaVersion = 1;
        window.localStorage.setItem(key, JSON.stringify(degraded));

        const migrated = store.read(OWNER_A);
        expect(migrated.schemaVersion).toBe(2);
        // Every legacy value survives the in-memory migration.
        expect(migrated.state.tasks.t1.name).toBe("Legacy task");
        expect(migrated.state.logs).toEqual([{ ...BASE_LOG }]);
        expect(migrated.state.settings.work_minutes).toBe(50);
        expect(migrated.settingsUpdatedAt).toBe("2026-01-02T00:00:00.000Z");
        expect(migrated.pmState).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "2026-01-02T00:00:00.000Z" } });
        expect(migrated.taskTombstones.t1).toEqual({ id: "t1", deletedAt: "2026-01-03T00:00:00.000Z" });
        expect(migrated.logTombstones["log-0"]).toEqual({ id: "log-0", deletedAt: "2026-01-03T00:00:00.000Z" });
        // The five new local fields and both snapshot maps are injected empty.
        expect(migrated.habits).toEqual({});
        expect(migrated.habitCompletions).toEqual({});
        expect(migrated.habitUpdatedAt).toEqual({});
        expect(migrated.habitTombstones).toEqual({});
        expect(migrated.habitCompletionTombstones).toEqual({});
        expect(migrated.lastSynced?.habits).toEqual({});
        expect(migrated.lastSynced?.habitCompletions).toEqual({});

        // One safe staged update stays schema 2 on the same v1-prefixed key and
        // never creates a worktime:staging:v2:* key.
        await store.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, active_task: "t1" } }));
        expect(store.read(OWNER_A).schemaVersion).toBe(2);
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) keys.push(window.localStorage.key(i) as string);
        expect(keys.filter((candidate) => candidate.startsWith("worktime:staging:"))).toEqual([key]);
    });

    it("counts zero pending when an initialized record exactly matches its baseline", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await seedInitialized(store, OWNER_A);
        expect(store.pendingCount(OWNER_A)).toBe(0);
        expect(store.hasPending(OWNER_A)).toBe(false);
    });

    it("replaceFromExternal observes external writes without caching", () => {
        const store = new LocalStagingStore(window.localStorage);
        const listener = vi.fn();
        store.subscribe(OWNER_A, listener);

        expect(store.replaceFromExternal(OWNER_A).revision).toBe(0);
        expect(listener).toHaveBeenCalledTimes(1);

        const record = store.read(OWNER_A);
        window.localStorage.setItem(
            stagingKey(OWNER_A),
            JSON.stringify({ ...record, revision: 41, initialized: true, lastSynced: makeBaseline() }),
        );
        expect(store.replaceFromExternal(OWNER_A).revision).toBe(41);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("exports the prefix and key helpers for storage-event filtering", () => {
        expect(STAGING_STORAGE_PREFIX).toBe("worktime:staging:v1:");
        expect(stagingKey(OWNER_A)).toBe(`${STAGING_STORAGE_PREFIX}${OWNER_A}`);
        expect(stagingOwnerId(stagingKey(OWNER_A))).toBe(OWNER_A);
        expect(stagingOwnerId("sb-example-auth-token")).toBeNull();
        expect(stagingOwnerId("pm_state_v1")).toBeNull();
    });

    it("never touches unrelated localStorage keys such as pm_state_v1 or auth tokens", async () => {
        const store = new LocalStagingStore(window.localStorage);
        window.localStorage.setItem("pm_state_v1", "ui-prefs");
        window.localStorage.setItem("sb-example-auth-token", "session");
        await store.update(OWNER_A, (r) => r);
        expect(window.localStorage.getItem("pm_state_v1")).toBe("ui-prefs");
        expect(window.localStorage.getItem("sb-example-auth-token")).toBe("session");
    });

    it("works against a plain StorageLike fake and surfaces corrupt records", async () => {
        const store = new LocalStagingStore(corruptStorage({}));
        expect(store.read(OWNER_A).initialized).toBe(false);
        await store.update(OWNER_A, (r) => ({ ...r, initialized: true }));
        expect(store.read(OWNER_A).initialized).toBe(true);

        const corrupt = new LocalStagingStore(
            corruptStorage({ [stagingKey(OWNER_A)]: JSON.stringify({ schemaVersion: 2, ownerId: OWNER_A }) }),
        );
        expect(() => corrupt.read(OWNER_A)).toThrow(StagingStorageError);
    });

    it("serializes interleaved two-store writes through an owner-scoped lock", async () => {
        const lockNames: string[] = [];
        const lockMock = vi.fn(async (name: string, callback: () => Promise<void>) => {
            lockNames.push(name);
            await callback();
        });
        Object.defineProperty(navigator, "locks", { value: { request: lockMock }, configurable: true });

        const storeA = new LocalStagingStore(window.localStorage);
        const storeB = new LocalStagingStore(window.localStorage);
        try {
            await Promise.all([
                storeA.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, active_task: "a" } })),
                storeB.update(OWNER_A, (r) => ({ ...r, state: { ...r.state, current_cycle_pomodoros: 7 } })),
            ]);
        } finally {
            delete (navigator as unknown as { locks?: unknown }).locks;
        }

        // Both updates ran through the same owner-scoped lock.
        expect(lockNames.length).toBe(2);
        expect(lockNames.every((name) => name === `${stagingKey(OWNER_A)}:lock`)).toBe(true);

        // Store B re-read inside the lock, so both mutations survive and the
        // revision advanced exactly twice (never overwritten by a stale snapshot).
        const record = storeA.read(OWNER_A);
        expect(record.revision).toBe(2);
        expect(record.state.active_task).toBe("a");
        expect(record.state.current_cycle_pomodoros).toBe(7);
    });

    it("falls back to unlocked writes when the Web Locks API is unavailable", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await store.update(OWNER_A, (r) => ({ ...r, initialized: true }));
        expect(store.read(OWNER_A).initialized).toBe(true);
    });
});
