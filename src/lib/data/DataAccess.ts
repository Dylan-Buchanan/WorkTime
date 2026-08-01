import type { EngineResult } from "../engine";
import type { ActiveTimer, AppStateData, PMTask, ProjectManagerState, Settings, Task, TimerKind } from "../../state/types";

export type SyncedPMState = Pick<ProjectManagerState, "projects" | "tasks" | "meta">;

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

export class DataAccessAuthError extends Error {
    readonly code = "DATA_ACCESS_NO_SESSION";

    constructor(message = "An authenticated Supabase session is required") {
        super(message);
        this.name = "DataAccessAuthError";
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
    resetAppState(): Promise<EngineResult<AppStateData>>;
    savePMState(state: SyncedPMState): Promise<void>;
    loadPMState(): Promise<SyncedPMState | null>;
}

export type { PMTask };
