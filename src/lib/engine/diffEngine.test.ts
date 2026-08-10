import { describe, expect, it } from "vitest";
import type { PMTask, ProposedTask } from "../../state/types";
import { diffPlannerTasks } from ".";

function currentTask(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "task-1",
        title: "Write report",
        projectId: "project-1",
        status: "Next",
        priority: "Medium",
        dueDate: "2026-08-10",
        estimatePomos: 4,
        timeSpentMinutes: 0,
        workedPomos: 0,
        tags: ["work"],
        links: [],
        checklist: [{ id: "check-1", title: "Outline", done: false }],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        appTaskId: "app-1",
        relatedTo: [],
        ...overrides,
    };
}

function proposed(overrides: Partial<ProposedTask> = {}): ProposedTask {
    return {
        id: "task-1",
        title: "Write report",
        projectId: "project-1",
        status: "Next",
        priority: "Medium",
        dueDate: "2026-08-10",
        estimatePomos: 4,
        checklist: [{ id: "check-1", title: "Outline", done: false }],
        relatedTo: [],
        ...overrides,
    };
}

describe("diffPlannerTasks", () => {
    it("returns no changes for an identical target without mutating snapshots", () => {
        const current = currentTask();
        const target = proposed();
        const currentBefore = structuredClone(current);
        const targetBefore = structuredClone(target);

        const result = diffPlannerTasks({ currentTasks: [current], proposedTasks: [target] });

        expect(result).toEqual({
            changes: [],
            hasChanges: false,
            noChangesNeeded: true,
            blocked: false,
            blockedChanges: [],
        });
        expect(current).toEqual(currentBefore);
        expect(target).toEqual(targetBefore);
    });

    it("classifies creates, splits, updates, archive removals, and reorder in target order", () => {
        const first = currentTask();
        const second = currentTask({ id: "task-2", title: "Review report", sortOrder: 1 });
        const third = currentTask({ id: "task-3", title: "Old task", sortOrder: 2 });
        const result = diffPlannerTasks({
            currentTasks: [first, second, third],
            proposedTasks: [
                proposed({ id: "task-2", title: "Review final report" }),
                proposed({ id: "task-1" }),
                proposed({ id: undefined, title: "Draft appendix", splitsFrom: "task-1" }),
            ],
        });

        expect(result.changes.map((change) => change.type)).toEqual(["update", "split", "remove", "reorder"]);
        expect(result.changes[0]).toMatchObject({ taskId: "task-2", action: "updateTask", after: { title: "Review final report" } });
        expect(result.changes[1]).toMatchObject({ type: "split", action: "createTask", splitsFrom: "task-1", after: { title: "Draft appendix" } });
        expect(result.changes[2]).toMatchObject({ type: "remove", action: "archiveTask", taskId: "task-3" });
        expect(result.changes[3]).toMatchObject({
            type: "reorder",
            action: "reorderTasks",
            beforeTaskIds: ["task-1", "task-2"],
            afterTaskIds: ["task-2", "task-1"],
        });
    });

    it("excludes Done tasks but retains Blocked tasks in the reorder proposal", () => {
        const first = currentTask();
        const second = currentTask({ id: "task-2", title: "Review report", sortOrder: 1 });
        const done = currentTask({ id: "task-done", title: "Finished report", status: "Done", sortOrder: 2 });
        const blocked = currentTask({ id: "task-blocked", title: "Blocked report", status: "Blocked", sortOrder: 3 });
        const result = diffPlannerTasks({
            currentTasks: [first, second, done, blocked],
            proposedTasks: [
                proposed({ id: "task-2", title: "Review report" }),
                proposed({ id: "task-done", title: "Finished report", status: "Done" }),
                proposed({ id: "task-blocked", title: "Blocked report", status: "Blocked" }),
                proposed({ id: "task-1" }),
            ],
        });
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toMatchObject({
            type: "reorder",
            beforeTaskIds: ["task-1", "task-2", "task-blocked"],
            afterTaskIds: ["task-2", "task-blocked", "task-1"],
        });
    });

    it("treats a status transition as an update and flags later due dates", () => {
        const result = diffPlannerTasks([currentTask()], [proposed({ status: "In Progress", dueDate: "2026-08-12" })]);

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toMatchObject({ type: "update", guardrails: { forwardDueDate: true, blocked: false } });
    });

    it("blocks estimate increases without a non-empty rationale", () => {
        const result = diffPlannerTasks({
            currentTasks: [currentTask()],
            proposedTasks: [proposed({ estimatePomos: 6, rationale: "   " })],
        });

        expect(result.blocked).toBe(true);
        expect(result.changes[0]).toMatchObject({
            blocked: true,
            blockReasons: ["estimate-increase-requires-rationale"],
            guardrails: { estimateIncreased: true, rationaleRequired: true },
        });
    });

    it("allows estimate increases with rationale and trims it for the card", () => {
        const result = diffPlannerTasks([currentTask()], [proposed({ estimatePomos: 6, rationale: "  Added integration work.  " })]);

        expect(result.blocked).toBe(false);
        expect(result.changes[0]).toMatchObject({ rationale: "Added integration work." });
    });

    it("blocks splits from tasks that already have worked pomodoros", () => {
        const result = diffPlannerTasks({
            currentTasks: [currentTask({ workedPomos: 0.5 })],
            proposedTasks: [proposed({ id: undefined, title: "Remaining work", splitsFrom: "task-1" })],
        });

        expect(result.changes[0]).toMatchObject({
            type: "split",
            blocked: true,
            blockReasons: ["split-with-worked-progress"],
            guardrails: { splitWithWorkedProgress: true, splitBlocked: true },
        });
    });

    it("blocks direct Done transitions because timer synchronization owns them", () => {
        const result = diffPlannerTasks([currentTask()], [proposed({ status: "Done" })]);

        expect(result.changes[0]).toMatchObject({
            type: "update",
            blocked: true,
            blockReasons: ["done-transition-is-timer-owned"],
        });
    });

    it("rejects duplicate and unknown explicit IDs", () => {
        expect(() => diffPlannerTasks([currentTask()], [proposed(), proposed()])).toThrowError("Duplicate proposed task id");
        expect(() => diffPlannerTasks([currentTask()], [proposed({ id: "missing" })])).toThrowError("not in current state");
    });
});
