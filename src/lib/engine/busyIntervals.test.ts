import { describe, expect, it } from "vitest";
import { mergeBusyIntervals, type BusyIntervalInput } from "./busyIntervals";
import { mergePlannerBusyIntervals, type PlannerBusyInterval } from "./plannerContext";

const at = (hour: number, minute = 0): Date => new Date(2026, 8, 17, hour, minute);

describe("mergeBusyIntervals", () => {
    it("clips, drops invalid and empty ranges, sorts, and merges overlap and touching runs without mutating input", () => {
        const intervals: readonly PlannerBusyInterval[] = [
            { start: at(12), end: at(13) },
            { start: at(9, 45).toISOString(), end: at(10, 30).toISOString() },
            { start: at(8), end: at(9, 50) },
            { start: at(10, 30), end: at(11) },
            { start: "invalid", end: at(12) },
            { start: at(11), end: new Date(NaN) },
            { start: at(11), end: at(11) },
            { start: at(12), end: at(11) },
            { start: at(7), end: at(9) },
            { start: at(13), end: at(14) },
        ];
        const sharedInputs: readonly BusyIntervalInput[] = intervals;
        const before = structuredClone(intervals);
        const expected = [{ start: at(9), end: at(11) }, { start: at(12), end: at(12, 30) }];
        expect(mergeBusyIntervals(sharedInputs, at(9), at(12, 30))).toEqual(expected);
        expect(mergePlannerBusyIntervals(intervals, at(9), at(12, 30))).toEqual(expected);
        expect(intervals).toEqual(before);
    });

    it("returns no runs for empty, invalid, or reversed windows and full coverage clips to the exact window", () => {
        const intervals = [{ start: at(8), end: at(15) }];
        expect(mergeBusyIntervals([], at(9), at(12))).toEqual([]);
        expect(mergeBusyIntervals(intervals, at(12), at(9))).toEqual([]);
        expect(mergeBusyIntervals(intervals, new Date(NaN), at(12))).toEqual([]);
        expect(mergeBusyIntervals(intervals, at(9), at(12))).toEqual([{ start: at(9), end: at(12) }]);
        expect(mergePlannerBusyIntervals(intervals, at(9), at(12))).toEqual(mergeBusyIntervals(intervals, at(9), at(12)));
    });
});
