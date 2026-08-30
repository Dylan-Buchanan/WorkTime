import type {
    ActiveTimer,
    AppStateData,
    Habit,
    HabitCompletion,
    PomodoroLogEntry,
    Settings,
    Task,
} from "../../../state/types";
import type { SyncedPMState } from "../DataAccess";
import type { InProgressPomodoroMap } from "../../engine";
import { isValidRule } from "../../todos";
import type { Todo, TodoCompletion, TodoRule } from "../../todos";
import { isCompleteSettings, parsePersistedSettings } from "../../settings";

/**
 * The versioned, serializable schema persisted for each owner under
 * `worktime:staging:v1:<ownerId>` (the key prefix is intentionally stable
 * across schema versions; only the embedded `schemaVersion` advances). These
 * shapes are the localStorage boundary and intentionally stay separate from
 * in-memory React/UI state. Database transport metadata is excluded except for
 * the client-supplied log ID that is already part of `PomodoroLogEntry`.
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
    habits: Record<string, { value: Habit; updatedAt: string }>;
    habitCompletions: Record<string, HabitCompletion>;
    todos: Record<string, { value: Todo; updatedAt: string }>;
    todoCompletions: Record<string, TodoCompletion>;
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

/**
 * A tombstoned habit completion. `habitId` records deletion provenance: it is
 * set only when the completion was removed as part of a habit hard-delete
 * cascade, so a merge that revives the parent habit can also suppress the
 * completion tombstone instead of silently erasing the history. Individual
 * unchecks of a surviving habit carry no provenance and stay unconditional.
 */
export interface HabitCompletionTombstone {
    id: string;
    deletedAt: string;
    habitId?: string;
}

export interface TodoCompletionTombstone {
    id: string;
    deletedAt: string;
    todoId?: string;
}

/** The per-owner localStorage record for the staging store. */
export interface StagedOwnerRecord {
    schemaVersion: 6;
    ownerId: string;
    revision: number;
    /** True only after at least one successful remote pull. Never pushes while false. */
    initialized: boolean;
    state: AppStateData;
    /** Owner-local only; excluded from snapshots, sync payloads, and pending counts. */
    inProgressPomodoros: InProgressPomodoroMap;
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
    /** Current locally-staged habits, keyed by habit id. */
    habits: Record<string, Habit>;
    /** Current locally-staged habit completions, keyed by completion id. */
    habitCompletions: Record<string, HabitCompletion>;
    /** `updated_at` LWW transport stamps per locally-changed habit. */
    habitUpdatedAt: Record<string, string>;
    habitTombstones: Record<string, { id: string; deletedAt: string }>;
    habitCompletionTombstones: Record<string, HabitCompletionTombstone>;
    /** Current locally-staged to-dos, keyed by to-do id. */
    todos: Record<string, Todo>;
    /** `updated_at` LWW transport stamps per locally-changed to-do. */
    todoUpdatedAt: Record<string, string>;
    todoTombstones: Record<string, { id: string; deletedAt: string }>;
    todoCompletions: Record<string, TodoCompletion>;
    todoCompletionTombstones: Record<string, TodoCompletionTombstone>;
}

export const STAGING_SCHEMA_VERSION = 6 as const;
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

function isInProgressPomodoroMap(value: unknown): boolean {
    return (
        isObject(value) &&
        Object.values(value).every(
            (elapsed) => isFiniteNumber(elapsed) && Number.isInteger(elapsed) && elapsed >= 0,
        )
    );
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
    return isCompleteSettings(value);
}

function isHabit(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.description === "string" &&
        typeof value.color === "string" &&
        (value.frequency === "daily" || value.frequency === "weekly" || value.frequency === "monthly") &&
        isFiniteNumber(value.position) &&
        typeof value.isArchived === "boolean" &&
        typeof value.createdAt === "string" &&
        typeof value.updatedAt === "string"
    );
}

function isHabitCompletion(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.id === "string" &&
        typeof value.habitId === "string" &&
        typeof value.bucket === "string" &&
        typeof value.createdAt === "string" &&
        typeof value.updatedAt === "string"
    );
}

function isTodo(value: unknown): boolean {
    return (
        isObject(value) &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        (value.rule === null || isValidRule(value.rule as TodoRule)) &&
        (value.dueDate === null || typeof value.dueDate === "string") &&
        (value.estimate === undefined || (isFiniteNumber(value.estimate) && value.estimate >= 1)) &&
        (value.currentTaskId === undefined || value.currentTaskId === null || typeof value.currentTaskId === "string") &&
        isFiniteNumber(value.position) &&
        typeof value.isArchived === "boolean" &&
        typeof value.createdAt === "string" &&
        typeof value.updatedAt === "string"
    );
}

function isTodoCompletion(value: unknown): boolean {
    return (
        isObject(value) && typeof value.id === "string" && typeof value.todoId === "string" &&
        typeof value.bucket === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string"
    );
}

function isTombstone(value: unknown): boolean {
    return isObject(value) && typeof value.id === "string" && typeof value.deletedAt === "string";
}

function isTombstoneMap(value: unknown): boolean {
    return isObject(value) && Object.values(value).every(isTombstone);
}

/** A completion tombstone may carry an optional habitId provenance string. */
function isCompletionTombstone(value: unknown): boolean {
    if (!isObject(value) || typeof value.id !== "string" || typeof value.deletedAt !== "string") return false;
    return value.habitId === undefined || typeof value.habitId === "string";
}

function isCompletionTombstoneMap(value: unknown): boolean {
    return isObject(value) && Object.values(value).every(isCompletionTombstone);
}

function isTodoCompletionTombstone(value: unknown): boolean {
    if (!isObject(value) || typeof value.id !== "string" || typeof value.deletedAt !== "string") return false;
    return value.todoId === undefined || typeof value.todoId === "string";
}

function isTodoCompletionTombstoneMap(value: unknown): boolean {
    return isObject(value) && Object.values(value).every(isTodoCompletionTombstone);
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
        isObject(value.habits) &&
        Object.values(value.habits).every(
            (row) => isObject(row) && isHabit(row.value) && typeof row.updatedAt === "string",
        ) &&
        isObject(value.habitCompletions) &&
        Object.values(value.habitCompletions).every(isHabitCompletion) &&
        isObject(value.todos) &&
        Object.values(value.todos).every(
            (row) => isObject(row) && isTodo(row.value) && typeof row.updatedAt === "string",
        ) &&
        isObject(value.todoCompletions) &&
        Object.values(value.todoCompletions).every(isTodoCompletion) &&
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
    ["inProgressPomodoros", isInProgressPomodoroMap],
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
    ["habits", (v): boolean => isObject(v) && Object.values(v).every(isHabit)],
    ["habitCompletions", (v): boolean => isObject(v) && Object.values(v).every(isHabitCompletion)],
    ["habitUpdatedAt", (v): boolean => isObject(v) && Object.values(v).every((stamp) => typeof stamp === "string")],
    ["habitTombstones", isTombstoneMap],
    ["habitCompletionTombstones", isCompletionTombstoneMap],
    ["todos", (v): boolean => isObject(v) && Object.values(v).every(isTodo)],
    ["todoUpdatedAt", (v): boolean => isObject(v) && Object.values(v).every((stamp) => typeof stamp === "string")],
    ["todoTombstones", isTombstoneMap],
    ["todoCompletions", (v): boolean => isObject(v) && Object.values(v).every(isTodoCompletion)],
    ["todoCompletionTombstones", isTodoCompletionTombstoneMap],
];

/**
 * Validate and parse a stored record. Only numeric literal schema versions `1`
 * through `6` are accepted; records at the unchanged v1 key migrate in memory
 * by adding the five habit/completion fields and injecting empty snapshot maps
 * before any v2 validation runs. Unknown/newer `schemaVersion` values and
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
    if (
        parsed.schemaVersion !== 1 &&
        parsed.schemaVersion !== 2 &&
        parsed.schemaVersion !== 3 &&
        parsed.schemaVersion !== 4 &&
        parsed.schemaVersion !== 5 &&
        parsed.schemaVersion !== 6
    ) {
        throw new StagingStorageError(
            `Unsupported staging schema version ${String(parsed.schemaVersion)} for owner "${ownerId}" (expected ${STAGING_SCHEMA_VERSION})`,
        );
    }
    // v1 records predate the habit fields, so inject the five empty values and
    // both empty snapshot maps before running v2 validation on the same shape
    // newer records are parsed with. The v1 key prefix is not a migration.
    let record: Record<string, unknown> =
        parsed.schemaVersion === 1
            ? {
                  ...parsed,
                  schemaVersion: 2,
                  habits: {},
                  habitCompletions: {},
                  habitUpdatedAt: {},
                  habitTombstones: {},
                  habitCompletionTombstones: {},
                  lastSynced:
                      parsed.lastSynced === null
                          ? null
                          : {
                                ...(parsed.lastSynced as Record<string, unknown>),
                                habits: {},
                                habitCompletions: {},
                            },
              }
            : parsed;
    // v2 records predate to-dos. Empty maps preserve every existing staged
    // domain while making the migration safe before the first remote pull.
    if (record.schemaVersion === 2) {
        record = {
            ...record,
            schemaVersion: 3,
            todos: {},
            todoUpdatedAt: {},
            todoTombstones: {},
            lastSynced:
                record.lastSynced === null
                    ? null
                    : { ...(record.lastSynced as Record<string, unknown>), todos: {} },
        };
    }
    if (record.schemaVersion === 3) {
        record = {
            ...record,
            schemaVersion: 4,
            todoCompletions: {},
            todoCompletionTombstones: {},
            lastSynced: record.lastSynced === null
                ? null
                : { ...(record.lastSynced as Record<string, unknown>), todoCompletions: {} },
        };
    }
    if (record.schemaVersion === 4) {
        const state = isObject(record.state)
            ? { ...record.state, settings: parsePersistedSettings(record.state.settings) ?? record.state.settings }
            : record.state;
        const lastSynced = isObject(record.lastSynced) && isObject(record.lastSynced.settings)
            ? {
                  ...record.lastSynced,
                  settings: {
                      ...record.lastSynced.settings,
                      value: record.lastSynced.settings.value === null
                          ? null
                          : parsePersistedSettings(record.lastSynced.settings.value) ?? record.lastSynced.settings.value,
                  },
              }
            : record.lastSynced;
        record = { ...record, schemaVersion: 5, state, lastSynced };
    }
    if (record.schemaVersion === 5) {
        record = { ...record, schemaVersion: 6, inProgressPomodoros: {} };
    }
    if (record.ownerId !== ownerId) {
        throw new StagingStorageError(
            `Staging record owner mismatch: stored "${String(record.ownerId)}" for key owner "${ownerId}"`,
        );
    }
    for (const [field, check] of REQUIRED_FIELD_CHECKS) {
        if (!check(record[field])) {
            throw new StagingStorageError(`Staging record for owner "${ownerId}" is missing or invalid field "${field}"`);
        }
    }
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
    if (record.lastSynced !== null && !isSyncSnapshot(record.lastSynced)) {
        throw new StagingStorageError(`Staging record for owner "${ownerId}" has an invalid lastSynced shape`);
    }
    if (typeof record.unbootstrapped !== "boolean") {
        record.unbootstrapped = false;
    }
    return record as unknown as StagedOwnerRecord;
}
