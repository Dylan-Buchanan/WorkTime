import type { ActiveTimer, AppStateData, PomodoroLogEntry, Task } from "../../../state/types";
import { cloneAppState } from "../../engine";
import { deepValuesEqual } from "../staging/serialization";
import type { PendingTimerCompletion, StagedOwnerRecord, SyncSnapshot, TimerStateSlice } from "../staging/types";
import { isLiveTimer } from "./merge";

/**
 * Pure timer-completion journal reconciliation. Completions are recorded locally
 * as exact generations and replayed through `complete_timer` during sync, so
 * this module owns the canonical generation key, the RPC payload mapping, and
 * the winner/loser transformations that keep the single-CAS-winner semantics
 * without losing later unrelated local edits. No code here may access
 * `Date.now`, localStorage, Supabase, or UUID generation; the clock is injected
 * and all inputs are serializable values.
 */

/**
 * The exact JSON arguments sent to the unchanged `complete_timer(jsonb, jsonb,
 * jsonb, jsonb)` RPC. `p_expected_timer` is the raw timer JSON the server's
 * predicate compares against; `p_log` carries the client-generated immutable id;
 * `p_task` is the single changed task row (null when no task changed).
 */
export interface CompletionRpcPayload {
    p_expected_timer: ActiveTimer | null;
    p_timer_data: TimerStateSlice;
    p_log: PomodoroLogEntry | null;
    p_task: Task | null;
}

/** The sets of entities a push plan must not send through `apply_staged_sync`. */
export interface CompletionMask {
    taskIds: ReadonlySet<string>;
    logIds: ReadonlySet<string>;
    maskTimer: boolean;
}

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function valuesEqual(a: unknown, b: unknown): boolean {
    return deepValuesEqual(a, b);
}

function timerSliceOf(state: {
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}): TimerStateSlice {
    return {
        active_task: state.active_task,
        current_cycle_pomodoros: state.current_cycle_pomodoros,
        timer: state.timer,
    };
}

function omitStamp(stamps: Record<string, string>, taskId: string): Record<string, string> {
    const copy = { ...stamps };
    delete copy[taskId];
    return copy;
}

/** Every persisted task field a three-way merge can reconcile. */
const LOSER_TASK_FIELDS: ReadonlyArray<keyof Task> = [
    "name",
    "target_pomodoros",
    "completed_pomodoros",
    "created_at",
    "completed_at",
    "break_skips",
    "archived",
];

/** Parses a client-authored timestamp, failing safe as "-infinity". */
function timestampMs(value: string): number {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Canonical serialization of a value: object keys are sorted recursively so the
 * generation key is independent of object insertion order while still exact for
 * the same persisted timer JSON. This is not a hash; the canonical JSON itself
 * is the identity used for journal dedup and RPC replay, and no random value is
 * involved.
 */
function canonicalize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

/**
 * The identity of one timer generation, derived from the complete `ActiveTimer`
 * payload. Two timers that differ in any field (started_at, ends_at, kind,
 * paused, ...) are different generations; a re-serialized identical timer maps
 * to the same key.
 */
export function timerGenerationKey(timer: ActiveTimer): string {
    return canonicalize(timer);
}

/** Maps one journal entry to the exact `complete_timer` RPC arguments. */
export function completionRpcPayload(entry: PendingTimerCompletion): CompletionRpcPayload {
    return {
        p_expected_timer: clone(entry.expectedTimer),
        p_timer_data: clone(entry.resultTimerState),
        p_log: clone(entry.log),
        p_task: entry.taskAfter ? clone(entry.taskAfter) : null,
    };
}

/**
 * Resolves a server-acknowledged completion. Removes the exact journal entry
 * (generation key + sequence) and incorporates the completed generation into
 * the baseline so its task/log/timer effects stop counting as ordinary pending
 * push work. Re-recording values that already match a re-pulled baseline at the
 * same stamp keeps the transformation idempotent; a later locally running timer
 * or a later user task edit is never touched.
 */
export function applyCompletionWinner(record: StagedOwnerRecord, entry: PendingTimerCompletion): StagedOwnerRecord {
    const pendingCompletions = record.pendingCompletions.filter(
        (candidate) => !(candidate.generationKey === entry.generationKey && candidate.sequence === entry.sequence),
    );
    if (pendingCompletions.length === record.pendingCompletions.length) return record;
    if (record.lastSynced === null) return { ...record, pendingCompletions };

    const baseline = {
        ...record.lastSynced,
        timerState: {
            value: clone(entry.resultTimerState),
            updatedAt: entry.completedAt,
            completed: true,
        },
        logs: { ...record.lastSynced.logs, [entry.log.id]: clone(entry.log) },
    };
    if (entry.taskAfter) {
        baseline.tasks = {
            ...record.lastSynced.tasks,
            [entry.taskAfter.id]: { value: clone(entry.taskAfter), updatedAt: entry.completedAt },
        };
    }
    return { ...record, pendingCompletions, lastSynced: baseline };
}

/**
 * True when the current local timer slice already equals the baseline row, so
 * the row has no pending push work. A `null` baseline row is matched by the
 * default timer slice.
 */
function timerSliceMatchesBaseline(record: StagedOwnerRecord, slice: TimerStateSlice): boolean {
    const baseline = record.lastSynced?.timerState;
    if (!baseline) return false;
    if (baseline.value === null) {
        return slice.timer === null && slice.active_task === null && slice.current_cycle_pomodoros === 0;
    }
    return valuesEqual(slice, baseline.value);
}

/**
 * Re-stamps a task after loser resolution. A value that now equals the baseline
 * drops its stamp; a value that still differs keeps a stamp (using `now` when
 * none exists) so the ordinary push plan can carry it.
 */
function syncTaskStamp(
    record: StagedOwnerRecord,
    state: AppStateData,
    taskId: string,
    fallbackStamp: string,
): Record<string, string> {
    const baseline = record.lastSynced?.tasks[taskId];
    const current = state.tasks[taskId];
    if (!current) return omitStamp(record.taskUpdatedAt, taskId);
    if (baseline && valuesEqual(current, baseline.value)) {
        return omitStamp(record.taskUpdatedAt, taskId);
    }
    return { ...record.taskUpdatedAt, [taskId]: record.taskUpdatedAt[taskId] ?? fallbackStamp };
}

/**
 * Three-way merge for a CAS-loser task. The shared base is the journal's
 * `taskBefore`; completion-derived fields (those `taskAfter` changed) count as
 * local changes so a user revert back to the base value is never mistaken for
 * "no local change". A field edited after the completion keeps its local value
 * (timestamp-resolved against a remote change, remote winning ties); a field
 * still equal to `taskAfter` reverts to `taskBefore` unless the remote changed
 * it, so the losing completion's own delta is dropped instead of duplicated.
 */
function mergeLoserTask(
    current: Task,
    taskBefore: Task,
    taskAfter: Task,
    remoteValue: Task,
    localStamp: string | undefined,
    remoteStamp: string,
): Task {
    const merged: Record<string, unknown> = { ...current };
    const localTs = localStamp !== undefined ? timestampMs(localStamp) : Number.NEGATIVE_INFINITY;
    const remoteTs = timestampMs(remoteStamp);
    for (const field of LOSER_TASK_FIELDS) {
        const localDerived = taskAfter[field] !== taskBefore[field];
        const localEditedAfter = current[field] !== taskAfter[field];
        const localChanged = localDerived || localEditedAfter;
        const remoteChanged = remoteValue[field] !== taskBefore[field];
        if (remoteChanged && !localChanged) {
            merged[field] = remoteValue[field];
        } else if (localChanged && !remoteChanged) {
            merged[field] = localEditedAfter ? current[field] : taskBefore[field];
        } else if (localChanged && remoteChanged) {
            merged[field] = localEditedAfter
                ? remoteTs >= localTs
                    ? remoteValue[field]
                    : current[field]
                : remoteValue[field];
        }
    }
    return merged as unknown as Task;
}

/**
 * Resolves a CAS-losing completion. Removes the exact journal entry and the
 * losing client log id (unless the pulled snapshot already carries it, which
 * covers a response lost after server commit), reverts completion-derived task
 * fields only while the current value still equals `taskAfter` so a later user
 * edit survives, adopts the remote winner's task/cycle/completion state, and
 * then applies the normal live-timer rule: a later currently running local
 * timer may remain authoritative, but it cannot reintroduce the losing
 * completion's log or progress.
 */
export function applyCompletionLoser(
    record: StagedOwnerRecord,
    entry: PendingTimerCompletion,
    remote: SyncSnapshot,
    now: Date,
): StagedOwnerRecord {
    const pendingCompletions = record.pendingCompletions.filter(
        (candidate) => !(candidate.generationKey === entry.generationKey && candidate.sequence === entry.sequence),
    );
    if (pendingCompletions.length === record.pendingCompletions.length) return record;

    const state = cloneAppState(record.state);
    const landed = remote.logs[entry.log.id] !== undefined;
    if (!landed) {
        state.logs = state.logs.filter((log) => log.id !== entry.log.id);
    }

    let taskUpdatedAt = record.taskUpdatedAt;
    if (entry.taskAfter) {
        const remoteRow = remote.tasks[entry.taskAfter.id];
        if (remoteRow) {
            const current = state.tasks[entry.taskAfter.id];
            if (current && entry.taskBefore) {
                state.tasks[entry.taskAfter.id] = mergeLoserTask(
                    current,
                    entry.taskBefore,
                    entry.taskAfter,
                    remoteRow.value,
                    record.taskUpdatedAt[entry.taskAfter.id],
                    remoteRow.updatedAt,
                );
            } else {
                state.tasks[entry.taskAfter.id] = clone(remoteRow.value);
            }
        } else {
            const current = state.tasks[entry.taskAfter.id];
            if (current && entry.taskBefore && valuesEqual(current, entry.taskAfter)) {
                state.tasks[entry.taskAfter.id] = clone(entry.taskBefore);
            }
        }
        taskUpdatedAt = syncTaskStamp(record, state, entry.taskAfter.id, now.toISOString());
    }

    let timerCompleted = record.timerCompleted;
    let timerUpdatedAt = record.timerUpdatedAt;
    if (!isLiveTimer(state.timer, now)) {
        const remoteSlice = remote.timerState.value;
        state.active_task = remoteSlice?.active_task ?? null;
        state.current_cycle_pomodoros = remoteSlice?.current_cycle_pomodoros ?? 0;
        state.timer = remoteSlice?.timer ? clone(remoteSlice.timer) : null;
        timerCompleted = remote.timerState.completed;
        timerUpdatedAt = timerSliceMatchesBaseline(record, timerSliceOf(state)) ? null : record.timerUpdatedAt;
    }

    return { ...record, state, pendingCompletions, taskUpdatedAt, timerCompleted, timerUpdatedAt };
}

/**
 * The task/log/timer values owned by unresolved journal entries. Those values
 * may reach Supabase only through `persist_transition` (local generation
 * install) and `complete_timer` (CAS), never through `apply_staged_sync`, so
 * `buildPushPlan` excludes them until each generation resolves. The timer is
 * masked only while the current slice still equals an unresolved completion's
 * result state; a later started generation (live or not) is ordinary pending
 * work and is not masked.
 */
export function completionMask(record: StagedOwnerRecord): CompletionMask {
    const taskIds = new Set<string>();
    const logIds = new Set<string>();
    let maskTimer = false;
    const timerSlice = timerSliceOf(record.state);
    for (const entry of record.pendingCompletions) {
        if (entry.taskAfter) taskIds.add(entry.taskAfter.id);
        logIds.add(entry.log.id);
        if (valuesEqual(timerSlice, entry.resultTimerState)) maskTimer = true;
    }
    return { taskIds, logIds, maskTimer };
}
