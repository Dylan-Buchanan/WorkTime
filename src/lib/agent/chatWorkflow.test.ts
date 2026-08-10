import { describe, expect, it, vi } from "vitest";
import type { Habit, HabitCompletion, PMTask, ProjectManagerState } from "../../state/types";
import { runChatWorkflow, type ChatWorkflowInput } from "./chatWorkflow";
import type { ChatCompletionsClient } from "./llmTransport";

function task(id: string, title: string, sortOrder: number): PMTask {
    return {
        id, title, projectId: "p1", status: "Backlog", priority: "Medium",
        timeSpentMinutes: 0, workedPomos: 0, description: "", tags: [], links: [], checklist: [], relatedTo: [],
        sortOrder, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function baseInput(complete: ChatCompletionsClient["complete"]): ChatWorkflowInput {
    const tasks = [task("t1", "Draft brief", 0), task("t2", "Review brief", 1)];
    const pmState: Pick<ProjectManagerState, "projects" | "tasks"> = {
        projects: {
            p1: { id: "p1", name: "Launch", description: "Ship the launch", color: "#6366F1", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        },
        tasks: Object.fromEntries(tasks.map((item) => [item.id, item])),
    };
    const habits: Habit[] = [{ id: "h1", name: "Daily review", description: "Review the plan", color: "#fff", frequency: "daily", position: 0, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }];
    const completions: HabitCompletion[] = [{ id: "hc1", habitId: "h1", bucket: "2026-08-10", createdAt: "2026-08-10T12:00:00.000Z", updatedAt: "2026-08-10T12:00:00.000Z" }];
    return { projectId: "p1", pmState, habits, completions, messages: [{ role: "user", content: "What should I focus on?" }], provider: "openai", client: { complete } };
}

describe("Chat workflow", () => {
    it("sends selected-project task and habit context and supports advice without changes", async () => {
        const complete = vi.fn().mockResolvedValue(JSON.stringify({ reply: "Draft the brief first, then do your daily review.", creates: [], updates: [], removeTaskIds: [] }));
        const result = await runChatWorkflow(baseInput(complete));
        expect(result.changes).toEqual([]);
        expect(result.reply).toContain("Draft the brief");
        const request = complete.mock.calls[0][0];
        expect(request.messages[1].content).toContain('"name":"Daily review"');
        expect(request.messages[1].content).toContain('"completionCount":1');
        expect(request.messages.at(-1)).toEqual({ role: "user", content: "What should I focus on?" });
    });

    it("creates selected and general pomodoro tasks through quick-add parsing without removing current tasks", async () => {
        const complete = vi.fn().mockResolvedValue(JSON.stringify({
            reply: "I proposed one launch task and one general task.",
            creates: [
                { quickAdd: "Write announcement ^2026-08-15 #launch !high 3p", scope: "selected-project", description: "Draft the announcement.", checklist: [], relatedTo: ["t1"] },
                { quickAdd: "Book dentist @General !low 1p", scope: "general", description: "", checklist: [], relatedTo: [] },
            ],
            updates: [], removeTaskIds: [],
        }));
        const result = await runChatWorkflow(baseInput(complete));
        expect(result.changes).toHaveLength(2);
        expect(result.changes[0]).toEqual(expect.objectContaining({ type: "create", after: expect.objectContaining({ title: "Write announcement", projectId: "p1", dueDate: "2026-08-15", priority: "High", estimatePomos: 3, tags: ["launch"], relatedTo: ["t1"] }) }));
        expect(result.changes[1]).toEqual(expect.objectContaining({ type: "create", after: expect.objectContaining({ title: "Book dentist", projectId: null, priority: "Low", estimatePomos: 1 }) }));
        expect(result.changes.some((change) => change.type === "remove")).toBe(false);
    });

    it("accepts a minimal create proposal for a simple task request", async () => {
        const complete = vi.fn().mockResolvedValue(JSON.stringify({
            reply: "I proposed a task to review the PowerPoint.",
            creates: [{ quickAdd: "Review PowerPoint 1p", scope: "selected-project" }],
            updates: [],
            removeTaskIds: [],
        }));
        const result = await runChatWorkflow(baseInput(complete));
        expect(complete).toHaveBeenCalledTimes(1);
        expect(result.changes).toEqual([
            expect.objectContaining({
                type: "create",
                after: expect.objectContaining({
                    title: "Review PowerPoint",
                    projectId: "p1",
                    estimatePomos: 1,
                    description: "",
                    checklist: [],
                    relatedTo: [],
                }),
            }),
        ]);
    });

    it("merges incremental updates and removals while leaving omitted tasks untouched", async () => {
        const complete = vi.fn().mockResolvedValue(JSON.stringify({
            reply: "I tightened the first task and proposed removing the second.", creates: [], removeTaskIds: ["t2"],
            updates: [{ id: "t1", title: "Draft launch brief", projectId: "p1", status: "Next", priority: "High", description: "Start with the audience.", checklist: [], relatedTo: [] }],
        }));
        const result = await runChatWorkflow(baseInput(complete));
        expect(result.changes.map((change) => [change.type, change.taskId])).toEqual([["update", "t1"], ["remove", "t2"]]);
    });

    it("rejects proposals that target unknown task IDs", async () => {
        const complete = vi.fn().mockResolvedValue(JSON.stringify({ reply: "Remove it.", creates: [], updates: [], removeTaskIds: ["missing"] }));
        await expect(runChatWorkflow(baseInput(complete))).rejects.toThrow("unknown task");
    });
});
