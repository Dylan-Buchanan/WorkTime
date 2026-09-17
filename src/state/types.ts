export interface Task {
    id: string;
    name: string;
    target_pomodoros: number;
    completed_pomodoros: number; // includes partials
    created_at: string;
    completed_at: string | null;
    break_skips: number;
    archived: boolean;
}

// New Project Manager domain types
export type TaskStatus = "Backlog" | "Next" | "In Progress" | "Blocked" | "Done";
export type TaskPriority = "Low" | "Medium" | "High";
export type WorkableWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Project {
    id: string;
    name: string;
    color: string; // hex
    description?: string;
    /** Local wall-clock project availability in 24-hour HH:mm form. */
    workableStart: string;
    workableEnd: string;
    /** JavaScript weekday numbers: Sunday=0 through Saturday=6. */
    workableDays: WorkableWeekday[];
    isArchived: boolean;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface PMTask {
    id: string;
    title: string;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string; // ISO date
    estimatePomos?: number; // estimated pomodoros
    timeSpentMinutes: number;
    workedPomos?: number; // derived from timer logs (completed work minutes / 25)
    lastWorkedAt?: string; // ISO
    description?: string; // markdown
    tags: string[];
    links: string[]; // urls
    checklist: { id: string; title: string; done: boolean }[];
    sortOrder: number;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
    appTaskId?: string; // linked timer task id
    relatedTo: string[]; // array of task IDs that must be done before this task
}

/**
 * The task shape accepted from an agent planner. Proposal-only metadata such
 * as `splitsFrom` and `rationale` intentionally does not belong on PMTask,
 * because neither field is persisted as task state.
 */
export interface ProposedTask {
    id?: string;
    title: string;
    projectId?: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    estimatePomos?: number;
    description?: string;
    /** Optional quick-add metadata used by chat task creation. */
    tags?: string[];
    checklist: PMTask["checklist"];
    relatedTo: string[];
    splitsFrom?: string;
    rationale?: string;
    /** IDs of completed comparable tasks supporting an estimate decrease. */
    estimateEvidenceTaskIds?: string[];
}

export interface ProjectManagerState {
    projects: Record<string, Project>;
    tasks: Record<string, PMTask>;
    ui: {
        selectedProjectIds: string[]; // filters
        selectedTaskId: string | null;
        view: "list" | "board";
        listGrouping: "none" | "project" | "status" | "due";
        statusFilter: TaskStatus[];
        tagFilter: string[];
        priorityFilter: TaskPriority[];
        search: string;
        showArchived: boolean;
        sort: "manual" | "due" | "priority" | "updated";
        dueFilter: "all" | "today" | "thisWeek" | "later" | "overdue";
        boardShowAllTasks: boolean;
    };
    meta: {
        initializedAt: string;
    };
}

export interface PomodoroLogEntry {
    id: string;
    task_id: string;
    duration_minutes: number;
    finished_at: string;
    was_break: boolean;
    break_skipped: boolean;
}

export interface Settings {
    work_minutes: number;
    short_break_minutes: number;
    long_break_minutes: number;
    segment_length: number;
    /** Local wall-clock cutoff in 24-hour HH:mm form. */
    end_of_day: string;
}

export type TimerKind = "Work" | "ShortBreak" | "LongBreak";

export interface ActiveTimer {
    task_id: string;
    started_at: string;
    ends_at: string;
    kind: TimerKind;
    paused?: boolean;
    paused_remaining_secs?: number;
    planned_secs?: number; // total planned duration in seconds
    accumulated_secs?: number; // elapsed active seconds before current segment
}

export type HabitFrequency = "daily" | "weekly" | "monthly";

export interface Habit {
    id: string;
    name: string;
    description: string;
    color: string;
    frequency: HabitFrequency;
    position: number;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface HabitCompletion {
    id: string;
    habitId: string;
    bucket: string;
    createdAt: string;
    updatedAt: string;
}

export interface AppStateData {
    tasks: Record<string, Task>;
    logs: PomodoroLogEntry[];
    settings: Settings;
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}

/** Extensible enum-style set of care activities the pet domain understands. */
export type PetActivityType = "potty" | "training" | "playtime" | "feeding";

/** Items classified fixed never move; flexible items may reflow by suggestion. */
export type PetFlexibility = "fixed" | "flexible";

export interface PetProfile {
    id: string;
    name: string;
    /** Timezone-free local calendar date in YYYY-MM-DD form. */
    birthDate: string;
    createdAt: string;
    updatedAt: string;
}

/** Clock-anchored recurrence; `flexibility` decides whether reflow may be proposed. */
export interface PetFixedTimeRecurrence {
    mode: "fixed-time";
    /** Local wall-clock start in 24-hour HH:mm form. */
    time: string;
    /** Minutes from local midnight; machine-readable mirror of `time`. */
    startMinutes: number;
    /** Minutes from local midnight for the window close. */
    endMinutes: number;
}

/** Interval recurrence anchored to the latest matching activity record. */
export interface PetIntervalRecurrence {
    mode: "interval";
    minMinutes: number;
    maxMinutes: number;
}

export type PetScheduleRecurrence = PetFixedTimeRecurrence | PetIntervalRecurrence;

export interface PetScheduleItem {
    id: string;
    activityType: PetActivityType;
    label: string;
    flexibility: PetFlexibility;
    /** Ordering among items sharing a resolved start; lower runs first. */
    priority: number;
    recurrence: PetScheduleRecurrence;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

/** Append-only care log row. Durations are only meaningful for training/playtime. */
export interface PetActivityRecord {
    id: string;
    activityType: PetActivityType;
    /** ISO timestamp when the activity happened. */
    timestamp: string;
    /** Optional; only meaningful for training and playtime. */
    durationMinutes?: number;
    createdAt: string;
}

/** Stored nap row. `end` stays null while the nap is ongoing. */
export interface PetNapRecord {
    id: string;
    /** ISO timestamp the nap started. */
    start: string;
    /** ISO timestamp the nap ended; null while still napping. */
    end: string | null;
    createdAt: string;
    updatedAt: string;
}

/** Append-only weight log row; the profile's current weight is the latest entry. */
export interface PetWeightEntry {
    id: string;
    /** ISO timestamp of the measurement. */
    timestamp: string;
    weight: number;
    createdAt: string;
    updatedAt: string;
}

/** Forward-only progression order for a training skill. */
export type PetTrainingStatus = "introduced" | "progressing" | "reliable";

/** A command or skill the pet is learning, with a forward-only progression. */
export interface PetTrainingSkill {
    id: string;
    /** Command/skill label, e.g. "Sit". */
    label: string;
    notes: string;
    status: PetTrainingStatus;
    /** ISO timestamp when the skill was closed as effectively done; null while active. */
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/** A current obsession or behavior problem with an active → resolved lifecycle. */
export interface PetFixation {
    id: string;
    /** Short description, e.g. "Chasing the vacuum". */
    label: string;
    notes: string;
    /** ISO timestamp when the fixation was archived; null while active. */
    resolvedAt: string | null;
    /** Freeform reason captured on resolve, e.g. "grew out of it". Empty while active. */
    resolutionNote: string;
    createdAt: string;
    updatedAt: string;
}
