import type { GoalCadence } from "../../state/types";

export function normalizeGoalCadence(rule: GoalCadence): GoalCadence {
    if (!rule || typeof rule !== "object" || !Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
        throw new RangeError("Invalid goal cadence weekday");
    }
    switch (rule.kind) {
        case "monthly-weekday":
            return { kind: rule.kind, weekday: rule.weekday };
        case "every-n-weeks":
            if (!Number.isSafeInteger(rule.intervalWeeks) || rule.intervalWeeks < 1) throw new RangeError("Invalid goal cadence intervalWeeks");
            return { kind: rule.kind, weekday: rule.weekday, intervalWeeks: rule.intervalWeeks };
        default:
            throw new RangeError("Invalid goal cadence kind");
    }
}

export function isValidGoalCadence(value: unknown): value is GoalCadence {
    try { normalizeGoalCadence(value as GoalCadence); return true; } catch { return false; }
}
