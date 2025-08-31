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
}

export interface AppStateData {
    tasks: Record<string, Task>;
    logs: PomodoroLogEntry[];
    settings: Settings;
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}
