import type { Project, WorkableWeekday } from "../state/types";

export const DEFAULT_WORKABLE_START = "09:00";
export const DEFAULT_WORKABLE_END = "17:00";
export const DEFAULT_WORKABLE_DAYS: WorkableWeekday[] = [1, 2, 3, 4, 5];

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type ProjectSchedule = Pick<Project, "workableStart" | "workableEnd" | "workableDays">;

export function isWallClockTime(value: unknown): value is string {
    return typeof value === "string" && TIME_PATTERN.test(value);
}

function minutes(value: string): number {
    const [hours, mins] = value.split(":").map(Number);
    return hours * 60 + mins;
}

export function normalizeProjectSchedule(value: Partial<ProjectSchedule> | null | undefined): ProjectSchedule {
    const proposedStart = isWallClockTime(value?.workableStart) ? value.workableStart : DEFAULT_WORKABLE_START;
    const proposedEnd = isWallClockTime(value?.workableEnd) ? value.workableEnd : DEFAULT_WORKABLE_END;
    const validWindow = minutes(proposedStart) < minutes(proposedEnd);
    const workableDays = Array.isArray(value?.workableDays)
        ? [...new Set(value.workableDays.filter((day): day is WorkableWeekday => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
        : [];

    return {
        workableStart: validWindow ? proposedStart : DEFAULT_WORKABLE_START,
        workableEnd: validWindow ? proposedEnd : DEFAULT_WORKABLE_END,
        workableDays: workableDays.length > 0 ? workableDays : [...DEFAULT_WORKABLE_DAYS],
    };
}
