import { describe, expect, it, vi } from "vitest";
import type { PMTask, ProjectManagerState } from "../../state/types";
import type { AgentStartOfDayPlan } from "./startOfDayPlanStore";
import { runEndOfDayWorkflow } from "./endOfDayWorkflow";

function task(id: string, sortOrder: number, overrides: Partial<PMTask> = {}): PMTask {
    return {
        id, title: id.toUpperCase(), projectId: "p1", status: "Next", priority: "Medium",
        timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [], relatedTo: [],
        sortOrder, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function state(tasks: PMTask[]): Pick<ProjectManagerState, "tasks" | "ui"> {
    return {
        tasks: Object.fromEntries(tasks.map((item) => [item.id, item])),
        ui: { selectedProjectIds: ["p1"], selectedTaskId: null, view: "list", listGrouping: "none", statusFilter: [], tagFilter: [], priorityFilter: [], search: "", showArchived: false, sort: "manual", dueFilter: "all", boardShowAllTasks: false },
    };
}

function plan(projectId = "p1"): AgentStartOfDayPlan {
    return {
        version: 1, projectId, createdAt: "2026-08-10T13:00:00.000Z", completedAt: "2026-08-10T13:01:00.000Z",
        workUntil: "2026-08-10T21:00:00.000Z", workBudgetPomos: 4, summary: "Do A then B",
        orderedTasks: [{ taskId: "a", title: "A", plannedPomos: 2, rollover: false, checklist: [] }, { taskId: "done", title: "DONE", plannedPomos: 2, rollover: false, checklist: [] }], approvedChanges: [],
    };
}

describe("End-of-Day workflow", () => {
    it("uses completed state and produces only a reorder of every remaining task", async () => {
        const complete = vi.fn().mockResolvedValue(JSON.stringify({ summary: "Start with B tomorrow, then return to A.", orderedTaskIds: ["b", "a"] }));
        const result = await runEndOfDayWorkflow({
            projectId: "p1", plan: plan(), now: new Date("2026-08-10T22:00:00.000Z"), provider: "openai", client: { complete },
            pmState: state([task("a", 0, { workedPomos: 1 }), task("b", 1, { priority: "High" }), task("done", 2, { status: "Done", workedPomos: 2 })]),
        });
        expect(result.comparison).toEqual(expect.objectContaining({ completedCount: 1, partialCount: 1 }));
        expect(result.tomorrowTasks.map((item) => item.taskId)).toEqual(["b", "a"]);
        expect(result.changes).toEqual([expect.objectContaining({ type: "reorder", beforeTaskIds: ["a", "b"], afterTaskIds: ["b", "a"] })]);
        expect(complete.mock.calls[0][0]).toEqual(expect.objectContaining({ model: "gpt-5.6-luna", temperature: 0.2 }));
        expect(complete.mock.calls[0][0].messages[1].content).toContain('"outcome":"completed"');
    });

    it("retries strict schema failures and rejects incomplete task orders", async () => {
        const complete = vi.fn()
            .mockResolvedValueOnce(JSON.stringify({ summary: "Missing IDs", orderedTaskIds: ["a"], extra: true }))
            .mockResolvedValueOnce(JSON.stringify({ summary: "Still missing B", orderedTaskIds: ["a"] }));
        await expect(runEndOfDayWorkflow({
            projectId: "p1", plan: plan(), now: new Date("2026-08-10T22:00:00.000Z"), client: { complete },
            pmState: state([task("a", 0), task("b", 1), task("done", 2, { status: "Done" })]),
        })).rejects.toThrow("every remaining task");
        expect(complete).toHaveBeenCalledTimes(2);
        expect(complete.mock.calls[1][0].messages.at(-1)?.content).toContain("Validation errors:");
    });

    it("fails before transport when the plan is absent or belongs to another project", async () => {
        const complete = vi.fn();
        const base = { projectId: "p1", now: new Date("2026-08-10T22:00:00.000Z"), client: { complete }, pmState: state([task("a", 0)]) };
        await expect(runEndOfDayWorkflow({ ...base, plan: null })).rejects.toThrow("No valid Start-of-Day plan");
        await expect(runEndOfDayWorkflow({ ...base, plan: plan("p2") })).rejects.toThrow("different project");
        expect(complete).not.toHaveBeenCalled();
    });

    it("returns a deterministic clear-tomorrow overview when all work is Done", async () => {
        const complete = vi.fn();
        const result = await runEndOfDayWorkflow({ projectId: "p1", plan: plan(), now: new Date("2026-08-10T22:00:00.000Z"), client: { complete }, pmState: state([task("a", 0, { status: "Done" }), task("done", 1, { status: "Done" })]) });
        expect(result.changes).toEqual([]);
        expect(result.tomorrowTasks).toEqual([]);
        expect(result.summary).toContain("Tomorrow starts clear");
        expect(complete).not.toHaveBeenCalled();
    });
});
