import type { GoalMetric } from "../../state/types";

/**
 * A deleted habit's link can never resolve again, so the metric becomes manual.
 * Manual metrics must not carry a `habitId` key at all (not `null`, not `""`):
 * `isGoalMetric` and the `goals_metric_check` constraint both reject it.
 * Reads, target and unit are preserved so the goal stays editable and comparable.
 */
export function downgradeHabitMetric(metric: GoalMetric): GoalMetric {
    return {
        label: metric.label,
        current: metric.current,
        target: metric.target,
        unit: metric.unit,
        source: "manual",
        overridePinned: false,
    };
}
