import { describe, expect, it } from "vitest";
import type { GoalMetric } from "../../state/types";
import { isGoalMetric } from "./factories";
import { downgradeHabitMetric } from "./metrics";

const linked: GoalMetric = {
    label: "Walks", target: 5, current: 0, unit: "days", source: "habit", habitId: "morning", overridePinned: false,
};

describe("downgradeHabitMetric", () => {
    it("keeps the label, target, unit and current while switching to manual", () => {
        expect(downgradeHabitMetric(linked)).toEqual({
            label: "Walks", target: 5, current: 0, unit: "days", source: "manual", overridePinned: false,
        });
    });

    it("removes the habit link key entirely and produces a valid metric", () => {
        const metric = downgradeHabitMetric(linked);
        expect("habitId" in metric).toBe(false);
        expect(isGoalMetric(metric)).toBe(true);
    });

    it("preserves a preserved nonzero reading and never mutates the source metric", () => {
        const source: GoalMetric = { ...linked, current: 3, overridePinned: false };
        expect(downgradeHabitMetric(source).current).toBe(3);
        expect(source).toEqual({ ...linked, current: 3 });
    });

    it("drops override pinning so the manual metric is not silently frozen", () => {
        expect(downgradeHabitMetric({ ...linked, overridePinned: true }).overridePinned).toBe(false);
    });
});
