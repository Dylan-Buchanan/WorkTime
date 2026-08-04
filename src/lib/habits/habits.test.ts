import { describe, expect, it } from "vitest";
import type { Habit } from "../../state/types";
import {
    bucketFor,
    canCheckHabitCell,
    createHabit,
    createHabitCompletion,
    dayBucket,
    derive365Grid,
    filterVisibleHabits,
    getBucketKey,
    getMonthBucket,
    getWeekBucket,
    getWindowBuckets,
    isHabitCompleted,
    monthBucket,
    weekBucket,
    visibleFrequencies,
} from "./index";

const date = (year: number, month: number, day: number, hour = 12): Date => new Date(year, month - 1, day, hour, 0, 0, 0);

function habit(id: string, frequency: Habit["frequency"]): Habit {
    return {
        id,
        name: id,
        description: "",
        color: "#6366F1",
        frequency,
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

describe("habit bucket math", () => {
    it("uses the device-local calendar date rather than the UTC date", () => {
        const localDate = new Date(2026, 0, 1, 0, 30, 0, 0);
        expect(dayBucket(localDate)).toBe(
            `${localDate.getFullYear()}-01-01`,
        );
        expect(getBucketKey(localDate, "daily")).toBe(dayBucket(localDate));
    });

    it("uses Sunday as the week start across a year boundary", () => {
        const saturday = date(2022, 1, 1);
        const sunday = date(2022, 1, 2);
        expect(weekBucket(saturday)).toBe("2021-12-26");
        expect(getWeekBucket(sunday)).toBe("2022-01-02");
        expect(bucketFor(sunday, "weekly")).toBe("2022-01-02");
    });

    it("uses the first local day of the month, including leap-year February", () => {
        const leapDay = date(2024, 2, 29, 23);
        expect(monthBucket(leapDay)).toBe("2024-02-01");
        expect(getMonthBucket(leapDay)).toBe("2024-02-01");
    });

    it("advances local dates by calendar days across DST without millisecond arithmetic", () => {
        const before = date(2024, 3, 9);
        const after = new Date(before.getTime());
        after.setDate(after.getDate() + 1);
        expect(dayBucket(after)).toBe("2024-03-10");
        expect(dayBucket(new Date(after.getTime()))).toBe(dayBucket(after));
    });
});

describe("habit windows and visibility", () => {
    const now = date(2026, 7, 15);

    it("returns the current Sunday-through-Saturday daily window", () => {
        const buckets = getWindowBuckets("week", "daily", now);
        expect(buckets).toHaveLength(7);
        expect(buckets[0]).toBe("2026-07-12");
        expect(buckets[6]).toBe("2026-07-18");
    });

    it("returns every local day in the current month and overlapping Sunday weeks", () => {
        expect(getWindowBuckets("month", "daily", date(2026, 2, 1))).toHaveLength(28);
        const weeks = getWindowBuckets("month", "weekly", date(2026, 2, 1));
        expect(weeks[0]).toBe("2026-02-01");
        expect(weeks[weeks.length - 1]).toBe("2026-02-22");
    });

    it("returns an inclusive trailing 365-day daily window", () => {
        const buckets = getWindowBuckets(new Date(2026, 6, 15, 23), "year", "daily");
        expect(buckets).toHaveLength(365);
        expect(buckets[0]).toBe("2025-07-16");
        expect(buckets[buckets.length - 1]).toBe("2026-07-15");
    });

    it("maps visibility to the three locked windows and preserves input order", () => {
        const habits = [habit("daily", "daily"), habit("weekly", "weekly"), habit("monthly", "monthly")];
        expect(visibleFrequencies("7")).toEqual(["daily"]);
        expect(filterVisibleHabits(habits, "30").map(({ id }) => id)).toEqual(["daily", "weekly"]);
        expect(filterVisibleHabits(habits, "365").map(({ id }) => id)).toEqual(["daily", "weekly", "monthly"]);
    });
});

describe("habit checkability and grids", () => {
    const now = date(2026, 7, 15);

    it("disables future-starting cells while keeping past and current cells checkable", () => {
        expect(canCheckHabitCell("daily", "2026-07-14", now)).toBe(true);
        expect(canCheckHabitCell("daily", "2026-07-15", now)).toBe(true);
        expect(canCheckHabitCell("daily", "2026-07-16", now)).toBe(false);
        expect(canCheckHabitCell("weekly", "2026-07-12", now)).toBe(true);
        expect(canCheckHabitCell("weekly", "2026-07-19", now)).toBe(false);
        expect(canCheckHabitCell("monthly", "2026-08-01", now)).toBe(false);
    });

    it("derives a checked, positioned 365-day grid without mutating completions", () => {
        const daily = habit("daily", "daily");
        const completion = createHabitCompletion(daily.id, "2026-07-15", now, "completion-1");
        const completions = [completion];
        const before = structuredClone(completions);
        const grid = derive365Grid(daily, completions, now);

        expect(grid.columns).toBe(7);
        expect(grid.rows).toBe(53);
        expect(grid.cells).toHaveLength(365);
        expect(grid.cells[grid.cells.length - 1]).toMatchObject({ bucket: "2026-07-15", row: 52, column: 0, checked: true, checkable: true });
        expect(grid.cells.every((cell) => cell.checkable)).toBe(true);
        expect(completions).toEqual(before);
        expect(isHabitCompleted(completions, daily.id, "2026-07-15")).toBe(true);
    });

    it("wraps weekly history into seven columns", () => {
        const grid = derive365Grid(habit("weekly", "weekly"), [], now);
        expect(grid.columns).toBe(7);
        expect(grid.cells.length).toBeGreaterThanOrEqual(52);
        expect(grid.cells.length).toBeLessThanOrEqual(53);
        expect(grid.cells.every((cell, index) => cell.column === index % 7 && cell.row === Math.floor(index / 7))).toBe(true);
    });
});

describe("habit factories", () => {
    it("uses injected ids and clocks without hidden I/O", () => {
        const now = date(2026, 1, 1);
        const created = createHabit({ name: "Read", color: "#fff", frequency: "daily" }, now, "habit-1");
        const completion = createHabitCompletion("habit-1", "2026-01-01", now, "completion-1");
        expect(created).toMatchObject({ id: "habit-1", name: "Read", description: "", frequency: "daily", isArchived: false });
        expect(created.createdAt).toBe(now.toISOString());
        expect(completion).toEqual({ id: "completion-1", habitId: "habit-1", bucket: "2026-01-01", createdAt: now.toISOString(), updatedAt: now.toISOString() });
    });
});
