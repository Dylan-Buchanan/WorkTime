import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriCloseProvider } from "./TauriCloseContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { AppStateProvider } from "./AppStateContext";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { AgentApprovalProvider, type AgentReplanInput, useAgentApproval } from "./AgentApprovalContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { TaskChange } from "../lib/engine/diffEngine";
import { MemoryRouter } from "react-router-dom";
import { AgentPanel } from "../components/ProjectManager/AgentPanel";
import { setAgentApiKey } from "../lib/agent/apiKey";

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

async function dataWithProject() {
    const data = new InMemoryDataAccess(makeAppState());
    await data.savePMState({
        projects: { p1: { id: "p1", name: "Plan", color: "#6366F1", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
        tasks: { t1: task("Original") }, meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
    });
    return data;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId={OWNER}><AppStateProvider><ProjectManagerProvider><AgentApprovalProvider>{children}</AgentApprovalProvider></ProjectManagerProvider></AppStateProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}

const Probe: React.FC<{ replan: (input: AgentReplanInput) => Promise<TaskChange[]>; changes?: TaskChange[] }> = ({ replan, changes = [updateChange("Rewritten")] }) => {
    const pm = usePM();
    const agent = useAgentApproval();
    return <div>
        <span data-testid="task-title">{pm.state.tasks.t1?.title ?? "loading"}</span>
        <span data-testid="agent-status">{agent.status}</span>
        <button onClick={() => agent.startReview({ projectId: "p1", mode: "start-of-day", changes, summary: "One improvement", replan })}>Start review</button>
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
});
