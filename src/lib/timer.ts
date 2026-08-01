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
