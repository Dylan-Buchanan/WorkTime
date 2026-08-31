import { describe, expect, it, vi } from "vitest";
import type { ChatCompletionsClient } from "./llmTransport";
import type { PMTask, ProjectManagerState } from "../../state/types";
import { runStartOfDayWorkflow, type StartOfDayProgressEvent } from "./startOfDayWorkflow";

function task(): PMTask {
    return {
        id: "t1",
        title: "Draft",
        projectId: "p1",
        status: "Next",
        priority: "High",
        estimatePomos: 2,
        timeSpentMinutes: 0,
        workedPomos: 0,
        description: "",
        tags: [],
        links: [],
        checklist: [{ id: "c1", title: "Old wording", done: false }],
        relatedTo: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function pmState(): Pick<ProjectManagerState, "tasks" | "ui"> {
    return {
        tasks: { t1: task() },
        ui: {
            selectedProjectIds: ["p1"],
            selectedTaskId: null,
            view: "list",
            listGrouping: "none",
            statusFilter: [],
            tagFilter: [],
            priorityFilter: [],
            search: "",
            showArchived: false,
            sort: "manual",
            dueFilter: "all",
            boardShowAllTasks: false,
        },
    };
}

function plannerJson() {
    return JSON.stringify({
        summary: "Planner summary",
        proposedTasks: [
            {
                id: "t1",
                title: "Draft",
                projectId: "p1",
                status: "Next",
                priority: "High",
                estimatePomos: 2,
                description: "",
                checklist: [{ id: "c1", title: "Old wording", done: false }],
                relatedTo: [],
            },
        ],
    });
}

describe("Start-of-Day workflow", () => {
    it("uses low/high-temperature personas while freezing structural fields", async () => {
        const events: StartOfDayProgressEvent[] = [];
        const times = [0, 6400, 7000, 9000];
        const complete = vi
            .fn()
            .mockResolvedValueOnce(plannerJson())
            .mockResolvedValueOnce(
                JSON.stringify({
                    summary: "Write the focused draft.",
                    proposedTasks: [
                        { id: "t1", title: "Write focused draft", description: "Produce the first reviewable version.", checklist: [{ id: "c1", title: "Outline the argument", done: false }] },
                    ],
                }),
            );
        const result = await runStartOfDayWorkflow({
            projectId: "p1",
            pmState: pmState(),
            logs: [],
            settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"),
            workUntil: new Date("2026-08-07T11:00:00.000Z"),
            client: { complete } as ChatCompletionsClient,
            provider: "openai",
            onProgress: (event) => events.push(event),
            monotonicNow: () => times.shift() ?? 9000,
        });
        expect(complete).toHaveBeenCalledTimes(2);
        expect(complete.mock.calls[0][0]).toEqual(expect.objectContaining({ temperature: 0.1, model: "gpt-5.6-luna" }));
        expect(complete.mock.calls[1][0]).toEqual(expect.objectContaining({ temperature: 0.75, model: "gpt-5.6-luna" }));
        expect(complete.mock.calls[0][0]).not.toHaveProperty("maxTokens");
        expect(complete.mock.calls[0][0]).not.toHaveProperty("thinking");
        expect(complete.mock.calls[0][0].messages[0].content).toContain("Example JSON:");
        expect(complete.mock.calls[1][0].messages[0].content).toContain("Example JSON:");
        expect(result.proposedTasks[0]).toEqual(
            expect.objectContaining({
                id: "t1",
                title: "Write focused draft",
                status: "Next",
                priority: "High",
                estimatePomos: 2,
                checklist: [{ id: "c1", title: "Outline the argument", done: false }],
            }),
        );
        expect(result.summary).toBe("Write the focused draft.");
        expect(result.changes).toEqual([expect.objectContaining({ type: "update", taskId: "t1", blocked: false })]);
        expect(events.filter((event) => event.type === "phase").map((event) => event.phase)).toEqual([
            "building-context", "planning", "validating-plan", "writing", "validating-copy", "diffing", "completed",
        ]);
        expect(events.filter((event) => event.type === "llm-attempt")).toEqual([
            expect.objectContaining({ role: "planner", attempt: 1, maxAttempts: 2, model: "gpt-5.6-luna", durationMs: 6400, outcome: "valid" }),
            expect.objectContaining({ role: "writer", attempt: 1, maxAttempts: 2, model: "gpt-5.6-luna", durationMs: 2000, outcome: "valid" }),
        ]);
    });

    it("passes caller-supplied busy intervals into the frozen planner budget", async () => {
        const complete = vi.fn()
            .mockResolvedValueOnce(plannerJson())
            .mockResolvedValueOnce(JSON.stringify({
                summary: "Ready",
                proposedTasks: [{ id: "t1", title: "Draft", description: "", checklist: [{ id: "c1", title: "Old wording", done: false }] }],
            }));
        const result = await runStartOfDayWorkflow({
            projectId: "p1", pmState: pmState(), logs: [], settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"), workUntil: new Date("2026-08-07T11:00:00.000Z"),
            busyIntervals: [{ start: "2026-08-07T09:30:00.000Z", end: "2026-08-07T10:30:00.000Z" }],
            client: { complete } as ChatCompletionsClient, provider: "openai",
        });
        expect(result.workBudgetPomos).toBe(2);
        expect(complete.mock.calls[0][0].messages[1].content).toContain('"workBudgetPomos":2');

        const unusedClient = { complete: vi.fn() } as unknown as ChatCompletionsClient;
        await expect(runStartOfDayWorkflow({
            projectId: "p1", pmState: pmState(), logs: [], settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"), workUntil: new Date("2026-08-07T10:00:00.000Z"),
            busyIntervals: [{ start: "2026-08-07T09:00:00.000Z", end: "2026-08-07T10:00:00.000Z" }],
            client: unusedClient, provider: "openai",
        })).rejects.toThrow(/calendar busy time/i);
        expect(unusedClient.complete).not.toHaveBeenCalled();
    });

    it("disables DeepSeek thinking and leaves Start-of-Day output uncapped", async () => {
        const complete = vi.fn()
            .mockResolvedValueOnce(plannerJson())
            .mockResolvedValueOnce(JSON.stringify({
                summary: "Ready",
                proposedTasks: [{ id: "t1", title: "Draft", description: "", checklist: [{ id: "c1", title: "Old wording", done: false }] }],
            }));
        await runStartOfDayWorkflow({
            projectId: "p1", pmState: pmState(), logs: [], settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"), workUntil: new Date("2026-08-07T10:00:00.000Z"),
            client: { complete }, provider: "deepseek",
        });
        for (const [request] of complete.mock.calls) {
            expect(request).toEqual(expect.objectContaining({
                model: "deepseek-v4-flash",
                thinking: { type: "disabled" },
            }));
            expect(request).not.toHaveProperty("maxTokens");
        }
    });

    it("reports each invalid JSON retry without retaining raw response content", async () => {
        const events: StartOfDayProgressEvent[] = [];
        const secretResponse = "```json\n{\"privateTask\":\"do not log this\"}\n```";
        const complete = vi.fn().mockResolvedValue(secretResponse);
        const times = [0, 6400, 7000, 7600];
        await expect(runStartOfDayWorkflow({
            projectId: "p1",
            pmState: pmState(),
            logs: [],
            settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"),
            workUntil: new Date("2026-08-07T10:00:00.000Z"),
            client: { complete } as ChatCompletionsClient,
            onProgress: (event) => events.push(event),
            monotonicNow: () => times.shift() ?? 7600,
        })).rejects.toThrow("LLM output failed schema validation after 2 attempt(s): response is not valid JSON");

        const attempts = events.filter((event) => event.type === "llm-attempt");
        expect(attempts).toEqual([
            expect.objectContaining({ role: "planner", attempt: 1, durationMs: 6400, outcome: "invalid", responseKind: "markdown-fence", validationError: "response is not valid JSON" }),
            expect.objectContaining({ role: "planner", attempt: 2, durationMs: 600, outcome: "invalid", responseKind: "markdown-fence", retryFeedback: "response is not valid JSON" }),
        ]);
        expect(JSON.stringify(events)).not.toContain("do not log this");
        expect(events.filter((event) => event.type === "phase").map((event) => event.phase)).toEqual(["building-context", "planning"]);
    });

    it("reports transport failures and ignores progress-listener errors", async () => {
        const transportEvents: StartOfDayProgressEvent[] = [];
        await expect(runStartOfDayWorkflow({
            projectId: "p1", pmState: pmState(), logs: [], settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"), workUntil: new Date("2026-08-07T10:00:00.000Z"),
            client: { complete: vi.fn().mockRejectedValue(new Error("network unavailable")) },
            onProgress: (event) => transportEvents.push(event), monotonicNow: (() => { const values = [10, 25]; return () => values.shift() ?? 25; })(),
        })).rejects.toThrow("network unavailable");
        expect(transportEvents).toContainEqual(expect.objectContaining({
            type: "llm-attempt", role: "planner", attempt: 1, durationMs: 15, outcome: "transport-error", validationError: "network unavailable",
        }));

        const complete = vi.fn()
            .mockResolvedValueOnce(plannerJson())
            .mockResolvedValueOnce(JSON.stringify({
                summary: "Ready", proposedTasks: [{ id: "t1", title: "Draft", description: "", checklist: [{ id: "c1", title: "Old wording", done: false }] }],
            }));
        await expect(runStartOfDayWorkflow({
            projectId: "p1", pmState: pmState(), logs: [], settings: { work_minutes: 25 },
            now: new Date("2026-08-07T09:00:00.000Z"), workUntil: new Date("2026-08-07T10:00:00.000Z"),
            client: { complete }, onProgress: () => { throw new Error("UI listener failed"); },
        })).resolves.toEqual(expect.objectContaining({ summary: "Ready" }));
    });

    it("rejects writer identity drift", async () => {
        const client: ChatCompletionsClient = {
            complete: vi
                .fn()
                .mockResolvedValueOnce(plannerJson())
                .mockResolvedValueOnce(
                    JSON.stringify({
                        summary: "Changed",
                        proposedTasks: [{ id: "other", title: "Changed", description: "", checklist: [{ id: "c1", title: "Changed", done: false }] }],
                    }),
                ),
        };
        await expect(
            runStartOfDayWorkflow({
                projectId: "p1",
                pmState: pmState(),
                logs: [],
                settings: { work_minutes: 25 },
                now: new Date("2026-08-07T09:00:00.000Z"),
                workUntil: new Date("2026-08-07T10:00:00.000Z"),
                client,
            }),
        ).rejects.toThrow("changed task identity");
    });
});
