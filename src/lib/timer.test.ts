import { describe, it, expect } from "vitest";
import {
    EPSILON,
    computeActiveFractionComplete,
    computeElapsedSecs,
    computePlannedSecs,
    computeRemainingMs,
    formatDurationMinutes,
    formatMs,
    formatPomodoroCount,
    parseDueDateKey,
    toLocalDateKey,
} from "./timer";
import { ActiveTimer } from "../state/types";

function timer(overrides: Partial<ActiveTimer> = {}): ActiveTimer {
    return {
        task_id: "t1",
        started_at: "2026-01-01T00:00:00.000Z",
        ends_at: "2026-01-01T00:25:00.000Z",
        kind: "Work" as const,
        paused: false,
        paused_remaining_secs: 0,
        planned_secs: 1500,
        accumulated_secs: 0,
        ...overrides,
    };
}

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

describe("formatMs", () => {
    it("formats zero", () => {
        expect(formatMs(0)).toBe("00:00");
    });
    it("formats seconds and minutes with padding", () => {
        expect(formatMs(65_000)).toBe("01:05");
        expect(formatMs(25 * 60_000)).toBe("25:00");
    });
    it("floors fractional seconds", () => {
        expect(formatMs(61_999)).toBe("01:01");
    });
});

describe("computeRemainingMs", () => {
    it("returns 0 when no timer", () => {
        expect(computeRemainingMs(null, T0)).toBe(0);
        expect(computeRemainingMs(undefined, T0)).toBe(0);
    });
    it("returns paused remaining seconds when paused", () => {
        const t = timer({ paused: true, paused_remaining_secs: 90, ends_at: "2026-01-01T01:00:00.000Z" });
        expect(computeRemainingMs(t, T0)).toBe(90_000);
    });
    it("computes end minus now, clamped at zero", () => {
        const t = timer({ ends_at: "2026-01-01T00:10:00.000Z" });
        expect(computeRemainingMs(t, T0)).toBe(600_000);
        expect(computeRemainingMs(t, T0 + 900_000)).toBe(0);
    });
});

describe("computePlannedSecs", () => {
    it("prefers planned_secs", () => {
        expect(computePlannedSecs(timer())).toBe(1500);
    });
    it("falls back to end-start span", () => {
        const t = timer({ planned_secs: 0 });
        expect(computePlannedSecs(t)).toBe(1500);
    });
});

describe("computeElapsedSecs", () => {
    it("returns accumulated when paused", () => {
        const t = timer({ paused: true, accumulated_secs: 600 });
        expect(computeElapsedSecs(t, T0, 1500)).toBe(600);
    });
    it("adds current run segment when active", () => {
        const t = timer({ accumulated_secs: 600, started_at: "2026-01-01T00:10:00.000Z" });
        expect(computeElapsedSecs(t, T0 + 15 * 60_000, 1500)).toBe(900);
    });
    it("clamps to planned", () => {
        const t = timer({ accumulated_secs: 0, started_at: "2026-01-01T00:00:00.000Z" });
        expect(computeElapsedSecs(t, T0 + 60 * 60_000, 1500)).toBe(1500);
    });
});

describe("computeActiveFractionComplete", () => {
    it("is zero for breaks or no timer", () => {
        expect(computeActiveFractionComplete(null, T0, 25)).toBe(0);
        const brk = timer({ kind: "ShortBreak", planned_secs: 300 });
        expect(computeActiveFractionComplete(brk, T0, 25)).toBe(0);
    });
    it("computes elapsed fraction of a work timer", () => {
        const t = timer({ ends_at: "2026-01-01T00:12:30.000Z" }); // half done
        expect(computeActiveFractionComplete(t, T0, 25)).toBeCloseTo(0.5, 3);
    });
});

describe("formatPomodoroCount", () => {
    it("handles zero and epsilon", () => {
        expect(formatPomodoroCount(0)).toBe("0p");
        expect(formatPomodoroCount(EPSILON)).toBe("0p");
        expect(formatPomodoroCount(Number.NaN)).toBe("0p");
    });
    it("rounds whole numbers", () => {
        expect(formatPomodoroCount(3)).toBe("3p");
        expect(formatPomodoroCount(3.02)).toBe("3p");
    });
    it("shows one decimal for fractions", () => {
        expect(formatPomodoroCount(2.5)).toBe("2.5p");
    });
});

describe("formatDurationMinutes", () => {
    it("handles zero and non-finite", () => {
        expect(formatDurationMinutes(0)).toBe("0m");
        expect(formatDurationMinutes(Number.NaN)).toBe("0m");
    });
    it("rounds up to at least 1 minute", () => {
        expect(formatDurationMinutes(0.4)).toBe("1m");
    });
    it("formats minutes and hours", () => {
        expect(formatDurationMinutes(45)).toBe("45m");
        expect(formatDurationMinutes(90)).toBe("1h 30m");
        expect(formatDurationMinutes(120)).toBe("2h");
    });
});

describe("date helpers", () => {
    it("toLocalDateKey ignores timezone", () => {
        const d = new Date("2026-07-15T12:34:56Z");
        expect(toLocalDateKey(d)).toBe("2026-07-15");
    });
    it("parseDueDateKey accepts ISO dates", () => {
        expect(parseDueDateKey("2026-07-15")).toBe("2026-07-15");
    });
    it("parseDueDateKey parses datetimes into local date key", () => {
        const d = parseDueDateKey("2026-07-15T12:34:56Z");
        expect(d).toBe(toLocalDateKey(new Date("2026-07-15T12:34:56Z")));
    });
    it("parseDueDateKey returns null for garbage", () => {
        expect(parseDueDateKey("")).toBe(null);
        expect(parseDueDateKey("not-a-date")).toBe(null);
        expect(parseDueDateKey(undefined)).toBe(null);
    });
});
