import type { Habit, HabitCompletion, HabitFrequency } from "../../state/types";
import { addLocalDays, dayBucket, dateFromBucket, getBucketKey, isFutureBucket, weekBucket } from "./calendar";
import type { HabitWindow, HabitWindowInput } from "./types";

function normalizeWindow(window: HabitWindowInput): HabitWindow {
    switch (window) {
        case "day":
            return "day";
        case "7":
        case "week":
            return "week";
        case "30":
        case "month":
            return "month";
        case "365":
        case "year":
            return "year";
    }
}

export function normalizeHabitWindow(window: HabitWindowInput): HabitWindow {
    return normalizeWindow(window);
}

export function visibleFrequencies(window: HabitWindowInput): readonly HabitFrequency[] {
    switch (normalizeWindow(window)) {
        case "day":
            return ["daily"];
        case "week":
            return ["daily"];
        case "month":
            return ["daily", "weekly"];
        case "year":
            return ["daily", "weekly", "monthly"];
    }
}

export function getVisibleHabitFrequencies(window: HabitWindowInput): readonly HabitFrequency[] {
    return visibleFrequencies(window);
}

export function isHabitVisible(habit: Pick<Habit, "frequency">, window: HabitWindowInput): boolean {
    return visibleFrequencies(window).includes(habit.frequency);
}

export function filterVisibleHabits<T extends Pick<Habit, "frequency">>(
    habits: readonly T[],
    window: HabitWindowInput,
): T[] {
    return habits.filter((habit) => isHabitVisible(habit, window));
}

export function getVisibleHabits<T extends Pick<Habit, "frequency">>(
    habits: readonly T[],
    window: HabitWindowInput,
): T[] {
    return filterVisibleHabits(habits, window);
}

function localMonthEnd(now: Date): Date {
    return addLocalDays(dateFromBucket(getBucketKey(now, "monthly")), new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - 1);
}

function currentWeekBuckets(now: Date): string[] {
    const start = dateFromBucket(weekBucket(now));
    return Array.from({ length: 7 }, (_, index) => dayBucket(addLocalDays(start, index)));
}

function currentMonthBuckets(now: Date, frequency: HabitFrequency): string[] {
    const start = dateFromBucket(getBucketKey(now, "monthly"));
    if (frequency === "daily") {
        const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return Array.from({ length: days }, (_, index) => dayBucket(addLocalDays(start, index)));
    }

    const end = localMonthEnd(now);
    const firstWeek = dateFromBucket(weekBucket(start));
    const buckets: string[] = [];
    for (let cursor = firstWeek; cursor.getTime() <= end.getTime(); cursor = addLocalDays(cursor, 7)) {
        buckets.push(weekBucket(cursor));
    }
    return buckets;
}

function trailingYearBuckets(now: Date, frequency: HabitFrequency): string[] {
    const start = addLocalDays(dateFromBucket(dayBucket(now)), -364);
    if (frequency === "daily") {
        return Array.from({ length: 365 }, (_, index) => dayBucket(addLocalDays(start, index)));
    }

    const endBucket = getBucketKey(now, frequency);
    const buckets: string[] = [];
    let cursor = dateFromBucket(getBucketKey(start, frequency));
    while (getBucketKey(cursor, frequency) <= endBucket) {
        buckets.push(getBucketKey(cursor, frequency));
        cursor = addLocalDays(cursor, frequency === "weekly" ? 7 : 1);
        if (frequency === "monthly") {
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12, 0, 0, 0);
        }
    }
    return buckets;
}

export function getWindowBuckets(
    window: HabitWindowInput,
    frequency: HabitFrequency,
    now: Date,
): string[];
export function getWindowBuckets(
    now: Date,
    window: HabitWindowInput,
    frequency: HabitFrequency,
): string[];
export function getWindowBuckets(
    first: HabitWindowInput | Date,
    second: HabitWindowInput | HabitFrequency,
    third: Date | HabitFrequency,
): string[] {
    const [window, frequency, now] = first instanceof Date
        ? [second as HabitWindowInput, third as HabitFrequency, first]
        : [first, second as HabitFrequency, third as Date];

    switch (normalizeWindow(window)) {
        case "day":
            return frequency === "daily" ? [dayBucket(now)] : [];
        case "week":
            return frequency === "daily" ? currentWeekBuckets(now) : [];
        case "month":
            return frequency === "daily" || frequency === "weekly" ? currentMonthBuckets(now, frequency) : [];
        case "year":
            return trailingYearBuckets(now, frequency);
    }
}

export function computeHabitWindow(
    window: HabitWindowInput,
    frequency: HabitFrequency,
    now: Date,
): string[] {
    return getWindowBuckets(window, frequency, now);
}

export function getHabitWindow(
    window: HabitWindowInput,
    frequency: HabitFrequency,
    now: Date,
): string[] {
    return getWindowBuckets(window, frequency, now);
}

export function isBucketCheckable(bucket: string, frequency: HabitFrequency, now: Date): boolean {
    return !isFutureBucket(bucket, frequency, now);
}

export function isHabitCellCheckable(
    habit: Pick<Habit, "frequency"> | HabitFrequency,
    bucket: string,
    now: Date,
): boolean {
    const frequency = typeof habit === "string" ? habit : habit.frequency;
    return isBucketCheckable(bucket, frequency, now);
}

export function canCheckHabitCell(
    habit: Pick<Habit, "frequency"> | HabitFrequency,
    bucket: string,
    now: Date,
): boolean {
    return isHabitCellCheckable(habit, bucket, now);
}

export function isHabitCompleted(
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[],
    habitId: string,
    bucket: string,
): boolean {
    return completions.some((completion) => completion.habitId === habitId && completion.bucket === bucket);
}
