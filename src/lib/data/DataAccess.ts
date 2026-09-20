import type { EngineResult } from "../engine";
import type { Todo, TodoCompletion } from "../todos";
import type {
    ActiveTimer,
    AppStateData,
    Habit,
    HabitCompletion,
    PetActivityRecord,
    PetFixation,
    PetNapRecord,
    PetNotableEvent,
    PetProfile,
    PetReminderMark,
    PetScheduleItem,
    PetTrainingSkill,
    PetWeightEntry,
    PMTask,
    ProjectManagerState,
    Settings,
    Task,
    TimerKind,
} from "../../state/types";

export type SyncedPMState = Pick<ProjectManagerState, "projects" | "tasks" | "meta">;

export type SyncStatus = "idle" | "syncing" | "success" | "error";
export type SyncReason = "bootstrap" | "manual" | "focus" | "visibility" | "pagehide" | "bridge" | "close";

export interface SyncOptions {
    reason: SyncReason;
    bestEffort?: boolean;
}

export interface SyncResult {
    state: AppStateData;
    pmState: SyncedPMState | null;
    pendingCount: number;
    initialized: boolean;
}

/**
 * The one sync action consumed by contexts. `StagedDataAccess` delegates to
 * this injected contract so local commands stay network-free; the production
 * implementation is the serialized coordinator, and tests inject a fake.
 */
export interface SyncExecutor {
    sync(options: SyncOptions): Promise<SyncResult>;
}

export interface ReconciledTimer {
    kind: TimerKind;
    taskId: string;
    applied: boolean;
}

export interface FetchStateResult extends EngineResult<AppStateData> {
    reconciledTimer: ReconciledTimer | null;
}

export interface CompleteTimerResult extends EngineResult<AppStateData> {
    applied: boolean;
}

/**
 * Stable auth-category codes carried by `DataAccessAuthError`. Callers (the
 * sync coordinator, contexts) distinguish "no session at all", "GoTrue refresh
 * failed", and "the session belongs to a different owner" while always matching
 * on the same error `name`. All codes share the `DATA_ACCESS_` auth prefix.
 */
export type DataAccessAuthErrorCode =
    | "DATA_ACCESS_NO_SESSION"
    | "DATA_ACCESS_REFRESH_FAILED"
    | "DATA_ACCESS_OWNER_MISMATCH";

const DATA_ACCESS_AUTH_ERROR_MESSAGES: Record<DataAccessAuthErrorCode, string> = {
    DATA_ACCESS_NO_SESSION: "An authenticated Supabase session is required",
    DATA_ACCESS_REFRESH_FAILED: "The Supabase session could not be refreshed",
    DATA_ACCESS_OWNER_MISMATCH: "The authenticated session does not match the local owner",
};

const DATA_ACCESS_AUTH_ERROR_CODES: readonly string[] = [
    "DATA_ACCESS_NO_SESSION",
    "DATA_ACCESS_REFRESH_FAILED",
    "DATA_ACCESS_OWNER_MISMATCH",
];

export class DataAccessAuthError extends Error {
    readonly code: DataAccessAuthErrorCode;

    constructor(codeOrMessage: DataAccessAuthErrorCode | string = "DATA_ACCESS_NO_SESSION", message?: string) {
        const isCode = DATA_ACCESS_AUTH_ERROR_CODES.includes(codeOrMessage);
        const code = isCode ? (codeOrMessage as DataAccessAuthErrorCode) : "DATA_ACCESS_NO_SESSION";
        // A legacy message-first call (`new DataAccessAuthError("some message")`)
        // is treated as the message with the default code instead of being
        // recorded as an invalid code that would break code-kind matching.
        super(message ?? (isCode ? DATA_ACCESS_AUTH_ERROR_MESSAGES[code] : codeOrMessage));
        this.name = "DataAccessAuthError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export interface DataAccess {
    fetchState(): Promise<FetchStateResult>;
    createTask(name: string, targetPomodoros: number): Promise<EngineResult<Task>>;
    setActiveTask(taskId: string): Promise<EngineResult<void>>;
    startWorkTimer(): Promise<EngineResult<ActiveTimer>>;
    startBreakTimer(): Promise<EngineResult<ActiveTimer>>;
    completeTimer(expectedTimer?: ActiveTimer): Promise<CompleteTimerResult>;
    stopWorkTimer(): Promise<EngineResult<AppStateData>>;
    pauseTimer(): Promise<EngineResult<ActiveTimer>>;
    resumeTimer(): Promise<EngineResult<ActiveTimer>>;
    skipBreak(): Promise<EngineResult<AppStateData>>;
    updateSettings(settings: Settings): Promise<EngineResult<Settings>>;
    finalizeTask(taskId: string): Promise<EngineResult<Task>>;
    archiveTask(taskId: string): Promise<EngineResult<Task>>;
    setTaskTarget(taskId: string, target: number): Promise<EngineResult<Task>>;
    deleteTask(taskId: string): Promise<EngineResult<void>>;
    deletePomodoroLog(logId: string): Promise<EngineResult<void>>;
    resetAppState(): Promise<EngineResult<AppStateData>>;
    savePMState(state: SyncedPMState): Promise<void>;
    loadPMState(): Promise<SyncedPMState | null>;
    saveHabits(habits: Habit[], completions: HabitCompletion[]): Promise<void>;
    loadHabits(): Promise<{ habits: Habit[]; completions: HabitCompletion[] }>;
    saveTodos(todos: Todo[], completions: TodoCompletion[]): Promise<void>;
    loadTodos(): Promise<{ todos: Todo[]; completions: TodoCompletion[] }>;
    savePetActivityRecords(records: PetActivityRecord[]): Promise<void>;
    loadPetActivityRecords(): Promise<PetActivityRecord[]>;
    /** Stages the single pet profile; `null` clears it locally. */
    savePetProfile(profile: PetProfile | null): Promise<void>;
    loadPetProfile(): Promise<PetProfile | null>;
    savePetScheduleItems(items: PetScheduleItem[]): Promise<void>;
    loadPetScheduleItems(): Promise<PetScheduleItem[]>;
    /** Owner-local reminder dedup state; Issue G will add remote transport. */
    savePetReminderMarks(marks: PetReminderMark[]): Promise<void>;
    loadPetReminderMarks(): Promise<PetReminderMark[]>;
    savePetNapRecords(naps: PetNapRecord[]): Promise<void>;
    loadPetNapRecords(): Promise<PetNapRecord[]>;
    savePetWeightEntries(entries: PetWeightEntry[]): Promise<void>;
    loadPetWeightEntries(): Promise<PetWeightEntry[]>;
    savePetTrainingSkills(skills: PetTrainingSkill[]): Promise<void>;
    loadPetTrainingSkills(): Promise<PetTrainingSkill[]>;
    savePetFixations(fixations: PetFixation[]): Promise<void>;
    loadPetFixations(): Promise<PetFixation[]>;
    savePetNotableEvents(events: PetNotableEvent[]): Promise<void>;
    loadPetNotableEvents(): Promise<PetNotableEvent[]>;
    sync(options: SyncOptions): Promise<SyncResult>;
    discardPendingChanges(): Promise<void>;
    pendingCount(): number;
    isInitialized(): boolean;
    reloadFromStorage(): void;
    subscribe(listener: () => void): () => void;
}

export type { PMTask };
