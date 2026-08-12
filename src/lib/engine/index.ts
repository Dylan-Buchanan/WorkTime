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

export {
    remainingEstimatePomos,
    selectStartOfDayPlanItems,
    START_OF_DAY_MAX_TASK_POMOS,
    validateStartOfDayPlan,
} from "./startOfDay";

export { buildWeekOverview } from "./weekOverview";
export type { BuildWeekOverviewInput, WeekOverview, WeekOverviewDay } from "./weekOverview";
export {
    buildShortcutTaskProposal,
    classifyShortcutStories,
    normalizeShortcutUrl,
} from "./shortcutClassification";
export type {
    ClassifyShortcutStoriesInput,
    ShortcutClassificationCounts,
    ShortcutClassificationResult,
    ShortcutStoryPayload,
    ShortcutTaskProposal,
} from "./shortcutClassification";
export type {
    StartOfDayPlanItem,
    StartOfDayPlanIssue,
    StartOfDayPlanIssueCode,
    StartOfDayPlanValidation,
    StartOfDayPlanValidationInput,
} from "./startOfDay";

export { diffPlannerTasks, diffProposedTasks } from "./diffEngine";
export type {
    DiffPlannerTasksInput,
    GuardrailFlags,
    TaskChange,
    TaskChangeAction,
    TaskChangeType,
    TaskDiffResult,
    TaskSnapshot,
    ProposedTask,
} from "./diffEngine";

// State: get_state, create_task, update_settings, reset_app_state.
export { createTask, getState, resetAppState, updateSettings } from "./stateCommands";
// Task lifecycle: set_active_task, delete_task, archive_task, finalize_task, set_task_target.
export { archiveTask, deleteTask, finalizeTask, setActiveTask, setTaskTarget } from "./taskCommands";
// Timer lifecycle: start_work_timer, start_break_timer, complete_timer, stop_work_timer.
export { completeTimer, startBreakTimer, startWorkTimer, stopWorkTimer } from "./timerCommands";
// Session commands: pause_timer, resume_timer, skip_break.
export { pauseTimer, resumeTimer, skipBreak } from "./sessionCommands";
