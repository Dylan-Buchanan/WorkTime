import { describe, expect, it } from "vitest";
import type { Goal, GoalCadence, Habit, HabitCompletion, HabitFrequency, Weekday } from "../../state/types";
import { addLocalDays, dayBucket } from "../habits/calendar";
import type { LocalDateKey } from "../todos/types";
import { habitMetricBuckets, habitMetricHit, habitMetricStreak, maxHabitMetricBuckets, readHabitMetric } from "./habitMetric";
import { listPeriods, type GoalGridInput, type PeriodBounds } from "./periods";

const metric = { label: "Practice", current: 999, target: 3, unit: "sessions", source: "habit" as const, habitId: "h", overridePinned: false };
const goal: Pick<Goal, "metric" | "createdAt"> = { metric, createdAt: "2026-01-01T12:00:00" };
const habit = (frequency: HabitFrequency, isArchived = false): Habit => ({ id: "h", name: "Practice", description: "", color: "", frequency, position: 0, isArchived, createdAt: goal.createdAt, updatedAt: goal.createdAt });
const completion = (bucket: string, habitId = "h", id = bucket): HabitCompletion => ({ id, habitId, bucket, createdAt: goal.createdAt, updatedAt: goal.createdAt });
const bounds = (periodStart: LocalDateKey, periodEnd: LocalDateKey): PeriodBounds => ({ periodStart, periodEnd });
const grid = (cadence: GoalCadence = { kind: "every-n-weeks", weekday: 0, intervalWeeks: 1 }): GoalGridInput => ({ cadence, cadenceAnchorAt: "2026-01-04", createdOn: "2026-01-01", isArchived: false, lastBuiltPeriodStart: null });

describe("habit metric bucket windows", () => {
    it.each<[HabitFrequency, number, number]>([["daily", 14, 35], ["weekly", 2, 5], ["monthly", 0, 1]])("enumerates %s buckets in multi-week and monthly windows", (frequency, weeklyCount, monthlyCount) => {
        expect(habitMetricBuckets(frequency, bounds("2026-01-04", "2026-01-18"))).toHaveLength(weeklyCount);
        expect(habitMetricBuckets(frequency, bounds("2026-01-04", "2026-02-08"))).toHaveLength(monthlyCount);
    });

    it("assigns straddling Sunday buckets only to the period containing their start", () => {
        const first = bounds("2026-01-05", "2026-01-14");
        const next = bounds("2026-01-14", "2026-01-23");
        expect(habitMetricBuckets("weekly", first)).toEqual(["2026-01-11"]);
        expect(habitMetricBuckets("weekly", next)).toEqual(["2026-01-18"]);
        expect(readHabitMetric(metric, [habit("weekly")], [completion("2026-01-11")], first, "2026-02-01").completed).toBe(1);
        expect(readHabitMetric(metric, [habit("weekly")], [completion("2026-01-11")], next, "2026-02-01").completed).toBe(0);
    });

    it("handles empty windows, leap days, year boundaries and DST with local date keys", () => {
        expect(habitMetricBuckets("daily", bounds("2026-01-04", "2026-01-04"))).toEqual([]);
        expect(habitMetricBuckets("daily", bounds("2024-02-28", "2024-03-02"))).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
        expect(habitMetricBuckets("weekly", bounds("2025-12-28", "2026-01-05"))).toEqual(["2025-12-28", "2026-01-04"]);
        expect(habitMetricBuckets("monthly", bounds("2025-12-15", "2026-02-02"))).toEqual(["2026-01-01", "2026-02-01"]);
        expect(habitMetricBuckets("daily", bounds("2026-03-07", "2026-03-10"))).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    });
});

describe("habit metric readings", () => {
    it("derives live counts, dedupes buckets, filters other habits and ignores malformed or future completions", () => {
        const completions = [completion("2026-01-04"), completion("2026-01-04", "h", "duplicate"), completion("2026-01-05", "other"), completion("2026-01-06"), completion("2026-01-08"), completion("2026-1-05"), completion("2026-02-30")];
        const reading = readHabitMetric(metric, [habit("daily")], completions, bounds("2026-01-04", "2026-01-11"), "2026-01-06");
        expect(reading).toEqual({ unavailable: false, completed: 2, totalBuckets: 7, availableBuckets: 3, partial: true, daysRemaining: 4, met: false, delta: -1 });
        expect(readHabitMetric(metric, [habit("daily", true)], completions, bounds("2026-01-04", "2026-01-11"), "2026-01-06")).toEqual(reading);
    });

    it("distinguishes nothing possible from an empty count and from an unavailable link", () => {
        const period = bounds("2020-02-02", "2020-03-01");
        expect(readHabitMetric(metric, [habit("monthly")], [], period, "2020-03-01")).toMatchObject({ unavailable: false, completed: 0, totalBuckets: 0, availableBuckets: 0, met: false, delta: -3 });
        expect(readHabitMetric(metric, [habit("weekly")], [], bounds("2026-01-04", "2026-02-08"), "2026-02-08")).toMatchObject({ completed: 0, totalBuckets: 5 });
        expect(readHabitMetric(metric, [], [completion("2026-01-04")], period, "2020-03-01")).toMatchObject({ unavailable: true, completed: null, totalBuckets: null, availableBuckets: null, met: null, delta: null });
    });

    it.each<[HabitFrequency, LocalDateKey, number]>([["weekly", "2026-01-07", 1], ["monthly", "2026-01-07", 1]])("makes the current %s bucket available before its end", (frequency, today, availableBuckets) => {
        expect(readHabitMetric(metric, [habit(frequency)], [], bounds("2026-01-01", "2026-02-02"), today)).toMatchObject({ partial: true, availableBuckets });
    });

    it("clamps days remaining on the last day and never marks completed or future periods partial", () => {
        const period = bounds("2026-03-07", "2026-03-10");
        expect(readHabitMetric(metric, [habit("daily")], [], period, "2026-03-07")).toMatchObject({ daysRemaining: 2, partial: true });
        expect(readHabitMetric(metric, [habit("daily")], [], period, "2026-03-09")).toMatchObject({ daysRemaining: 0, partial: true });
        expect(readHabitMetric(metric, [habit("daily")], [], period, "2026-03-10")).toMatchObject({ daysRemaining: 0, partial: false, availableBuckets: 3 });
        expect(readHabitMetric(metric, [habit("daily")], [completion("2026-03-07")], period, "2026-03-06")).toMatchObject({ partial: false, completed: 0, availableBuckets: 0 });
    });

    it("returns numeric deltas and a boolean hit without prose", () => {
        expect(habitMetricHit(3, 3)).toEqual({ met: true, delta: 0 });
        expect(habitMetricHit(5, 3)).toEqual({ met: true, delta: 2 });
        expect(habitMetricHit(0, 3)).toEqual({ met: false, delta: -3 });
        expect(habitMetricHit(0, 0)).toEqual({ met: true, delta: 0 });
    });
});

describe("cadence bucket maxima", () => {
    it.each([0, 1, 2, 3, 4, 5, 6] as Weekday[])("uses the existing monthly snapping rule for weekday %s", weekday => {
        const cadence: GoalCadence = { kind: "monthly-weekday", weekday };
        const maxWeeks = weekday >= 2 && weekday <= 4 ? 6 : 5;
        expect(maxHabitMetricBuckets(cadence, "daily")).toBe(maxWeeks * 7);
        expect(maxHabitMetricBuckets(cadence, "weekly")).toBe(maxWeeks);
        expect(maxHabitMetricBuckets(cadence, "monthly")).toBe(2);
        const periods = listPeriods({ ...grid(cadence), cadenceAnchorAt: "2020-01-01", createdOn: "2019-12-01" }, "2020-01-01", "2028-01-01");
        for (const frequency of ["daily", "weekly", "monthly"] as const) {
            expect(Math.max(...periods.map(period => habitMetricBuckets(frequency, period).length))).toBe(maxHabitMetricBuckets(cadence, frequency));
        }
    });

    it.each<[number, number]>([[1, 1], [4, 1], [5, 2], [8, 2], [12, 3], [52, 12], [53, 13], [104, 24], [20871, 4800], [20872, 4801]])("supports %s week strides including multi-century intervals", (intervalWeeks, months) => {
        for (const weekday of [0, 1, 2, 3, 4, 5, 6] as Weekday[]) {
            const cadence: GoalCadence = { kind: "every-n-weeks", weekday, intervalWeeks };
            expect(maxHabitMetricBuckets(cadence, "daily")).toBe(7 * intervalWeeks);
            expect(maxHabitMetricBuckets(cadence, "weekly")).toBe(intervalWeeks);
            expect(maxHabitMetricBuckets(cadence, "monthly")).toBe(months);
        }
    });

    it("counts actual 21- and 42-day periods without assuming a calendar month", () => {
        expect(habitMetricBuckets("daily", bounds("2021-05-07", "2021-05-28"))).toHaveLength(21);
        expect(habitMetricBuckets("daily", bounds("2025-06-25", "2025-08-06"))).toHaveLength(42);
        expect(habitMetricBuckets("weekly", bounds("2025-06-25", "2025-08-06"))).toHaveLength(6);
        expect(habitMetricBuckets("monthly", bounds("2025-06-25", "2025-08-06"))).toHaveLength(2);
    });
});

describe("habit metric streak", () => {
    const oneTarget = { ...goal, metric: { ...metric, target: 1 } };
    const history = [completion("2026-01-04"), completion("2026-01-11")];

    it("retains completed hits during an unfinished miss, then adds a current hit", () => {
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], history, "2026-01-20")).toBe(2);
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], [...history, completion("2026-01-18")], "2026-01-20")).toBe(3);
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], history, "2026-01-26")).toBe(0);
    });

    it("stops at a completed miss and at the tracker/goal floor", () => {
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], [completion("2026-01-11")], "2026-01-20")).toBe(1);
        expect(habitMetricStreak({ ...oneTarget, createdAt: "2026-01-11T12:00:00" }, grid(), [habit("weekly")], history, "2026-01-20")).toBe(1);
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], [completion("2025-12-28"), ...history], "2026-01-20")).toBe(2);
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], history, "2026-01-03")).toBe(0);
        expect(habitMetricStreak({ ...oneTarget, createdAt: "2026-02-01T12:00:00" }, grid(), [habit("weekly")], history, "2026-01-20")).toBe(0);
    });

    it("normalizes off-grid historical keys and clamps future selections on both grids", () => {
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], history, "2026-01-26", "2026-01-13")).toBe(2);
        const monthlyGrid = grid({ kind: "monthly-weekday", weekday: 0 });
        expect(habitMetricStreak(oneTarget, monthlyGrid, [habit("monthly")], [completion("2026-02-01")], "2026-03-10", "2026-02-19")).toBe(1);
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], history, "2026-01-20", "2027-01-01")).toBe(2);
    });

    it("keeps archived history, returns null for missing habits and never mutates inputs", () => {
        const completions = Object.freeze(history.map(item => Object.freeze(item)));
        expect(habitMetricStreak(oneTarget, grid(), [Object.freeze(habit("weekly", true))], completions, "2026-01-20")).toBe(2);
        expect(habitMetricStreak(oneTarget, grid(), [], completions, "2026-01-20")).toBeNull();
        expect(habitMetricStreak({ ...goal, metric: null }, grid(), [], [], "2026-01-20")).toBeNull();
    });

    it("uses local calendar days for a supplied Date converted to today", () => {
        const date = new Date(2026, 0, 20, 12);
        expect(habitMetricStreak(oneTarget, grid(), [habit("weekly")], history, dayBucket(addLocalDays(date, 0)) as LocalDateKey)).toBe(2);
    });
});
