import { describe, expect, it } from "vitest";
import { formatClock } from "./format";

describe("formatClock", () => {
    it("formats local times using a 12-hour clock", () => {
        expect(formatClock(new Date(2026, 0, 1, 0, 5))).toBe("12:05 AM");
        expect(formatClock(new Date(2026, 0, 1, 12, 0))).toBe("12:00 PM");
        expect(formatClock(new Date(2026, 0, 1, 15, 30))).toBe("3:30 PM");
    });
});
