import { DEFAULT_END_OF_DAY, isEndOfDayTime } from "./settings";

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
