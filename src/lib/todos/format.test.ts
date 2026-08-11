import { describe, expect, it } from "vitest";
import { formatTodoRule } from "./format";

describe("todo recurrence formatting", () => {
    it("formats weekly rules as a natural-language preview", () => {
        expect(formatTodoRule({ type: "weekly", weekdays: [3, 1] })).toBe("Every Monday and Wednesday");
    });

    it("formats monthly last-day selections", () => {
        expect(formatTodoRule({ type: "monthly", days: [{ lastDayOffset: 0 }] })).toBe("Monthly on the last day");
        expect(formatTodoRule({ type: "monthly", days: [{ lastDayOffset: 2 }] })).toBe("Monthly on the last day - 2");
    });

    it("formats yearly February 29 without hiding its leap-year behavior", () => {
        expect(formatTodoRule({ type: "yearly", dates: [{ month: 2, day: 29 }] })).toBe("Every year on February 29");
    });
});

