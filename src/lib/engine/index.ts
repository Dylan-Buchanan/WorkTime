export {
    DEFAULT_SETTINGS,
    EngineError,
    addSeconds,
    cloneAppState,
    defaultAppState,
    elapsedTimerSecs,
    fullCycleDurationSecs,
    plannedTimerSecs,
} from "./core";
export type { EngineResult } from "./core";

export { buildPlannerContext, calculatePomodoroBudget } from "./plannerContext";
export type {
    AccuracyAggregate,
    PlannerAccuracyAggregates,
    PlannerContext,
    PlannerContextInput,
    PlannerTaskContext,
} from "./plannerContext";

// State: get_state, create_task, update_settings, reset_app_state.
export { createTask, getState, resetAppState, updateSettings } from "./stateCommands";
// Task lifecycle: set_active_task, delete_task, archive_task, finalize_task, set_task_target.
export { archiveTask, deleteTask, finalizeTask, setActiveTask, setTaskTarget } from "./taskCommands";
// Timer lifecycle: start_work_timer, start_break_timer, complete_timer, stop_work_timer.
export { completeTimer, startBreakTimer, startWorkTimer, stopWorkTimer } from "./timerCommands";
// Session commands: pause_timer, resume_timer, skip_break.
export { pauseTimer, resumeTimer, skipBreak } from "./sessionCommands";
