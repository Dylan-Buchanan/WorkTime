import { describe, expect, it } from "vitest";
import { formatWaitingDuration } from "./waitingDuration";

describe("formatWaitingDuration", () => {
    const since = "2026-08-12T09:00:00.000Z";
    it.each([
        [-1, "<1 minute"],
        [0, "<1 minute"],
        [59_999, "<1 minute"],
        [60_000, "1 minute"],
        [59 * 60_000, "59 minutes"],
        [60 * 60_000, "1 hour 0 minutes"],
        [61 * 60_000, "1 hour 1 minute"],
        [125 * 60_000, "2 hours 5 minutes"],
        [1439 * 60_000, "23 hours 59 minutes"],
        [1440 * 60_000, "1 day"],
        [3.5 * 86400_000, "3 days"],
    ])("formats elapsed %i ms as %s", (elapsed, expected) => {
        expect(formatWaitingDuration(since, Date.parse(since) + elapsed)).toBe(expected);
    });

    it("handles invalid timestamps defensively", () => {
        expect(formatWaitingDuration("invalid", 0)).toBe("<1 minute");
        expect(formatWaitingDuration(since, NaN)).toBe("<1 minute");
    });
});
