import type { ActiveTimer, Habit, HabitCompletion, PomodoroLogEntry, Settings, Task } from "../../../state/types";
import type { SyncedPMState } from "../DataAccess";
import type { PendingTimerCompletion, StagedOwnerRecord, SyncSnapshot, TimerStateSlice, VersionedValue, HabitCompletionTombstone } from "../staging/types";

/**
 * The authenticated remote transport consumed by the sync coordinator. Every
 * method takes `expectedOwnerId` as a verification value only: the transport
 * refuses to read or write when the current session belongs to any other owner,
 * but never forwards the owner as an RPC/DML input (the RPCs derive the owner
 * from the caller's JWT).
 */
export interface SyncRemote {
    /** Pulls a complete versioned snapshot, paginating rows past api.max_rows. */
    pull(expectedOwnerId: string): Promise<SyncSnapshot>;
    /** Persists a local-only timer generation so its CAS can later be claimed. */
    installTimerGeneration(expectedOwnerId: string, entry: PendingTimerCompletion): Promise<void>;
    /** Replays one journaled completion through the CAS; true when it won. */
    completeTimer(expectedOwnerId: string, entry: PendingTimerCompletion): Promise<boolean>;
    /** Applies one idempotent staged non-completion batch transactionally. */
    push(expectedOwnerId: string, plan: PushPlan): Promise<void>;
    /** Refreshes the GoTrue session and verifies it still belongs to the owner. */
    refreshSession(expectedOwnerId: string): Promise<void>;
}

/**
 * Transport-neutral outputs for the staged-sync three-way merge. These shapes
 * keep SQL/RPC naming (`task_upserts`, `updated_at` columns) out of the pure
 * merge engine; `SupabaseDataAccess` converts a `PushPlan` into
 * `apply_staged_sync` parameter names.
 */

/**
 * Exact pending values/tombstone timestamps that one push intends to
 * acknowledge. `commitAcknowledgedPush` clears an item only when the current
 * stored value still equals the acknowledged value, so edits made while a sync
 * is in flight stay pending against the new baseline. Keys identify the exact
 * entity (task id, log id, habit id, completion id, ...) whose value/timestamp
 * was acknowledged.
 */
export interface AcknowledgedChanges {
    taskUpserts: Record<string, { value: Task; updatedAt: string }>;
    taskTombstones: Record<string, { deletedAt: string }>;
    logUpserts: Record<string, PomodoroLogEntry>;
    logTombstones: Record<string, { deletedAt: string }>;
    habitUpserts: Record<string, { value: Habit; updatedAt: string }>;
    habitTombstones: Record<string, { deletedAt: string }>;
    habitCompletionUpserts: Record<string, HabitCompletion>;
    habitCompletionTombstones: Record<string, Omit<HabitCompletionTombstone, "id">>;
    settings: VersionedValue<Settings> | null;
    timerState: VersionedValue<TimerStateSlice> | null;
    pmState: VersionedValue<SyncedPMState> | null;
    fullWipe: { createdAt: string } | null;
}

/**
 * The idempotent delta a client pushes through `apply_staged_sync`. Only
 * entities that differ from the pulled baseline are included; `baseRevision`
 * is the staging revision the plan was built against so a concurrent edit can
 * be detected when the commit runs.
 */
export interface PushPlan {
    baseRevision: number;
    taskUpserts: Array<{ value: Task; updatedAt: string }>;
    taskTombstones: Array<{ id: string; deletedAt: string }>;
    logUpserts: PomodoroLogEntry[];
    logTombstones: Array<{ id: string; deletedAt: string }>;
    habitUpserts: Array<{ value: Habit; updatedAt: string }>;
    habitTombstones: Array<{ id: string; deletedAt: string }>;
    habitCompletionUpserts: HabitCompletion[];
    habitCompletionTombstones: Array<HabitCompletionTombstone>;
    settings: VersionedValue<Settings> | null;
    timerState: (VersionedValue<TimerStateSlice> & { newGeneration: boolean }) | null;
    pmState: VersionedValue<SyncedPMState> | null;
    fullWipe: boolean;
    acknowledged: AcknowledgedChanges;
}

/**
 * Result of merging a pulled snapshot into the latest staging record. The
 * record has already advanced its baseline to the pulled snapshot
 * (`lastSynced === remoteBaseline`), so `buildPushPlan` on it yields only the
 * delta that still differs from the remote. `pendingCount` is the number of
 * staged entities that remain to be pushed against that baseline.
 */
export interface MergeResult {
    record: StagedOwnerRecord;
    remoteBaseline: SyncSnapshot;
    pendingCount: number;
}

// Re-exported for convenience so sync consumers can name the merge primitives
// without importing staging types directly.
export type { ActiveTimer, SyncSnapshot, TimerStateSlice, VersionedValue };
