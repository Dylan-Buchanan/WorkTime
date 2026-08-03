import type { ActiveTimer, AppStateData, PomodoroLogEntry, Settings, Task } from "../../../state/types";
import type { SyncedPMState } from "../DataAccess";

/**
 * The versioned, serializable schema persisted for each owner under
 * `worktime:staging:v1:<ownerId>`. These shapes are the localStorage boundary
 * and intentionally stay separate from in-memory React/UI state. Database
 * transport metadata is excluded except for the client-supplied log ID that is
 * already part of `PomodoroLogEntry`.
 */

/** The timer-related fields persisted together as the `timer_state` row. */
export interface TimerStateSlice {
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}

/** A singleton JSONB row value plus its `updated_at` timestamp. */
export interface VersionedValue<T> {
    value: T | null;
    updatedAt: string | null;
}

/**
 * The last successfully pulled/acknowledged remote snapshot. Acts as the
 * three-way merge baseline. Absent singleton rows are `{ value: null,
 * updatedAt: null }` so "never existed on the server" stays distinct from
 * default application values.
 */
export interface SyncSnapshot {
    tasks: Record<string, { value: Task; updatedAt: string }>;
    logs: Record<string, PomodoroLogEntry>;
    settings: VersionedValue<Settings>;
    timerState: VersionedValue<TimerStateSlice> & { completed: boolean };
    pmState: VersionedValue<SyncedPMState>;
}

/**
 * One locally-completed timer generation awaiting CAS replay through
 * `complete_timer`. Recorded at local completion time so the exact expected
 * timer, the generated log, and the before/after task state can be replayed or
 * rolled back during sync without losing later unrelated local edits.
 */
export interface PendingTimerCompletion {
    generationKey: string;
    sequence: number;
    expectedTimer: ActiveTimer;
    expectedTimerState: TimerStateSlice;
    resultTimerState: TimerStateSlice;
    taskBefore: Task | null;
    taskAfter: Task | null;
    log: PomodoroLogEntry;
    localOnlyGeneration: boolean;
    completedAt: string;
}

/** The per-owner localStorage record for the staging store. */
export interface StagedOwnerRecord {
    schemaVersion: 1;
    ownerId: string;
    revision: number;
    /** True only after at least one successful remote pull. Never pushes while false. */
    initialized: boolean;
    state: AppStateData;
    pmState: SyncedPMState | null;
    /** `updated_at` stamps per locally-changed task, keyed by task id. */
    taskUpdatedAt: Record<string, string>;
    settingsUpdatedAt: string | null;
    timerUpdatedAt: string | null;
    pmUpdatedAt: string | null;
    /** Local completion guard mirroring the server-side `timer_state.completed`. */
    timerCompleted: boolean;
    taskTombstones: Record<string, { id: string; deletedAt: string }>;
    logTombstones: Record<string, { id: string; deletedAt: string }>;
    /** Scoped full-wipe marker; replaces tasks/logs/settings/timer, preserves PM. */
    fullWipe: { createdAt: string } | null;
    pendingCompletions: PendingTimerCompletion[];
    /**
     * True when local edits were staged before the first successful bootstrap
     * pull. `pendingCount` treats these as unsynced work so badges, recovery
     * banners, and the native close dialog are visible even before a baseline
     * exists; the bootstrap merge resets it to false.
     */
    unbootstrapped: boolean;
    /** `null` is valid only while the record is uninitialized. */
    lastSynced: SyncSnapshot | null;
}

export const STAGING_SCHEMA_VERSION = 1 as const;
/** Maximum journal size before persistence fails closed instead of exhausting localStorage. */
export const MAX_PENDING_COMPLETIONS = 1000;

/** Blocking error for corrupt, unsupported, or unwritable staging records. */
export class StagingStorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StagingStorageError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isTask(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        isFiniteNumber(value.target_pomodoros) &&
        isFiniteNumber(value.completed_pomodoros) &&
        typeof value.created_at === "string" &&
        (value.completed_at === null || typeof value.completed_at === "string") &&
        isFiniteNumber(value.break_skips) &&
        typeof value.archived === "boolean"
    );
}

function isLog(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.id === "string" &&
        typeof value.task_id === "string" &&
        isFiniteNumber(value.duration_minutes) &&
        typeof value.finished_at === "string" &&
        typeof value.was_break === "boolean" &&
        typeof value.break_skipped === "boolean"
    );
}

function isTimer(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.task_id === "string" &&
        typeof value.started_at === "string" &&
        typeof value.ends_at === "string" &&
        (value.kind === "Work" || value.kind === "ShortBreak" || value.kind === "LongBreak") &&
        (value.paused === undefined || typeof value.paused === "boolean")
    );
}

function isTimerSlice(value: unknown): boolean {
    return (
        isObject(value) &&
        (value.active_task === null || typeof value.active_task === "string") &&
        isFiniteNumber(value.current_cycle_pomodoros) &&
        (value.timer === null || isTimer(value.timer))
    );
}

function isSettings(value: unknown): boolean {
    return (
        isObject(value) &&
        isFiniteNumber(value.work_minutes) &&
        isFiniteNumber(value.short_break_minutes) &&
        isFiniteNumber(value.long_break_minutes) &&
        isFiniteNumber(value.segment_length)
    );
}

function isAppState(value: unknown): boolean {
    return (
        isObject(value) &&
        isObject(value.tasks) &&
        Object.values(value.tasks).every(isTask) &&
        Array.isArray(value.logs) &&
        value.logs.every(isLog) &&
        isSettings(value.settings) &&
        (value.active_task === null || typeof value.active_task === "string") &&
        isFiniteNumber(value.current_cycle_pomodoros) &&
        (value.timer === null || isTimer(value.timer))
    );
}

function isVersionedValue(value: unknown, valueCheck: (candidate: unknown) => boolean): boolean {
    return (
        isObject(value) &&
        (value.value === null || valueCheck(value.value)) &&
        (value.updatedAt === null || typeof value.updatedAt === "string")
    );
}

function isSyncSnapshot(value: unknown): boolean {
    if (!isObject(value) || !isObject(value.timerState)) return false;
    const timerState = value.timerState;
    return (
        isObject(value.tasks) &&
        Object.values(value.tasks).every(
            (row) => isObject(row) && isTask(row.value) && typeof row.updatedAt === "string",
        ) &&
        isObject(value.logs) &&
        Object.values(value.logs).every(isLog) &&
        isVersionedValue(value.settings, isSettings) &&
        isVersionedValue(timerState, isTimerSlice) &&
        typeof timerState.completed === "boolean" &&
        isVersionedValue(value.pmState, isObject)
    );
}

function isPendingCompletion(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.generationKey === "string" &&
        isFiniteNumber(value.sequence) &&
        isTimer(value.expectedTimer) &&
        isTimerSlice(value.expectedTimerState) &&
        isTimerSlice(value.resultTimerState) &&
        (value.taskBefore === null || isTask(value.taskBefore)) &&
        (value.taskAfter === null || isTask(value.taskAfter)) &&
        isLog(value.log) &&
        typeof value.localOnlyGeneration === "boolean" &&
        typeof value.completedAt === "string"
    );
}

const REQUIRED_FIELD_CHECKS: ReadonlyArray<readonly [string, (value: unknown) => boolean]> = [
    ["ownerId", (v): boolean => typeof v === "string"],
    ["revision", (v): boolean => typeof v === "number"],
    ["initialized", (v): boolean => typeof v === "boolean"],
    ["state", isObject],
    ["pmState", (v): boolean => v === null || isObject(v)],
    ["taskUpdatedAt", isObject],
    ["settingsUpdatedAt", (v): boolean => v === null || typeof v === "string"],
    ["timerUpdatedAt", (v): boolean => v === null || typeof v === "string"],
    ["pmUpdatedAt", (v): boolean => v === null || typeof v === "string"],
    ["timerCompleted", (v): boolean => typeof v === "boolean"],
    ["taskTombstones", isObject],
    ["logTombstones", isObject],
    ["fullWipe", (v): boolean => v === null || isObject(v)],
    ["pendingCompletions", (v): boolean => Array.isArray(v)],
    ["lastSynced", (v): boolean => v === null || isObject(v)],
];

/**
 * Validate and parse a stored record. Unknown/newer `schemaVersion` values and
 * records whose embedded `ownerId` differs from the storage key are rejected so
 * local data is never silently overwritten or read under the wrong owner.
 * `unbootstrapped` predates this schema revision and defaults to false when
 * absent so previously stored records keep loading.
 */
export function parseStagedOwnerRecord(raw: string, ownerId: string): StagedOwnerRecord {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" is not valid JSON`);
    }
    if (!isObject(parsed)) {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" is not an object`);
    }
    if (parsed.schemaVersion !== STAGING_SCHEMA_VERSION) {
        throw new StagingStorageError(
            `Unsupported staging schema version ${String(parsed.schemaVersion)} for owner "${ownerId}" (expected ${STAGING_SCHEMA_VERSION})`,
        );
    }
    if (parsed.ownerId !== ownerId) {
        throw new StagingStorageError(
            `Staging record owner mismatch: stored "${String(parsed.ownerId)}" for key owner "${ownerId}"`,
        );
    }
    for (const [field, check] of REQUIRED_FIELD_CHECKS) {
        if (!check(parsed[field])) {
            throw new StagingStorageError(`Staging record for owner "${ownerId}" is missing or invalid field "${field}"`);
        }
    }
    const record = parsed as Record<string, unknown>;
    if (!isAppState(record.state)) {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" has an invalid state shape`);
    }
    const pmState = record.pmState;
    if (
        pmState !== null &&
        (!isObject(pmState) || !isObject(pmState.projects) || !isObject(pmState.tasks) || !isObject(pmState.meta))
    ) {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" has an invalid pmState shape`);
    }
    const pendingCompletions = record.pendingCompletions;
    if (
        !Array.isArray(pendingCompletions) ||
        pendingCompletions.length > MAX_PENDING_COMPLETIONS ||
        !pendingCompletions.every(isPendingCompletion)
    ) {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" has an invalid pendingCompletions list`);
    }
    if (parsed.lastSynced !== null && !isSyncSnapshot(parsed.lastSynced)) {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" has an invalid lastSynced shape`);
    }
    if (typeof parsed.unbootstrapped !== "boolean") {
        parsed.unbootstrapped = false;
    }
    return parsed as unknown as StagedOwnerRecord;
}
