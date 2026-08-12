import { ActiveTimer } from "../state/types";

export const EPSILON = 1e-3;

export function formatMs(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
    const s = (total % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

export function toLocalDateKey(date: Date): string {
    const offset = date.getTimezoneOffset();
    const adjusted = new Date(date.getTime() - offset * 60000);
    return adjusted.toISOString().slice(0, 10);
}

export function parseDueDateKey(raw?: string | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return toLocalDateKey(parsed);
}

export interface LocalWeekWindow {
    startKey: string;
    endKey: string;
}

/** Returns the local Monday-through-Sunday window containing `reference`. */
export function getLocalWeekWindow(reference: Date): LocalWeekWindow {
    const start = new Date(reference);
    start.setHours(0, 0, 0, 0);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { startKey: toLocalDateKey(start), endKey: toLocalDateKey(end) };
}

export interface ProjectionBacklogTask {
    dueDate?: string | null;
    remainingPomodoros: number;
    projectId: string | null;
}

export interface ProjectionBacklog {
    totalPomodoros: number;
    dueTodayOrOverduePomodoros: number;
    unscheduledPomodoros: number;
    dueThisWeekPomodoros: number;
    excludedFuturePomodoros: number;
    remainingByProject: Map<string | null, number>;
}

export interface ProjectionBacklogs {
    daily: ProjectionBacklog;
    weekly: ProjectionBacklog;
}

function emptyProjectionBacklog(): ProjectionBacklog {
    return {
        totalPomodoros: 0,
        dueTodayOrOverduePomodoros: 0,
        unscheduledPomodoros: 0,
        dueThisWeekPomodoros: 0,
        excludedFuturePomodoros: 0,
        remainingByProject: new Map(),
    };
}

function addToBacklog(backlog: ProjectionBacklog, task: ProjectionBacklogTask, category: "due" | "unscheduled" | "thisWeek") {
    backlog.totalPomodoros += task.remainingPomodoros;
    if (category === "due") backlog.dueTodayOrOverduePomodoros += task.remainingPomodoros;
    if (category === "unscheduled") backlog.unscheduledPomodoros += task.remainingPomodoros;
    if (category === "thisWeek") backlog.dueThisWeekPomodoros += task.remainingPomodoros;
    backlog.remainingByProject.set(task.projectId, (backlog.remainingByProject.get(task.projectId) ?? 0) + task.remainingPomodoros);
}

/**
 * Builds daily and ISO-week projection backlogs from already-eligible task work.
 * The caller supplies the reference date so the computation has no wall-clock dependency.
 */
export function buildProjectionBacklogs(tasks: ProjectionBacklogTask[], reference: Date): ProjectionBacklogs {
    const daily = emptyProjectionBacklog();
    const weekly = emptyProjectionBacklog();
    const todayKey = toLocalDateKey(reference);
    const { endKey: weekEndKey } = getLocalWeekWindow(reference);

    for (const task of tasks) {
        if (!Number.isFinite(task.remainingPomodoros) || task.remainingPomodoros <= EPSILON) continue;
        const dueKey = parseDueDateKey(task.dueDate);
        if (!dueKey) {
            addToBacklog(daily, task, "unscheduled");
            addToBacklog(weekly, task, "unscheduled");
        } else if (dueKey <= todayKey) {
            addToBacklog(daily, task, "due");
            addToBacklog(weekly, task, "due");
        } else if (dueKey <= weekEndKey) {
            daily.excludedFuturePomodoros += task.remainingPomodoros;
            addToBacklog(weekly, task, "thisWeek");
        } else {
            daily.excludedFuturePomodoros += task.remainingPomodoros;
            weekly.excludedFuturePomodoros += task.remainingPomodoros;
        }
    }

    return { daily, weekly };
}

export function formatPomodoroCount(value: number): string {
    if (!Number.isFinite(value) || value <= EPSILON) return "0p";
    if (Math.abs(value - Math.round(value)) < 0.05) {
        return `${Math.round(value)}p`;
    }
    return `${value.toFixed(1)}p`;
}

export function formatDurationMinutes(totalMinutes: number): string {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0m";
    const rounded = Math.max(1, Math.round(totalMinutes));
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

/** Milliseconds remaining on a timer at a given wall-clock time. */
export function computeRemainingMs(timer: ActiveTimer | null | undefined, nowMs: number): number {
    if (!timer) return 0;
    if (timer.paused) {
        return (timer.paused_remaining_secs || 0) * 1000;
    }
    const end = new Date(timer.ends_at).getTime();
    return Math.max(0, end - nowMs);
}

/** Total planned seconds for a timer (falls back to end-start span). */
export function computePlannedSecs(timer: ActiveTimer | null | undefined): number {
    if (!timer) return 0;
    return timer.planned_secs || (new Date(timer.ends_at).getTime() - new Date(timer.started_at).getTime()) / 1000;
}

/**
 * Active elapsed seconds, honoring pause/resume `accumulated_secs` semantics.
 * When paused, the current run segment is frozen and only accumulated time counts.
 */
export function computeElapsedSecs(timer: ActiveTimer | null | undefined, nowMs: number, plannedSecs: number): number {
    if (!timer) return 0;
    const accumulated = timer.accumulated_secs || 0;
    if (timer.paused) {
        return accumulated;
    }
    const start = new Date(timer.started_at).getTime();
    return Math.min(plannedSecs, accumulated + Math.max(0, nowMs - start) / 1000);
}

export function computeActiveFractionComplete(timer: ActiveTimer | null | undefined, nowMs: number, workMinutesSetting: number): number {
    if (!timer || timer.kind !== "Work") return 0;
    const planned = timer.planned_secs || workMinutesSetting * 60;
    if (planned <= 0) return 0;
    const remaining = computeRemainingMs(timer, nowMs) / 1000;
    return Math.min(1, Math.max(0, 1 - remaining / planned));
}
