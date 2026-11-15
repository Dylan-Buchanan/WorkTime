import type { Goal, GoalCadence, GoalMetric, Habit, HabitCompletion, HabitFrequency } from "../../state/types";
import { addLocalDays, dateFromBucket, dayBucket, getBucketKey } from "../habits/calendar";
import { isLeapYear, localDateFromKey } from "../todos/calendar";
import type { LocalDateKey } from "../todos/types";
import { normalizeGoalCadence } from "./cadence";
import { periodAt, previousPeriod, type GoalGridInput, type PeriodBounds } from "./periods";

export interface HabitMetricHit {
    readonly met: boolean;
    /** Signed surplus: completed minus target. */
    readonly delta: number;
}

interface ReadingWindow {
    readonly partial: boolean;
    readonly daysRemaining: number;
}
export type HabitMetricReading = ReadingWindow & (
    | ({ readonly unavailable: false; readonly completed: number; readonly totalBuckets: number; readonly availableBuckets: number } & HabitMetricHit)
    | { readonly unavailable: true; readonly completed: null; readonly totalBuckets: null; readonly availableBuckets: null; readonly met: null; readonly delta: null }
);

/** Canonical bucket starts in [periodStart, periodEnd), including straddling buckets. */
export function habitMetricBuckets(frequency: HabitFrequency, period: PeriodBounds): string[] {
    const start = localDateFromKey(period.periodStart);
    localDateFromKey(period.periodEnd);
    const buckets: string[] = [];
    let bucket = getBucketKey(start, frequency);
    while (bucket < period.periodEnd) {
        if (bucket >= period.periodStart) buckets.push(bucket);
        const date = dateFromBucket(bucket);
        if (frequency === "monthly") {
            date.setMonth(date.getMonth() + 1, 1);
            bucket = getBucketKey(date, frequency);
        } else {
            bucket = getBucketKey(addLocalDays(date, frequency === "daily" ? 1 : 7), frequency);
        }
    }
    return buckets;
}

export function habitMetricHit(completed: number, target: number): HabitMetricHit {
    return { met: completed >= target, delta: completed - target };
}

export function readHabitMetric(
    metric: GoalMetric,
    habits: readonly Habit[],
    completions: readonly HabitCompletion[],
    period: PeriodBounds,
    today: LocalDateKey,
): HabitMetricReading {
    const date = localDateFromKey(today);
    const lastDay = addLocalDays(localDateFromKey(period.periodEnd), -1);
    localDateFromKey(period.periodStart);
    const window: ReadingWindow = {
        partial: today >= period.periodStart && today < period.periodEnd,
        // Noon-to-noon rounded days remain stable across DST changes.
        daysRemaining: Math.max(0, Math.round((lastDay.getTime() - date.getTime()) / 86_400_000)),
    };
    const habit = metric.source === "habit" ? habits.find(habit => habit.id === metric.habitId) : undefined;
    if (!habit) return { ...window, unavailable: true, completed: null, totalBuckets: null, availableBuckets: null, met: null, delta: null };
    const buckets = habitMetricBuckets(habit.frequency, period);
    const currentBucket = getBucketKey(date, habit.frequency);
    const available = buckets.filter(bucket => bucket <= currentBucket);
    const completedKeys = new Set(completions.filter(completion => completion.habitId === habit.id).map(completion => completion.bucket));
    const completed = available.filter(bucket => completedKeys.has(bucket)).length;
    return { ...window, unavailable: false, completed, totalBuckets: buckets.length, availableBuckets: available.length, ...habitMetricHit(completed, metric.target) };
}

// A Gregorian cycle has 400 years / 4,800 months / 146,097 days, and starts
// on the same weekday each time. Numeric offsets avoid enumerating goal periods
// or walking a date range, even for arbitrarily long weekly cadences.
const CYCLE_DAYS = 146_097;
const CYCLE_MONTHS = 4_800;
const MONTH_STARTS: readonly number[] = (() => {
    const starts: number[] = [0]; // 2000-01-01 was Saturday.
    for (let year = 2000; year < 2400; year += 1) {
        for (const days of [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]) {
            starts.push(starts[starts.length - 1] + days);
        }
    }
    return starts;
})();

function monthOffset(index: number): number {
    return Math.floor(index / CYCLE_MONTHS) * CYCLE_DAYS + MONTH_STARTS[index % CYCLE_MONTHS];
}

function maxMonthStarts(weeks: number, weekday: number): number {
    // Split in weeks so even very large safe-integer intervals retain the remainder.
    const cycles = Math.floor(weeks / 20_871);
    const days = (weeks % 20_871) * 7;
    if (days === 0) return cycles * CYCLE_MONTHS;
    let maximum = 0;
    for (let first = 0; first < CYCLE_MONTHS; first += 1) {
        const start = MONTH_STARTS[first];
        const offset = ((6 + start) % 7 - weekday + 7) % 7;
        // The latest allowed start on this weekday before this month-first
        // leaves the most room for subsequent month-firsts.
        const end = start - offset + days;
        let low = first;
        let high = first + CYCLE_MONTHS;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (monthOffset(mid) < end) low = mid + 1;
            else high = mid;
        }
        maximum = Math.max(maximum, low - first);
    }
    return cycles * CYCLE_MONTHS + maximum;
}

/** Exact attainable maximum for this cadence and frequency, independent of anchor. */
export function maxHabitMetricBuckets(cadence: GoalCadence, frequency: HabitFrequency): number {
    const rule = normalizeGoalCadence(cadence);
    if (rule.kind === "every-n-weeks") {
        if (frequency === "daily") return rule.intervalWeeks * 7;
        if (frequency === "weekly") return rule.intervalWeeks;
        return maxMonthStarts(rule.intervalWeeks, rule.weekday);
    }
    // The existing monthly snapping rule permits six-week windows on Tue–Thu.
    const maxWeeks = rule.weekday >= 2 && rule.weekday <= 4 ? 6 : 5;
    if (frequency === "daily") return maxWeeks * 7;
    if (frequency === "weekly") return maxWeeks;
    return 2;
}

/** Count month-firsts in the half-open offset interval [from, to), across cycle wraps. */
function monthStartsIn(from: number, to: number): number {
    const countBefore = (offset: number): number => {
        let low = 0;
        let high = CYCLE_MONTHS;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (MONTH_STARTS[mid] < offset) low = mid + 1;
            else high = mid;
        }
        return low;
    };
    const fromCycle = Math.floor(from / CYCLE_DAYS);
    const toCycle = Math.floor(to / CYCLE_DAYS);
    const localFrom = from - fromCycle * CYCLE_DAYS;
    const localTo = to - toCycle * CYCLE_DAYS;
    return toCycle === fromCycle
        ? countBefore(localTo) - countBefore(localFrom)
        : CYCLE_MONTHS - countBefore(localFrom) + countBefore(localTo);
}

function minMonthStarts(weeks: number, weekday: number): number {
    // Split whole 400-year cycles out first so arbitrarily long strides stay exact.
    const cycles = Math.floor(weeks / 20_871);
    const days = (weeks % 20_871) * 7;
    if (days === 0) return cycles * CYCLE_MONTHS;
    let minimum = Number.POSITIVE_INFINITY;
    for (let first = 0; first < CYCLE_MONTHS; first += 1) {
        const start = MONTH_STARTS[first];
        const offset = ((weekday - ((6 + start) % 7)) % 7 + 7) % 7;
        // The fewest month-firsts start at the earliest cadence weekday strictly
        // after this month-first, leaving the widest gap before the next one.
        const windowStart = start + (offset === 0 ? 7 : offset);
        minimum = Math.min(minimum, monthStartsIn(windowStart, windowStart + days));
    }
    return cycles * CYCLE_MONTHS + minimum;
}

/** Exact guaranteed minimum bucket count over every period of this cadence. */
export function minHabitMetricBuckets(cadence: GoalCadence, frequency: HabitFrequency): number {
    const rule = normalizeGoalCadence(cadence);
    if (rule.kind === "every-n-weeks") {
        if (frequency === "daily") return rule.intervalWeeks * 7;
        if (frequency === "weekly") return rule.intervalWeeks;
        return minMonthStarts(rule.intervalWeeks, rule.weekday);
    }
    // The snapping rule can make a period three weeks long; some windows of every
    // monthly-weekday tracker contain no month-first at all.
    const short = rule.weekday === 0 || rule.weekday === 1;
    if (frequency === "daily") return short ? 28 : 21;
    if (frequency === "weekly") return short ? 4 : 3;
    return 0;
}

const FREQUENCY_ORDER: readonly HabitFrequency[] = ["daily", "weekly", "monthly"];

/** Frequencies whose guaranteed minimum is at least 1, in order daily, weekly, monthly. */
export function connectableHabitFrequencies(cadence: GoalCadence): HabitFrequency[] {
    return FREQUENCY_ORDER.filter(frequency => minHabitMetricBuckets(cadence, frequency) >= 1);
}

const HABIT_UNIT_WORDS: Record<HabitFrequency, readonly [string, string]> = {
    daily: ["day", "days"],
    weekly: ["week", "weeks"],
    monthly: ["month", "months"],
};

/** "day"/"days", "week"/"weeks", "month"/"months"; singular only when count === 1. */
export function habitUnitWord(count: number, frequency: HabitFrequency): string {
    return HABIT_UNIT_WORDS[frequency][count === 1 ? 0 : 1];
}

/** Always the plural: "days" | "weeks" | "months". This is the stored metric unit. */
export function habitUnitPlural(frequency: HabitFrequency): string {
    return HABIT_UNIT_WORDS[frequency][1];
}

/** Current misses are provisional; completed misses break the streak. */
export function habitMetricStreak(
    goal: Pick<Goal, "metric" | "createdAt">,
    grid: GoalGridInput,
    habits: readonly Habit[],
    completions: readonly HabitCompletion[],
    today: LocalDateKey,
    throughPeriodStart: LocalDateKey = today,
): number | null {
    if (!goal.metric || goal.metric.source !== "habit" || !habits.some(habit => habit.id === goal.metric?.habitId)) return null;
    // Resolve a date through the grid first: stored off-grid keys never reach previousPeriod.
    let period = periodAt(grid, throughPeriodStart < today ? throughPeriodStart : today);
    const createdOn = dayBucket(new Date(goal.createdAt));
    let streak = 0;
    while (period && period.periodEnd > createdOn && createdOn <= today) {
        const reading = readHabitMetric(goal.metric, habits, completions, period, today);
        if (reading.met) streak += 1;
        else if (!reading.partial) break;
        period = previousPeriod(grid, period);
    }
    return streak;
}
