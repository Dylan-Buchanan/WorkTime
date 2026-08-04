import { defaultAppState } from "../../engine";
import type { AppStateData } from "../../../state/types";
import { deepValuesEqual } from "./serialization";
import {
    STAGING_SCHEMA_VERSION,
    MAX_PENDING_COMPLETIONS,
    StagingStorageError,
    parseStagedOwnerRecord,
    type StagedOwnerRecord,
    type SyncSnapshot,
    type TimerStateSlice,
} from "./types";

/** Minimal storage interface compatible with `window.localStorage`. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** Storage key prefix for the per-owner staging records. */
export const STAGING_STORAGE_PREFIX = "worktime:staging:v1:";

export function stagingKey(ownerId: string): string {
    return `${STAGING_STORAGE_PREFIX}${ownerId}`;
}

/**
 * Maps a storage key to the owner it belongs to, or `null` when the key is not
 * a staging record. Lets storage-event wiring filter `worktime:staging:v1:*`
 * keys without touching GoTrue `sb-...-auth-token` or `pm_state_v1` keys.
 */
export function stagingOwnerId(key: string): string | null {
    return key.startsWith(STAGING_STORAGE_PREFIX) ? key.slice(STAGING_STORAGE_PREFIX.length) : null;
}

/** Fresh, uninitialized record for an owner that has no persisted record. */
function freshRecord(ownerId: string): StagedOwnerRecord {
    return {
        schemaVersion: STAGING_SCHEMA_VERSION,
        ownerId,
        revision: 0,
        initialized: false,
        state: defaultAppState(),
        pmState: null,
        taskUpdatedAt: {},
        settingsUpdatedAt: null,
        timerUpdatedAt: null,
        pmUpdatedAt: null,
        timerCompleted: false,
        taskTombstones: {},
        logTombstones: {},
        fullWipe: null,
        pendingCompletions: [],
        unbootstrapped: false,
        lastSynced: null,
        habits: {},
        habitCompletions: {},
        habitUpdatedAt: {},
        habitTombstones: {},
        habitCompletionTombstones: {},
    };
}

function timerSliceOf(state: AppStateData): TimerStateSlice {
    return {
        active_task: state.active_task,
        current_cycle_pomodoros: state.current_cycle_pomodoros,
        timer: state.timer,
    };
}

/**
 * True when a local singleton differs from its baseline. A non-null local stamp
 * wins (the record stamps every write); a null stamp falls back to a defensive
 * value comparison so an edit that was never stamped is still detected.
 */
function versionedChanged(
    localStamp: string | null,
    baselineStamp: string | null,
    localValue: unknown,
    baselineValue: unknown,
): boolean {
    if (localStamp !== null) return localStamp !== baselineStamp;
    return baselineValue !== null && !deepValuesEqual(localValue, baselineValue);
}

function pmDiffers(record: StagedOwnerRecord, base: SyncSnapshot): boolean {
    return versionedChanged(record.pmUpdatedAt, base.pmState.updatedAt, record.pmState, base.pmState.value);
}

/**
 * Habit deltas relative to the baseline. Each current habit that differs from
 * `base.habits` and carries a new/different `habitUpdatedAt` stamp counts as
 * one item; each habit tombstone counts only while the baseline still carries
 * that habit, matching the task/task-tombstone comparison used for the plan.
 */
function countHabitDeltas(record: StagedOwnerRecord, base: SyncSnapshot): number {
    let count = 0;
    const habitIds = new Set<string>([...Object.keys(record.habits), ...Object.keys(base.habits)]);
    for (const id of habitIds) {
        const current = record.habits[id];
        if (!current) continue; // local removal is represented by its tombstone below.
        const baseline = base.habits[id];
        const localStamp = record.habitUpdatedAt[id];
        const baselineStamp = baseline?.updatedAt;
        const valueUnchanged = baseline !== undefined && deepValuesEqual(current, baseline.value);
        const neverTouchedLocally = baseline !== undefined && localStamp === undefined;
        const stampUnchanged = baseline !== undefined && localStamp === baselineStamp;
        if (valueUnchanged && (neverTouchedLocally || stampUnchanged)) continue;
        count += 1;
    }
    for (const id of Object.keys(record.habitTombstones)) {
        if (base.habits[id]) count += 1;
    }
    return count;
}

/**
 * Habit completion deltas relative to the baseline. Each current completion
 * whose value differs from `base.habitCompletions[id]` counts as one item; each
 * completion tombstone counts only while the baseline still carries it.
 */
function countHabitCompletionDeltas(record: StagedOwnerRecord, base: SyncSnapshot): number {
    let count = 0;
    const completionIds = new Set<string>([
        ...Object.keys(record.habitCompletions),
        ...Object.keys(base.habitCompletions),
    ]);
    for (const id of completionIds) {
        const current = record.habitCompletions[id];
        if (!current) continue;
        const baseline = base.habitCompletions[id] ?? null;
        if (baseline !== null && deepValuesEqual(current, baseline)) continue;
        count += 1;
    }
    for (const id of Object.keys(record.habitCompletionTombstones)) {
        if (base.habitCompletions[id]) count += 1;
    }
    return count;
}

/**
 * Entity-based pending work relative to `lastSynced`. Task upserts, task
 * tombstones, new/changed logs, log tombstones, habit upserts, habit
 * tombstones, new/changed habit completions, completion tombstones, and each
 * changed settings/timer/PM singleton count as one item. A full wipe counts as
 * one scoped change plus one more for PM when it differs plus every
 * habit/completion delta, instead of counting every removed row.
 * Completion-derived entities are part of those entity counts; journal entries
 * are never counted separately. Before the first successful bootstrap there is
 * no baseline to compare against, so any staged edit (`unbootstrapped`) counts
 * as one unsynced item instead of zero.
 */
function countPending(record: StagedOwnerRecord): number {
    if (!record.initialized || record.lastSynced === null) return record.unbootstrapped ? 1 : 0;
    const base = record.lastSynced;

    if (record.fullWipe) {
        let count = 1;
        if (pmDiffers(record, base)) count += 1;
        count += countHabitDeltas(record, base);
        count += countHabitCompletionDeltas(record, base);
        return count;
    }

    let count = 0;

    // Task upserts: current tasks that differ from the baseline snapshot.
    const taskIds = new Set<string>([...Object.keys(record.state.tasks), ...Object.keys(base.tasks)]);
    for (const id of taskIds) {
        const current = record.state.tasks[id];
        const baseline = base.tasks[id];
        if (!current) continue; // local removal is represented by its tombstone below.
        const localStamp = record.taskUpdatedAt[id];
        const baselineStamp = baseline?.updatedAt;
        const valueUnchanged = baseline !== undefined && deepValuesEqual(current, baseline.value);
        const neverTouchedLocally = baseline !== undefined && localStamp === undefined;
        const stampUnchanged = baseline !== undefined && localStamp === baselineStamp;
        if (valueUnchanged && (neverTouchedLocally || stampUnchanged)) continue;
        count += 1;
    }

    // Task tombstones: pending while the baseline still carries the task.
    for (const id of Object.keys(record.taskTombstones)) {
        if (base.tasks[id]) count += 1;
    }

    // Logs: current logs that differ from the baseline log map. Removals are
    // represented only by logTombstones below, never double-counted here.
    const currentLogs = new Map(record.state.logs.map((log) => [log.id, log] as const));
    const logIds = new Set<string>([...currentLogs.keys(), ...Object.keys(base.logs)]);
    for (const id of logIds) {
        const current = currentLogs.get(id);
        if (!current) continue;
        const baseline = base.logs[id] ?? null;
        if (baseline !== null && deepValuesEqual(current, baseline)) continue;
        count += 1;
    }

    // Log tombstones: pending while the baseline still carries the log.
    for (const id of Object.keys(record.logTombstones)) {
        if (base.logs[id]) count += 1;
    }

    // Versioned singleton rows.
    if (versionedChanged(record.settingsUpdatedAt, base.settings.updatedAt, record.state.settings, base.settings.value)) {
        count += 1;
    }
    if (
        versionedChanged(
            record.timerUpdatedAt,
            base.timerState.updatedAt,
            timerSliceOf(record.state),
            base.timerState.value,
        )
    ) {
        count += 1;
    }
    if (pmDiffers(record, base)) count += 1;

    count += countHabitDeltas(record, base);
    count += countHabitCompletionDeltas(record, base);

    return count;
}

type Listener = () => void;

/**
 * Per-owner localStorage staging store. The persisted record is the only source
 * of truth; nothing is cached, so `localStorage.clear()` and other-tab writes
 * are observed on every read. This class does not listen for browser `storage`
 * events — React lifecycle wiring owns that event and calls
 * `replaceFromExternal`/notifies views.
 */
export class LocalStagingStore {
    private readonly storage: StorageLike;
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(storage: StorageLike, _options?: { now?: () => Date }) {
        this.storage = storage;
    }

    /** Reads the current persisted record (or a fresh uninitialized default). */
    read(ownerId: string): StagedOwnerRecord {
        const raw = this.storage.getItem(stagingKey(ownerId));
        if (raw === null) return freshRecord(ownerId);
        return parseStagedOwnerRecord(raw, ownerId);
    }

    /**
     * Re-reads the latest record immediately before applying the mutation,
     * increments `revision`, persists, then notifies same-tab subscribers.
     * Write failures surface as `StagingStorageError` and never notify.
     *
     * The per-owner record is shared by every PWA tab, so the whole
     * read-modify-write runs inside a cross-context lock scoped to the owner.
     * Tabs serialize on the lock and each re-reads the record inside it, so a
     * concurrent tab can never overwrite a newer record with a stale snapshot.
     * When the Web Locks API is unavailable (older webviews, tests) the write
     * falls back to the single-context path.
     */
    async update(ownerId: string, mutate: (current: StagedOwnerRecord) => StagedOwnerRecord): Promise<StagedOwnerRecord> {
        const persisted = await this.withOwnerLock(ownerId, () => {
            const current = this.read(ownerId);
            const next = mutate(current);
            if (next.ownerId !== ownerId) {
                throw new StagingStorageError(`Staged update produced a different owner than "${ownerId}"`);
            }
            if (next.schemaVersion !== STAGING_SCHEMA_VERSION) {
                throw new StagingStorageError(
                    `Staged update produced an unsupported schema version for owner "${ownerId}"`,
                );
            }
            if (!Array.isArray(next.pendingCompletions) || next.pendingCompletions.length > MAX_PENDING_COMPLETIONS) {
                throw new StagingStorageError(
                    `Staging record for owner "${ownerId}" exceeds the maximum of ${MAX_PENDING_COMPLETIONS} pending completions`,
                );
            }
            const stored: StagedOwnerRecord = {
                ...next,
                ownerId,
                schemaVersion: STAGING_SCHEMA_VERSION,
                revision: current.revision + 1,
                unbootstrapped: next.initialized ? false : current.unbootstrapped || next !== current,
            };
            try {
                this.storage.setItem(stagingKey(ownerId), JSON.stringify(stored));
            } catch (error) {
                throw new StagingStorageError(
                    `Unable to persist staging record for owner "${ownerId}": ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
            return stored;
        });
        this.notify(ownerId);
        return persisted;
    }

    /**
     * Runs the read-modify-write inside the owner-scoped cross-context lock.
     * The lock name is derived from the staging key so unrelated owners never
     * serialize against each other. Any lock-API failure falls back to the
     * unlocked path so a broken lock manager can never block persistence; the
     * mutation itself runs exactly once because the fallback only applies when
     * the manager is absent, not when its callback rejects.
     */
    private async withOwnerLock(ownerId: string, run: () => StagedOwnerRecord): Promise<StagedOwnerRecord> {
        const manager = typeof navigator !== "undefined" ? navigator.locks : undefined;
        if (!manager || typeof manager.request !== "function") return run();
        return manager.request(`${stagingKey(ownerId)}:lock`, async () => run());
    }

    /** Re-reads after an external change and refreshes same-tab subscribers. */
    replaceFromExternal(ownerId: string): StagedOwnerRecord {
        const record = this.read(ownerId);
        this.notify(ownerId);
        return record;
    }

    /** Subscribes a same-tab listener; returns an unsubscribe function. */
    subscribe(ownerId: string, listener: () => void): () => void {
        let set = this.listeners.get(ownerId);
        if (!set) {
            set = new Set();
            this.listeners.set(ownerId, set);
        }
        set.add(listener);
        return () => {
            const current = this.listeners.get(ownerId);
            current?.delete(listener);
            if (current && current.size === 0) this.listeners.delete(ownerId);
        };
    }

    /** Number of staged entities that differ from the last synced baseline. */
    pendingCount(ownerId: string): number {
        return countPending(this.read(ownerId));
    }

    hasPending(ownerId: string): boolean {
        return this.pendingCount(ownerId) > 0;
    }

    private notify(ownerId: string): void {
        const set = this.listeners.get(ownerId);
        if (!set) return;
        for (const listener of [...set]) {
            try {
                listener();
            } catch {
                // A subscriber failure must not break persistence or other listeners.
            }
        }
    }
}
