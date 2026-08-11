import { describe, expect, it } from "vitest";
import {
    addLocalDays,
    isDueOn,
    isValidRule,
    localDateFromKey,
    localDateKey,
    nextOccurrence,
    normalizeRule,
    validateRule,
} from "./index";

const date = (year: number, month: number, day: number, hour = 12): Date =>
    new Date(year, month - 1, day, hour, 0, 0, 0);

function dateKey(value: Date | null): string | null {
    return value ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : null;
}

describe("todo recurrence validation and normalization", () => {
    it("deduplicates weekly, monthly, and yearly selections without mutating the input", () => {
        const rule = {
            type: "monthly" as const,
            days: [31, { lastDayOffset: 1 }, 31, "last-day" as const, { lastDayOffset: 1 }],
        };
        const before = structuredClone(rule);

        expect(normalizeRule(rule)).toEqual({
            type: "monthly",
            days: [31, { lastDayOffset: 1 }, { lastDayOffset: 0 }],
        });
        expect(rule).toEqual(before);
        expect(normalizeRule({ type: "weekly", weekdays: [1, 3, 1] })).toEqual({ type: "weekly", weekdays: [1, 3] });
        expect(normalizeRule({ type: "yearly", dates: [{ month: 2, day: 29 }, { month: 2, day: 29 }] })).toEqual({
            type: "yearly",
            dates: [{ month: 2, day: 29 }],
        });
    });

    it("validates one-off dates, weekday bounds, monthly offsets, and yearly month/day pairs", () => {
        expect(() => validateRule({ type: "one-off", date: "2026-02-29" })).toThrow(RangeError);
        expect(() => validateRule({ type: "weekly", weekdays: [7] })).toThrow(RangeError);
        expect(() => validateRule({ type: "monthly", days: [0] })).toThrow(RangeError);
        expect(() => validateRule({ type: "monthly", days: [{ lastDayOffset: 31 }] })).toThrow(RangeError);
        expect(() => validateRule({ type: "yearly", dates: [{ month: 4, day: 31 }] })).toThrow(RangeError);
        expect(isValidRule({ type: "yearly", dates: [{ month: 2, day: 29 }] })).toBe(true);
        expect(isValidRule({ type: "monthly", days: [] })).toBe(false);
    });
});

describe("todo due-date matching", () => {
    it("matches one-off dates by the local calendar date and ignores the time", () => {
        const rule = { type: "one-off" as const, date: "2026-01-15" };
        expect(isDueOn(rule, date(2026, 1, 15, 0))).toBe(true);
        expect(isDueOn(rule, date(2026, 1, 15, 23))).toBe(true);
        expect(isDueOn(rule, date(2026, 1, 16))).toBe(false);
    });

    it("matches every selected weekday and ignores duplicate selections", () => {
        const rule = { type: "weekly" as const, weekdays: [1, 3, 1] };
        expect(isDueOn(rule, date(2026, 7, 13))).toBe(true); // Monday
        expect(isDueOn(rule, date(2026, 7, 15))).toBe(true); // Wednesday
        expect(isDueOn(rule, date(2026, 7, 14))).toBe(false); // Tuesday
    });

    it("clamps numeric monthly days to short months", () => {
        const rule = { type: "monthly" as const, days: [31] };
        expect(isDueOn(rule, date(2026, 2, 28))).toBe(true);
        expect(isDueOn(rule, date(2026, 2, 27))).toBe(false);
        expect(isDueOn(rule, date(2026, 4, 30))).toBe(true);
    });

    it("supports last day and last day minus N in every month", () => {
        const lastDay = { type: "monthly" as const, days: [{ lastDayOffset: 0 }] };
        const dayBeforeLast = { type: "monthly" as const, days: ["last-day" as const, { lastDayOffset: 1 }] };
        expect(isDueOn(lastDay, date(2026, 2, 28))).toBe(true);
        expect(isDueOn(lastDay, date(2026, 3, 31))).toBe(true);
        expect(isDueOn(dayBeforeLast, date(2026, 2, 27))).toBe(true);
        expect(isDueOn(dayBeforeLast, date(2026, 3, 30))).toBe(true);
    });

    it("matches yearly month/day rules and naturally skips February 29 in non-leap years", () => {
        const rule = { type: "yearly" as const, dates: [{ month: 2, day: 29 }, { month: 12, day: 25 }] };
        expect(isDueOn(rule, date(2024, 2, 29))).toBe(true);
        expect(isDueOn(rule, date(2025, 2, 28))).toBe(false);
        expect(isDueOn(rule, date(2025, 12, 25))).toBe(true);
    });
});

describe("todo next occurrences", () => {
    it("returns a one-off only when it is strictly after completion", () => {
        const rule = { type: "one-off" as const, date: "2026-07-20" };
        expect(dateKey(nextOccurrence(rule, date(2026, 7, 19, 23)))).toBe("2026-07-20");
        expect(nextOccurrence(rule, date(2026, 7, 20))).toBeNull();
        expect(nextOccurrence(rule, date(2026, 7, 21))).toBeNull();
    });

    it("finds the next selected weekday across a week boundary", () => {
        const rule = { type: "weekly" as const, weekdays: [1, 3] };
        expect(dateKey(nextOccurrence(rule, date(2026, 7, 13)))).toBe("2026-07-15");
        expect(dateKey(nextOccurrence(rule, date(2026, 7, 15)))).toBe("2026-07-20");
    });

    it("finds the next clamped monthly date and does not auto-advance before check-off", () => {
        const rule = { type: "monthly" as const, days: [31] };
        expect(dateKey(nextOccurrence(rule, date(2026, 1, 31)))).toBe("2026-02-28");
        expect(dateKey(nextOccurrence(rule, date(2026, 2, 28)))).toBe("2026-03-31");
    });

    it("finds last-day-minus-N across a month boundary", () => {
        const rule = { type: "monthly" as const, days: [{ lastDayOffset: 1 }] };
        expect(dateKey(nextOccurrence(rule, date(2026, 2, 27)))).toBe("2026-03-30");
        expect(dateKey(nextOccurrence(rule, date(2026, 3, 30)))).toBe("2026-04-29");
    });

    it("skips non-leap years when finding a yearly February 29 occurrence", () => {
        const rule = { type: "yearly" as const, dates: [{ month: 2, day: 29 }] };
        expect(dateKey(nextOccurrence(rule, date(2025, 1, 1)))).toBe("2028-02-29");
        expect(dateKey(nextOccurrence(rule, date(2024, 2, 29)))).toBe("2028-02-29");
    });

    it("returns the earliest yearly selection even when the rule input is not sorted", () => {
        const rule = { type: "yearly" as const, dates: [{ month: 12, day: 25 }, { month: 1, day: 1 }] };
        expect(dateKey(nextOccurrence(rule, date(2026, 1, 2)))).toBe("2026-12-25");
        expect(dateKey(nextOccurrence(rule, date(2026, 12, 26)))).toBe("2027-01-01");
    });

    it("uses local calendar arithmetic across DST boundaries", () => {
        const before = date(2024, 3, 9);
        const after = addLocalDays(before, 1);
        expect(localDateKey(after)).toBe("2024-03-10");
        expect(dateKey(nextOccurrence({ type: "weekly", weekdays: [0] }, before))).toBe("2024-03-10");
        expect(localDateFromKey("2024-03-10").getHours()).toBe(12);
    });
});
