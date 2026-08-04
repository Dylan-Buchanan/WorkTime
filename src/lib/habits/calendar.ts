import type { HabitFrequency } from "./types";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function formatDateKey(date: Date): string {
    return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Returns a local-calendar date at noon, avoiding midnight DST transitions. */
function localDateAtNoon(year: number, month: number, day: number): Date {
    return new Date(year, month, day, 12, 0, 0, 0);
}

function localDateFromKey(key: string): Date {
    if (!DATE_KEY_PATTERN.test(key)) throw new RangeError(`Invalid habit bucket: ${key}`);
    const [year, month, day] = key.split("-").map(Number);
    return localDateAtNoon(year, month - 1, day);
}

function localDateParts(date: Date): [number, number, number] {
    if (Number.isNaN(date.getTime())) throw new RangeError("Invalid habit date");
    return [date.getFullYear(), date.getMonth(), date.getDate()];
}

function shiftLocalDate(date: Date, days: number): Date {
    const [year, month, day] = localDateParts(date);
    const shifted = localDateAtNoon(year, month, day);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
}

export function dayBucket(date: Date): string {
    return formatDateKey(localDateAtNoon(...localDateParts(date)));
}

export function weekBucket(date: Date): string {
    return dayBucket(shiftLocalDate(date, -date.getDay()));
}

export function monthBucket(date: Date): string {
    const [year, month] = localDateParts(date);
    return formatDateKey(localDateAtNoon(year, month, 1));
}

export function getDayBucket(date: Date): string {
    return dayBucket(date);
}

export function getWeekBucket(date: Date): string {
    return weekBucket(date);
}

export function getMonthBucket(date: Date): string {
    return monthBucket(date);
}

export function getBucketKey(date: Date, frequency: HabitFrequency): string {
    switch (frequency) {
        case "daily":
            return dayBucket(date);
        case "weekly":
            return weekBucket(date);
        case "monthly":
            return monthBucket(date);
    }
}

export function bucketFor(date: Date, frequency: HabitFrequency): string {
    return getBucketKey(date, frequency);
}

export function addLocalDays(date: Date, days: number): Date {
    return shiftLocalDate(date, days);
}

export function dateFromBucket(bucket: string): Date {
    return localDateFromKey(bucket);
}

export function isFutureBucket(bucket: string, frequency: HabitFrequency, now: Date): boolean {
    return bucket > getBucketKey(now, frequency);
}

