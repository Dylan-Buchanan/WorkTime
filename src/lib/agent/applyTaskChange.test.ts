import { describe, expect, it, vi } from "vitest";
import type { TaskChange } from "../engine/diffEngine";
import { applyTaskChange } from "./applyTaskChange";

const guardrails = {
    blocked: false, splitWithWorkedProgress: false, splitBlocked: false,
    estimateIncreased: false, estimateIncrease: false, rationaleRequired: false,
    forwardDueDate: false, forwardDueDateChange: false, doneTransition: false, reasons: [],
};

function mutations() {
    return {
        createTask: vi.fn(async (title: string, opts = {}) => ({ id: "created", title, ...opts } as any)),
        updateTask: vi.fn(), archiveTask: vi.fn(), reorderTasks: vi.fn(),
    };
}

describe("applyTaskChange", () => {
    it("creates split proposals in the active project without persisting proposal metadata", async () => {
        const api = mutations();
        const change: TaskChange = {
            type: "split", action: "createTask", splitsFrom: "source", rationale: "Smaller step",
            after: { title: "New half", status: "Next", priority: "High", checklist: [], relatedTo: [], splitsFrom: "source", rationale: "Smaller step" },
            guardrails, blocked: false, blockReasons: [],
        };

        await expect(applyTaskChange(change, "project-1", api)).resolves.toEqual({ createdTaskId: "created" });
        expect(api.createTask).toHaveBeenCalledWith("New half", expect.objectContaining({ projectId: "project-1", status: "Next", priority: "High" }));
        expect(api.createTask.mock.calls[0][1]).not.toHaveProperty("splitsFrom");
        expect(api.createTask.mock.calls[0][1]).not.toHaveProperty("rationale");
    });

    it("maps removal to archive and reorder to the supplied target order", async () => {
        const api = mutations();
        await applyTaskChange({ type: "remove", action: "archiveTask", taskId: "t1", guardrails, blocked: false, blockReasons: [] }, "p1", api);
        await applyTaskChange({ type: "reorder", action: "reorderTasks", afterTaskIds: ["t2", "t1"], guardrails, blocked: false, blockReasons: [] }, "p1", api);
        expect(api.archiveTask).toHaveBeenCalledWith("t1");
        expect(api.reorderTasks).toHaveBeenCalledWith(["t2", "t1"]);
    });

    it("refuses blocked changes", async () => {
        const api = mutations();
        await expect(applyTaskChange({ type: "update", action: "updateTask", taskId: "t1", blocked: true, blockReasons: ["guardrail"], guardrails: { ...guardrails, blocked: true, reasons: ["guardrail"] } }, "p1", api)).rejects.toThrow("Blocked agent changes");
        expect(api.updateTask).not.toHaveBeenCalled();
    });
});
