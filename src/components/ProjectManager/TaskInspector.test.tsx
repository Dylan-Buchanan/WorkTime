import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import { AppStateProvider } from "../../state/AppStateContext";
import { DataProvider } from "../../state/DataContext";
import { ProjectManagerProvider } from "../../state/ProjectManagerContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import { TaskInspector } from "./TaskInspector";

const OWNER = "owner-1";
const SINCE = "2026-11-08T09:00:00.000Z";

function task(patch: Partial<PMTask> = {}): PMTask {
    return {
        id: "pt1",
        title: "Task",
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        workedPomos: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        relatedTo: [],
        waiting: null,
        ...patch,
    };
}

async function seededData(patch: Partial<PMTask> = {}) {
    const data = new InMemoryDataAccess(makeAppState());
    await data.savePMState({
        projects: {},
        tasks: { pt1: task(patch) },
        meta: { initializedAt: "2026-01-01T00:00:00Z" },
    });
    return data;
}

async function renderInspector(data: InMemoryDataAccess) {
    localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedTaskId: "pt1" } }));
    const view = render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <MemoryRouter initialEntries={["/projects"]}>
                                <TaskInspector />
                            </MemoryRouter>
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>,
    );
    await screen.findByText("Task");
    return view;
}

async function persistedWaiting(data: InMemoryDataAccess) {
    return (await data.loadPMState())?.tasks.pt1?.waiting ?? null;
}

beforeEach(() => localStorage.clear());

describe("TaskInspector waiting control", () => {
    it("toggles on an agent wait with the current timestamp", async () => {
        const data = await seededData();
        await renderInspector(data);
        const before = Date.now();

        await act(async () => screen.getByRole("button", { name: "Waiting" }).click());

        await waitFor(async () => expect(await persistedWaiting(data)).not.toBeNull());
        const waiting = await persistedWaiting(data);
        expect(waiting?.type).toBe("agent");
        const since = Date.parse(waiting!.since);
        expect(since).toBeGreaterThanOrEqual(before);
        expect(since).toBeLessThanOrEqual(Date.now());
        expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "false");
    });

    it("switches Agent to Person while keeping the original since", async () => {
        const data = await seededData({ waiting: { type: "agent", since: SINCE } });
        await renderInspector(data);
        expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute("aria-pressed", "true");

        await act(async () => screen.getByRole("button", { name: "Person" }).click());

        await waitFor(async () => expect(await persistedWaiting(data)).toEqual({ type: "person", since: SINCE }));
        expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "true");
    });

    it("clears the flag with the clear action", async () => {
        const data = await seededData({ waiting: { type: "person", since: SINCE } });
        await renderInspector(data);

        await act(async () => screen.getByRole("button", { name: "Clear waiting" }).click());

        await waitFor(async () => expect(await persistedWaiting(data)).toBeNull());
        expect(screen.getByRole("button", { name: "Waiting" })).toBeInTheDocument();
    });

    it.each([
        ["Done", { status: "Done" as const }],
        ["archived", { isArchived: true }],
    ])("hides the control for a %s task", async (_label, patch) => {
        const data = await seededData(patch);
        await renderInspector(data);
        expect(screen.queryByRole("button", { name: "Waiting" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Agent" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Clear waiting" })).toBeNull();
    });
});
