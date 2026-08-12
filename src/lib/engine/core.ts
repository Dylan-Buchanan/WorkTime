import type { ActiveTimer, AppStateData, Settings, Task } from "../../state/types";
import { DEFAULT_END_OF_DAY } from "../settings";

export interface EngineResult<T> {
    state: AppStateData;
    value: T;
}

export class EngineError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EngineError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 20,
    segment_length: 4,
    end_of_day: DEFAULT_END_OF_DAY,
});

export function defaultAppState(): AppStateData {
    return {
        tasks: {},
        logs: [],
        settings: { ...DEFAULT_SETTINGS },
        active_task: null,
        current_cycle_pomodoros: 0,
        timer: null,
    };
}

export function cloneAppState(state: AppStateData): AppStateData {
    return {
        tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task }])),
        logs: state.logs.map((log) => ({ ...log })),
        settings: { ...state.settings },
        active_task: state.active_task,
        current_cycle_pomodoros: state.current_cycle_pomodoros,
        timer: state.timer ? { ...state.timer } : null,
    };
}

function wholeSecondsBetween(later: Date, earlier: Date): number {
    return Math.trunc((later.getTime() - earlier.getTime()) / 1000);
}

export function fullCycleDurationSecs(settings: Settings): number {
    const segment = Math.max(1, Math.trunc(settings.segment_length));
    const workSecs = Math.trunc(settings.work_minutes) * 60;
    const shortBreakSecs = Math.trunc(settings.short_break_minutes) * 60;
    const longBreakSecs = Math.trunc(settings.long_break_minutes) * 60;
    return workSecs * segment + shortBreakSecs * (segment - 1) + longBreakSecs;
}

export function plannedTimerSecs(timer: ActiveTimer): number {
    const planned = timer.planned_secs ?? 0;
    if (planned > 0) return planned;
    return wholeSecondsBetween(new Date(timer.ends_at), new Date(timer.started_at));
}

export function elapsedTimerSecs(timer: ActiveTimer, now: Date): number {
    const planned = plannedTimerSecs(timer);
    const accumulated = timer.accumulated_secs ?? 0;
    const elapsed = timer.paused
        ? accumulated
        : accumulated + Math.max(0, wholeSecondsBetween(now, new Date(timer.started_at)));
    return Math.min(Math.max(0, elapsed), Math.max(0, planned));
}

export function addSeconds(now: Date, seconds: number): string {
    return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function taskOrThrow(state: AppStateData, taskId: string): Task {
    const task = state.tasks[taskId];
    if (!task) throw new EngineError("Task not found");
    return task;
}

export function appendLog(
    state: AppStateData,
    taskId: string,
    durationMinutes: number,
    finishedAt: Date,
    wasBreak: boolean,
    logId: string,
    breakSkipped = false,
): void {
    state.logs.push({
        id: logId,
        task_id: taskId,
        duration_minutes: durationMinutes,
        finished_at: finishedAt.toISOString(),
        was_break: wasBreak,
        break_skipped: breakSkipped,
    });
}

export function clampFraction(value: number): number {
    return Math.min(1, Math.max(0, value));
}

export function normalizePositiveInteger(value: number): number {
    return Math.max(1, Math.trunc(value));
}
