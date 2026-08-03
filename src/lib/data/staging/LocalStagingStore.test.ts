import { describe, expect, it, vi } from "vitest";
import { makeAppState } from "../../../test/mockTauri";
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

function makeBaseline(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    const state = makeAppState({ tasks: { t1: { ...BASE_TASK } }, logs: [{ ...BASE_LOG }] });
    return {
        tasks: { t1: { value: { ...BASE_TASK }, updatedAt: "2026-01-01T00:00:00.000Z" } },
        logs: { "log-0": { ...BASE_LOG } },
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

        window.localStorage.setItem(key, JSON.stringify({ schemaVersion: 999, ownerId: OWNER_A }));
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

    it("counts a full wipe as one scoped change plus one only when PM differs", async () => {
        const store = new LocalStagingStore(window.localStorage);
        await seedInitialized(store, OWNER_A);

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
