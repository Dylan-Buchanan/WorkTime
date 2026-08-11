import { normalizeRule } from "./recurrence";
import type { MonthlyDay, TodoRule, YearlyDate } from "./types";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

function joinList(values: string[]): string {
    if (values.length <= 1) return values[0] ?? "";
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function ordinal(value: number): string {
    const suffix = value % 100 >= 11 && value % 100 <= 13
        ? "th"
        : value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
    return `${value}${suffix}`;
}

export function formatMonthlyDay(day: MonthlyDay): string {
    if (day === "last-day") return "the last day";
    if (typeof day === "number") return ordinal(day);
    return day.lastDayOffset === 0 ? "the last day" : `the last day - ${day.lastDayOffset}`;
}

export function formatYearlyDate(date: YearlyDate): string {
    return `${MONTH_NAMES[date.month - 1]} ${date.day}`;
}

function compareMonthlyDays(left: MonthlyDay, right: MonthlyDay): number {
    const numericValue = (day: MonthlyDay): [number, number] => {
        if (typeof day === "number") return [0, day];
        if (day === "last-day") return [1, 0];
        return [1, day.lastDayOffset];
    };
    const leftValue = numericValue(left);
    const rightValue = numericValue(right);
    return leftValue[0] - rightValue[0] || leftValue[1] - rightValue[1];
}

/** Returns the compact, user-facing description shown below the schedule editor. */
export function formatTodoRule(rule: TodoRule | null): string {
    if (!rule) return "No due date";
    const normalized = normalizeRule(rule);
    switch (normalized.type) {
        case "one-off":
            return `On ${normalized.date}`;
        case "weekly":
            return `Every ${joinList([...normalized.weekdays].sort((left, right) => left - right).map((day) => WEEKDAY_NAMES[day]))}`;
        case "monthly": {
            const days = [...normalized.days].sort(compareMonthlyDays);
            return `Monthly on ${joinList(days.map(formatMonthlyDay))}`;
        }
        case "yearly": {
            const dates = [...normalized.dates].sort((left, right) => left.month - right.month || left.day - right.day);
            return `Every year on ${joinList(dates.map(formatYearlyDate))}`;
        }
    }
}
