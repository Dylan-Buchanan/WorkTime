import type { GoalCadence, GoalTracker, Weekday } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import {
    addLocalDays,
    compareLocalDates,
    localDateAtNoon,
    localDateFromKey,
    localDateKey,
} from "../todos/calendar";
import { normalizeGoalCadence } from "./cadence";
import { isGoalDateKey } from "./factories";

export type GoalMonthKey = `${number}-${number}`;
export interface PeriodBounds {
    readonly periodStart: LocalDateKey;
    readonly periodEnd: LocalDateKey;
}
export interface GoalPeriod extends PeriodBounds {
    readonly monthKey: GoalMonthKey;
}
export interface GoalGridInput {
    readonly cadence: GoalCadence;
    readonly cadenceAnchorAt: LocalDateKey;
    readonly createdOn: LocalDateKey;
    readonly isArchived: boolean;
    readonly lastBuiltPeriodStart: LocalDateKey | null;
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const MONTH_ABBREVIATIONS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const EN_DASH = "\u2013";
const MILLISECONDS_PER_DAY = 86_400_000;

function dateKey(date: Date): LocalDateKey {
    const key = localDateKey(date);
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
}

function parseKey(key: LocalDateKey): Date {
    return localDateFromKey(key);
}

function compareKeys(left: LocalDateKey, right: LocalDateKey): number {
    return compareLocalDates(parseKey(left), parseKey(right));
}

function dayDifference(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);
}

function normalizeMonth(year: number, month: number): { year: number; month: number } {
    const date = localDateAtNoon(year, month, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
}

function monthKeyOf(year: number, month: number): GoalMonthKey {
    const normalized = normalizeMonth(year, month);
    return `${String(normalized.year).padStart(4, "0")}-${String(normalized.month + 1).padStart(2, "0")}` as GoalMonthKey;
}

function splitMonthKey(monthKey: GoalMonthKey): { year: number; month: number } {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
    if (!match) throw new RangeError("Invalid goal month key");
    const month = Number(match[2]) - 1;
    if (month < 0 || month > 11) throw new RangeError("Invalid goal month key");
    return { year: Number(match[1]), month };
}

// The nominal month owns this boundary, including dates snapped into the prior month.
function monthlyBoundary(year: number, month: number, weekday: Weekday): Date {
    const first = localDateAtNoon(year, month, 1);
    const day = first.getDay();
    const shift = day === 1 || day === 2
        ? -((day - weekday + 7) % 7)
        : (weekday - day + 7) % 7;
    return addLocalDays(first, shift);
}

export function resolveCadenceAnchorAt(rule: GoalCadence, after: LocalDateKey): LocalDateKey {
    const cadence = normalizeGoalCadence(rule);
    const date = localDateFromKey(after);
    if (cadence.kind === "every-n-weeks") {
        const days = (cadence.weekday - date.getDay() + 7) % 7 || 7;
        return dateKey(addLocalDays(date, days));
    }
    // Include adjacent nominal months: next month's boundary can precede its 1st.
    for (let month = date.getMonth() - 1; ; month += 1) {
        const boundary = dateKey(monthlyBoundary(date.getFullYear(), month, cadence.weekday));
        if (boundary > after) return boundary;
    }
}

function weeklyPeriod(strideDays: number, start: Date): GoalPeriod {
    const periodStart = dateKey(start);
    return {
        periodStart,
        periodEnd: dateKey(addLocalDays(start, strideDays)),
        monthKey: periodStart.slice(0, 7) as GoalMonthKey,
    };
}

function monthlyPeriod(year: number, month: number, weekday: Weekday): GoalPeriod {
    const nominal = normalizeMonth(year, month);
    const next = normalizeMonth(nominal.year, nominal.month + 1);
    return {
        periodStart: dateKey(monthlyBoundary(nominal.year, nominal.month, weekday)),
        periodEnd: dateKey(monthlyBoundary(next.year, next.month, weekday)),
        monthKey: monthKeyOf(nominal.year, nominal.month),
    };
}

function weeklyBoundaryAfter(anchor: Date, strideDays: number, target: Date): Date {
    const offset = dayDifference(anchor, target);
    let k = Math.floor(offset / strideDays) + 1;
    while (compareLocalDates(addLocalDays(anchor, k * strideDays), target) <= 0) k += 1;
    while (compareLocalDates(addLocalDays(anchor, (k - 1) * strideDays), target) > 0) k -= 1;
    return addLocalDays(anchor, k * strideDays);
}

function monthlyBoundaryAfter(weekday: Weekday, target: Date): { year: number; month: number } {
    const start = normalizeMonth(target.getFullYear(), target.getMonth() - 1);
    let year = start.year;
    let month = start.month;
    for (;;) {
        if (compareLocalDates(monthlyBoundary(year, month, weekday), target) > 0) return { year, month };
        const next = normalizeMonth(year, month + 1);
        year = next.year;
        month = next.month;
    }
}

function monthlyPeriodContaining(weekday: Weekday, target: Date): GoalPeriod {
    const start = normalizeMonth(target.getFullYear(), target.getMonth() - 1);
    let year = start.year;
    let month = start.month;
    let nominal = { year, month };
    for (;;) {
        if (compareLocalDates(monthlyBoundary(year, month, weekday), target) > 0) {
            return monthlyPeriod(nominal.year, nominal.month, weekday);
        }
        nominal = { year, month };
        const next = normalizeMonth(year, month + 1);
        year = next.year;
        month = next.month;
    }
}

function monthlyPeriodBefore(weekday: Weekday, startKey: LocalDateKey): GoalPeriod {
    const startDate = parseKey(startKey);
    const start = normalizeMonth(startDate.getFullYear(), startDate.getMonth() - 1);
    let year = start.year;
    let month = start.month;
    for (let step = 0; step < 4; step += 1) {
        if (compareLocalDates(monthlyBoundary(year, month, weekday), startDate) === 0) {
            const previous = normalizeMonth(year, month - 1);
            return monthlyPeriod(previous.year, previous.month, weekday);
        }
        const next = normalizeMonth(year, month + 1);
        year = next.year;
        month = next.month;
    }
    throw new RangeError("Goal period is not on the monthly cadence grid");
}

function boundaryAfter(cadence: GoalCadence, anchor: Date, target: LocalDateKey): GoalPeriod {
    const targetDate = parseKey(target);
    if (cadence.kind === "every-n-weeks") {
        const strideDays = cadence.intervalWeeks * 7;
        return weeklyPeriod(strideDays, weeklyBoundaryAfter(anchor, strideDays, targetDate));
    }
    const boundary = monthlyBoundaryAfter(cadence.weekday, targetDate);
    return monthlyPeriod(boundary.year, boundary.month, cadence.weekday);
}

function boundaryOnOrAfter(cadence: GoalCadence, anchor: Date, target: LocalDateKey): GoalPeriod {
    return boundaryAfter(cadence, anchor, dateKey(addLocalDays(parseKey(target), -1)));
}

export function goalGrid(tracker: GoalTracker): GoalGridInput {
    return {
        cadence: normalizeGoalCadence(tracker.cadence),
        cadenceAnchorAt: tracker.cadenceAnchorAt,
        createdOn: dateKey(new Date(tracker.createdAt)),
        isArchived: tracker.isArchived,
        lastBuiltPeriodStart: tracker.lastBuiltPeriodStart,
    };
}

export function firstPeriod(grid: GoalGridInput): GoalPeriod {
    const cadence = normalizeGoalCadence(grid.cadence);
    const anchor = parseKey(grid.cadenceAnchorAt);
    const firstAfterCreation = boundaryAfter(cadence, anchor, grid.createdOn).periodStart;
    const floor = compareKeys(firstAfterCreation, grid.cadenceAnchorAt) >= 0
        ? firstAfterCreation
        : grid.cadenceAnchorAt;
    return boundaryOnOrAfter(cadence, anchor, floor);
}

export function periodAt(grid: GoalGridInput, date: LocalDateKey): GoalPeriod | null {
    const first = firstPeriod(grid);
    if (compareKeys(date, first.periodStart) < 0) return null;
    const cadence = normalizeGoalCadence(grid.cadence);
    const anchor = parseKey(grid.cadenceAnchorAt);
    let period: GoalPeriod;
    if (cadence.kind === "every-n-weeks") {
        const strideDays = cadence.intervalWeeks * 7;
        const target = parseKey(date);
        let start = addLocalDays(anchor, Math.floor(dayDifference(anchor, target) / strideDays) * strideDays);
        while (compareLocalDates(start, target) > 0) start = addLocalDays(start, -strideDays);
        while (compareLocalDates(addLocalDays(start, strideDays), target) <= 0) start = addLocalDays(start, strideDays);
        period = weeklyPeriod(strideDays, start);
    } else {
        period = monthlyPeriodContaining(cadence.weekday, parseKey(date));
    }
    return compareKeys(period.periodStart, first.periodStart) < 0 ? null : period;
}

export function previousPeriod(grid: GoalGridInput, period: GoalPeriod): GoalPeriod | null {
    const first = firstPeriod(grid);
    if (compareKeys(period.periodStart, first.periodStart) <= 0) return null;
    const cadence = normalizeGoalCadence(grid.cadence);
    const previous = cadence.kind === "every-n-weeks"
        ? weeklyPeriod(
            cadence.intervalWeeks * 7,
            addLocalDays(parseKey(period.periodStart), -(cadence.intervalWeeks * 7)),
        )
        : monthlyPeriodBefore(cadence.weekday, period.periodStart);
    return compareKeys(previous.periodStart, first.periodStart) < 0 ? null : previous;
}

export function nextPeriod(grid: GoalGridInput, period: GoalPeriod): GoalPeriod {
    const cadence = normalizeGoalCadence(grid.cadence);
    return boundaryOnOrAfter(cadence, parseKey(grid.cadenceAnchorAt), period.periodEnd);
}

export function mostRecentCompletedPeriod(grid: GoalGridInput, today: LocalDateKey): GoalPeriod | null {
    const current = periodAt(grid, today);
    return current ? previousPeriod(grid, current) : null;
}

export function listPeriods(grid: GoalGridInput, from: LocalDateKey, to: LocalDateKey): GoalPeriod[] {
    if (compareKeys(to, from) <= 0) return [];
    const first = firstPeriod(grid);
    let period = compareKeys(from, first.periodStart) < 0 ? first : periodAt(grid, from);
    const periods: GoalPeriod[] = [];
    const toDate = parseKey(to);
    while (period && compareLocalDates(parseKey(period.periodStart), toDate) < 0) {
        if (compareKeys(period.periodEnd, from) > 0) periods.push(period);
        period = nextPeriod(grid, period);
    }
    return periods;
}

export type DueState =
    | { readonly kind: "archived" }
    | { readonly kind: "before-first-period"; readonly firstPeriod: GoalPeriod }
    | {
          readonly kind: "not-due";
          readonly current: GoalPeriod;
          readonly mostRecentCompleted: GoalPeriod | null;
          readonly lastBuiltPeriodStart: LocalDateKey | null;
      }
    | {
          readonly kind: "due";
          readonly current: GoalPeriod;
          readonly mostRecentCompleted: GoalPeriod;
          readonly lastBuiltPeriodStart: LocalDateKey | null;
      };

export function dueState(grid: GoalGridInput, today: LocalDateKey): DueState {
    if (grid.isArchived) return { kind: "archived" };
    const first = firstPeriod(grid);
    const current = periodAt(grid, today);
    if (!current) return { kind: "before-first-period", firstPeriod: first };
    const completed = mostRecentCompletedPeriod(grid, today);
    const built = grid.lastBuiltPeriodStart;
    if (completed && (built === null || compareKeys(built, completed.periodStart) < 0)) {
        return { kind: "due", current, mostRecentCompleted: completed, lastBuiltPeriodStart: built };
    }
    return { kind: "not-due", current, mostRecentCompleted: completed, lastBuiltPeriodStart: built };
}

export function periodLabel(period: GoalPeriod): string {
    const { year, month } = splitMonthKey(period.monthKey);
    return `${MONTH_NAMES[month]} ${year}`;
}

export function periodRangeLabel(period: GoalPeriod): string {
    const start = parseKey(period.periodStart);
    const endInclusive = addLocalDays(parseKey(period.periodEnd), -1);
    const startText = `${MONTH_ABBREVIATIONS[start.getMonth()]} ${start.getDate()}`;
    const endText = `${MONTH_ABBREVIATIONS[endInclusive.getMonth()]} ${endInclusive.getDate()}`;
    return start.getFullYear() === endInclusive.getFullYear()
        ? `${startText} ${EN_DASH} ${endText}, ${start.getFullYear()}`
        : `${startText}, ${start.getFullYear()} ${EN_DASH} ${endText}, ${endInclusive.getFullYear()}`;
}
