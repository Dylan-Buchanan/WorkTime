import type { EngineResult } from "../engine";
import type { ActiveTimer, AppStateData, PMTask, ProjectManagerState, Settings, Task, TimerKind } from "../../state/types";

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
    setTaskTarget(taskId: string, target: number): Promise<EngineResult<Task>>;
    deleteTask(taskId: string): Promise<EngineResult<void>>;
    deletePomodoroLog(logId: string): Promise<EngineResult<void>>;
    resetAppState(): Promise<EngineResult<AppStateData>>;
    savePMState(state: SyncedPMState): Promise<void>;
    loadPMState(): Promise<SyncedPMState | null>;
    sync(options: SyncOptions): Promise<SyncResult>;
    pendingCount(): number;
    isInitialized(): boolean;
    reloadFromStorage(): void;
    subscribe(listener: () => void): () => void;
}

export type { PMTask };
