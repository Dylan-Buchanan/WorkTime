import { DEFAULT_END_OF_DAY, isEndOfDayTime } from "./settings";
import { normalizeProjectSchedule, type ProjectSchedule } from "./projectSchedule";

function cutoffForDay(day: Date, endMinutes: number): Date {
    const cutoff = new Date(day);
    if (endMinutes === 0) {
        cutoff.setHours(24, 0, 0, 0);
    } else {
        cutoff.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    }
    return cutoff;
}

function nextLocalMidnight(day: Date): Date {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next;
}

/**
 * Adds projected work/break duration while skipping time after each local
 * end-of-day cutoff. Calendar setters preserve the intended local boundaries
 * across daylight-saving transitions.
 */
export function addProjectedDuration(start: Date, durationMs: number, endOfDay: string): Date {
    const safeEndOfDay = isEndOfDayTime(endOfDay) ? endOfDay : DEFAULT_END_OF_DAY;
    const [hours, minutes] = safeEndOfDay.split(":").map(Number);
    const endMinutes = hours * 60 + minutes;
    let cursor = new Date(start);
    let remaining = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;

    while (remaining > 0) {
        const cutoff = cutoffForDay(cursor, endMinutes);
        if (cursor.getTime() >= cutoff.getTime()) {
            cursor = nextLocalMidnight(cursor);
            continue;
        }

        const available = cutoff.getTime() - cursor.getTime();
        if (remaining <= available) {
            return new Date(cursor.getTime() + remaining);
        }

        remaining -= available;
        cursor = nextLocalMidnight(cursor);
    }

    return cursor;
}

function atTime(day: Date, time: string): Date {
    const [hours, minutes] = time.split(":").map(Number);
    const result = new Date(day);
    result.setHours(hours, minutes, 0, 0);
    return result;
}

function nextWorkableStart(day: Date, schedule: ProjectSchedule): Date {
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    while (!schedule.workableDays.includes(next.getDay() as any)) {
        next.setDate(next.getDate() + 1);
    }
    return atTime(next, schedule.workableStart);
}

/** Adds duration only inside a project's local work window and weekdays. */
export function addProjectWorkableDuration(start: Date, durationMs: number, input: Partial<ProjectSchedule>): Date {
    const schedule = normalizeProjectSchedule(input);
    let cursor = new Date(start);
    let remaining = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;

    while (remaining > 0) {
        if (!schedule.workableDays.includes(cursor.getDay() as any)) {
            cursor = nextWorkableStart(cursor, schedule);
            continue;
        }
        const windowStart = atTime(cursor, schedule.workableStart);
        const windowEnd = atTime(cursor, schedule.workableEnd);
        if (cursor < windowStart) cursor = windowStart;
        if (cursor >= windowEnd) {
            cursor = nextWorkableStart(cursor, schedule);
            continue;
        }
        const available = windowEnd.getTime() - cursor.getTime();
        if (remaining <= available) return new Date(cursor.getTime() + remaining);
        remaining -= available;
        cursor = nextWorkableStart(cursor, schedule);
    }
    return cursor;
}

export interface ScheduledProjectWorkload {
    durationMs: number;
    schedule: Partial<ProjectSchedule>;
}

function availableWindow(cursor: Date, schedule: ProjectSchedule): { start: Date; end: Date } {
    let day = new Date(cursor);
    while (true) {
        if (schedule.workableDays.includes(day.getDay() as any)) {
            const start = atTime(day, schedule.workableStart);
            const end = atTime(day, schedule.workableEnd);
            if (cursor < end) return { start: cursor > start ? new Date(cursor) : start, end };
        }
        day = nextWorkableStart(day, schedule);
        return { start: day, end: atTime(day, schedule.workableEnd) };
    }
}

/**
 * Schedules project workloads on one focus stream. Work is preempted when a
 * tighter project window opens, so overlapping projects are never counted as
 * simultaneous work and narrower availability is not accidentally missed.
 */
export function combinedProjectFinish(start: Date, workloads: ScheduledProjectWorkload[]): Date {
    const pending = workloads
        .map((workload) => ({
            remaining: Number.isFinite(workload.durationMs) ? Math.max(0, workload.durationMs) : 0,
            schedule: normalizeProjectSchedule(workload.schedule),
        }))
        .filter((workload) => workload.remaining > 0);
    let cursor = new Date(start);

    while (pending.length > 0) {
        const candidates = pending.map((workload) => ({ workload, ...availableWindow(cursor, workload.schedule) }));
        const earliestStart = Math.min(...candidates.map((candidate) => candidate.start.getTime()));
        if (cursor.getTime() < earliestStart) cursor = new Date(earliestStart);
        const active = candidates
            .filter((candidate) => candidate.start.getTime() === earliestStart)
            .sort((a, b) => a.end.getTime() - b.end.getTime());
        const chosen = active[0];
        const nextOpening = Math.min(...candidates.map((candidate) => candidate.start.getTime()).filter((time) => time > cursor.getTime()), Number.POSITIVE_INFINITY);
        const sliceEnd = Math.min(chosen.end.getTime(), nextOpening);
        const available = sliceEnd - cursor.getTime();
        const consumed = Math.min(chosen.workload.remaining, available);
        chosen.workload.remaining -= consumed;
        cursor = new Date(cursor.getTime() + consumed);
        if (chosen.workload.remaining <= 0) pending.splice(pending.indexOf(chosen.workload), 1);
    }
    return cursor;
}
