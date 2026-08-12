import type { Settings } from "../state/types";

export const DEFAULT_END_OF_DAY = "22:00";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function isEndOfDayTime(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
    const [hours, minutes] = value.split(":").map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/**
 * Parses settings at persistence boundaries. Legacy rows without end_of_day
 * remain readable and receive the current default; malformed present values
 * are rejected instead of silently overwritten.
 */
export function parsePersistedSettings(value: unknown): Settings | null {
    if (
        !isRecord(value) ||
        !isFiniteNumber(value.work_minutes) ||
        !isFiniteNumber(value.short_break_minutes) ||
        !isFiniteNumber(value.long_break_minutes) ||
        !isFiniteNumber(value.segment_length) ||
        (value.end_of_day !== undefined && !isEndOfDayTime(value.end_of_day))
    ) {
        return null;
    }

    return {
        work_minutes: value.work_minutes,
        short_break_minutes: value.short_break_minutes,
        long_break_minutes: value.long_break_minutes,
        segment_length: value.segment_length,
        end_of_day: value.end_of_day ?? DEFAULT_END_OF_DAY,
    };
}

export function isCompleteSettings(value: unknown): value is Settings {
    return isRecord(value) && isEndOfDayTime(value.end_of_day) && parsePersistedSettings(value) !== null;
}
