import type { ActiveTimer, AppStateData, Habit, HabitCompletion, PomodoroLogEntry, Settings, Task } from "../../../state/types";
import type { SyncedPMState } from "../DataAccess";
import { defaultAppState } from "../../engine";
import { deepValuesEqual } from "../staging/serialization";
import type { StagedOwnerRecord, SyncSnapshot, TimerStateSlice, VersionedValue, HabitCompletionTombstone } from "../staging/types";
import type { AcknowledgedChanges, MergeResult, PushPlan } from "./types";
import { completionMask } from "./timerCompletions";
import type { Todo } from "../../todos";

/**
 * Pure three-way merge, push-plan construction, and post-push commit for the
 * per-owner staging record. No code here may access `Date.now`, localStorage,
 * Supabase, or UUID generation; the clock is injected and all inputs are
 * serializable values.
 */

/** Blocking error for bootstrap violations, corrupt records, or invalid timestamps. */
export class MergeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MergeError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** Baseline used for the first pull, when no server state has been observed yet. */
const EMPTY_SNAPSHOT: SyncSnapshot = {
    tasks: {},
    logs: {},
    habits: {},
    habitCompletions: {},
    todos: {},
    settings: { value: null, updatedAt: null },
    timerState: { value: null, updatedAt: null, completed: false },
    pmState: { value: null, updatedAt: null },
};

const TASK_FIELDS: ReadonlyArray<keyof Task> = [
    "name",
    "target_pomodoros",
    "completed_pomodoros",
    "created_at",
    "completed_at",
    "break_skips",
    "archived",
];

/**
 * Persisted habit fields used for the field-level three-way merge. `id` is the
 * identity key and `updatedAt` is derived from the merged row timestamp, so
 * neither participates in the per-field decisions.
 */
const HABIT_FIELDS: ReadonlyArray<keyof Habit> = [
    "name",
    "description",
    "color",
    "frequency",
    "position",
    "isArchived",
    "createdAt",
];

const TODO_FIELDS: ReadonlyArray<keyof Todo> = [
    "title",
    "rule",
    "dueDate",
    "estimate",
    "currentTaskId",
    "position",
    "isArchived",
    "createdAt",
];

function valuesEqual(a: unknown, b: unknown): boolean {
    // Key-order-insensitive: pulled snapshots carry server-normalized JSONB key
    // ordering, so a live local value must not report a spurious difference.
    return deepValuesEqual(a, b);
}

/**
 * Same change-detection contract as `LocalStagingStore`: a non-null local stamp
 * wins (the record stamps every write); a null stamp falls back to a defensive
 * value comparison so an unstamped edit is still detected.
 */
function versionedChanged(
    localStamp: string | null,
    baseStamp: string | null,
    localValue: unknown,
    baseValue: unknown,
): boolean {
    if (localStamp !== null) return localStamp !== baseStamp;
    return baseValue !== null && !deepValuesEqual(localValue, baseValue);
}

function timerSliceOf(state: AppStateData): TimerStateSlice {
    return {
        active_task: state.active_task,
        current_cycle_pomodoros: state.current_cycle_pomodoros,
        timer: state.timer,
    };
}

function pmDiffers(record: StagedOwnerRecord, base: SyncSnapshot): boolean {
    return versionedChanged(record.pmUpdatedAt, base.pmState.updatedAt, record.pmState, base.pmState.value);
}

/** Parses a timestamp or fails safely instead of silently ordering `NaN` dates. */
export function timestampMs(value: string): number {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
        throw new MergeError(`Invalid timestamp "${value}" cannot be ordered safely`);
    }
    return ms;
}

/**
 * The smallest deterministic timestamp strictly later than `value`. ISO
 * timestamps carry millisecond precision, so one millisecond is enough to
 * satisfy the RPC's strict `excluded.updated_at > stored.updated_at` LWW gate
 * without depending on the wall clock. Used when a synthesized habit row that
 * must be re-pushed would otherwise carry a stamp equal to the pulled remote
 * row's timestamp, which the server would reject as a no-op.
 */
function strictlyAfter(value: string): string {
    return new Date(timestampMs(value) + 1).toISOString();
}

/**
 * True when the timer is currently running: present, not paused, and not yet
 * past `ends_at`. Paused and expired timers are not protected. An invalid
 * `ends_at` fails safe by treating the timer as not live.
 */
export function isLiveTimer(timer: ActiveTimer | null, now: Date): boolean {
    return !!timer && !timer.paused && Date.parse(timer.ends_at) > now.getTime();
}

/**
 * Field-level three-way merge for a task present on both branches. For each
 * persisted field, a field changed on only one branch is kept from that branch;
 * when both changed it, the row with the later `updated_at` wins and the remote
 * value wins an exact tie. Returns the merged row and its merged timestamp
 * `max(localUpdatedAt, remoteUpdatedAt)`.
 */
function mergeTaskRow(
    localTask: Task,
    localStamp: string | undefined,
    remoteRow: { value: Task; updatedAt: string },
    baseRow: { value: Task; updatedAt: string } | undefined,
    now: Date,
): { value: Task; updatedAt: string } {
    const base = baseRow?.value;
    const localTs = localStamp ?? baseRow?.updatedAt;
    const remoteTs = remoteRow.updatedAt;

    // Task fields have mixed types, so build the merged row through a loose
    // record and cast back once all field decisions have been applied.
    const merged: Record<string, unknown> = { ...localTask };
    for (const field of TASK_FIELDS) {
        const localChanged = base === undefined || localTask[field] !== base[field];
        const remoteChanged = base === undefined || remoteRow.value[field] !== base[field];
        if (remoteChanged && localChanged) {
            // Both branches changed this field: later updated_at wins, remote wins ties.
            if (remoteTs !== undefined && (localTs === undefined || timestampMs(remoteTs) >= timestampMs(localTs))) {
                merged[field] = remoteRow.value[field];
            }
        } else if (remoteChanged) {
            merged[field] = remoteRow.value[field];
        }
        // Local-only or no change keeps the local (== baseline) value.
    }

    const updatedAt =
        localTs !== undefined && remoteTs !== undefined
            ? timestampMs(localTs) >= timestampMs(remoteTs)
                ? localTs
                : remoteTs
            : (localTs ?? remoteTs ?? now.toISOString());
    return { value: merged as unknown as Task, updatedAt };
}

interface MergedTasks {
    tasks: Record<string, Task>;
    stamps: Record<string, string>;
    tombstones: Record<string, { id: string; deletedAt: string }>;
}

/**
 * Merges every task id in the union of baseline/local/remote/tombstones.
 * Remote absence relative to a baseline row is a remote deletion; a locally
 * created task (never in the baseline) survives it. A local tombstone competes
 * with a remote row by `deletedAt` versus `updatedAt`: the newer deletion wins
 * and stays pending, a newer remote update revives the task and clears the
 * tombstone, and a remote that already lacks the row clears the tombstone.
 */
function mergeTasks(
    localState: AppStateData,
    taskUpdatedAt: Record<string, string>,
    taskTombstones: Record<string, { id: string; deletedAt: string }>,
    base: SyncSnapshot,
    remote: SyncSnapshot,
    now: Date,
): MergedTasks {
    const tasks: Record<string, Task> = {};
    const stamps: Record<string, string> = {};
    const tombstones: Record<string, { id: string; deletedAt: string }> = {};

    const ids = new Set<string>([
        ...Object.keys(base.tasks),
        ...Object.keys(localState.tasks),
        ...Object.keys(taskTombstones),
        ...Object.keys(remote.tasks),
    ]);

    for (const id of ids) {
        const baseRow = base.tasks[id];
        const localTask = localState.tasks[id];
        const localTombstone = taskTombstones[id];
        const remoteRow = remote.tasks[id];

        if (localTombstone) {
            if (remoteRow && timestampMs(remoteRow.updatedAt) > timestampMs(localTombstone.deletedAt)) {
                // A newer remote update revives the task and clears the tombstone.
                tasks[id] = { ...remoteRow.value };
            } else if (remoteRow) {
                // The newer deletion wins and remains pending against the pull.
                tombstones[id] = { id, deletedAt: localTombstone.deletedAt };
            }
            // No remote row: the remote already deleted it (or never had it),
            // so the tombstone is no longer pending work.
            continue;
        }

        if (!localTask) {
            if (remoteRow) {
                // Remote created/updated the row; adopt it. This also covers the
                // anomalous "local absent without a tombstone" state.
                tasks[id] = { ...remoteRow.value };
            }
            continue;
        }

        if (!remoteRow) {
            if (!baseRow) {
                // Locally created after the baseline; remote never had it.
                const stamp = taskUpdatedAt[id];
                if (stamp === undefined) {
                    throw new MergeError(`Locally-created task "${id}" has no updated_at stamp`);
                }
                tasks[id] = { ...localTask };
                stamps[id] = stamp;
            } else {
                // A remote deletion only wins over the unchanged baseline. If
                // this device edited the task after that baseline, preserve the
                // newer local value and re-send it as an upsert.
                const localStamp = taskUpdatedAt[id];
                if (
                    localStamp !== undefined &&
                    timestampMs(localStamp) > timestampMs(baseRow.updatedAt) &&
                    !valuesEqual(localTask, baseRow.value)
                ) {
                    tasks[id] = { ...localTask };
                    stamps[id] = localStamp;
                }
            }
            // Remote absence of a baseline row is a remote deletion; adopt it.
            continue;
        }

        // Both branches present: field-level three-way merge.
        const merged = mergeTaskRow(localTask, taskUpdatedAt[id], remoteRow, baseRow, now);
        tasks[id] = merged.value;
        if (!valuesEqual(merged.value, remoteRow.value)) {
            stamps[id] = merged.updatedAt;
        }
    }

    return { tasks, stamps, tombstones };
}

interface MergedLogs {
    logs: PomodoroLogEntry[];
    tombstones: Record<string, { id: string; deletedAt: string }>;
}

/**
 * Logs are an immutable union by client UUID, always materialized sorted by
 * `finished_at` then `id`. A local tombstone stays pending only while the pulled
 * baseline still carries the log; a brand-new remote log is retained unless the
 * same immutable ID is explicitly tombstoned.
 */
function mergeLogs(
    localLogs: PomodoroLogEntry[],
    logTombstones: Record<string, { id: string; deletedAt: string }>,
    remote: SyncSnapshot,
): MergedLogs {
    const mergedLogs = new Map<string, PomodoroLogEntry>();
    for (const log of localLogs) {
        if (!logTombstones[log.id]) mergedLogs.set(log.id, log);
    }
    for (const [id, log] of Object.entries(remote.logs)) {
        if (!logTombstones[id]) mergedLogs.set(id, log);
    }

    const tombstones: Record<string, { id: string; deletedAt: string }> = {};
    for (const [id, tombstone] of Object.entries(logTombstones)) {
        if (remote.logs[id]) tombstones[id] = { id, deletedAt: tombstone.deletedAt };
    }

    const logs = [...mergedLogs.values()].sort((a, b) => {
        const byFinished = a.finished_at.localeCompare(b.finished_at);
        return byFinished !== 0 ? byFinished : a.id.localeCompare(b.id);
    });
    return { logs, tombstones };
}

interface MergedHabits {
    habits: Record<string, Habit>;
    stamps: Record<string, string>;
    tombstones: Record<string, { id: string; deletedAt: string }>;
}

/**
 * Field-level three-way merge for a habit present on both branches, parallel to
 * `mergeTaskRow`. For each persisted field a change on only one branch is kept
 * from that branch; when both changed it, the row with the later timestamp wins
 * and the remote value wins an exact tie. `Habit.updatedAt` is domain data that
 * mirrors the transport LWW stamp, so the merged value carries the authored
 * timestamp while the caller records the same value as the pending push stamp.
 *
 * A synthesized row that differs from the pulled remote row must be re-pushed,
 * but the RPC LWW gate rejects an equal (or older) stamp as a no-op the client
 * would otherwise acknowledge as successful. When the merged stamp is not
 * strictly later than the remote timestamp, it is bumped deterministically so
 * the re-push is accepted and the next pull observes a converged row.
 */
function mergeHabitRow(
    localHabit: Habit,
    localStamp: string | undefined,
    remoteRow: { value: Habit; updatedAt: string },
    baseRow: { value: Habit; updatedAt: string } | undefined,
    now: Date,
): { value: Habit; updatedAt: string } {
    const base = baseRow?.value;
    const localTs = localStamp ?? baseRow?.updatedAt;
    const remoteTs = remoteRow.updatedAt;

    const merged: Record<string, unknown> = { ...localHabit };
    for (const field of HABIT_FIELDS) {
        const localChanged = base === undefined || localHabit[field] !== base[field];
        const remoteChanged = base === undefined || remoteRow.value[field] !== base[field];
        if (remoteChanged && localChanged) {
            // Both branches changed this field: later updated_at wins, remote wins ties.
            if (remoteTs !== undefined && (localTs === undefined || timestampMs(remoteTs) >= timestampMs(localTs))) {
                merged[field] = remoteRow.value[field];
            }
        } else if (remoteChanged) {
            merged[field] = remoteRow.value[field];
        }
        // Local-only or no change keeps the local (== baseline) value.
    }

    let updatedAt =
        localTs !== undefined && remoteTs !== undefined
            ? timestampMs(localTs) >= timestampMs(remoteTs)
                ? localTs
                : remoteTs
            : (localTs ?? remoteTs ?? now.toISOString());
    merged.updatedAt = updatedAt;
    const mergedHabit = merged as unknown as Habit;

    // Compare against the remote row while `mergedHabit.updatedAt` still equals
    // the un-bumped value so only genuine field divergence re-pushes.
    if (!valuesEqual(mergedHabit, remoteRow.value) && timestampMs(updatedAt) <= timestampMs(remoteTs)) {
        updatedAt = strictlyAfter(remoteTs);
        mergedHabit.updatedAt = updatedAt;
    }
    return { value: mergedHabit, updatedAt };
}

/**
 * Merges every habit id in the union of baseline/local/remote/tombstones using
 * the same rules as tasks: remote absence of a baseline row is a remote
 * deletion, a locally created habit (never in the baseline) survives it, and a
 * local tombstone competes with a remote row by `deletedAt` versus `updatedAt`
 * so a newer remote update revives the habit while the remote already lacking
 * the row clears the tombstone.
 */
function mergeHabits(
    localHabits: Record<string, Habit>,
    habitUpdatedAt: Record<string, string>,
    habitTombstones: Record<string, { id: string; deletedAt: string }>,
    base: SyncSnapshot,
    remote: SyncSnapshot,
    now: Date,
): MergedHabits {
    const habits: Record<string, Habit> = {};
    const stamps: Record<string, string> = {};
    const tombstones: Record<string, { id: string; deletedAt: string }> = {};

    const ids = new Set<string>([
        ...Object.keys(base.habits),
        ...Object.keys(localHabits),
        ...Object.keys(habitTombstones),
        ...Object.keys(remote.habits),
    ]);

    for (const id of ids) {
        const baseRow = base.habits[id];
        const localHabit = localHabits[id];
        const localTombstone = habitTombstones[id];
        const remoteRow = remote.habits[id];

        if (localTombstone) {
            if (remoteRow && timestampMs(remoteRow.updatedAt) > timestampMs(localTombstone.deletedAt)) {
                // A newer remote update revives the habit and clears the tombstone.
                habits[id] = { ...remoteRow.value };
            } else if (remoteRow) {
                // The newer deletion wins and remains pending against the pull.
                tombstones[id] = { id, deletedAt: localTombstone.deletedAt };
            }
            // No remote row: the remote already deleted it (or never had it),
            // so the tombstone is no longer pending work.
            continue;
        }

        if (!localHabit) {
            if (remoteRow) {
                habits[id] = { ...remoteRow.value };
            }
            continue;
        }

        if (!remoteRow) {
            if (!baseRow) {
                // Locally created after the baseline; remote never had it.
                const stamp = habitUpdatedAt[id];
                if (stamp === undefined) {
                    throw new MergeError(`Locally-created habit "${id}" has no updated_at stamp`);
                }
                habits[id] = { ...localHabit };
                stamps[id] = stamp;
            } else {
                // A remote deletion only wins over the unchanged baseline. If
                // this device edited the habit after that baseline, preserve the
                // newer local value and re-send it as an upsert.
                const localStamp = habitUpdatedAt[id];
                if (
                    localStamp !== undefined &&
                    timestampMs(localStamp) > timestampMs(baseRow.updatedAt) &&
                    !valuesEqual(localHabit, baseRow.value)
                ) {
                    habits[id] = { ...localHabit };
                    stamps[id] = localStamp;
                }
            }
            // Remote absence of a baseline row is a remote deletion; adopt it.
            continue;
        }

        // Both branches present: field-level three-way merge.
        const merged = mergeHabitRow(localHabit, habitUpdatedAt[id], remoteRow, baseRow, now);
        habits[id] = merged.value;
        if (!valuesEqual(merged.value, remoteRow.value)) {
            stamps[id] = merged.updatedAt;
        }
    }

    return { habits, stamps, tombstones };
}

interface MergedTodos {
    todos: Record<string, Todo>;
    stamps: Record<string, string>;
    tombstones: Record<string, { id: string; deletedAt: string }>;
}

function mergeTodoRow(
    localTodo: Todo,
    localStamp: string | undefined,
    remoteRow: { value: Todo; updatedAt: string },
    baseRow: { value: Todo; updatedAt: string } | undefined,
    now: Date,
): { value: Todo; updatedAt: string } {
    const base = baseRow?.value;
    const localTs = localStamp ?? baseRow?.updatedAt;
    const remoteTs = remoteRow.updatedAt;
    const merged: Record<string, unknown> = { ...localTodo };
    for (const field of TODO_FIELDS) {
        const localChanged = base === undefined || !valuesEqual(localTodo[field], base[field]);
        const remoteChanged = base === undefined || !valuesEqual(remoteRow.value[field], base[field]);
        if (remoteChanged && localChanged) {
            if (localTs === undefined || timestampMs(remoteTs) >= timestampMs(localTs)) merged[field] = remoteRow.value[field];
        } else if (remoteChanged) {
            merged[field] = remoteRow.value[field];
        }
    }
    let updatedAt =
        localTs !== undefined && timestampMs(localTs) >= timestampMs(remoteTs) ? localTs : (remoteTs ?? now.toISOString());
    merged.updatedAt = updatedAt;
    const mergedTodo = merged as unknown as Todo;
    if (!valuesEqual(mergedTodo, remoteRow.value) && timestampMs(updatedAt) <= timestampMs(remoteTs)) {
        updatedAt = strictlyAfter(remoteTs);
        mergedTodo.updatedAt = updatedAt;
    }
    return { value: mergedTodo, updatedAt };
}

function mergeTodos(
    localTodos: Record<string, Todo>,
    todoUpdatedAt: Record<string, string>,
    todoTombstones: Record<string, { id: string; deletedAt: string }>,
    base: SyncSnapshot,
    remote: SyncSnapshot,
    now: Date,
): MergedTodos {
    const todos: Record<string, Todo> = {};
    const stamps: Record<string, string> = {};
    const tombstones: Record<string, { id: string; deletedAt: string }> = {};
    const ids = new Set([
        ...Object.keys(base.todos), ...Object.keys(localTodos), ...Object.keys(todoTombstones), ...Object.keys(remote.todos),
    ]);
    for (const id of ids) {
        const baseRow = base.todos[id];
        const local = localTodos[id];
        const tombstone = todoTombstones[id];
        const remoteRow = remote.todos[id];
        if (tombstone) {
            if (remoteRow && timestampMs(remoteRow.updatedAt) > timestampMs(tombstone.deletedAt)) todos[id] = { ...remoteRow.value };
            else if (remoteRow) tombstones[id] = { ...tombstone };
            continue;
        }
        if (!local) {
            if (remoteRow) todos[id] = { ...remoteRow.value };
            continue;
        }
        if (!remoteRow) {
            if (!baseRow) {
                const stamp = todoUpdatedAt[id];
                if (stamp === undefined) throw new MergeError(`Locally-created to-do "${id}" has no updated_at stamp`);
                todos[id] = { ...local };
                stamps[id] = stamp;
            } else {
                const stamp = todoUpdatedAt[id];
                if (stamp !== undefined && timestampMs(stamp) > timestampMs(baseRow.updatedAt) && !valuesEqual(local, baseRow.value)) {
                    todos[id] = { ...local };
                    stamps[id] = stamp;
                }
            }
            continue;
        }
        const merged = mergeTodoRow(local, todoUpdatedAt[id], remoteRow, baseRow, now);
        todos[id] = merged.value;
        if (!valuesEqual(merged.value, remoteRow.value)) stamps[id] = merged.updatedAt;
    }
    return { todos, stamps, tombstones };
}

interface MergedHabitCompletions {
    habitCompletions: Record<string, HabitCompletion>;
    tombstones: Record<string, HabitCompletionTombstone>;
}

/**
 * Habit completions merge by the database idempotency key as well as by row
 * id. A completion present on both branches with the same id collapses to one
 * (the remote value wins). A local completion whose `(habitId, bucket)` is
 * already occupied by a different remote completion id is dropped in favor of
 * the pulled/server row, because the RPC replays a second id for that bucket
 * as a no-op through the `(habit_id, bucket)` unique constraint; keeping the
 * local id would leave a permanent ghost upsert that can never converge. A
 * tombstoned id is excluded, and a tombstone remains pending only while the
 * pulled remote snapshot still carries that completion id.
 *
 * Cascaded completion tombstones carry the parent habit id as provenance and
 * are suppressed when that habit survived the merge: a newer remote habit
 * update that revives the parent means the hard-delete intent lost, so the
 * completion history must survive instead of being pushed as an identity
 * delete. Unprovenanced tombstones (individual unchecks) keep the plain
 * identity-delete rule regardless of the habit's fate.
 */
function mergeHabitCompletions(
    localCompletions: Record<string, HabitCompletion>,
    habitCompletionTombstones: Record<string, HabitCompletionTombstone>,
    remote: SyncSnapshot,
    mergedHabits: Record<string, Habit>,
): MergedHabitCompletions {
    // Compute the effective tombstone set once so both the merged union and the
    // pending-tombstone output agree about which completions are deleted.
    const effective: Record<string, HabitCompletionTombstone> = {};
    for (const [id, tombstone] of Object.entries(habitCompletionTombstones)) {
        if (tombstone.habitId !== undefined && mergedHabits[tombstone.habitId]) continue;
        effective[id] = tombstone;
    }

    const merged = new Map<string, HabitCompletion>();
    for (const [id, completion] of Object.entries(localCompletions)) {
        if (!effective[id]) merged.set(id, completion);
    }

    // Track which id owns each (habitId, bucket) in the running merged set so a
    // conflicting local id can be dropped when the server's row claims the key.
    const bucketOwner = new Map<string, string>();
    for (const [id, completion] of merged) {
        bucketOwner.set(`${completion.habitId}\u0000${completion.bucket}`, id);
    }

    for (const [id, completion] of Object.entries(remote.habitCompletions)) {
        if (effective[id]) continue;
        const key = `${completion.habitId}\u0000${completion.bucket}`;
        if (merged.has(id)) {
            // Same id on both branches: the pulled row wins the value.
            merged.set(id, completion);
            continue;
        }
        const occupant = bucketOwner.get(key);
        if (occupant !== undefined && occupant !== id) {
            // This bucket is already held by a local id the database could
            // never insert; prefer the pulled/server completion and drop the
            // local ghost entirely so pending state can converge.
            merged.delete(occupant);
        }
        merged.set(id, completion);
        bucketOwner.set(key, id);
    }

    const tombstones: Record<string, HabitCompletionTombstone> = {};
    for (const [id, tombstone] of Object.entries(effective)) {
        if (remote.habitCompletions[id]) tombstones[id] = { ...tombstone };
    }

    return { habitCompletions: Object.fromEntries(merged), tombstones };
}

/**
 * Whole-row three-way merge for settings/timer/PM singleton rows. An unchanged
 * branch yields to the changed branch; a true conflict uses `updatedAt` with
 * the remote value winning ties. `forceLocal` keeps the complete local value
 * regardless of timestamps (live-timer protection). `changed` is true only when
 * the local branch authored the merged value and it must be pushed.
 */
function mergeSingletonValue<T>(
    localValue: T | null,
    localStamp: string | null,
    remote: VersionedValue<T>,
    base: VersionedValue<T>,
    now: Date,
    forceLocal = false,
): { value: T | null; stamp: string | null; changed: boolean } {
    if (forceLocal) {
        // A live timer is protected from a remote pull, but an unstamped timer
        // that is semantically equal to the baseline is not local pending work.
        // Only synthesize a stamp for a genuinely divergent unstamped value.
        if (localStamp === null) {
            const changed = base.value !== null && !valuesEqual(localValue, base.value);
            return { value: localValue, stamp: changed ? now.toISOString() : null, changed };
        }
        return { value: localValue, stamp: localStamp, changed: true };
    }

    const baseValue = base.value ?? null;
    const baseStamp = base.updatedAt;
    const localChanged =
        localStamp !== null
            ? localStamp !== baseStamp
            : (baseStamp !== null || baseValue !== null) && !valuesEqual(localValue, baseValue);
    const remoteChanged = !valuesEqual(remote.value ?? null, baseValue);

    if (localChanged && remoteChanged) {
        // True conflict: later updated_at wins, remote wins exact ties.
        const localTs = localStamp !== null ? timestampMs(localStamp) : Number.NEGATIVE_INFINITY;
        const remoteTs = remote.updatedAt !== null ? timestampMs(remote.updatedAt) : Number.NEGATIVE_INFINITY;
        if (localTs > remoteTs) {
            return { value: localValue, stamp: localStamp ?? now.toISOString(), changed: true };
        }
        return { value: remote.value ?? null, stamp: null, changed: false };
    }
    if (localChanged) {
        return { value: localValue, stamp: localStamp ?? now.toISOString(), changed: true };
    }
    if (remoteChanged) {
        return { value: remote.value ?? null, stamp: null, changed: false };
    }
    return { value: localValue, stamp: null, changed: false };
}

/**
 * Habit deltas relative to the baseline, mirroring the staging store's counter:
 * each current habit that differs from `base.habits` and carries a new/different
 * `habitUpdatedAt` stamp counts as one item; each habit tombstone counts only
 * while the baseline still carries that habit.
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
 * Habit completion deltas relative to the baseline, mirroring the staging
 * store's counter: each current completion whose value differs from
 * `base.habitCompletions[id]` counts as one item; each completion tombstone
 * counts only while the baseline still carries it.
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

function countTodoDeltas(record: StagedOwnerRecord, base: SyncSnapshot): number {
    let count = 0;
    const ids = new Set([...Object.keys(record.todos), ...Object.keys(base.todos)]);
    for (const id of ids) {
        const current = record.todos[id];
        if (!current) continue;
        const baseline = base.todos[id];
        const stamp = record.todoUpdatedAt[id];
        if (baseline && valuesEqual(current, baseline.value) && (stamp === undefined || stamp === baseline.updatedAt)) continue;
        count += 1;
    }
    for (const id of Object.keys(record.todoTombstones)) if (base.todos[id]) count += 1;
    return count;
}

/**
 * Pending work in a record relative to `base`, mirroring the staging store's
 * entity-based counting so `MergeResult.pendingCount` matches the persisted
 * record's `pendingCount()`. A full wipe counts as one scoped change plus one
 * more for PM when it differs plus every habit/completion delta, instead of
 * counting every removed row.
 */
function countPending(record: StagedOwnerRecord, base: SyncSnapshot): number {
    if (!record.initialized) return 0;
    if (record.fullWipe) {
        let count = 1;
        if (pmDiffers(record, base)) count += 1;
        count += countHabitDeltas(record, base);
        count += countHabitCompletionDeltas(record, base);
        count += countTodoDeltas(record, base);
        return count;
    }

    let count = 0;

    const taskIds = new Set<string>([...Object.keys(record.state.tasks), ...Object.keys(base.tasks)]);
    for (const id of taskIds) {
        const current = record.state.tasks[id];
        if (!current) continue;
        const baseline = base.tasks[id];
        const localStamp = record.taskUpdatedAt[id];
        const baselineStamp = baseline?.updatedAt;
        const valueUnchanged = baseline !== undefined && deepValuesEqual(current, baseline.value);
        const neverTouchedLocally = baseline !== undefined && localStamp === undefined;
        const stampUnchanged = baseline !== undefined && localStamp === baselineStamp;
        if (valueUnchanged && (neverTouchedLocally || stampUnchanged)) continue;
        count += 1;
    }
    for (const id of Object.keys(record.taskTombstones)) {
        if (base.tasks[id]) count += 1;
    }

    const currentLogs = new Map(record.state.logs.map((log) => [log.id, log] as const));
    const logIds = new Set<string>([...currentLogs.keys(), ...Object.keys(base.logs)]);
    for (const id of logIds) {
        const current = currentLogs.get(id);
        if (!current) continue;
        const baseline = base.logs[id] ?? null;
        if (baseline !== null && deepValuesEqual(current, baseline)) continue;
        count += 1;
    }
    for (const id of Object.keys(record.logTombstones)) {
        if (base.logs[id]) count += 1;
    }

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
    count += countTodoDeltas(record, base);

    return count;
}

/**
 * Pulls a remote snapshot into the latest staging record and returns the merged
 * record plus the count of changes still pending against that snapshot. The
 * merged record is always `initialized` with `lastSynced` advanced to the pull,
 * so a subsequent `buildPushPlan` yields only the delta that still differs from
 * the remote.
 */
export function mergePulledSnapshot(record: StagedOwnerRecord, remote: SyncSnapshot, now: Date): MergeResult {
    const base = record.lastSynced ?? EMPTY_SNAPSHOT;

    if (record.fullWipe) {
        // A scoped full wipe overrides remote tasks/logs/settings/timer with
        // engine defaults, retains the wipe marker, and merges PM normally.
        // Habits and completions are outside the wipe scope and merge against
        // base and remote exactly like an ordinary pull.
        const pm = mergeSingletonValue(record.pmState, record.pmUpdatedAt, remote.pmState, base.pmState, now);
        const habits = mergeHabits(record.habits, record.habitUpdatedAt, record.habitTombstones, base, remote, now);
        const completions = mergeHabitCompletions(
            record.habitCompletions,
            record.habitCompletionTombstones,
            remote,
            habits.habits,
        );
        const todos = mergeTodos(record.todos, record.todoUpdatedAt, record.todoTombstones, base, remote, now);
        const merged: StagedOwnerRecord = {
            ...record,
            initialized: true,
            lastSynced: remote,
            state: defaultAppState(),
            taskUpdatedAt: {},
            taskTombstones: {},
            logTombstones: {},
            settingsUpdatedAt: record.fullWipe.createdAt,
            timerUpdatedAt: record.fullWipe.createdAt,
            pmState: pm.value,
            pmUpdatedAt: pm.stamp,
            habits: habits.habits,
            habitCompletions: completions.habitCompletions,
            habitUpdatedAt: habits.stamps,
            habitTombstones: habits.tombstones,
            habitCompletionTombstones: completions.tombstones,
            todos: todos.todos,
            todoUpdatedAt: todos.stamps,
            todoTombstones: todos.tombstones,
            unbootstrapped: false,
        };
        return { record: merged, remoteBaseline: remote, pendingCount: countPending(merged, remote) };
    }

    const tasks = mergeTasks(record.state, record.taskUpdatedAt, record.taskTombstones, base, remote, now);
    const logs = mergeLogs(record.state.logs, record.logTombstones, remote);
    const habits = mergeHabits(record.habits, record.habitUpdatedAt, record.habitTombstones, base, remote, now);
    const completions = mergeHabitCompletions(
        record.habitCompletions,
        record.habitCompletionTombstones,
        remote,
        habits.habits,
    );
    const todos = mergeTodos(record.todos, record.todoUpdatedAt, record.todoTombstones, base, remote, now);
    const settings = mergeSingletonValue<Settings>(
        record.state.settings,
        record.settingsUpdatedAt,
        remote.settings,
        base.settings,
        now,
    );
    const liveTimer = isLiveTimer(record.state.timer, now);
    const timer = mergeSingletonValue<TimerStateSlice>(
        timerSliceOf(record.state),
        record.timerUpdatedAt,
        remote.timerState,
        base.timerState,
        now,
        liveTimer,
    );
    const pm = mergeSingletonValue<SyncedPMState>(record.pmState, record.pmUpdatedAt, remote.pmState, base.pmState, now);

    // A null winner (remote row absent) keeps the local UI/domain default value;
    // `state.settings` and the timer slice are never null.
    const settingsValue = settings.value ?? record.state.settings;
    const timerValue = timer.value ?? timerSliceOf(record.state);
    const timerCompleted = timer.changed ? record.timerCompleted : remote.timerState.completed;

    const mergedState: AppStateData = {
        ...record.state,
        tasks: tasks.tasks,
        logs: logs.logs,
        settings: settingsValue,
        active_task: timerValue.active_task,
        current_cycle_pomodoros: timerValue.current_cycle_pomodoros,
        timer: timerValue.timer,
    };

    const merged: StagedOwnerRecord = {
        ...record,
        initialized: true,
        lastSynced: remote,
        state: mergedState,
        taskUpdatedAt: tasks.stamps,
        taskTombstones: tasks.tombstones,
        logTombstones: logs.tombstones,
        settingsUpdatedAt: settings.stamp,
        timerUpdatedAt: timer.stamp,
        timerCompleted,
        pmState: pm.value,
        pmUpdatedAt: pm.stamp,
        habits: habits.habits,
        habitCompletions: completions.habitCompletions,
        habitUpdatedAt: habits.stamps,
        habitTombstones: habits.tombstones,
        habitCompletionTombstones: completions.tombstones,
        todos: todos.todos,
        todoUpdatedAt: todos.stamps,
        todoTombstones: todos.tombstones,
        unbootstrapped: false,
    };

    return { record: merged, remoteBaseline: remote, pendingCount: countPending(merged, remote) };
}

interface HabitDeltas {
    upserts: PushPlan["habitUpserts"];
    upsertAcks: AcknowledgedChanges["habitUpserts"];
    tombstones: PushPlan["habitTombstones"];
    tombstoneAcks: AcknowledgedChanges["habitTombstones"];
}

/**
 * Habit deltas relative to `base`. An upsert is emitted only when the current
 * value differs from the baseline row and the id carries a `habitUpdatedAt`
 * stamp (a changed unstamped habit is a corruption error). Tombstones are
 * emitted only while the baseline still carries the habit. These deltas are
 * independent of `completionMask` and of any full-wipe scope.
 */
function habitDeltasOf(record: StagedOwnerRecord, base: SyncSnapshot): HabitDeltas {
    const upserts: PushPlan["habitUpserts"] = [];
    const upsertAcks: AcknowledgedChanges["habitUpserts"] = {};
    const habitIds = new Set<string>([...Object.keys(record.habits), ...Object.keys(base.habits)]);
    for (const id of habitIds) {
        const current = record.habits[id];
        if (!current) continue;
        const baseline = base.habits[id];
        if (baseline !== undefined && valuesEqual(current, baseline.value)) continue;
        const updatedAt = record.habitUpdatedAt[id];
        if (updatedAt === undefined) {
            throw new MergeError(`Habit "${id}" differs from the baseline but has no updated_at stamp`);
        }
        upserts.push({ value: { ...current }, updatedAt });
        upsertAcks[id] = { value: { ...current }, updatedAt };
    }

    const tombstones: PushPlan["habitTombstones"] = [];
    const tombstoneAcks: AcknowledgedChanges["habitTombstones"] = {};
    for (const [id, tombstone] of Object.entries(record.habitTombstones)) {
        if (!base.habits[id]) continue; // redundant tombstone: nothing to delete on the server
        tombstones.push({ id, deletedAt: tombstone.deletedAt });
        tombstoneAcks[id] = { deletedAt: tombstone.deletedAt };
    }

    return { upserts, upsertAcks, tombstones, tombstoneAcks };
}

interface TodoDeltas {
    upserts: PushPlan["todoUpserts"];
    upsertAcks: AcknowledgedChanges["todoUpserts"];
    tombstones: PushPlan["todoTombstones"];
    tombstoneAcks: AcknowledgedChanges["todoTombstones"];
}

function todoDeltasOf(record: StagedOwnerRecord, base: SyncSnapshot): TodoDeltas {
    const upserts: PushPlan["todoUpserts"] = [];
    const upsertAcks: AcknowledgedChanges["todoUpserts"] = {};
    for (const [id, current] of Object.entries(record.todos)) {
        const baseline = base.todos[id];
        if (baseline && valuesEqual(current, baseline.value)) continue;
        const updatedAt = record.todoUpdatedAt[id];
        if (updatedAt === undefined) throw new MergeError(`To-do "${id}" differs from the baseline but has no updated_at stamp`);
        upserts.push({ value: { ...current }, updatedAt });
        upsertAcks[id] = { value: { ...current }, updatedAt };
    }
    const tombstones: PushPlan["todoTombstones"] = [];
    const tombstoneAcks: AcknowledgedChanges["todoTombstones"] = {};
    for (const [id, tombstone] of Object.entries(record.todoTombstones)) {
        if (!base.todos[id]) continue;
        tombstones.push({ id, deletedAt: tombstone.deletedAt });
        tombstoneAcks[id] = { deletedAt: tombstone.deletedAt };
    }
    return { upserts, upsertAcks, tombstones, tombstoneAcks };
}

interface CompletionDeltas {
    upserts: PushPlan["habitCompletionUpserts"];
    upsertAcks: AcknowledgedChanges["habitCompletionUpserts"];
    tombstones: PushPlan["habitCompletionTombstones"];
    tombstoneAcks: AcknowledgedChanges["habitCompletionTombstones"];
}

/**
 * Habit completion deltas relative to `base`. An upsert is emitted when the
 * current completion differs from its baseline row; the exact row is
 * acknowledged. Tombstones are emitted only while the baseline still carries
 * the completion id. These deltas are independent of `completionMask` and of
 * any full-wipe scope.
 */
function completionDeltasOf(record: StagedOwnerRecord, base: SyncSnapshot): CompletionDeltas {
    const upserts: PushPlan["habitCompletionUpserts"] = [];
    const upsertAcks: AcknowledgedChanges["habitCompletionUpserts"] = {};
    for (const [id, completion] of Object.entries(record.habitCompletions)) {
        const baseline = base.habitCompletions[id];
        if (baseline !== undefined && valuesEqual(completion, baseline)) continue;
        upserts.push({ ...completion });
        upsertAcks[id] = { ...completion };
    }

    const tombstones: PushPlan["habitCompletionTombstones"] = [];
    const tombstoneAcks: AcknowledgedChanges["habitCompletionTombstones"] = {};
    for (const [id, tombstone] of Object.entries(record.habitCompletionTombstones)) {
        if (!base.habitCompletions[id]) continue;
        tombstones.push({ ...tombstone });
        tombstoneAcks[id] =
            tombstone.habitId === undefined
                ? { deletedAt: tombstone.deletedAt }
                : { deletedAt: tombstone.deletedAt, habitId: tombstone.habitId };
    }

    return { upserts, upsertAcks, tombstones, tombstoneAcks };
}

/**
 * Builds the idempotent push delta for the current staging record against its
 * baseline. Throws a bootstrap error before the first successful pull. The
 * acknowledged map captures the exact values/tombstone timestamps being pushed
 * so the commit step can prove nothing changed before clearing them.
 */
export function buildPushPlan(record: StagedOwnerRecord): PushPlan {
    if (!record.initialized || record.lastSynced === null) {
        throw new MergeError(
            "Cannot build a push plan before the staging record has synced at least once (bootstrap guard)",
        );
    }
    const base = record.lastSynced;

    // Completion-derived task/log/timer values may reach Supabase only through
    // persist_transition (local generation install) and complete_timer (CAS),
    // never through the ordinary staged-sync push. Exclude them while their
    // journal entries are unresolved; each winner/loser resolution rebuilds this
    // plan so resolved generations resume ordinary merge/push handling.
    const mask = completionMask(record);

    const acknowledged: AcknowledgedChanges = {
        taskUpserts: {},
        taskTombstones: {},
        logUpserts: {},
        logTombstones: {},
        habitUpserts: {},
        habitTombstones: {},
        habitCompletionUpserts: {},
        habitCompletionTombstones: {},
        todoUpserts: {},
        todoTombstones: {},
        settings: null,
        timerState: null,
        pmState: null,
        fullWipe: null,
    };

    if (record.fullWipe) {
        // The transactional RPC requires default singleton payloads even though
        // the remote rows are deleted by the wipe.
        const defaults = defaultAppState();
        const settings: VersionedValue<Settings> = {
            value: { ...defaults.settings },
            updatedAt: record.fullWipe.createdAt,
        };
        const timerState: VersionedValue<TimerStateSlice> & { newGeneration: boolean } = {
            value: timerSliceOf(defaults),
            updatedAt: record.fullWipe.createdAt,
            newGeneration: true,
        };
        let pmState: VersionedValue<SyncedPMState> | null = null;
        if (record.pmState !== null && pmDiffers(record, base)) {
            pmState = { value: record.pmState, updatedAt: record.pmUpdatedAt ?? record.fullWipe.createdAt };
        }
        // Habit/completion deltas are outside the wipe scope and still ride the
        // wipe request so durable habit work is never dropped by a reset.
        const habits = habitDeltasOf(record, base);
        const completions = completionDeltasOf(record, base);
        const todos = todoDeltasOf(record, base);
        return {
            baseRevision: record.revision,
            taskUpserts: [],
            taskTombstones: [],
            logUpserts: [],
            logTombstones: [],
            habitUpserts: habits.upserts,
            habitTombstones: habits.tombstones,
            habitCompletionUpserts: completions.upserts,
            habitCompletionTombstones: completions.tombstones,
            todoUpserts: todos.upserts,
            todoTombstones: todos.tombstones,
            settings,
            timerState,
            pmState,
            fullWipe: true,
            acknowledged: {
                ...acknowledged,
                habitUpserts: habits.upsertAcks,
                habitTombstones: habits.tombstoneAcks,
                habitCompletionUpserts: completions.upsertAcks,
                habitCompletionTombstones: completions.tombstoneAcks,
                todoUpserts: todos.upsertAcks,
                todoTombstones: todos.tombstoneAcks,
                settings,
                timerState,
                pmState,
                fullWipe: { createdAt: record.fullWipe.createdAt },
            },
        };
    }

    const taskUpserts: PushPlan["taskUpserts"] = [];
    const taskUpsertAcks: AcknowledgedChanges["taskUpserts"] = {};
    const taskIds = new Set<string>([...Object.keys(record.state.tasks), ...Object.keys(base.tasks)]);
    for (const id of taskIds) {
        const current = record.state.tasks[id];
        if (!current) continue;
        if (mask.taskIds.has(id)) continue;
        const baseline = base.tasks[id];
        if (baseline !== undefined && valuesEqual(current, baseline.value)) continue;
        const updatedAt = record.taskUpdatedAt[id];
        if (updatedAt === undefined) {
            throw new MergeError(`Task "${id}" differs from the baseline but has no updated_at stamp`);
        }
        taskUpserts.push({ value: { ...current }, updatedAt });
        taskUpsertAcks[id] = { value: { ...current }, updatedAt };
    }

    const taskTombstones: PushPlan["taskTombstones"] = [];
    const taskTombstoneAcks: AcknowledgedChanges["taskTombstones"] = {};
    for (const [id, tombstone] of Object.entries(record.taskTombstones)) {
        if (!base.tasks[id]) continue; // redundant tombstone: nothing to delete on the server
        taskTombstones.push({ id, deletedAt: tombstone.deletedAt });
        taskTombstoneAcks[id] = { deletedAt: tombstone.deletedAt };
    }

    const logUpserts: PushPlan["logUpserts"] = [];
    const logUpsertAcks: AcknowledgedChanges["logUpserts"] = {};
    for (const log of record.state.logs) {
        if (mask.logIds.has(log.id)) continue;
        const baseline = base.logs[log.id];
        if (baseline !== undefined && valuesEqual(log, baseline)) continue;
        logUpserts.push({ ...log });
        logUpsertAcks[log.id] = { ...log };
    }

    const logTombstones: PushPlan["logTombstones"] = [];
    const logTombstoneAcks: AcknowledgedChanges["logTombstones"] = {};
    for (const [id, tombstone] of Object.entries(record.logTombstones)) {
        if (!base.logs[id]) continue;
        logTombstones.push({ id, deletedAt: tombstone.deletedAt });
        logTombstoneAcks[id] = { deletedAt: tombstone.deletedAt };
    }

    let settings: VersionedValue<Settings> | null = null;
    if (versionedChanged(record.settingsUpdatedAt, base.settings.updatedAt, record.state.settings, base.settings.value)) {
        const updatedAt = record.settingsUpdatedAt;
        if (updatedAt === null) {
            throw new MergeError("Settings differ from the baseline but have no updated_at stamp");
        }
        settings = { value: { ...record.state.settings }, updatedAt };
        acknowledged.settings = settings;
    }

    let timerState: (VersionedValue<TimerStateSlice> & { newGeneration: boolean }) | null = null;
    if (
        !mask.maskTimer &&
        versionedChanged(
            record.timerUpdatedAt,
            base.timerState.updatedAt,
            timerSliceOf(record.state),
            base.timerState.value,
        )
    ) {
        const updatedAt = record.timerUpdatedAt;
        if (updatedAt === null) {
            throw new MergeError("Timer state differs from the baseline but has no updated_at stamp");
        }
        timerState = { value: timerSliceOf(record.state), updatedAt, newGeneration: !record.timerCompleted };
        acknowledged.timerState = timerState;
    }

    let pmState: VersionedValue<SyncedPMState> | null = null;
    if (record.pmState !== null && pmDiffers(record, base)) {
        const updatedAt = record.pmUpdatedAt;
        if (updatedAt === null) {
            throw new MergeError("PM state differs from the baseline but has no updated_at stamp");
        }
        pmState = { value: record.pmState, updatedAt };
        acknowledged.pmState = pmState;
    }

    // Habit/completion deltas never depend on the completion mask, so they are
    // built outside the masked task/log/timer section and always travel with the
    // ordinary plan.
    const habits = habitDeltasOf(record, base);
    const completions = completionDeltasOf(record, base);
    const todos = todoDeltasOf(record, base);

    return {
        baseRevision: record.revision,
        taskUpserts,
        taskTombstones,
        logUpserts,
        logTombstones,
        habitUpserts: habits.upserts,
        habitTombstones: habits.tombstones,
        habitCompletionUpserts: completions.upserts,
        habitCompletionTombstones: completions.tombstones,
        todoUpserts: todos.upserts,
        todoTombstones: todos.tombstones,
        settings,
        timerState,
        pmState,
        fullWipe: false,
        acknowledged: {
            ...acknowledged,
            taskUpserts: taskUpsertAcks,
            taskTombstones: taskTombstoneAcks,
            logUpserts: logUpsertAcks,
            logTombstones: logTombstoneAcks,
            habitUpserts: habits.upsertAcks,
            habitTombstones: habits.tombstoneAcks,
            habitCompletionUpserts: completions.upsertAcks,
            habitCompletionTombstones: completions.tombstoneAcks,
            todoUpserts: todos.upsertAcks,
            todoTombstones: todos.tombstoneAcks,
        },
    };
}

function omitStamp(record: Record<string, string>, key: string): Record<string, string> {
    const copy = { ...record };
    delete copy[key];
    return copy;
}

function omitTombstone(
    record: Record<string, { id: string; deletedAt: string }>,
    key: string,
): Record<string, { id: string; deletedAt: string }> {
    const copy = { ...record };
    delete copy[key];
    return copy;
}

/**
 * Advances the baseline to the pushed snapshot and clears each acknowledged
 * item only when the current stored value/tombstone still equals the value
 * acknowledged by the plan. Edits made after the plan was built (or by another
 * tab) leave their pending markers intact against the new baseline.
 */
export function commitAcknowledgedPush(record: StagedOwnerRecord, plan: PushPlan, pushed: SyncSnapshot): StagedOwnerRecord {
    let next: StagedOwnerRecord = { ...record, lastSynced: pushed, initialized: true };
    const ack = plan.acknowledged;

    let taskUpdatedAt = next.taskUpdatedAt;
    for (const [id, acknowledged] of Object.entries(ack.taskUpserts)) {
        const current = next.state.tasks[id];
        if (current && valuesEqual(current, acknowledged.value) && taskUpdatedAt[id] === acknowledged.updatedAt) {
            taskUpdatedAt = omitStamp(taskUpdatedAt, id);
        }
    }
    next = { ...next, taskUpdatedAt };

    let taskTombstones = next.taskTombstones;
    for (const [id, acknowledged] of Object.entries(ack.taskTombstones)) {
        const current = taskTombstones[id];
        if (current && current.deletedAt === acknowledged.deletedAt) {
            taskTombstones = omitTombstone(taskTombstones, id);
        }
    }
    next = { ...next, taskTombstones };

    let logTombstones = next.logTombstones;
    for (const [id, acknowledged] of Object.entries(ack.logTombstones)) {
        const current = logTombstones[id];
        if (current && current.deletedAt === acknowledged.deletedAt) {
            logTombstones = omitTombstone(logTombstones, id);
        }
    }
    next = { ...next, logTombstones };

    let habitUpdatedAt = next.habitUpdatedAt;
    for (const [id, acknowledged] of Object.entries(ack.habitUpserts)) {
        const current = next.habits[id];
        if (current && valuesEqual(current, acknowledged.value) && habitUpdatedAt[id] === acknowledged.updatedAt) {
            habitUpdatedAt = omitStamp(habitUpdatedAt, id);
        }
    }
    next = { ...next, habitUpdatedAt };

    let habitTombstones = next.habitTombstones;
    for (const [id, acknowledged] of Object.entries(ack.habitTombstones)) {
        const current = habitTombstones[id];
        if (current && current.deletedAt === acknowledged.deletedAt) {
            habitTombstones = omitTombstone(habitTombstones, id);
        }
    }
    next = { ...next, habitTombstones };

    let habitCompletionTombstones = next.habitCompletionTombstones;
    for (const [id, acknowledged] of Object.entries(ack.habitCompletionTombstones)) {
        const current = habitCompletionTombstones[id];
        if (current && current.deletedAt === acknowledged.deletedAt) {
            habitCompletionTombstones = omitTombstone(habitCompletionTombstones, id);
        }
    }
    next = { ...next, habitCompletionTombstones };

    let todoUpdatedAt = next.todoUpdatedAt;
    for (const [id, acknowledged] of Object.entries(ack.todoUpserts)) {
        const current = next.todos[id];
        if (current && valuesEqual(current, acknowledged.value) && todoUpdatedAt[id] === acknowledged.updatedAt) {
            todoUpdatedAt = omitStamp(todoUpdatedAt, id);
        }
    }
    next = { ...next, todoUpdatedAt };

    let todoTombstones = next.todoTombstones;
    for (const [id, acknowledged] of Object.entries(ack.todoTombstones)) {
        const current = todoTombstones[id];
        if (current && current.deletedAt === acknowledged.deletedAt) todoTombstones = omitTombstone(todoTombstones, id);
    }
    next = { ...next, todoTombstones };

    // Log upserts and habit completion upserts have no marker to clear; once
    // `pushed` contains them the entity-based pending detection stops counting
    // them.

    if (ack.settings) {
        if (
            valuesEqual(next.state.settings, ack.settings.value) &&
            next.settingsUpdatedAt === ack.settings.updatedAt
        ) {
            next = { ...next, settingsUpdatedAt: null };
        }
    }

    if (ack.timerState) {
        if (
            valuesEqual(timerSliceOf(next.state), ack.timerState.value) &&
            next.timerUpdatedAt === ack.timerState.updatedAt
        ) {
            next = { ...next, timerUpdatedAt: null };
        }
    }

    if (ack.pmState) {
        if (valuesEqual(next.pmState, ack.pmState.value) && next.pmUpdatedAt === ack.pmState.updatedAt) {
            next = { ...next, pmUpdatedAt: null };
        }
    }

    if (ack.fullWipe && next.fullWipe && next.fullWipe.createdAt === ack.fullWipe.createdAt) {
        next = { ...next, fullWipe: null };
    }

    return next;
}
