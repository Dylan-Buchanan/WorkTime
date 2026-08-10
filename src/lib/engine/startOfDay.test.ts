import { describe, expect, it } from "vitest";
import type { PMTask, ProposedTask } from "../../state/types";
import { selectStartOfDayPlanItems, validateStartOfDayPlan } from "./startOfDay";

function task(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "t1", title: "Ship feature", projectId: "p1", status: "Next", priority: "High",
        estimatePomos: 3, timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [],
        relatedTo: [], sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
    };
}

function proposed(overrides: Partial<ProposedTask> = {}): ProposedTask {
    return {
        id: "t1", title: "Ship feature", projectId: "p1", status: "Next", priority: "High",
        estimatePomos: 3, checklist: [], relatedTo: [], ...overrides,
    };
}

describe("Start-of-Day plan rules", () => {
    it("accepts independently estimated bounded pieces for an unstarted large task", () => {
        const current = task({ id: "large", estimatePomos: 8 });
        const pieces = [
            proposed({ id: undefined, title: "Design", estimatePomos: 3, splitsFrom: "large" }),
            proposed({ id: undefined, title: "Implement", estimatePomos: 4, splitsFrom: "large" }),
        ];
        expect(validateStartOfDayPlan({ currentTasks: [current], proposedTasks: pieces, workBudgetPomos: 6 })).toEqual({ valid: true, issues: [] });
    });

    it("preserves the estimate of a worked task unless comparable completed evidence supports a decrease", () => {
        const current = task({ id: "worked", title: "Write feature design", estimatePomos: 8, workedPomos: 1.5, tags: ["feature"] });
        expect(validateStartOfDayPlan({
            currentTasks: [current],
            proposedTasks: [proposed({ id: "worked", title: "Write feature design", estimatePomos: 8 })],
            workBudgetPomos: 4,
        }).valid).toBe(true);

        const withoutEvidence = validateStartOfDayPlan({
            currentTasks: [current],
            proposedTasks: [proposed({ id: "worked", title: "Write feature design", estimatePomos: 7 })],
            workBudgetPomos: 4,
        });
        expect(withoutEvidence.issues.map((issue) => issue.code)).toContain("estimate-decrease-needs-completed-evidence");

        const completed = task({ id: "done", title: "Review feature design", status: "Done", estimatePomos: 4, workedPomos: 2, tags: ["feature"], sortOrder: 1 });
        expect(validateStartOfDayPlan({
            currentTasks: [current, completed],
            proposedTasks: [
                proposed({ id: "worked", title: "Write feature design", estimatePomos: 7, rationale: "Similar feature work finished in 2 of 4 pomodoros.", estimateEvidenceTaskIds: ["done"] }),
                proposed({ id: "done", title: "Review feature design", status: "Done", estimatePomos: 4 }),
            ],
            workBudgetPomos: 4,
        }).valid).toBe(true);

        const invalid = validateStartOfDayPlan({
            currentTasks: [current],
            proposedTasks: [proposed({ id: undefined, splitsFrom: "worked", estimatePomos: 4 })],
            workBudgetPomos: 4,
        });
        expect(invalid.valid).toBe(false);
        expect(invalid.issues.map((issue) => issue.code)).toContain("split-with-worked-progress");
        expect(invalid.issues.map((issue) => issue.code)).toContain("worked-task-must-rollover");
    });

    it("preserves off-plan backlog and timer-owned completion", () => {
        const current = [task({ id: "one" }), task({ id: "two", sortOrder: 1 })];
        const result = validateStartOfDayPlan({
            currentTasks: current,
            proposedTasks: [proposed({ id: "one", status: "Done" })],
            workBudgetPomos: 4,
        });
        expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["done-transition", "missing-current-task"]));
    });

    it("selects an ordered budget-bounded plan with explicit rollover", () => {
        const items = selectStartOfDayPlanItems([
            proposed({ id: "done", title: "Already done", status: "Done", estimatePomos: 1 }),
            proposed({ id: "one", estimatePomos: 6 }),
            proposed({ id: "two", estimatePomos: 2 }),
        ], 4);
        expect(items).toEqual([expect.objectContaining({ taskId: "one", plannedPomos: 4, rollover: true })]);
    });

    it("keeps Blocked tasks in the ordered plan while excluding Done tasks", () => {
        const items = selectStartOfDayPlanItems([
            proposed({ id: "done", title: "Already done", status: "Done", estimatePomos: 1 }),
            proposed({ id: "blocked", title: "Blocked dependency", status: "Blocked", estimatePomos: 1 }),
            proposed({ id: "next", title: "Next task", estimatePomos: 1 }),
        ], 3);

        expect(items.map((item) => item.taskId)).toEqual(["blocked", "next"]);
    });

    it("excludes non-Done tasks whose checklist is already complete", () => {
        const items = selectStartOfDayPlanItems([
            proposed({ id: "checklist-complete", estimatePomos: undefined, checklist: [{ id: "step", title: "Finished step", done: true }] }),
            proposed({ id: "actionable", estimatePomos: 2 }),
        ], 3);

        expect(items.map((item) => item.taskId)).toEqual(["actionable"]);
        expect(items[0]).toEqual(expect.objectContaining({ plannedPomos: 2, rollover: false }));
    });
});
