import {
    addLocalDays,
    compareLocalDates,
    daysInMonth,
    isLeapYear,
    localDateAtNoon,
    localDateFromKey,
    localDateKey,
    localDateParts,
} from "./calendar";
import type {
    MonthlyDay,
    MonthlyTodoRule,
    TodoRule,
    WeeklyTodoRule,
    YearlyDate,
} from "./types";

const MAX_MONTH_SEARCH = 12 * 400;
const MAX_YEAR_SEARCH = 400;

function invalidRule(message: string): never {
    throw new RangeError(`Invalid todo recurrence rule: ${message}`);
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length === 0) invalidRule(`${field} must not be empty`);
}

function normalizeWeekdays(rule: WeeklyTodoRule): WeeklyTodoRule {
    assertArray(rule.weekdays, "weekdays");
    const weekdays = [...new Set(rule.weekdays)];
    for (const weekday of weekdays) {
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
            invalidRule("weekdays must contain integers from 0 through 6");
        }
    }
    return { type: "weekly", weekdays };
}

function normalizeMonthlyDay(day: MonthlyDay): MonthlyDay {
    if (day === "last-day") return { lastDayOffset: 0 };
    if (typeof day === "number") {
        if (!Number.isInteger(day) || day < 1 || day > 31) invalidRule("monthly days must be integers from 1 through 31");
        return day;
    }
    if (isLastDayOffsetSelection(day)) {
        if (!Number.isInteger(day.lastDayOffset) || day.lastDayOffset < 0 || day.lastDayOffset > 30) {
            invalidRule("lastDayOffset must be an integer from 0 through 30");
        }
        return { lastDayOffset: day.lastDayOffset };
    }
    invalidRule("monthly day must be a day number or last-day selector");
}

function isLastDayOffsetSelection(day: MonthlyDay): day is { lastDayOffset: number } {
    return typeof day === "object" && day !== null && "lastDayOffset" in day;
}

function monthlyDayKey(day: MonthlyDay): string {
    if (typeof day === "number") return `day:${day}`;
    if (!isLastDayOffsetSelection(day)) return "last:0";
    return `last:${day.lastDayOffset}`;
}

function normalizeMonthly(rule: MonthlyTodoRule): MonthlyTodoRule {
    assertArray(rule.days, "days");
    const days: MonthlyDay[] = [];
    const seen = new Set<string>();
    for (const rawDay of rule.days) {
        const day = normalizeMonthlyDay(rawDay);
        const key = monthlyDayKey(day);
        if (!seen.has(key)) {
            seen.add(key);
            days.push(day);
        }
    }
    return { type: "monthly", days };
}

function normalizeYearlyDate(date: YearlyDate): YearlyDate {
    if (!date || typeof date !== "object" || !Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
        invalidRule("yearly months must be integers from 1 through 12");
    }
    if (!Number.isInteger(date.day) || date.day < 1 || date.day > daysInMonth(2024, date.month - 1)) {
        // February 29 is the only valid month/day that does not exist every year.
        if (!(date.month === 2 && date.day === 29)) invalidRule("yearly dates must be real month/day pairs");
    }
    return { month: date.month, day: date.day };
}

function yearlyDateKey(date: YearlyDate): string {
    return `${date.month}-${date.day}`;
}

function normalizeYearly(rule: TodoRule & { type: "yearly" }): TodoRule {
    assertArray(rule.dates, "dates");
    const dates: YearlyDate[] = [];
    const seen = new Set<string>();
    for (const rawDate of rule.dates) {
        const date = normalizeYearlyDate(rawDate);
        const key = yearlyDateKey(date);
        if (!seen.has(key)) {
            seen.add(key);
            dates.push(date);
        }
    }
    return { type: "yearly", dates };
}

function normalizeOneOffDate(date: string): string {
    if (typeof date !== "string") invalidRule("one-off date must be a YYYY-MM-DD string");
    return localDateKey(localDateFromKey(date)) === date ? date : invalidRule("one-off date must be a YYYY-MM-DD string");
}

/**
 * Validates a rule and returns a fresh copy with duplicate day selections
 * removed. The input object and all of its arrays are left untouched.
 */
export function normalizeRule(rule: TodoRule): TodoRule {
    if (!rule || typeof rule !== "object" || typeof rule.type !== "string") invalidRule("missing type");
    switch (rule.type) {
        case "one-off":
            return { type: "one-off", date: normalizeOneOffDate(rule.date) };
        case "weekly":
            return normalizeWeekdays(rule);
        case "monthly":
            return normalizeMonthly(rule);
        case "yearly":
            return normalizeYearly(rule);
        default:
            invalidRule("unknown type");
    }
}

/** Throws RangeError when the rule is malformed; returns nothing otherwise. */
export function validateRule(rule: TodoRule): void {
    normalizeRule(rule);
}

export function isValidRule(rule: TodoRule): boolean {
    try {
        validateRule(rule);
        return true;
    } catch (error) {
        if (error instanceof RangeError) return false;
        throw error;
    }
}

function resolvedMonthlyDays(rule: MonthlyTodoRule, year: number, month: number): number[] {
    const lastDay = daysInMonth(year, month);
    return [...new Set(rule.days.map((selection) => {
        if (typeof selection === "number") return Math.min(selection, lastDay);
        if (!isLastDayOffsetSelection(selection)) return lastDay;
        const day = lastDay - selection.lastDayOffset;
        return day >= 1 ? day : null;
    }).filter((day): day is number => day !== null))].sort((left, right) => left - right);
}

function matchesDate(rule: TodoRule, date: Date): boolean {
    const [year, month, day] = localDateParts(date);
    switch (rule.type) {
        case "one-off":
            return rule.date === `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        case "weekly":
            return rule.weekdays.includes(date.getDay());
        case "monthly":
            return resolvedMonthlyDays(rule, year, month).includes(day);
        case "yearly":
            return rule.dates.some((candidate) => candidate.month === month + 1 && candidate.day === day);
    }
}

/** Returns whether a rule has an occurrence on the supplied local calendar date. */
export function isDueOn(rule: TodoRule, date: Date): boolean {
    const normalized = normalizeRule(rule);
    localDateParts(date);
    return matchesDate(normalized, date);
}

function monthlyCandidates(rule: MonthlyTodoRule, year: number, month: number): Date[] {
    return resolvedMonthlyDays(rule, year, month).map((day) => localDateAtNoon(year, month, day));
}

function yearlyCandidates(rule: TodoRule & { type: "yearly" }, year: number): Date[] {
    const candidates = !isLeapYear(year)
        ? rule.dates
            .filter(({ month, day }) => month !== 2 || day !== 29)
            .map(({ month, day }) => localDateAtNoon(year, month - 1, day))
        : rule.dates.map(({ month, day }) => localDateAtNoon(year, month - 1, day));

    return candidates.sort(compareLocalDates);
}

/**
 * Finds the first occurrence strictly after the completion date in local
 * calendar terms. Returning a local-noon Date avoids DST midnight changes.
 * A one-off whose date has already passed has no next occurrence.
 */
export function nextOccurrence(rule: TodoRule, completionTime: Date): Date | null {
    const normalized = normalizeRule(rule);
    const [year, month, day] = localDateParts(completionTime);
    const completionDate = localDateAtNoon(year, month, day);

    if (normalized.type === "one-off") {
        const candidate = localDateFromKey(normalized.date);
        return compareLocalDates(candidate, completionDate) > 0 ? candidate : null;
    }

    if (normalized.type === "weekly") {
        for (let offset = 1; offset <= 7; offset += 1) {
            const candidate = addLocalDays(completionDate, offset);
            if (matchesDate(normalized, candidate)) return candidate;
        }
        return null;
    }

    if (normalized.type === "monthly") {
        for (let offset = 0; offset < MAX_MONTH_SEARCH; offset += 1) {
            const absoluteMonth = year * 12 + month + offset;
            const candidateYear = Math.floor(absoluteMonth / 12);
            const candidateMonth = absoluteMonth % 12;
            const candidate = monthlyCandidates(normalized, candidateYear, candidateMonth).find(
                (date) => compareLocalDates(date, completionDate) > 0,
            );
            if (candidate) return candidate;
        }
        return null;
    }

    for (let offset = 0; offset < MAX_YEAR_SEARCH; offset += 1) {
        const candidate = yearlyCandidates(normalized, year + offset).find(
            (date) => compareLocalDates(date, completionDate) > 0,
        );
        if (candidate) return candidate;
    }
    return null;
}
