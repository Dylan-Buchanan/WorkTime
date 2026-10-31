import { describe, expect, it } from "vitest";
import { normalizeGoalCadence, isValidGoalCadence } from "./cadence";
import type { GoalCadence } from "../../state/types";

describe("goal cadence validation", () => {
    it("normalizes both cadence variants without mutating the input", () => {
        for (const rule of [{ kind: "monthly-weekday", weekday: 0 }, { kind: "every-n-weeks", weekday: 6, intervalWeeks: 2 }] as GoalCadence[]) {
            expect(normalizeGoalCadence(rule)).toEqual(rule);
            expect(normalizeGoalCadence(rule)).not.toBe(rule);
            expect(isValidGoalCadence(rule)).toBe(true);
        }
    });
    it.each([null, {}, { kind: "daily", weekday: 0 }, { kind: "monthly-weekday", weekday: 7 },
        { kind: "monthly-weekday", weekday: 0.5 }, { kind: "every-n-weeks", weekday: 0, intervalWeeks: 0 },
        { kind: "every-n-weeks", weekday: 0, intervalWeeks: 1.5 }, { kind: "every-n-weeks", weekday: 0, intervalWeeks: Infinity }])("rejects malformed cadence %j", rule => {
        expect(isValidGoalCadence(rule)).toBe(false);
        expect(() => normalizeGoalCadence(rule as GoalCadence)).toThrow(RangeError);
    });
});
