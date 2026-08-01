import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { AppStateProvider } from "./AppStateContext";
import StateSyncBridge from "./StateSyncBridge";
import { DataProvider } from "./DataContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";

function PMProbe() {
    const { state, createProject, createTask, quickAddParse } = usePM();
    return <div>
        <div data-testid="project-count">{Object.keys(state.projects).length}</div>
        <div data-testid="task-count">{Object.keys(state.tasks).length}</div>
        <div data-testid="hydrated">{state.meta.initializedAt.length > 0 ? "yes" : "no"}</div>
        <button onClick={() => { const project = createProject("Alpha"); void createTask("First task", { projectId: project.id }); }}>add</button>
        <button onClick={() => void createTask("Quick task", { ...quickAddParse("Quick task #dev 2p").task })}>quick</button>
    </div>;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return <DataProvider dataAccess={data}><AppStateProvider><ProjectManagerProvider><StateSyncBridge />{children}</ProjectManagerProvider></AppStateProvider></DataProvider>;
}

beforeEach(() => localStorage.clear());

describe("ProjectManagerContext", () => {
    it("hydrates a default state and persists separate local UI/server slices", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(JSON.parse(localStorage.getItem("pm_state_v1")!).ui).toBeTruthy();
        expect((await data.loadPMState())?.projects).toBeTruthy();
    });

    it("restores only UI from legacy localStorage while server slices come from DataAccess", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        localStorage.setItem("pm_state_v1", JSON.stringify({ projects: { old: { name: "Old" } }, ui: { search: "saved" } }));
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(JSON.parse(localStorage.getItem("pm_state_v1")!).ui.search).toBe("saved");
        expect((await data.loadPMState())?.projects).not.toHaveProperty("old");
    });

    it("createProject and createTask update state", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "app-task" });
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        await act(async () => screen.getByText("add").click());
        await waitFor(() => expect(Number(screen.getByTestId("task-count").textContent)).toBeGreaterThan(0));
    });

    it("creates a task through the General project fallback", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "app-task" });
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        await act(async () => screen.getByText("quick").click());
        await waitFor(() => expect(Number(screen.getByTestId("task-count").textContent)).toBeGreaterThan(0));
    });
});

function SelectionProbe() {
    const { state } = usePM();
    return <div>
        <div data-testid="hydrated">{state.meta.initializedAt.length > 0 ? "yes" : "no"}</div>
        <div data-testid="selected">{state.ui.selectedProjectIds.join(",")}</div>
        <div data-testid="search">{state.ui.search}</div>
    </div>;
}

describe("ProjectManagerContext server selection reconciliation", () => {
    function serverState(projectIds: string[]) {
        const projects: Record<string, any> = {};
        projectIds.forEach((id) => {
            projects[id] = { id, name: id.toUpperCase(), color: "#fff", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
        });
        return { projects, tasks: {}, meta: { initializedAt: "2026-01-01T00:00:00Z" } };
    }

    it("drops local selections absent from the server and keeps the rest", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1", "p2"]));
        localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedProjectIds: ["ghost", "p2"], search: "keep" } }));
        render(<DataProvider dataAccess={data}><AppStateProvider><ProjectManagerProvider><SelectionProbe /></ProjectManagerProvider></AppStateProvider></DataProvider>);
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(screen.getByTestId("selected").textContent).toBe("p2");
        expect(screen.getByTestId("search").textContent).toBe("keep");
    });

    it("falls back to the first server project when every selection is gone", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1", "p2"]));
        localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedProjectIds: ["ghost"] } }));
        render(<DataProvider dataAccess={data}><AppStateProvider><ProjectManagerProvider><SelectionProbe /></ProjectManagerProvider></AppStateProvider></DataProvider>);
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(screen.getByTestId("selected").textContent).toBe("p1");
    });
});

describe("StateSyncBridge", () => {
    it("creates PM metadata for backend tasks", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { bt1: { id: "bt1", name: "Synced task", target_pomodoros: 4, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } } }));
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("task-count")).toHaveTextContent("1"));
    });

    it("marks PM tasks Done when the backend task completes", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { bt1: { id: "bt1", name: "Done task", target_pomodoros: 2, completed_pomodoros: 2, created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-05T00:00:00Z", break_skips: 0, archived: false } } }));
        await data.savePMState({ projects: {}, tasks: { pt1: { id: "pt1", title: "Done task", projectId: null, status: "In Progress", priority: "Medium", timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [], sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", appTaskId: "bt1", relatedTo: [] } }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        render(wrap(data, <PMProbe />));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1?.status).toBe("Done"));
    });
});
