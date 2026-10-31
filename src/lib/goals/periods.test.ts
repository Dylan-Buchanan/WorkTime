import { describe, expect, it } from "vitest";
import {
    dueState,
    firstPeriod,
    goalGrid,
    listPeriods,
    mostRecentCompletedPeriod,
    nextPeriod,
    periodAt,
    periodLabel,
    periodRangeLabel,
    previousPeriod,
    resolveCadenceAnchorAt,
} from "./periods";
import type { GoalGridInput, GoalPeriod } from "./periods";
import type { GoalCadence } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { addLocalDays, localDateAtNoon, localDateFromKey, localDateKey } from "../todos/calendar";
import { buildGoalTrackerFixture, buildMonthlyWeekdayTrackerFixture } from "./testFixtures";

describe("resolveCadenceAnchorAt", () => {
    it.each<[GoalCadence, LocalDateKey, LocalDateKey]>([
        [{ kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 }, "2026-10-01", "2026-10-04"],
        [{ kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 }, "2026-10-04", "2026-10-11"],
        [{ kind: "every-n-weeks", weekday: 3, intervalWeeks: 1 }, "2026-12-31", "2027-01-06"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-09-20", "2026-10-04"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-11-01", "2026-11-29"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-11-29", "2027-01-03"],
        // Monday and Tuesday triggers both snap backwards; equality stays on the 1st.
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-05-20", "2026-05-31"],
        [{ kind: "monthly-weekday", weekday: 1 }, "2026-05-31", "2026-06-01"],
        [{ kind: "monthly-weekday", weekday: 1 }, "2026-06-01", "2026-07-06"],
        [{ kind: "monthly-weekday", weekday: 2 }, "2026-11-30", "2026-12-01"],
        [{ kind: "monthly-weekday", weekday: 5 }, "2026-11-20", "2026-11-27"],
        [{ kind: "monthly-weekday", weekday: 0 }, "2026-12-31", "2027-01-03"],
    ])("resolves %j strictly after %s to %s", (rule, after, expected) => {
        expect(resolveCadenceAnchorAt(rule, after)).toBe(expected);
    });

    it("validates the rule and date rather than inventing an anchor", () => {
        expect(() => resolveCadenceAnchorAt({ kind: "every-n-weeks", weekday: 0, intervalWeeks: 0 }, "2026-10-01")).toThrow(RangeError);
        expect(() => resolveCadenceAnchorAt({ kind: "monthly-weekday", weekday: 0 }, "2026-02-30")).toThrow(RangeError);
    });
});

const EVERY_TWO_SUNDAYS: GoalCadence = { kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 };
const MONTHLY_SUNDAY: GoalCadence = { kind: "monthly-weekday", weekday: 0 };

function buildGrid(overrides: Partial<GoalGridInput> = {}): GoalGridInput {
    return {
        cadence: EVERY_TWO_SUNDAYS,
        cadenceAnchorAt: "2026-10-04",
        createdOn: "2026-09-20",
        isArchived: false,
        lastBuiltPeriodStart: null,
        ...overrides,
    };
}

function required(period: GoalPeriod | null): GoalPeriod {
    if (!period) throw new Error("Expected a goal period");
    return period;
}

function expectPeriodLength(period: GoalPeriod, days: number): void {
    expect(localDateKey(addLocalDays(localDateFromKey(period.periodStart), days))).toBe(period.periodEnd);
}

describe("goal period grid", () => {
    it("walks every-n-weeks parity from the saved anchor in 14-day windows", () => {
        const grid = buildGrid();
        const first = firstPeriod(grid);
        expect(first).toEqual({ periodStart: "2026-10-04", periodEnd: "2026-10-18", monthKey: "2026-10" });
        const second = nextPeriod(grid, first);
        expect(second).toEqual({ periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" });
        const third = nextPeriod(grid, second);
        expect(third).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-15", monthKey: "2026-11" });
        expect(previousPeriod(grid, third)).toEqual(second);
        expectPeriodLength(first, 14);
        expectPeriodLength(second, 14);
    });

    it("supports weekly interval 1 with the saved anchor as the parity epoch", () => {
        const grid = buildGrid({
            cadence: { kind: "every-n-weeks", weekday: 3, intervalWeeks: 1 },
            cadenceAnchorAt: "2027-01-06",
            createdOn: "2026-12-20",
        });
        const first = firstPeriod(grid);
        expect(first).toEqual({ periodStart: "2027-01-06", periodEnd: "2027-01-13", monthKey: "2027-01" });
        expect(nextPeriod(grid, first)).toEqual({ periodStart: "2027-01-13", periodEnd: "2027-01-20", monthKey: "2027-01" });
        expectPeriodLength(first, 7);
    });

    it("starts strictly after the creation date even when creation lands on a boundary", () => {
        expect(firstPeriod(buildGrid({ createdOn: "2026-10-04" })).periodStart).toBe("2026-10-18");
    });

    it("uses the later of the creation floor and the saved anchor as the floor", () => {
        const grid = buildGrid({ cadenceAnchorAt: "2026-11-01", createdOn: "2026-09-20" });
        const first = firstPeriod(grid);
        expect(first.periodStart).toBe("2026-11-01");
        expect(first.periodEnd).toBe("2026-11-15");
    });

    it("keeps a stored earlier anchor as a parity epoch while the creation floor still applies", () => {
        const grid = buildGrid({ cadenceAnchorAt: "2026-08-09", createdOn: "2026-10-20" });
        expect(firstPeriod(grid).periodStart).toBe("2026-11-01");
    });

    it("reports no open period before the first boundary", () => {
        const grid = buildGrid();
        expect(periodAt(grid, "2026-09-25")).toBeNull();
        expect(mostRecentCompletedPeriod(grid, "2026-09-25")).toBeNull();
        expect(dueState(grid, "2026-09-25")).toEqual({
            kind: "before-first-period",
            firstPeriod: firstPeriod(grid),
        });
    });

    it("returns no predecessor below the floor and a successor above it", () => {
        const grid = buildGrid();
        const first = firstPeriod(grid);
        expect(previousPeriod(grid, first)).toBeNull();
        const second = nextPeriod(grid, first);
        expect(previousPeriod(grid, second)).toEqual(first);
        expect(nextPeriod(grid, second).periodStart).toBe("2026-11-01");
    });
});

describe("monthly period boundaries", () => {
    it("derives variable nominal-month windows, including the snapped-backward December", () => {
        const grid = buildGrid({ cadence: MONTHLY_SUNDAY });
        const periods = listPeriods(grid, "2026-10-04", "2027-01-03");
        expect(periods.map(period => period.periodStart)).toEqual(["2026-10-04", "2026-11-01", "2026-11-29"]);
        expect(periods.map(period => period.periodEnd)).toEqual(["2026-11-01", "2026-11-29", "2027-01-03"]);
        expect(periods.map(period => period.monthKey)).toEqual(["2026-10", "2026-11", "2026-12"]);
    });

    it("produces the fixed 21-day Friday period for May 2021", () => {
        const grid = buildGrid({
            cadence: { kind: "monthly-weekday", weekday: 5 },
            cadenceAnchorAt: "2021-05-07",
            createdOn: "2021-04-01",
        });
        const first = firstPeriod(grid);
        expect(first).toEqual({ periodStart: "2021-05-07", periodEnd: "2021-05-28", monthKey: "2021-05" });
        expectPeriodLength(first, 21);
    });

    it("produces the fixed 42-day Wednesday period for July 2025", () => {
        const grid = buildGrid({
            cadence: { kind: "monthly-weekday", weekday: 3 },
            cadenceAnchorAt: "2025-06-25",
            createdOn: "2025-06-05",
        });
        const first = firstPeriod(grid);
        expect(first).toEqual({ periodStart: "2025-06-25", periodEnd: "2025-08-06", monthKey: "2025-07" });
        expectPeriodLength(first, 42);
    });

    it("resolves a Monday-first month to the 1st but still starts after a creation on it", () => {
        const grid = buildGrid({
            cadence: { kind: "monthly-weekday", weekday: 1 },
            cadenceAnchorAt: "2026-06-01",
            createdOn: "2026-06-01",
        });
        expect(resolveCadenceAnchorAt({ kind: "monthly-weekday", weekday: 1 }, "2026-05-31")).toBe("2026-06-01");
        expect(firstPeriod(grid)).toEqual({ periodStart: "2026-07-06", periodEnd: "2026-08-03", monthKey: "2026-07" });
    });

    it("maps snapped-backward late-month dates to the next nominal period", () => {
        const grid = buildGrid({ cadence: MONTHLY_SUNDAY });
        const december = { periodStart: "2026-11-29", periodEnd: "2027-01-03", monthKey: "2026-12" };
        expect(periodAt(grid, "2026-11-29")).toEqual(december);
        expect(periodAt(grid, "2026-11-30")).toEqual(december);
        expect(periodAt(grid, "2026-11-28")).toEqual({
            periodStart: "2026-11-01",
            periodEnd: "2026-11-29",
            monthKey: "2026-11",
        });
        expect(periodAt(grid, "2026-10-03")).toBeNull();
    });
});

describe("mostRecentCompletedPeriod", () => {
    it("is null while the first period is in progress and the predecessor afterwards", () => {
        const grid = buildGrid();
        expect(mostRecentCompletedPeriod(grid, "2026-10-04")).toBeNull();
        expect(mostRecentCompletedPeriod(grid, "2026-10-17")).toBeNull();
        const completed = required(mostRecentCompletedPeriod(grid, "2026-10-18"));
        expect(completed).toEqual({ periodStart: "2026-10-04", periodEnd: "2026-10-18", monthKey: "2026-10" });
    });
});

describe("listPeriods", () => {
    it("returns ascending overlapping periods above the floor", () => {
        const grid = buildGrid();
        expect(listPeriods(grid, "2026-10-05", "2026-11-02").map(period => period.periodStart))
            .toEqual(["2026-10-04", "2026-10-18", "2026-11-01"]);
    });

    it("returns an empty list for an empty or reversed range", () => {
        const grid = buildGrid();
        expect(listPeriods(grid, "2026-10-18", "2026-10-18")).toEqual([]);
        expect(listPeriods(grid, "2026-10-04", "2026-10-04")).toEqual([]);
        expect(listPeriods(grid, "2026-10-18", "2026-10-01")).toEqual([]);
    });

    it("starts at the first period when from is below the floor", () => {
        expect(listPeriods(buildGrid(), "2026-01-01", "2026-10-05").map(period => period.periodStart))
            .toEqual(["2026-10-04"]);
    });

    it("includes a boundary period when from equals its start", () => {
        const grid = buildGrid({ cadence: MONTHLY_SUNDAY });
        expect(listPeriods(grid, "2026-11-29", "2026-12-01").map(period => period.periodStart))
            .toEqual(["2026-11-29"]);
    });
});

describe("dueState", () => {
    it("reports archived before any period math", () => {
        expect(dueState(buildGrid({ isArchived: true }), "2026-10-20")).toEqual({ kind: "archived" });
    });

    it("is not due while the first period is in progress", () => {
        const grid = buildGrid();
        expect(dueState(grid, "2026-10-10")).toEqual({
            kind: "not-due",
            current: firstPeriod(grid),
            mostRecentCompleted: null,
            lastBuiltPeriodStart: null,
        });
    });

    it("is due after a completed period with a null or earlier build key", () => {
        const current = required(periodAt(buildGrid(), "2026-10-20"));
        const completed = required(mostRecentCompletedPeriod(buildGrid(), "2026-10-20"));
        expect(dueState(buildGrid(), "2026-10-20")).toEqual({
            kind: "due",
            current,
            mostRecentCompleted: completed,
            lastBuiltPeriodStart: null,
        });
        expect(dueState(buildGrid({ lastBuiltPeriodStart: "2026-09-20" }), "2026-10-20")).toEqual({
            kind: "due",
            current,
            mostRecentCompleted: completed,
            lastBuiltPeriodStart: "2026-09-20",
        });
    });

    it("is not due with an equal or future build key", () => {
        const current = required(periodAt(buildGrid(), "2026-10-20"));
        const completed = required(mostRecentCompletedPeriod(buildGrid(), "2026-10-20"));
        for (const buildKey of ["2026-10-04", "2026-10-18", "2026-12-01"] as LocalDateKey[]) {
            expect(dueState(buildGrid({ lastBuiltPeriodStart: buildKey }), "2026-10-20")).toEqual({
                kind: "not-due",
                current,
                mostRecentCompleted: completed,
                lastBuiltPeriodStart: buildKey,
            });
        }
    });
});

describe("period labels", () => {
    it("labels nominal October with an inclusive last day", () => {
        const period = required(periodAt(buildGrid({ cadence: MONTHLY_SUNDAY }), "2026-10-10"));
        expect(period.monthKey).toBe("2026-10");
        expect(periodLabel(period)).toBe("October 2026");
        expect(periodRangeLabel(period)).toBe("Oct 4 – Oct 31, 2026");
    });

    it("labels a same-year weekly range across months from the start month", () => {
        const grid = buildGrid({
            cadence: { kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 },
            cadenceAnchorAt: "2026-10-25",
            createdOn: "2026-10-10",
        });
        const period = required(periodAt(grid, "2026-10-26"));
        expect(period.monthKey).toBe("2026-10");
        expect(periodLabel(period)).toBe("October 2026");
        expect(periodRangeLabel(period)).toBe("Oct 25 – Nov 7, 2026");
    });

    it("labels a cross-year snapped period from its nominal month", () => {
        const period = required(periodAt(buildGrid({ cadence: MONTHLY_SUNDAY }), "2026-12-15"));
        expect(period.monthKey).toBe("2026-12");
        expect(periodLabel(period)).toBe("December 2026");
        expect(periodRangeLabel(period)).toBe("Nov 29, 2026 – Jan 2, 2027");
    });

    it("labels a cross-year weekly range", () => {
        const grid = buildGrid({
            cadence: { kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 },
            cadenceAnchorAt: "2026-12-27",
            createdOn: "2026-12-20",
        });
        const period = required(periodAt(grid, "2026-12-28"));
        expect(period.monthKey).toBe("2026-12");
        expect(periodRangeLabel(period)).toBe("Dec 27, 2026 – Jan 9, 2027");
    });
});

describe("goalGrid", () => {
    it("projects the tracker creation instant to a host-local creation date", () => {
        const tracker = buildMonthlyWeekdayTrackerFixture({
            createdAt: localDateAtNoon(2026, 8, 20).toISOString(),
            isArchived: true,
            lastBuiltPeriodStart: "2026-10-04",
        });
        expect(goalGrid(tracker)).toEqual({
            cadence: { kind: "monthly-weekday", weekday: 0 },
            cadenceAnchorAt: "2026-10-04",
            createdOn: "2026-09-20",
            isArchived: true,
            lastBuiltPeriodStart: "2026-10-04",
        });
    });

    it("rejects an unreadable creation instant instead of inventing a date", () => {
        const tracker = { ...buildGoalTrackerFixture(), createdAt: "not-a-date" };
        expect(() => goalGrid(tracker)).toThrow(RangeError);
    });
});
