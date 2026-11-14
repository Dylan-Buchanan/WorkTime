import { describe, expect, it } from "vitest";
import { createGoal, createGoalCheckIn, createGoalTracker, isGoal, isGoalCheckIn, isGoalMetric, isGoalTracker } from "./factories";

const now = new Date("2026-10-31T12:00:00.000Z");
describe("goal foundation factories", () => {
    const habitMetric = { label: "Practice", target: 5, current: 0, unit: "sessions", source: "habit" as const, habitId: "practice", overridePinned: false };

    it("validates and clones habit metrics without persisting readings on check-ins", () => {
        expect(isGoalMetric(habitMetric)).toBe(true);
        const goal = createGoal({ trackerId: "t", title: "Practice", metric: habitMetric }, now, "g");
        expect(goal.metric).toEqual(habitMetric);
        expect(goal.metric).not.toBe(habitMetric);
        const checkIn = createGoalCheckIn({ goalId: goal.id, periodStart: "2026-11-01" }, now, "c");
        expect(isGoalCheckIn(checkIn)).toBe(true);
        expect(checkIn).not.toHaveProperty("metric");
    });

    it.each([undefined, null, "", " \t\n", "\u00a0\ufeff\u2003", 42])("rejects invalid habit links (%s)", habitId => {
        expect(isGoalMetric({ ...habitMetric, habitId })).toBe(false);
    });

    it("rejects missing links, unknown sources, pinned habit metrics and invalid numbers", () => {
        const { habitId: _link, ...missing } = habitMetric;
        for (const metric of [missing, { ...habitMetric, source: "unknown" }, { ...habitMetric, overridePinned: true },
            { ...habitMetric, current: NaN }, { ...habitMetric, current: undefined }, { ...habitMetric, target: Infinity }]) {
            expect(isGoalMetric(metric)).toBe(false);
            expect(() => createGoal({ trackerId: "t", title: "Practice", metric: metric as typeof habitMetric }, now, "g")).toThrow(RangeError);
        }
    });

    it.each(["manual", "liftingtracker"] as const)("keeps %s validation and rejects any habitId key", source => {
        const { habitId: _link, ...base } = habitMetric;
        expect(isGoalMetric({ ...base, source, overridePinned: true, unit: "", extra: "retained" })).toBe(true);
        for (const habitId of ["habit", "", null, undefined]) expect(isGoalMetric({ ...base, source, habitId })).toBe(false);
    });

    it("creates deterministic defaults with injected time and ids", () => {
        const input = { name: " Work ", cadence: { kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 } as const, cadenceAnchorAt: "2026-11-01" as const };
        const tracker = createGoalTracker(input, now, "tracker");
        expect(tracker).toMatchObject({ id: "tracker", name: "Work", projectId: null, isArchived: false, lastBuiltPeriodStart: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
        expect(createGoalTracker(input, now, "tracker")).toEqual(tracker);
        const metric = { label: "Distance", target: 10, current: 2, unit: "km", source: "manual" as const, overridePinned: false };
        const goal = createGoal({ trackerId: tracker.id, title: " Run ", metric }, now, "goal");
        metric.current = 5;
        expect(goal).toMatchObject({ title: "Run", projectLink: { mode: "inherit" }, lifecycle: "active", achievedAt: null, droppedAt: null, metric: { current: 2 } });
        const planned = [{ text: "Practice", dueDate: "2026-11-02" as const }];
        const checkIn = createGoalCheckIn({ goalId: goal.id, periodStart: "2026-11-01", planned }, now, "check");
        planned[0].text = "Changed";
        expect(checkIn.planned[0].text).toBe("Practice");
        expect(checkIn).not.toHaveProperty("periodEnd");
        expect(isGoalTracker(tracker) && isGoal(goal) && isGoalCheckIn(checkIn)).toBe(true);
    });

    it("creates trackers with an optional project and validates stored tracker links", () => {
        const tracker = createGoalTracker({ name: "Work", cadence: { kind: "monthly-weekday", weekday: 0 }, cadenceAnchorAt: "2026-11-01", projectId: "p1" }, now, "tracker");
        expect(tracker.projectId).toBe("p1");
        expect(isGoalTracker(tracker)).toBe(true);
        for (const projectId of [undefined, "", " \t", 1]) {
            expect(isGoalTracker({ ...tracker, projectId })).toBe(false);
        }
    });

    it("accepts only the fields for each goal project-link mode", () => {
        const goal = createGoal({ trackerId: "t", title: "x" }, now, "g");
        for (const projectLink of [{ mode: "inherit" }, { mode: "none" }, { mode: "project", projectId: "p1" }]) {
            expect(isGoal({ ...goal, projectLink })).toBe(true);
        }
        for (const projectLink of [
            undefined, null, {}, { mode: "other" },
            { mode: "inherit", projectId: null }, { mode: "none", projectId: undefined },
            { mode: "none", projectId: "p1" }, { mode: "inherit", extra: true },
            { mode: "project" }, { mode: "project", projectId: null },
            { mode: "project", projectId: "" }, { mode: "project", projectId: " \t" },
            { mode: "project", projectId: "p1", extra: true },
        ]) {
            expect(isGoal({ ...goal, projectLink })).toBe(false);
        }
        expect(isGoal({ ...goal, projectId: "legacy" })).toBe(false);
    });
    it("rejects invalid dates, metric values and persisted row shapes", () => {
        expect(() => createGoalTracker({ name: "Work", cadence: { kind: "monthly-weekday", weekday: 0 }, cadenceAnchorAt: "2026-02-30" }, now, "t")).toThrow(RangeError);
        expect(() => createGoalCheckIn({ goalId: "g", periodStart: "2026-11-01", planned: [{ text: "x", dueDate: "2026-02-30" }] }, now, "c")).toThrow(RangeError);
        const goal = createGoal({ trackerId: "t", title: "x" }, now, "g");
        expect(isGoal({ ...goal, metric: { label: "x", current: NaN, target: 2, unit: "", source: "manual", overridePinned: false } })).toBe(false);
        expect(isGoal({ ...goal, updatedAt: "bad" })).toBe(false);
        expect(isGoalCheckIn({ ...createGoalCheckIn({ goalId: "g", periodStart: "2026-11-01" }, now, "c"), periodEnd: "2026-12-01" })).toBe(false);
    });
});
