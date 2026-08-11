/**
 * A calendar date used by a one-off rule. It is deliberately a date-only
 * value, rather than an ISO timestamp, so recurrence never depends on UTC.
 */
export type LocalDateKey = `${number}-${number}-${number}`;

export type TodoRuleType = "one-off" | "weekly" | "monthly" | "yearly";

export interface OneOffTodoRule {
    type: "one-off";
    date: string;
}

/** Sunday is 0, Monday is 1, through Saturday is 6. */
export interface WeeklyTodoRule {
    type: "weekly";
    weekdays: number[];
}

/**
 * A numeric monthly day is clamped to the month's last day. A last-day
 * selector represents `last day - lastDayOffset` (offset 0 means last day).
 */
export type MonthlyDay = number | "last-day" | { lastDayOffset: number };

export interface MonthlyTodoRule {
    type: "monthly";
    days: MonthlyDay[];
}

export interface YearlyDate {
    month: number;
    day: number;
}

export interface YearlyTodoRule {
    type: "yearly";
    dates: YearlyDate[];
}

export type TodoRule = OneOffTodoRule | WeeklyTodoRule | MonthlyTodoRule | YearlyTodoRule;

