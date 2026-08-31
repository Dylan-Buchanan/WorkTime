import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriCloseProvider } from "./TauriCloseContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { AppStateProvider } from "./AppStateContext";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { HabitProvider } from "./HabitContext";
import { AgentApprovalProvider, type AgentReplanInput, type AgentReviewCompletionInput, useAgentApproval } from "./AgentApprovalContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { TaskChange } from "../lib/engine/diffEngine";
import { MemoryRouter } from "react-router-dom";
import { AgentPanel } from "../components/ProjectManager/AgentPanel";
import { setAgentApiKey } from "../lib/agent/apiKey";
import type { StartOfDayWorkflowInput, StartOfDayWorkflowResult } from "../lib/agent/startOfDayWorkflow";
import type { EndOfDayWorkflowInput, EndOfDayWorkflowResult } from "../lib/agent/endOfDayWorkflow";
import type { ChatWorkflowInput } from "../lib/agent/chatWorkflow";
import type { GoogleCalendarDataAccess } from "../lib/data/GoogleCalendarDataAccess";

const OWNER = "agent-owner";
const guardrails = {
    blocked: false, splitWithWorkedProgress: false, splitBlocked: false,
    estimateIncreased: false, estimateIncrease: false, rationaleRequired: false,
    forwardDueDate: false, forwardDueDateChange: false, doneTransition: false, reasons: [],
};

function updateChange(title: string): TaskChange {
    return {
        type: "update", action: "updateTask", taskId: "t1",
        before: task("Original"),
        after: { id: "t1", title, projectId: "p1", status: "Backlog", priority: "Medium", checklist: [], relatedTo: [] },
        rationale: "Clarify the next action", guardrails, blocked: false, blockReasons: [],
    };
}

function task(title: string) {
    return {
        id: "t1", title, projectId: "p1", status: "Backlog" as const, priority: "Medium" as const,
        timeSpentMinutes: 0, workedPomos: 0, description: "", tags: [], links: [], checklist: [], relatedTo: [],
        sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function workflowResult(overrides: Partial<StartOfDayWorkflowResult> = {}): StartOfDayWorkflowResult {
    return {
        projectId: "p1",
        createdAt: "2026-08-07T13:00:00.000Z",
        workUntil: "2026-08-07T17:00:00.000Z",
        workBudgetPomos: 8,
        summary: "One improvement",
        proposedTasks: [updateChange("Rewritten").after!],
        orderedTasks: [{ taskId: "t1", title: "Rewritten", plannedPomos: 1, rollover: false, checklist: [] }],
        changes: [updateChange("Rewritten")],
        ...overrides,
    };
}

async function dataWithProject() {
    const data = new InMemoryDataAccess(makeAppState());
    await data.savePMState({
        projects: { p1: { id: "p1", name: "Plan", color: "#6366F1", workableStart: "09:00", workableEnd: "17:00", workableDays: [1, 2, 3, 4, 5], isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
        tasks: { t1: task("Original") }, meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
    });
    return data;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}><AppStateProvider><ProjectManagerProvider><AgentApprovalProvider><HabitProvider>{children}</HabitProvider></AgentApprovalProvider></ProjectManagerProvider></AppStateProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}

const Probe: React.FC<{ replan: (input: AgentReplanInput) => Promise<TaskChange[]>; changes?: TaskChange[]; onComplete?: (input: AgentReviewCompletionInput) => void | Promise<void> }> = ({ replan, changes = [updateChange("Rewritten")], onComplete }) => {
    const pm = usePM();
    const agent = useAgentApproval();
    return <div>
        <span data-testid="task-title">{pm.state.tasks.t1?.title ?? "loading"}</span>
        <span data-testid="agent-status">{agent.status}</span>
        <button onClick={() => agent.startReview({ projectId: "p1", mode: "start-of-day", changes, summary: "One improvement", replan, onComplete })}>Start review</button>
        <button onClick={() => void agent.approveCurrent()}>Approve current</button>
        <button onClick={() => void agent.rejectCurrent()}>Reject current</button>
    </div>;
};

beforeEach(() => localStorage.clear());

describe("AgentApprovalProvider", () => {
    it("applies one-click approval and completes with a revert snapshot", async () => {
        const data = await dataWithProject();
        render(wrap(data, <Probe replan={vi.fn(async () => [])} />));
        await screen.findByText("Original");
        fireEvent.click(screen.getByText("Start review"));
        expect(screen.getByTestId("agent-status")).toHaveTextContent("reviewing");
        await act(async () => { fireEvent.click(screen.getByText("Approve current")); });
        await waitFor(() => expect(screen.getByTestId("task-title")).toHaveTextContent("Rewritten"));
        expect(screen.getByTestId("agent-status")).toHaveTextContent("completed");
        expect(localStorage.getItem("worktime:agent:projectSnapshot:v1")).toContain("Original");
    });

    it("replans a rejection over the working copy with approved changes locked", async () => {
        const data = await dataWithProject();
        const replan = vi.fn(async (_input: AgentReplanInput) => []);
        render(wrap(data, <Probe replan={replan} changes={[updateChange("Rewritten"), updateChange("Rejected follow-up")]} />));
        await screen.findByText("Original");
        fireEvent.click(screen.getByText("Start review"));
        await act(async () => { fireEvent.click(screen.getByText("Approve current")); });
        await waitFor(() => expect(screen.getByTestId("task-title")).toHaveTextContent("Rewritten"));
        await act(async () => { fireEvent.click(screen.getByText("Reject current")); });
        await waitFor(() => expect(replan).toHaveBeenCalledTimes(1));
        expect(replan.mock.calls[0][0]).toEqual(expect.objectContaining({ projectId: "p1", mode: "start-of-day", approvedChanges: [expect.objectContaining({ after: expect.objectContaining({ title: "Rewritten" }) })], rejectedChange: expect.objectContaining({ after: expect.objectContaining({ title: "Rejected follow-up" }) }) }));
        expect(replan.mock.calls[0][0].workingTasks).toEqual([expect.objectContaining({ id: "t1", title: "Rewritten" })]);
        expect(screen.getByTestId("agent-status")).toHaveTextContent("completed");
    });

    it("notifies workflow completion once with the final approved changes", async () => {
        const data = await dataWithProject();
        const onComplete = vi.fn(async (_input: AgentReviewCompletionInput) => undefined);
        render(wrap(data, <Probe replan={vi.fn(async () => [])} onComplete={onComplete} />));
        await screen.findByText("Original");
        fireEvent.click(screen.getByText("Start review"));
        await act(async () => { fireEvent.click(screen.getByText("Approve current")); });
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        expect(onComplete.mock.calls[0][0]).toEqual({
            projectId: "p1",
            mode: "start-of-day",
            summary: "One improvement",
            approvedChanges: [expect.objectContaining({ taskId: "t1", after: expect.objectContaining({ title: "Rewritten" }) })],
        });
    });

    it("does not apply or complete the final change twice after rapid approval clicks", async () => {
        const data = await dataWithProject();
        const onComplete = vi.fn(async (_input: AgentReviewCompletionInput) => undefined);
        render(wrap(data, <Probe replan={vi.fn(async () => [])} onComplete={onComplete} />));
        await screen.findByText("Original");
        fireEvent.click(screen.getByText("Start review"));

        await act(async () => {
            fireEvent.click(screen.getByText("Approve current"));
            fireEvent.click(screen.getByText("Approve current"));
        });

        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        expect(onComplete.mock.calls[0][0].approvedChanges).toHaveLength(1);
    });

    it("completes an empty review once when startReview is rapidly invoked", async () => {
        const data = await dataWithProject();
        const onComplete = vi.fn(async (_input: AgentReviewCompletionInput) => undefined);
        render(wrap(data, <Probe changes={[]} replan={vi.fn(async () => [])} onComplete={onComplete} />));
        await screen.findByText("Original");

        fireEvent.click(screen.getByText("Start review"));
        fireEvent.click(screen.getByText("Start review"));

        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });

    it("shows setup until an API key is configured, then exposes all modes", async () => {
        const data = await dataWithProject();
        render(wrap(data, <MemoryRouter><AgentPanel /></MemoryRouter>));
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        expect(screen.getByText("Set up your agent")).toBeInTheDocument();
        act(() => { setAgentApiKey("test-key"); });
        expect(screen.getByRole("button", { name: /Start of Day/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /End of Day/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Chat/ })).toBeInTheDocument();
    });

    it("launches the Start-of-Day workflow with the selected work-until time", async () => {
        const data = await dataWithProject();
        setAgentApiKey("test-key");
        const runStartOfDay = vi.fn(async (input: StartOfDayWorkflowInput) => {
            if (input.rejectionFeedback) {
                input.onProgress?.({ type: "phase", run: "replan", phase: "building-context" });
                input.onProgress?.({ type: "phase", run: "replan", phase: "completed" });
                return {
                    projectId: "p1", createdAt: "2026-08-07T13:01:00.000Z", workUntil: "2026-08-07T17:00:00.000Z",
                    workBudgetPomos: 8, summary: "Replanned without that change",
                    proposedTasks: [updateChange("Original").after!],
                    orderedTasks: [{ taskId: "t1", title: "Original", plannedPomos: 1, rollover: false, checklist: [] }],
                    changes: [],
                };
            }
            for (let index = 0; index < 17; index += 1) {
                input.onProgress?.({ type: "phase", run: "initial", phase: "building-context" });
            }
            input.onProgress?.({ type: "phase", run: "initial", phase: "planning" });
            input.onProgress?.({ type: "llm-attempt", run: "initial", role: "planner", attempt: 1, maxAttempts: 2, model: "gpt-5.6-luna", durationMs: 6400, outcome: "invalid", responseKind: "non-json", validationError: "response is not valid JSON" });
            input.onProgress?.({ type: "llm-attempt", run: "initial", role: "planner", attempt: 2, maxAttempts: 2, model: "gpt-5.6-luna", durationMs: 900, outcome: "valid", retryFeedback: "response is not valid JSON" });
            input.onProgress?.({ type: "phase", run: "initial", phase: "completed" });
            return {
                projectId: "p1",
                createdAt: "2026-08-07T13:00:00.000Z",
                workUntil: "2026-08-07T17:00:00.000Z",
                workBudgetPomos: 8,
                summary: "One improvement",
                proposedTasks: [updateChange("Rewritten").after!],
                orderedTasks: [{ taskId: "t1", title: "Rewritten", plannedPomos: 1, rollover: false, checklist: [] }],
                changes: [updateChange("Rewritten")],
            };
        });
        const fetchBusyIntervals = vi.fn().mockResolvedValue({
            intervals: [{ start: "2026-08-07T14:00:00.000Z", end: "2026-08-07T14:30:00.000Z" }],
            refreshedAt: "2026-08-07T13:00:00.000Z",
        });
        const googleCalendarDataAccess = {
            loadSettings: vi.fn().mockResolvedValue({
                scopeLevel: "readonly", selectedCalendarIds: ["primary"], worktimeCalendarId: null,
                connectedAt: "2026-08-07T12:00:00.000Z", updatedAt: "2026-08-07T12:00:00.000Z",
            }),
            fetchBusyIntervals,
        } as unknown as GoogleCalendarDataAccess;
        const PanelProbe = () => {
            const pm = usePM();
            return <><span>{pm.state.tasks.t1?.title ?? "loading"}</span><AgentPanel runStartOfDay={runStartOfDay} googleCalendarDataAccess={googleCalendarDataAccess} /></>;
        };
        render(wrap(data, <MemoryRouter><PanelProbe /></MemoryRouter>));
        await screen.findByText("Original");
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        fireEvent.click(screen.getByRole("button", { name: /Start of Day/ }));
        fireEvent.change(screen.getByLabelText("Work until"), { target: { value: "23:59" } });
        fireEvent.click(screen.getByRole("button", { name: "Refresh calendar" }));
        expect(await screen.findByText("Calendar refreshed: 30 busy minutes.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
        await screen.findByLabelText("Update task proposal");
        expect(screen.getByLabelText("Today's recommended order")).toHaveTextContent("1");
        expect(screen.getByLabelText("Today's recommended order")).toHaveTextContent("Rewritten");
        expect(runStartOfDay).toHaveBeenCalledWith(expect.objectContaining({
            projectId: "p1", workUntil: "23:59",
            busyIntervals: [{ start: "2026-08-07T14:00:00.000Z", end: "2026-08-07T14:30:00.000Z" }],
        }));
        expect(fetchBusyIntervals).toHaveBeenCalledTimes(2);
        expect(screen.getByText("Plan ready", { selector: "p" })).toHaveAttribute("aria-live", "polite");
        fireEvent.click(screen.getByText("Details (20)"));
        expect(screen.getByRole("list", { name: "Agent activity log" })).toHaveTextContent("Planner · gpt-5.6-luna · attempt 1/2 · 6.4s · non json");
        expect(screen.getByRole("list", { name: "Agent activity log" })).toHaveTextContent("Retry feedback: response is not valid JSON");
        const initialProgress = runStartOfDay.mock.calls[0][0].onProgress;
        fireEvent.click(screen.getByRole("button", { name: "Reject" }));
        await waitFor(() => expect(runStartOfDay).toHaveBeenCalledTimes(2));
        expect(runStartOfDay.mock.calls[1][0]).toEqual(expect.objectContaining({
            rejectionFeedback: expect.stringContaining("user rejected"),
            onProgress: initialProgress,
        }));
        expect(await screen.findByText("Replan · Plan ready", { selector: "p" })).toHaveAttribute("aria-live", "polite");
        await waitFor(() => expect(localStorage.getItem("worktime:agent:startOfDayPlan:v1")).toContain("Replanned without that change"));
        expect(localStorage.getItem("worktime:agent:startOfDayPlan:v1")).not.toContain("One improvement");
        fireEvent.click(screen.getByRole("button", { name: "Clear activity" }));
        expect(screen.queryByLabelText("Agent activity")).not.toBeInTheDocument();
    });

    it("launches End-of-Day, previews tomorrow, and applies the approved priority order", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({
            projects: { p1: { id: "p1", name: "Plan", color: "#6366F1", workableStart: "09:00", workableEnd: "17:00", workableDays: [1, 2, 3, 4, 5], isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
            tasks: { t1: task("First"), t2: { ...task("Second"), id: "t2", sortOrder: 1 } },
            meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
        });
        setAgentApiKey("test-key");
        const reorder: TaskChange = {
            type: "reorder", action: "reorderTasks", beforeTaskIds: ["t1", "t2"], afterTaskIds: ["t2", "t1"],
            guardrails, blocked: false, blockReasons: [],
        };
        const runEndOfDay = vi.fn(async (_input: EndOfDayWorkflowInput): Promise<EndOfDayWorkflowResult> => ({
            projectId: "p1", createdAt: "2026-08-10T22:00:00.000Z", summary: "Start with Second tomorrow.",
            comparison: { plannedCount: 2, completedCount: 1, partialCount: 1, notStartedCount: 0, missingCount: 0, items: [] },
            tomorrowTasks: [
                { taskId: "t2", title: "Second", status: "Backlog", priority: "Medium" },
                { taskId: "t1", title: "First", status: "Backlog", priority: "Medium" },
            ],
            changes: [reorder],
        }));
        const PanelProbe = () => {
            const pm = usePM();
            return <><span data-testid="tomorrow-order">{Object.values(pm.state.tasks).sort((left, right) => left.sortOrder - right.sortOrder).map((item) => item.title).join(",")}</span><AgentPanel runEndOfDay={runEndOfDay} /></>;
        };
        render(wrap(data, <MemoryRouter><PanelProbe /></MemoryRouter>));
        await screen.findByText("First,Second");
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        fireEvent.click(screen.getByRole("button", { name: /End of Day/ }));
        fireEvent.click(screen.getByRole("button", { name: "Wrap up day" }));

        expect(await screen.findByLabelText("Tomorrow overview")).toHaveTextContent("Start with Second tomorrow.");
        expect(screen.getByLabelText("Tomorrow overview")).toHaveTextContent("1 completed, 1 partial");
        expect(runEndOfDay).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }));
        fireEvent.click(screen.getByRole("button", { name: "Approve" }));
        await waitFor(() => expect(screen.getByTestId("tomorrow-order")).toHaveTextContent("Second,First"));
    });

    it("runs a multi-turn chat with project and habit context and reviews proposed changes", async () => {
        const data = await dataWithProject();
        setAgentApiKey("test-key");
        const runChat = vi.fn(async (_input: ChatWorkflowInput) => ({
            projectId: "p1",
            reply: "I can clarify the next action for you.",
            changes: [updateChange("Draft the launch outline")],
        }));
        const PanelProbe = () => {
            const pm = usePM();
            return <><span data-testid="chat-task-title">{pm.state.tasks.t1?.title ?? "loading"}</span><AgentPanel runChat={runChat} /></>;
        };
        render(wrap(data, <MemoryRouter><PanelProbe /></MemoryRouter>));
        await screen.findByText("Original");
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        fireEvent.click(screen.getByRole("button", { name: /^Chat/ }));
        fireEvent.change(screen.getByLabelText("Message the planning agent"), { target: { value: "Make the first task actionable" } });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));

        expect(await screen.findByLabelText("Update task proposal")).toBeInTheDocument();
        expect(screen.getByText("I can clarify the next action for you.")).toBeInTheDocument();
        expect(runChat).toHaveBeenCalledWith(expect.objectContaining({
            projectId: "p1",
            messages: [{ role: "user", content: "Make the first task actionable" }],
            habits: expect.any(Array),
            completions: expect.any(Array),
        }));
        fireEvent.click(screen.getByRole("button", { name: "Approve" }));
        await waitFor(() => expect(screen.getByTestId("chat-task-title")).toHaveTextContent("Draft the launch outline"));
        expect(screen.getByLabelText("Agent chat messages")).toHaveTextContent("Make the first task actionable");
        expect(screen.getByLabelText("Agent chat messages")).toHaveTextContent("I can clarify the next action for you.");
    });

    it("explains when End-of-Day has no saved Start-of-Day handoff", async () => {
        const data = await dataWithProject();
        setAgentApiKey("test-key");
        const PanelProbe = () => {
            const pm = usePM();
            return <><span>{pm.state.tasks.t1?.title ?? "loading"}</span><AgentPanel /></>;
        };
        render(wrap(data, <MemoryRouter><PanelProbe /></MemoryRouter>));
        await screen.findByText("Original");
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        fireEvent.click(screen.getByRole("button", { name: /End of Day/ }));
        fireEvent.click(screen.getByRole("button", { name: "Wrap up day" }));
        expect(await screen.findByText(/No valid Start-of-Day plan/)).toHaveAttribute("role", "alert");
    });

    it("uses current project state when replanning after a task is archived", async () => {
        const data = await dataWithProject();
        setAgentApiKey("test-key");
        const runStartOfDay = vi.fn(async (input: StartOfDayWorkflowInput) => input.rejectionFeedback
            ? workflowResult({ summary: "Current context", changes: [] })
            : workflowResult());
        const PanelProbe = () => {
            const pm = usePM();
            return <>
                <span data-testid="archive-state">{pm.state.tasks.t1?.isArchived ? "archived" : "current"}</span>
                <button onClick={() => pm.archiveTask("t1")}>Archive task externally</button>
                <AgentPanel runStartOfDay={runStartOfDay} />
            </>;
        };
        render(wrap(data, <MemoryRouter><PanelProbe /></MemoryRouter>));
        await screen.findByText("current");
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        fireEvent.click(screen.getByRole("button", { name: /Start of Day/ }));
        fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
        await screen.findByLabelText("Update task proposal");

        fireEvent.click(screen.getByText("Archive task externally"));
        await waitFor(() => expect(screen.getByTestId("archive-state")).toHaveTextContent("archived"));
        fireEvent.click(screen.getByRole("button", { name: "Reject" }));

        await waitFor(() => expect(runStartOfDay).toHaveBeenCalledTimes(2));
        expect(runStartOfDay.mock.calls[1][0].pmState.tasks.t1).toEqual(expect.objectContaining({ isArchived: true }));
    });

    it("surfaces an error when the selected project disappears during generation", async () => {
        const data = await dataWithProject();
        setAgentApiKey("test-key");
        let resolveWorkflow!: (result: StartOfDayWorkflowResult) => void;
        const runStartOfDay = vi.fn(() => new Promise<StartOfDayWorkflowResult>((resolve) => { resolveWorkflow = resolve; }));
        const PanelProbe = () => {
            const pm = usePM();
            return <>
                <span data-testid="project-state">{pm.state.projects.p1 ? "project-present" : "project-gone"}</span>
                <button onClick={() => pm.deleteProject("p1")}>Delete project externally</button>
                <AgentPanel runStartOfDay={runStartOfDay} />
            </>;
        };
        render(wrap(data, <MemoryRouter><PanelProbe /></MemoryRouter>));
        await screen.findByText("project-present");
        fireEvent.click(screen.getByRole("button", { name: "Open planning agent" }));
        fireEvent.click(screen.getByRole("button", { name: /Start of Day/ }));
        fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
        await waitFor(() => expect(runStartOfDay).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByText("Delete project externally"));
        await waitFor(() => expect(screen.getByTestId("project-state")).toHaveTextContent("project-gone"));
        await act(async () => { resolveWorkflow(workflowResult({ changes: [] })); });

        expect(await screen.findByText(/The review could not start/)).toBeInTheDocument();
        expect(screen.getByText("Select an existing project before starting an agent review.")).toHaveAttribute("role", "alert");
    });
});
