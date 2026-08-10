import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import type { AgentStartOfDayPlan } from "../agent/startOfDayPlanStore";
import { compareEndOfDayPlan, validateTomorrowTaskOrder } from "./endOfDay";

function task(id: string, overrides: Partial<PMTask> = {}): PMTask {
    return {
        id, title: id, projectId: "p1", status: "Next", priority: "Medium",
        timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [], relatedTo: [],
        sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const plan = {
    orderedTasks: [
        { taskId: "done", title: "Done", plannedPomos: 2, rollover: false, checklist: [] },
        { taskId: "partial", title: "Partial", plannedPomos: 2, rollover: false, checklist: [] },
        { title: "Split piece", splitsFrom: "source", plannedPomos: 1, rollover: false, checklist: [] },
        { taskId: "gone", title: "Gone", plannedPomos: 1, rollover: false, checklist: [] },
    ],
} as Pick<AgentStartOfDayPlan, "orderedTasks">;

describe("End-of-Day engine", () => {
    it("diffs completed, partial, unstarted split, and missing planned work", () => {
        const comparison = compareEndOfDayPlan(plan, [
            task("done", { title: "Done", status: "Done", workedPomos: 2 }),
            task("partial", { title: "Partial", workedPomos: 1 }),
            task("created-split", { title: "  SPLIT   piece " }),
        ]);
        expect(comparison).toEqual(expect.objectContaining({ plannedCount: 4, completedCount: 1, partialCount: 1, notStartedCount: 1, missingCount: 1 }));
        expect(comparison.items.map((item) => item.outcome)).toEqual(["completed", "partial", "not-started", "missing"]);
        expect(comparison.items[2].currentTaskId).toBe("created-split");
    });

    it("treats an ambiguous split title as missing and a completed checklist as complete", () => {
        const comparison = compareEndOfDayPlan({ orderedTasks: [plan.orderedTasks[2], { taskId: "checked", title: "Checked", plannedPomos: 1, rollover: false, checklist: [] }] }, [
            task("one", { title: "Split piece" }), task("two", { title: "split piece" }),
            task("checked", { checklist: [{ id: "c1", title: "Step", done: true }] }),
        ]);
        expect(comparison.items.map((item) => item.outcome)).toEqual(["missing", "completed"]);
    });

    it("requires a complete, unique permutation for tomorrow", () => {
        expect(() => validateTomorrowTaskOrder(["a", "b"], ["b", "a"])).not.toThrow();
        expect(() => validateTomorrowTaskOrder(["a", "b"], ["a", "a"])).toThrow("duplicate");
        expect(() => validateTomorrowTaskOrder(["a", "b"], ["a"])).toThrow("every remaining task");
    });
});
