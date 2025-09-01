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
export type TaskStatus =
    | "Backlog"
    | "Next"
    | "In Progress"
    | "Blocked"
    | "Done";
export type TaskPriority = "Low" | "Medium" | "High";

export interface Project {
    id: string;
    name: string;
    color: string; // hex
    description?: string;
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
    };
    meta: {
        initializedAt: string;
    };
}

export interface PomodoroLogEntry {
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
}

export type TimerKind = "Work" | "ShortBreak" | "LongBreak";

export interface ActiveTimer {
    task_id: string;
    started_at: string;
    ends_at: string;
    kind: TimerKind;
    paused?: boolean;
    paused_remaining_secs?: number;
}

export interface AppStateData {
    tasks: Record<string, Task>;
    logs: PomodoroLogEntry[];
    settings: Settings;
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}
