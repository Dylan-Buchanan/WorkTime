import { describe, expect, it } from "vitest";
import { normalizeTaskDueDate } from "./taskDueDate";

describe("normalizeTaskDueDate", () => {
    it("preserves valid date keys", () => {
        expect(normalizeTaskDueDate("2026-08-20")).toBe("2026-08-20");
    });

    it("uses the source date portion of an ISO timestamp", () => {
        expect(normalizeTaskDueDate("2026-08-20T00:00:00Z")).toBe("2026-08-20");
        expect(normalizeTaskDueDate("2026-08-20T23:30:00-07:00")).toBe("2026-08-20");
    });

    it("rejects blank, malformed, and impossible dates", () => {
        expect(normalizeTaskDueDate(" ")).toBeUndefined();
        expect(normalizeTaskDueDate("August 20, 2026")).toBeUndefined();
        expect(normalizeTaskDueDate("2026-08-20Trash")).toBeUndefined();
        expect(normalizeTaskDueDate("2026-02-30T12:00:00Z")).toBeUndefined();
        expect(normalizeTaskDueDate(null)).toBeUndefined();
    });
});
