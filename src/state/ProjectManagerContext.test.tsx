import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { AppStateProvider, useAppState } from "./AppStateContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import StateSyncBridge from "./StateSyncBridge";
import { DataProvider } from "./DataContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { SyncOptions, SyncResult } from "../lib/data/DataAccess";
import { stagingKey } from "../lib/data/staging/LocalStagingStore";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";
import type { PMTask, Task, TaskPriority, TaskStatus } from "./types";
import { TaskInspector } from "../components/ProjectManager/TaskInspector";

const OWNER = "owner-1";

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

function BridgeProbe() {
    const { state, updateTask } = usePM();
    return <div>
        <div data-testid="pm-task-count">{Object.keys(state.tasks).length}</div>
        <div data-testid="pm-task-estimate">{state.tasks.pt1?.estimatePomos}</div>
        <button onClick={() => updateTask("pt1", { estimatePomos: 8 })}>estimate-8</button>
    </div>;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider><StateSyncBridge />{children}</ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

function wrapWithoutBridge(data: InMemoryDataAccess, children: React.ReactNode) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>{children}</ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

function serverState(projectIds: string[]) {
    const projects: Record<string, any> = {};
    projectIds.forEach((id) => {
        projects[id] = { id, name: id.toUpperCase(), color: "#fff", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    });
    return { projects, tasks: {}, meta: { initializedAt: "2026-01-01T00:00:00Z" } };
}

function makePMTask(overrides: Partial<PMTask>): PMTask {
    return {
        id: "pt",
        title: "Task",
        projectId: null,
        status: "Backlog" as TaskStatus,
        priority: "Medium" as TaskPriority,
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
        ...overrides,
    };
}

type WorkStartControls = { pm: ReturnType<typeof usePM>; app: ReturnType<typeof useAppState> };

function WorkStartProbe({ onChange }: { onChange: (controls: WorkStartControls) => void }) {
    const pm = usePM();
    const app = useAppState();
    useLayoutEffect(() => onChange({ pm, app }), [pm, app, onChange]);
    return <div data-testid="work-start-status">{pm.state.tasks.pt1?.status ?? "missing"}</div>;
}

function InspectorLocation() {
    return <div data-testid="inspector-location">{useLocation().pathname}</div>;
}

async function renderWorkStart(data: InMemoryDataAccess, options: { withoutBridge?: boolean; inspector?: boolean } = {}) {
    let current!: WorkStartControls;
    const children = <>
        <WorkStartProbe onChange={(value) => { current = value; }} />
        {options.inspector && <MemoryRouter initialEntries={["/projects"]}><TaskInspector /><InspectorLocation /></MemoryRouter>}
    </>;
    const view = render(options.withoutBridge ? wrapWithoutBridge(data, children) : wrap(data, children));
    await waitFor(() => {
        expect(current.app.state).not.toBeNull();
        expect(current.pm.state.meta.initializedAt).toBe("2026-01-01T00:00:00Z");
    });
    return { ...view, get current() { return current; } };
}

function workStartBackend(patch: Partial<Task> = {}): Task {
    return { id: "bt1", name: "Work task", target_pomodoros: 4, completed_pomodoros: 0,
        created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false, ...patch };
}

async function workStartData(status: TaskStatus = "Backlog") {
    const data = new InMemoryDataAccess(makeAppState({ tasks: { bt1: workStartBackend() }, active_task: "bt1" }));
    await data.savePMState({ projects: {}, tasks: { pt1: makePMTask({ id: "pt1", title: "Work task", appTaskId: "bt1", status, estimatePomos: 4 }) }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
    return data;
}

/**
 * In-memory DataAccess that reports uninitialized until the first sync, so the
 * PM save effect's `initialized` gate can be exercised in isolation.
 */
class UninitializedDataAccess extends InMemoryDataAccess {
    private bootstrapped = false;
    override isInitialized(): boolean {
        return this.bootstrapped;
    }
    override async sync(options: SyncOptions): Promise<SyncResult> {
        this.bootstrapped = true;
        return super.sync(options);
    }
}

class DelayedReloadDataAccess extends InMemoryDataAccess {
    loadCalls = 0;
    releaseReload!: () => void;
    private readonly reloadGate = new Promise<void>((resolve) => {
        this.releaseReload = resolve;
    });

    override async loadPMState() {
        const call = ++this.loadCalls;
        const snapshot = await super.loadPMState();
        if (call === 2) await this.reloadGate;
        return snapshot;
    }
}

beforeEach(() => localStorage.clear());

it("creates and restores a PM task in isolation without timer transition events", async () => {
    const data = await workStartData();
    await data.startWorkTimer();
    const original = structuredClone(data.store.state.timer);
    const restore = vi.spyOn(data, "setActiveTask");
    const view = await renderWorkStart(data, { withoutBridge: true });
    const listener = vi.fn();
    const unsubscribe = view.current.app.subscribeTimerTransitions(listener);
    await act(async () => { await view.current.pm.createTask("Another task"); });
    expect(restore).toHaveBeenCalledWith("bt1");
    expect(view.current.app.state?.timer).toEqual(original);
    expect(Object.values(view.current.pm.state.tasks).some(task => task.title === "Another task")).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
});

/** Waits for the mount-time PM reads (hydration + staged reload) to settle. */
async function waitForPMSettled(loadSpy: ReturnType<typeof vi.spyOn>) {
    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(2));
}

describe("ProjectManagerContext", () => {
    it("hydrates a default state and persists only the local UI slice", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        // The rendered default shows the General project; the UI slice is saved
        // locally while the server slice is never seeded from a null remote.
        expect(JSON.parse(localStorage.getItem("pm_state_v1")!).ui).toBeTruthy();
        expect(Number(screen.getByTestId("project-count").textContent)).toBeGreaterThan(0);
        expect(await data.loadPMState()).toBeNull();
    });

    it("restores only UI from legacy localStorage while server slices come from DataAccess", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        localStorage.setItem("pm_state_v1", JSON.stringify({ projects: { old: { name: "Old" } }, ui: { search: "saved" } }));
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(JSON.parse(localStorage.getItem("pm_state_v1")!).ui.search).toBe("saved");
        // Legacy localStorage projects are ignored; no server slice is staged.
        expect(await data.loadPMState()).toBeNull();
        expect(Number(screen.getByTestId("project-count").textContent)).toBe(1);
    });

    it("stages PM edits locally and immediately with no debounce and no sync", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const saveSpy = vi.spyOn(data, "savePMState");
        const loadSpy = vi.spyOn(data, "loadPMState");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        await waitForPMSettled(loadSpy);
        const syncBefore = data.syncCalls.length;
        saveSpy.mockClear();
        await act(async () => screen.getByText("add").click());
        // The local stage happens inside the same act: no 750ms debounce timer.
        expect(saveSpy).toHaveBeenCalled();
        expect(await data.loadPMState()).not.toBeNull();
        // PM edits never trigger a sync; only SyncProvider's bootstrap exists.
        expect(data.syncCalls.length).toBe(syncBefore);
        expect(data.syncCalls.filter((c) => c.reason === "bridge")).toHaveLength(0);
    });

    it("keeps a failed PM save in memory across an unrelated revision", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const loadSpy = vi.spyOn(data, "loadPMState");
        const saveSpy = vi.spyOn(data, "savePMState");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        await waitForPMSettled(loadSpy);

        saveSpy.mockRejectedValueOnce(new Error("quota"));
        await act(async () => screen.getByText("add").click());
        await waitFor(() => expect(screen.getByTestId("task-count")).toHaveTextContent("1"));

        await act(async () => {
            await data.updateSettings({ ...data.store.state.settings, work_minutes: 30 });
        });
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("keeps a local PM edit when a stale staged reload finishes", async () => {
        const data = new DelayedReloadDataAccess(makeAppState());
        await data.savePMState({
            ...serverState(["p1"]),
            tasks: { pt1: makePMTask({ id: "pt1", projectId: "p1", estimatePomos: 4 }) },
        });
        render(wrapWithoutBridge(data, <BridgeProbe />));
        await waitFor(() => expect(screen.getByTestId("pm-task-estimate")).toHaveTextContent("4"));
        await waitFor(() => expect(data.loadCalls).toBe(2));

        await act(async () => screen.getByText("estimate-8").click());
        expect(screen.getByTestId("pm-task-estimate")).toHaveTextContent("8");

        await act(async () => {
            data.releaseReload();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(screen.getByTestId("pm-task-estimate")).toHaveTextContent("8");
        expect((await data.loadPMState())?.tasks.pt1?.estimatePomos).toBe(8);
    });

    it("does not seed a default PM state before a successful bootstrap pull", async () => {
        const data = new UninitializedDataAccess(makeAppState());
        const saveSpy = vi.spyOn(data, "savePMState");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        // The default renders but is never staged: hydration does not seed, and
        // the save effect is gated until the store bootstrap initializes.
        expect(saveSpy).not.toHaveBeenCalled();
        expect(await data.loadPMState()).toBeNull();
    });

    it("createProject and createTask update state", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "app-task" });
        const loadSpy = vi.spyOn(data, "loadPMState");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        await waitForPMSettled(loadSpy);
        await act(async () => screen.getByText("add").click());
        await waitFor(() => expect(Number(screen.getByTestId("task-count").textContent)).toBeGreaterThan(0));
    });

    it("creates a task through the General project fallback", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "app-task" });
        const loadSpy = vi.spyOn(data, "loadPMState");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        await waitForPMSettled(loadSpy);
        await act(async () => screen.getByText("quick").click());
        await waitFor(() => expect(Number(screen.getByTestId("task-count").textContent)).toBeGreaterThan(0));
    });
});

function SnapshotProbe() {
    const {
        state,
        captureAgentSnapshot,
        getAgentSnapshot,
        revertAgentSnapshot,
        updateTask,
    } = usePM();
    const [confirmationToken, setConfirmationToken] = useState<string>();
    const [result, setResult] = useState("none");
    const current = state.tasks.pt1;
    return <div>
        <div data-testid="snapshot-title">{current?.title ?? "missing"}</div>
        <div data-testid="snapshot-result">{result}</div>
        <div data-testid="stored-snapshot">{getAgentSnapshot()?.projectId ?? "none"}</div>
        <button onClick={() => { captureAgentSnapshot(); setResult("captured"); }}>capture-snapshot</button>
        <button onClick={() => updateTask("pt1", { title: "Changed" })}>change-snapshot-task</button>
        <button onClick={() => {
            const next = revertAgentSnapshot();
            setResult(next.status);
            if (next.status === "conflicts") setConfirmationToken(next.confirmationToken);
        }}>preview-revert</button>
        <button onClick={() => setResult(revertAgentSnapshot(confirmationToken).status)}>confirm-revert</button>
    </div>;
}

describe("ProjectManagerContext agent snapshot revert", () => {
    it("surfaces timestamp conflicts before restoring through the staged PM state", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({
            projects: serverState(["p1"]).projects,
            tasks: { pt1: makePMTask({ id: "pt1", title: "Original", projectId: "p1" }) },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        render(wrapWithoutBridge(data, <SnapshotProbe />));
        await waitFor(() => expect(screen.getByTestId("snapshot-title")).toHaveTextContent("Original"));

        await act(async () => screen.getByText("capture-snapshot").click());
        expect(screen.getByTestId("stored-snapshot")).toHaveTextContent("p1");
        expect(localStorage.getItem("worktime:agent:projectSnapshot:v1")).not.toBeNull();

        await act(async () => screen.getByText("change-snapshot-task").click());
        expect(screen.getByTestId("snapshot-title")).toHaveTextContent("Changed");
        await act(async () => screen.getByText("preview-revert").click());
        expect(screen.getByTestId("snapshot-result")).toHaveTextContent("conflicts");
        expect(screen.getByTestId("snapshot-title")).toHaveTextContent("Changed");

        await act(async () => screen.getByText("confirm-revert").click());
        expect(screen.getByTestId("snapshot-result")).toHaveTextContent("reverted");
        expect(screen.getByTestId("snapshot-title")).toHaveTextContent("Original");
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1?.title).toBe("Original"));
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
    it("drops local selections absent from the server and keeps the rest", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1", "p2"]));
        localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedProjectIds: ["ghost", "p2"], search: "keep" } }));
        render(
            <TauriCloseProvider>
                <DataProvider dataAccess={data}>
                    <SyncProvider ownerId={OWNER}>
                        <AppStateProvider><ProjectManagerProvider><SelectionProbe /></ProjectManagerProvider></AppStateProvider>
                    </SyncProvider>
                </DataProvider>
            </TauriCloseProvider>,
        );
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(screen.getByTestId("selected").textContent).toBe("p2");
        expect(screen.getByTestId("search").textContent).toBe("keep");
    });

    it("falls back to the first server project when every selection is gone", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1", "p2"]));
        localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedProjectIds: ["ghost"] } }));
        render(
            <TauriCloseProvider>
                <DataProvider dataAccess={data}>
                    <SyncProvider ownerId={OWNER}>
                        <AppStateProvider><ProjectManagerProvider><SelectionProbe /></ProjectManagerProvider></AppStateProvider>
                    </SyncProvider>
                </DataProvider>
            </TauriCloseProvider>,
        );
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(screen.getByTestId("selected").textContent).toBe("p1");
    });
});

describe("ProjectManagerContext reload and lifecycle", () => {
    it("does not restage a suppress-once reload from a storage/sync revision", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1"]));
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        const saveSpy = vi.spyOn(data, "savePMState");
        await data.savePMState(serverState(["p1", "p2"]));
        saveSpy.mockClear();
        act(() => {
            window.dispatchEvent(new StorageEvent("storage", { key: stagingKey(OWNER), newValue: "{}" }));
        });
        await waitFor(() => expect(screen.getByTestId("project-count")).toHaveTextContent("2"));
        // The reloaded slice is never written back into the store.
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("reloads the PM view after a storage/sync revision", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1", "p2", "p3"]));
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        expect(screen.getByTestId("project-count")).toHaveTextContent("3");
        await data.savePMState(serverState(["p1"]));
        act(() => {
            window.dispatchEvent(new StorageEvent("storage", { key: stagingKey(OWNER), newValue: "{}" }));
        });
        await waitFor(() => expect(screen.getByTestId("project-count")).toHaveTextContent("1"));
    });

    it("does not read or write PM state on window focus or visibility", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const loadSpy = vi.spyOn(data, "loadPMState");
        const saveSpy = vi.spyOn(data, "savePMState");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("yes"));
        // Wait for hydration + the post-hydration staged reload to settle so a
        // mount-time read never lands after the clear below.
        await waitForPMSettled(loadSpy);
        loadSpy.mockClear();
        saveSpy.mockClear();
        act(() => window.dispatchEvent(new Event("focus")));
        act(() => document.dispatchEvent(new Event("visibilitychange")));
        // SyncProvider owns lifecycle triggers; PM registers no own listeners,
        // so neither a PM read nor a PM write happens on focus.
        expect(loadSpy).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("preserves the staged PM slice across an app reset", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(serverState(["p1"]));
        const before = await data.loadPMState();
        await data.resetAppState();
        expect(await data.loadPMState()).toEqual(before);
    });
});

function MoveProbe() {
    const { state, moveTaskToStatus, reorderTasks } = usePM();
    const order = (status: TaskStatus) =>
        Object.values(state.tasks)
            .filter((t) => t.status === status)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((t) => t.id)
            .join(",");
    return <div>
        <div data-testid="backlog-order">{order("Backlog")}</div>
        <div data-testid="next-order">{order("Next")}</div>
        <div data-testid="done-order">{order("Done")}</div>
        <button onClick={() => moveTaskToStatus("t2", "Done", 1)}>move-t2-done</button>
        <button onClick={() => moveTaskToStatus("t1", "Next", 1)}>move-t1-next</button>
        <button onClick={() => moveTaskToStatus("t4", "Backlog")}>move-t4-backlog</button>
        <button onClick={() => reorderTasks(["t3", "t1", "t2"], "Backlog")}>reorder-backlog</button>
    </div>;
}

function boardSeed() {
    return {
        projects: serverState(["p1"]).projects,
        tasks: {
            t1: makePMTask({ id: "t1", title: "A", projectId: "p1", status: "Backlog", sortOrder: 0 }),
            t2: makePMTask({ id: "t2", title: "B", projectId: "p1", status: "Backlog", sortOrder: 1 }),
            t3: makePMTask({ id: "t3", title: "C", projectId: "p1", status: "Backlog", sortOrder: 2 }),
            t4: makePMTask({ id: "t4", title: "D", projectId: "p1", status: "Next", sortOrder: 0 }),
            t5: makePMTask({ id: "t5", title: "E", projectId: "p1", status: "Next", sortOrder: 1 }),
            t6: makePMTask({ id: "t6", title: "F", projectId: "p1", status: "Done", sortOrder: 0 }),
            t7: makePMTask({ id: "t7", title: "G", projectId: "p1", status: "Done", sortOrder: 1 }),
        },
        meta: { initializedAt: "2026-01-01T00:00:00Z" },
    };
}

describe("ProjectManagerContext board ordering persistence", () => {
    it("moveTaskToStatus inserts at a target index and persists sibling ordering", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(boardSeed());
        render(wrapWithoutBridge(data, <MoveProbe />));
        await waitFor(() => expect(screen.getByTestId("backlog-order")).toHaveTextContent("t1,t2,t3"));

        await act(async () => screen.getByText("move-t2-done").click());

        // In-memory order reflects the cross-column move at index 1, and the
        // source column keeps its relative ordering.
        expect(screen.getByTestId("done-order").textContent).toBe("t6,t2,t7");
        expect(screen.getByTestId("backlog-order").textContent).toBe("t1,t3");
        // The recomputed sibling ordering is persisted, not just the status.
        await waitFor(async () => {
            const persisted = (await data.loadPMState())?.tasks;
            expect(persisted?.t2?.status).toBe("Done");
            expect(persisted?.t2?.sortOrder).toBe(1);
            expect(persisted?.t6?.sortOrder).toBe(0);
            expect(persisted?.t7?.sortOrder).toBe(2);
            expect(persisted?.t1?.sortOrder).toBe(0);
            expect(persisted?.t3?.sortOrder).toBe(2);
        });
    });

    it("moveTaskToStatus honors a middle index in the target column", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(boardSeed());
        render(wrapWithoutBridge(data, <MoveProbe />));
        await waitFor(() => expect(screen.getByTestId("backlog-order")).toHaveTextContent("t1,t2,t3"));

        await act(async () => screen.getByText("move-t1-next").click());

        expect(screen.getByTestId("next-order").textContent).toBe("t4,t1,t5");
        await waitFor(async () => {
            const persisted = (await data.loadPMState())?.tasks;
            expect(persisted?.t1?.status).toBe("Next");
            expect(persisted?.t1?.sortOrder).toBe(1);
            expect(persisted?.t4?.sortOrder).toBe(0);
            expect(persisted?.t5?.sortOrder).toBe(2);
        });
    });

    it("moveTaskToStatus without an index appends to the target column", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(boardSeed());
        render(wrapWithoutBridge(data, <MoveProbe />));
        await waitFor(() => expect(screen.getByTestId("backlog-order")).toHaveTextContent("t1,t2,t3"));

        await act(async () => screen.getByText("move-t4-backlog").click());

        expect(screen.getByTestId("backlog-order").textContent).toBe("t1,t2,t3,t4");
        await waitFor(async () => {
            const persisted = (await data.loadPMState())?.tasks;
            expect(persisted?.t4?.status).toBe("Backlog");
            expect(persisted?.t4?.sortOrder).toBe(3);
        });
    });

    it("reorderTasks persists within-column ordering", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(boardSeed());
        render(wrapWithoutBridge(data, <MoveProbe />));
        await waitFor(() => expect(screen.getByTestId("backlog-order")).toHaveTextContent("t1,t2,t3"));

        await act(async () => screen.getByText("reorder-backlog").click());

        expect(screen.getByTestId("backlog-order").textContent).toBe("t3,t1,t2");
        await waitFor(async () => {
            const persisted = (await data.loadPMState())?.tasks;
            expect(persisted?.t1?.sortOrder).toBe(1);
            expect(persisted?.t2?.sortOrder).toBe(2);
            expect(persisted?.t3?.sortOrder).toBe(0);
        });
    });
});

describe("ProjectManagerContext waiting flag", () => {
    function WaitingProbe() {
        const { state, updateTask, archiveTask, moveTaskToStatus } = usePM();
        const snapshot = Object.fromEntries(
            Object.values(state.tasks).map((task) => [
                task.id,
                { status: task.status, isArchived: task.isArchived, waiting: task.waiting ?? null },
            ]),
        );
        return <div>
            <div data-testid="waiting-state">{JSON.stringify(snapshot)}</div>
            <button onClick={() => updateTask("pt1", { status: "Done" })}>done-pt1</button>
            <button onClick={() => archiveTask("pt2")}>archive-pt2</button>
            <button onClick={() => updateTask("pt3", { isArchived: true })}>archive-patch-pt3</button>
            <button onClick={() => moveTaskToStatus("pt4", "Done")}>move-done-pt4</button>
            <button onClick={() => updateTask("pt5", { waiting: { type: "agent", since: "2026-11-08T10:00:00.000Z" } })}>set-agent-pt5</button>
            <button onClick={() => updateTask("pt5", { waiting: { type: "person", since: "2026-11-08T10:00:00.000Z" } })}>set-person-pt5</button>
        </div>;
    }

    const since = "2026-11-08T09:00:00.000Z";

    function waitingState() {
        return JSON.parse(screen.getByTestId("waiting-state").textContent || "{}") as Record<string, {
            status: TaskStatus;
            isArchived: boolean;
            waiting: { type: "agent" | "person"; since: string } | null;
        }>;
    }

    function waitingSeed(overrides: Record<string, Partial<PMTask>> = {}) {
        const base: Record<string, Partial<PMTask>> = {
            pt1: { id: "pt1", title: "Done path", waiting: { type: "agent", since } },
            pt2: { id: "pt2", title: "Archive helper", waiting: { type: "agent", since } },
            pt3: { id: "pt3", title: "Archive patch", waiting: { type: "agent", since } },
            pt4: { id: "pt4", title: "Move path", waiting: { type: "agent", since } },
            pt5: { id: "pt5", title: "Persist path" },
        };
        return {
            projects: {},
            tasks: Object.fromEntries(Object.entries({ ...base, ...overrides }).map(([id, patch]) => [id, makePMTask(patch)])),
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        };
    }

    it("normalizes waiting on load and clears it for Done and archived tasks", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(waitingSeed({
            pt1: { id: "pt1", title: "Done path", status: "Done", waiting: { type: "agent", since } },
            pt2: { id: "pt2", title: "Archive helper", status: "In Progress", isArchived: true, waiting: { type: "person", since } },
            pt3: { id: "pt3", title: "Blocked path", status: "Blocked", waiting: { type: "person", since } },
            pt4: { id: "pt4", title: "Malformed path", waiting: { type: "robot", since } as any },
            pt5: { id: "pt5", title: "Bad since", waiting: { type: "agent", since: "not-a-date" } },
        }));
        render(wrapWithoutBridge(data, <WaitingProbe />));
        await waitFor(() => expect(waitingState().pt1?.status).toBe("Done"));
        const state = waitingState();
        expect(state.pt1.waiting).toBeNull();
        expect(state.pt2.waiting).toBeNull();
        expect(state.pt3).toMatchObject({ status: "Blocked", waiting: { type: "person", since } });
        expect(state.pt4.waiting).toBeNull();
        expect(state.pt5.waiting).toBeNull();
    });

    it("clears waiting immediately on every Done and archive write path", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(waitingSeed());
        render(wrapWithoutBridge(data, <WaitingProbe />));
        await waitFor(() => expect(waitingState().pt1?.waiting).toEqual({ type: "agent", since }));

        await act(async () => screen.getByText("done-pt1").click());
        await act(async () => screen.getByText("archive-pt2").click());
        await act(async () => screen.getByText("archive-patch-pt3").click());
        await act(async () => screen.getByText("move-done-pt4").click());

        const state = waitingState();
        expect(state.pt1).toMatchObject({ status: "Done", waiting: null });
        expect(state.pt2).toMatchObject({ isArchived: true, waiting: null });
        expect(state.pt3).toMatchObject({ isArchived: true, waiting: null });
        expect(state.pt4).toMatchObject({ status: "Done", waiting: null });
        await waitFor(async () => {
            const persisted = (await data.loadPMState())?.tasks;
            expect(persisted?.pt1).toMatchObject({ status: "Done", waiting: null });
            expect(persisted?.pt2).toMatchObject({ isArchived: true, waiting: null });
            expect(persisted?.pt3).toMatchObject({ isArchived: true, waiting: null });
            expect(persisted?.pt4).toMatchObject({ status: "Done", waiting: null });
        });
    });

    it("persists a waiting flag and restores it after a provider reload", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(waitingSeed());
        const first = render(wrapWithoutBridge(data, <WaitingProbe />));
        await waitFor(() => expect(waitingState().pt5?.waiting).toBeNull());

        await act(async () => screen.getByText("set-person-pt5").click());
        expect(waitingState().pt5.waiting).toEqual({ type: "person", since: "2026-11-08T10:00:00.000Z" });
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt5?.waiting).toEqual({
            type: "person",
            since: "2026-11-08T10:00:00.000Z",
        }));

        first.unmount();
        render(wrapWithoutBridge(data, <WaitingProbe />));
        await waitFor(() => expect(waitingState().pt5?.waiting).toEqual({
            type: "person",
            since: "2026-11-08T10:00:00.000Z",
        }));
    });

    it("switching the waiting type keeps the original since", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState(waitingSeed());
        render(wrapWithoutBridge(data, <WaitingProbe />));
        await waitFor(() => expect(waitingState().pt5?.waiting).toBeNull());

        await act(async () => screen.getByText("set-agent-pt5").click());
        await act(async () => screen.getByText("set-person-pt5").click());
        expect(waitingState().pt5.waiting).toEqual({ type: "person", since: "2026-11-08T10:00:00.000Z" });
    });
});

describe("StateSyncBridge", () => {
    it("reports reserved/in-flight links, then clears them without creating a second backend task", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({ ...serverState([]), tasks: { pt1: makePMTask({ id: "pt1", title: "Delayed link", estimatePomos: 2 }) } });
        const original = data.createTask.bind(data);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const create = vi.spyOn(data, "createTask").mockImplementation(async (...args) => { await gate; return original(...args); });
        const view = await renderWorkStart(data);
        await waitFor(() => expect(view.current.pm.linkingTaskIds.has("pt1")).toBe(true));
        // A metadata render while reserved cannot claim the task again.
        act(() => view.current.pm.updateTask("pt1", { priority: "High" }));
        expect(create).toHaveBeenCalledOnce();
        await act(async () => { release(); await gate; });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.appTaskId).toBeTruthy());
        await waitFor(() => expect(view.current.pm.linkingTaskIds.size).toBe(0));
        expect(create).toHaveBeenCalledOnce();
        expect(Object.keys(data.store.state.tasks)).toHaveLength(1);
        expect(Object.keys(view.current.pm.state.tasks)).toHaveLength(1);
    });

    it("records create failures, waits for retryLink, then retries successfully", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({ ...serverState([]), tasks: { pt1: makePMTask({ id: "pt1", title: "Retry link" }) } });
        const create = vi.spyOn(data, "createTask").mockRejectedValueOnce(new Error("Create unavailable"));
        const view = await renderWorkStart(data);
        await waitFor(() => expect(view.current.pm.linkFailures.pt1).toBe("Create unavailable"));
        expect(view.current.pm.linkingTaskIds.has("pt1")).toBe(false);
        await act(async () => { view.current.pm.updateTask("pt1", { priority: "High" }); await view.current.app.refresh(); });
        expect(create).toHaveBeenCalledOnce();
        act(() => view.current.pm.retryLink("pt1"));
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.appTaskId).toBeTruthy());
        await waitFor(() => expect(view.current.pm.linkingTaskIds.size).toBe(0));
        expect(view.current.pm.linkFailures.pt1).toBeUndefined();
        expect(create).toHaveBeenCalledTimes(2);
        expect(Object.keys(data.store.state.tasks)).toHaveLength(1);
    });

    it("evicts a cached backend id removed by discard before retrying a failed PM save", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({ ...serverState([]), tasks: { pt1: makePMTask({ id: "pt1", title: "Discard retry" }) } });
        await data.sync({ reason: "manual" });
        const originalSave = data.savePMState.bind(data);
        let rejectLink = true;
        vi.spyOn(data, "savePMState").mockImplementation(async state => {
            if (rejectLink && state.tasks.pt1?.appTaskId) throw new Error("Link save unavailable");
            return originalSave(state);
        });
        const create = vi.spyOn(data, "createTask");
        const view = await renderWorkStart(data);
        await waitFor(() => expect(view.current.pm.linkFailures.pt1).toBe("Link save unavailable"));
        const removedId = Object.keys(data.store.state.tasks)[0];
        await act(async () => { await data.discardPendingChanges(); await view.current.app.refresh(); });
        expect(data.store.state.tasks[removedId]).toBeUndefined();
        rejectLink = false;
        act(() => view.current.pm.retryLink("pt1"));
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.appTaskId).toBeTruthy());
        const linkedId = view.current.pm.state.tasks.pt1.appTaskId!;
        expect(linkedId).not.toBe(removedId);
        expect(data.store.state.tasks[linkedId]).toBeDefined();
        expect(create).toHaveBeenCalledTimes(2);
    });

    it("reuses the created backend id when retrying a failed PM-link save", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({ ...serverState([]), tasks: { pt1: makePMTask({ id: "pt1", title: "Save retry" }) } });
        const originalSave = data.savePMState.bind(data);
        let rejectLink = true;
        vi.spyOn(data, "savePMState").mockImplementation(async (state) => {
            if (rejectLink && state.tasks.pt1?.appTaskId) throw new Error("Link save unavailable");
            return originalSave(state);
        });
        const create = vi.spyOn(data, "createTask");
        const view = await renderWorkStart(data);
        await waitFor(() => expect(view.current.pm.linkFailures.pt1).toBe("Link save unavailable"));
        expect(create).toHaveBeenCalledOnce();
        rejectLink = false;
        act(() => view.current.pm.retryLink("pt1"));
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.appTaskId).toBeTruthy());
        expect(create).toHaveBeenCalledOnce();
        expect(Object.keys(data.store.state.tasks)).toHaveLength(1);
        expect(Object.keys(view.current.pm.state.tasks)).toHaveLength(1);
    });
    it.each([false, true])("baselines a persisted running Work timer without advancing Backlog (bridge mounts after load=%s)", async (mountAfterLoad) => {
        const data = await workStartData();
        data.store.state.timer = makeActiveTimer({ task_id: "bt1" });
        let current!: WorkStartControls;
        function BaselineBridge() {
            const [mounted, setMounted] = useState(!mountAfterLoad);
            return <>
                <button onClick={() => setMounted(true)}>mount-bridge</button>
                {mounted && <StateSyncBridge />}
            </>;
        }
        render(wrapWithoutBridge(data, <>
            <WorkStartProbe onChange={(value) => { current = value; }} />
            <BaselineBridge />
        </>));
        expect(current.app.state).toBeNull();
        await waitFor(() => {
            expect(current.app.state?.timer?.task_id).toBe("bt1");
            expect(current.pm.state.tasks.pt1?.status).toBe("Backlog");
        });
        if (mountAfterLoad) await act(async () => { screen.getByText("mount-bridge").click(); });
        await act(async () => { await current.app.refresh(); });
        expect(current.pm.state.tasks.pt1.status).toBe("Backlog");
        expect((await data.loadPMState())?.tasks.pt1.status).toBe("Backlog");
    });

    it("preserves persisted agent waiting through the running baseline and rerenders, then advances on stop/start", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { bt1: workStartBackend() }, active_task: "bt1",
            timer: makeActiveTimer({ task_id: "bt1" }),
        }));
        await data.savePMState({
            projects: {},
            tasks: { pt1: makePMTask({
                id: "pt1", title: "Work task", appTaskId: "bt1", estimatePomos: 4,
                status: "Backlog", waiting: { type: "agent", since: "2026-01-01T00:00:00Z" },
            }) },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const expected = { status: "Backlog", waiting: { type: "agent", since: "2026-01-01T00:00:00Z" } };
        const view = await renderWorkStart(data);
        expect(view.current.pm.state.tasks.pt1).toMatchObject(expected);
        await act(async () => { view.current.pm.updateTask("pt1", { title: "Renamed work task" }); });
        await act(async () => { await view.current.app.refresh(); });
        await act(async () => { view.current.app.pauseTimer(); });
        await waitFor(() => expect(view.current.app.state?.timer?.paused).toBe(true));
        await act(async () => { view.current.app.resumeTimer(); });
        await waitFor(() => expect(view.current.app.state?.timer?.paused).toBe(false));
        expect(view.current.pm.state.tasks.pt1).toMatchObject(expected);
        expect((await data.loadPMState())?.tasks.pt1).toMatchObject(expected);

        await act(async () => { await view.current.app.stopWork(); });
        await waitFor(() => expect(view.current.app.state?.timer).toBeNull());
        expect(view.current.pm.state.tasks.pt1).toMatchObject(expected);
        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1).toMatchObject({ status: "In Progress", waiting: null }));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1).toMatchObject({ status: "In Progress", waiting: null }));
    });

    it.each<TaskStatus>(["Backlog", "Next", "In Progress", "Blocked", "Done"])("applies work-start status rules to %s through the real providers", async (status) => {
        const data = await workStartData(status);
        const view = await renderWorkStart(data);
        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        const expected = status === "Backlog" || status === "Next" ? "In Progress" : status;
        await waitFor(() => expect(screen.getByTestId("work-start-status")).toHaveTextContent(expected));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1.status).toBe(expected));
    });

    it("clears waiting but keeps Blocked when work starts on a waiting Blocked task", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { bt1: workStartBackend() }, active_task: "bt1",
        }));
        const since = "2026-11-08T09:00:00.000Z";
        await data.savePMState({
            projects: {},
            tasks: { pt1: makePMTask({
                id: "pt1", title: "Blocked task", appTaskId: "bt1", status: "Blocked", estimatePomos: 4,
                waiting: { type: "agent", since },
            }) },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const view = await renderWorkStart(data);
        expect(view.current.pm.state.tasks.pt1).toMatchObject({ status: "Blocked", waiting: { type: "agent", since } });

        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1).toMatchObject({ status: "Blocked", waiting: null }));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1).toMatchObject({ status: "Blocked", waiting: null }));
    });

    it("covers timer-page startWork and persists the status through savePMState and provider reload", async () => {
        const data = await workStartData();
        const saveSpy = vi.spyOn(data, "savePMState");
        const view = await renderWorkStart(data);
        saveSpy.mockClear();
        await act(async () => { await view.current.app.startWork(); });
        await waitFor(() => expect(screen.getByTestId("work-start-status")).toHaveTextContent("In Progress"));
        await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
            tasks: expect.objectContaining({ pt1: expect.objectContaining({ status: "In Progress" }) }),
        })));
        view.unmount();
        // Reload without the observer so the assertion can only pass because
        // savePMState stored the advanced status before the first unmount.
        await renderWorkStart(data, { withoutBridge: true });
        expect(screen.getByTestId("work-start-status")).toHaveTextContent("In Progress");
    });

    it("preserves a manual override and new waiting flag through pause/resume, then re-applies after stop/start", async () => {
        const data = await workStartData();
        const view = await renderWorkStart(data);
        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.status).toBe("In Progress"));
        const waiting = { type: "person" as const, since: new Date().toISOString() };
        await act(async () => { view.current.pm.updateTask("pt1", { status: "Next", waiting }); });
        await act(async () => { view.current.app.pauseTimer(); });
        await waitFor(() => expect(view.current.app.state?.timer?.paused).toBe(true));
        await act(async () => { view.current.app.resumeTimer(); });
        await waitFor(() => expect(view.current.app.state?.timer?.paused).toBe(false));
        expect(view.current.pm.state.tasks.pt1).toMatchObject({ status: "Next", waiting });

        await act(async () => { await view.current.app.stopWork(); });
        await waitFor(() => expect(view.current.app.state?.timer).toBeNull());
        expect(view.current.pm.state.tasks.pt1.status).toBe("Next");
        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1).toMatchObject({ status: "In Progress", waiting: null }));
    });

    it("advances a late-arriving PM row exactly once for a pending occupancy", async () => {
        // Timer and task metadata can arrive in separate provider snapshots.
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "bt1" });
        await data.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        const view = await renderWorkStart(data);
        expect(Object.keys(view.current.pm.state.tasks)).toHaveLength(0);
        // Open a new occupancy after the baseline, before its PM row arrives.
        await act(async () => {
            data.store.state.timer = makeActiveTimer({ task_id: "bt1" });
            await view.current.app.refresh();
        });
        expect(view.current.app.state?.timer?.task_id).toBe("bt1");
        await act(async () => {
            await data.createTask("Late metadata", 4);
            await view.current.app.refresh();
        });
        await waitFor(() => {
            const tasks = Object.values(view.current.pm.state.tasks);
            expect(tasks).toHaveLength(1);
            expect(tasks[0]).toMatchObject({ appTaskId: "bt1", status: "In Progress" });
        });
        const pmId = Object.values(view.current.pm.state.tasks)[0].id;
        await act(async () => { view.current.pm.updateTask(pmId, { status: "Backlog" }); });
        await act(async () => { await view.current.app.refresh(); });
        expect(view.current.pm.state.tasks[pmId].status).toBe("Backlog");
    });

    it("observes task switches and new window ids without downgrading the outgoing task", async () => {
        const data = await workStartData();
        data.store.state.tasks.bt2 = workStartBackend({ id: "bt2", name: "Blocked task" });
        const pm = (await data.loadPMState())!;
        await data.savePMState({ ...pm, tasks: { ...pm.tasks, pt2: makePMTask({
            id: "pt2", title: "Blocked task", appTaskId: "bt2", status: "Blocked", estimatePomos: 4,
            waiting: { type: "agent", since: "2026-01-01T00:00:00Z" },
        }) } });
        const view = await renderWorkStart(data);
        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.status).toBe("In Progress"));
        // Feed the snapshots #173 will produce, without depending on its engine
        // changes being present in this lane's worktree.
        const window = view.current.app.state!.timer!;
        await act(async () => {
            data.store.state.timer = { ...window, task_id: "bt2" };
            await view.current.app.refresh();
        });
        await waitFor(() => expect(view.current.pm.state.tasks.pt2).toMatchObject({ status: "Blocked", waiting: null }));
        expect(view.current.pm.state.tasks.pt1.status).toBe("In Progress");
        await act(async () => { view.current.pm.updateTask("pt1", { status: "Next" }); });
        await act(async () => {
            data.store.state.timer = { ...window, task_id: "bt1", window_started_at: "2026-11-08T12:00:00.000Z" };
            await view.current.app.refresh();
        });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.status).toBe("In Progress"));
        await act(async () => { view.current.pm.updateTask("pt1", { status: "Next" }); });
        await act(async () => {
            data.store.state.timer = { ...window, window_started_at: "2026-11-08T13:00:00.000Z" };
            await view.current.app.refresh();
        });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.status).toBe("In Progress"));
        expect(view.current.pm.state.tasks.pt2.status).toBe("Blocked");
    });

    it("preserves status and a bridge progress patch emitted in the same render as work starts", async () => {
        const now = new Date(Date.now() - 2 * 60_000);
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { bt1: workStartBackend({ completed_pomodoros: 0.5 }) }, active_task: "bt1",
        }), { now: () => now });
        await data.savePMState({ projects: {}, tasks: { pt1: makePMTask({
            id: "pt1", title: "Work task", appTaskId: "bt1", estimatePomos: 4,
            workedPomos: 0.5, timeSpentMinutes: 12.5,
        }) }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        const view = await renderWorkStart(data);
        await act(async () => { await view.current.app.startTaskWork("bt1"); });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1).toMatchObject({
            status: "In Progress", estimatePomos: 4, workedPomos: 0.58, timeSpentMinutes: 14.5,
        }));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1).toMatchObject({
            status: "In Progress", workedPomos: 0.58, timeSpentMinutes: 14.5,
        }));
    });

    it.each(["patch-first", "start-first"])("composes link/estimate/progress and work-start patches in one tick (%s)", async (order) => {
        const data = await workStartData();
        const view = await renderWorkStart(data, { withoutBridge: true });
        const at = "2026-11-08T12:00:00.000Z";
        await act(async () => {
            const { updateTask, recordWorkStart } = view.current.pm;
            const patch = () => updateTask("pt1", { appTaskId: "new-link", estimatePomos: 7, workedPomos: 1.5, dueDate: "2026-11-09" });
            if (order === "patch-first") patch();
            recordWorkStart("pt1", at);
            if (order === "start-first") patch();
        });
        expect(view.current.pm.state.tasks.pt1).toMatchObject({
            status: "In Progress", appTaskId: "new-link", estimatePomos: 7, workedPomos: 1.5, dueDate: "2026-11-09",
        });
        if (order === "patch-first") expect(view.current.pm.state.tasks.pt1.updatedAt).toBe(at);
    });

    it("avoids PM writes and timestamp changes for unchanged or missing work-start rows", async () => {
        const data = await workStartData("Blocked");
        const loadSpy = vi.spyOn(data, "loadPMState");
        const view = await renderWorkStart(data, { withoutBridge: true });
        await waitForPMSettled(loadSpy);
        const saveSpy = vi.spyOn(data, "savePMState");
        const original = view.current.pm.state;
        await act(async () => {
            view.current.pm.recordWorkStart("pt1");
            view.current.pm.recordWorkStart("missing");
        });
        expect(view.current.pm.state).toBe(original);
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("routes linked inspector Start through startTaskWork with the existing id", async () => {
        const data = await workStartData();
        const view = await renderWorkStart(data, { inspector: true });
        await act(async () => { view.current.pm.setSelectedTask("pt1"); });
        const startSpy = vi.spyOn(view.current.app, "startTaskWork");
        const createSpy = vi.spyOn(data, "createTask");
        await act(async () => { screen.getByRole("button", { name: "Start", exact: true }).click(); });
        expect(startSpy).toHaveBeenCalledExactlyOnceWith("bt1");
        await waitFor(() => expect(screen.getByTestId("work-start-status")).toHaveTextContent("In Progress"));
        expect(view.current.app.state?.timer?.task_id).toBe("bt1");
        expect(view.current.pm.state.tasks.pt1.appTaskId).toBe("bt1");
        expect(screen.getByTestId("inspector-location")).toHaveTextContent("/");
        expect(createSpy).not.toHaveBeenCalled();
    });

    it("advances an initially unlinked inspector task after the bridge baselines and clears waiting", async () => {
        // The bridge mounts and records its empty-occupant baseline before the
        // user can start work. Legacy auto-linking then links the PM row, so
        // the Start itself is a NEW occupancy and must advance the status.
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "created-backend" });
        const since = "2026-11-08T09:00:00.000Z";
        await data.savePMState({ projects: {}, tasks: { pt1: makePMTask({
            id: "pt1", title: "Inspector task", estimatePomos: 3, waiting: { type: "agent", since },
        }) }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        const view = await renderWorkStart(data, { inspector: true });
        await waitFor(() => expect(view.current.pm.state.tasks.pt1).toMatchObject({
            status: "Backlog", waiting: { type: "agent", since },
        }));
        await waitFor(() => expect(view.current.pm.state.tasks.pt1.appTaskId).toBe("created-backend"));
        await act(async () => { view.current.pm.setSelectedTask("pt1"); });
        const startSpy = vi.spyOn(view.current.app, "startTaskWork");
        await act(async () => { screen.getByRole("button", { name: "Start", exact: true }).click(); });
        expect(startSpy).toHaveBeenCalledExactlyOnceWith("created-backend");
        await waitFor(() => expect(screen.getByTestId("work-start-status")).toHaveTextContent("In Progress"));
        await waitFor(() => expect(view.current.pm.state.tasks.pt1).toMatchObject({ status: "In Progress", waiting: null }));
        expect(view.current.app.state?.timer?.task_id).toBe("created-backend");
        expect(screen.getByTestId("inspector-location")).toHaveTextContent("/");
    });

    it("creates and links an unlinked inspector task before starting work without an observer", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "created-backend" });
        await data.savePMState({ projects: {}, tasks: { pt1: makePMTask({ id: "pt1", title: "Inspector task", estimatePomos: 3 }) }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        const view = await renderWorkStart(data, { inspector: true, withoutBridge: true });
        await act(async () => { view.current.pm.setSelectedTask("pt1"); });
        const startSpy = vi.spyOn(view.current.app, "startTaskWork");
        const createSpy = vi.spyOn(data, "createTask");
        await act(async () => { screen.getByRole("button", { name: "Start", exact: true }).click(); });
        expect(startSpy).toHaveBeenCalledExactlyOnceWith("created-backend");
        expect(createSpy).toHaveBeenCalledExactlyOnceWith("Inspector task", 3);
        expect(view.current.app.state?.timer?.task_id).toBe("created-backend");
        expect(view.current.pm.state.tasks.pt1.appTaskId).toBe("created-backend");
        expect(screen.getByTestId("inspector-location")).toHaveTextContent("/");
    });

    it("creates PM metadata for backend tasks", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { bt1: { id: "bt1", name: "Synced task", target_pomodoros: 4, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } } }));
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(screen.getByTestId("task-count")).toHaveTextContent("1"));
    });

    it("links a batch of unlinked PM tasks without creating backend or PM duplicates", async () => {
        const ids = ["generated-task-1", "generated-task-2", "generated-task-3"];
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => ids.shift()! });
        await data.savePMState({
            projects: {},
            tasks: {
                pt1: makePMTask({ id: "pt1", title: "Schedule stakeholder demo", estimatePomos: 2 }),
                pt2: makePMTask({ id: "pt2", title: "Read one technical chapter", estimatePomos: 2 }),
                pt3: makePMTask({ id: "pt3", title: "Replace air filter", estimatePomos: 1 }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const createTaskSpy = vi.spyOn(data, "createTask");

        render(wrap(data, <PMProbe />));

        await waitFor(async () => {
            const tasks = (await data.loadPMState())?.tasks;
            expect(Object.values(tasks ?? {}).map((task) => task.appTaskId).sort()).toEqual([
                "generated-task-1",
                "generated-task-2",
                "generated-task-3",
            ]);
        });
        expect(createTaskSpy).toHaveBeenCalledTimes(3);
        expect(Object.keys(data.store.state.tasks).sort()).toEqual([
            "generated-task-1",
            "generated-task-2",
            "generated-task-3",
        ]);
        expect(Object.keys((await data.loadPMState())?.tasks ?? {})).toEqual(["pt1", "pt2", "pt3"]);
    });

    it("marks PM tasks Done when the backend task completes and clears waiting", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { bt1: { id: "bt1", name: "Done task", target_pomodoros: 2, completed_pomodoros: 2, created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-05T00:00:00Z", break_skips: 0, archived: false } } }));
        await data.savePMState({ projects: {}, tasks: { pt1: { id: "pt1", title: "Done task", projectId: null, status: "In Progress", priority: "Medium", timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [], sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", appTaskId: "bt1", relatedTo: [], waiting: { type: "agent", since: "2026-11-08T09:00:00.000Z" } } }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        render(wrap(data, <PMProbe />));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1?.status).toBe("Done"));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1?.waiting).toBeNull());
    });

    it("propagates divergent estimates with N local writes and one bridge sync", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: {
                bt1: { id: "bt1", name: "A", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false },
                bt2: { id: "bt2", name: "B", target_pomodoros: 3, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false },
            },
        }));
        await data.savePMState({
            projects: {},
            tasks: {
                pt1: makePMTask({ id: "pt1", title: "A", appTaskId: "bt1", estimatePomos: 5 }),
                pt2: makePMTask({ id: "pt2", title: "B", appTaskId: "bt2", estimatePomos: 7 }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const setTargetSpy = vi.spyOn(data, "setTaskTarget");
        render(wrap(data, <PMProbe />));
        await waitFor(() => expect(data.store.state.tasks.bt1?.target_pomodoros).toBe(5));
        expect(data.store.state.tasks.bt2?.target_pomodoros).toBe(7);
        expect(setTargetSpy).toHaveBeenCalledTimes(2);
        expect(data.syncCalls.filter((c) => c.reason === "bridge")).toHaveLength(1);
    });

    it("preserves an estimate below completed overage in both PM and backend state", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: {
                bt1: { id: "bt1", name: "Over estimate", target_pomodoros: 4, completed_pomodoros: 3, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false },
            },
        }));
        await data.savePMState({
            projects: {},
            tasks: {
                pt1: makePMTask({ id: "pt1", title: "Over estimate", appTaskId: "bt1", estimatePomos: 2 }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });

        render(wrap(data, <PMProbe />));

        await waitFor(() => expect(data.store.state.tasks.bt1?.target_pomodoros).toBe(2));
        await waitFor(async () => {
            const pmTask = (await data.loadPMState())?.tasks.pt1;
            expect(pmTask?.estimatePomos).toBe(2);
            expect(pmTask?.workedPomos).toBe(3);
        });
    });

    it("keeps pending targets recoverable after a failed write and propagates a later edit", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { bt1: { id: "bt1", name: "A", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        await data.savePMState({
            projects: {},
            tasks: { pt1: makePMTask({ id: "pt1", title: "A", appTaskId: "bt1", estimatePomos: 5 }) },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const originalSetTarget = data.setTaskTarget.bind(data);
        const setTargetSpy = vi.spyOn(data, "setTaskTarget");
        let offline = true;
        setTargetSpy.mockImplementation(async (taskId: string, target: number) => {
            if (offline) throw new Error("offline");
            return originalSetTarget(taskId, target);
        });
        render(wrap(data, <BridgeProbe />));
        // The offline attempts leave the backend target unchanged and never
        // reach the sync action; the pending entry is cleared, not stuck.
        await waitFor(() => expect(setTargetSpy).toHaveBeenCalledWith("bt1", 5));
        expect(data.store.state.tasks.bt1?.target_pomodoros).toBe(2);
        expect(data.syncCalls.filter((c) => c.reason === "bridge")).toHaveLength(0);
        // Once the write path recovers, a later edit stages and syncs once.
        offline = false;
        await act(async () => screen.getByText("estimate-8").click());
        await waitFor(() => expect(data.store.state.tasks.bt1?.target_pomodoros).toBe(8));
        expect(setTargetSpy).toHaveBeenCalledWith("bt1", 8);
        expect(data.syncCalls.filter((c) => c.reason === "bridge")).toHaveLength(1);
    });

    it("propagates an estimate edited while a propagation batch is in flight", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { bt1: { id: "bt1", name: "A", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        await data.savePMState({
            projects: {},
            tasks: { pt1: makePMTask({ id: "pt1", title: "A", appTaskId: "bt1", estimatePomos: 5 }) },
            meta: { initializedAt: "2026-01-01T00:00:00Z" },
        });
        const originalSetTarget = data.setTaskTarget.bind(data);
        const setTargetSpy = vi.spyOn(data, "setTaskTarget");
        let releaseFirst!: (result: Awaited<ReturnType<typeof originalSetTarget>>) => void;
        const firstGate = new Promise<Awaited<ReturnType<typeof originalSetTarget>>>((resolve) => {
            releaseFirst = resolve;
        });
        let gateReleased = false;
        setTargetSpy.mockImplementation(async (taskId: string, target: number) => {
            if (!gateReleased) {
                gateReleased = true;
                return firstGate;
            }
            return originalSetTarget(taskId, target);
        });
        render(wrap(data, <BridgeProbe />));
        // The first batch is now awaiting the gated write for bt1=5.
        await waitFor(() => expect(setTargetSpy).toHaveBeenCalledWith("bt1", 5));
        // The user edits the estimate while that batch is still in flight. The
        // bail-out marks the batch dirty so its completion schedules one more
        // pass; the edit must not sit unpropagated.
        await act(async () => screen.getByText("estimate-8").click());
        await act(async () => {
            releaseFirst(await originalSetTarget("bt1", 5));
        });
        await waitFor(() => expect(data.store.state.tasks.bt1?.target_pomodoros).toBe(8));
        expect(setTargetSpy).toHaveBeenCalledWith("bt1", 8);
        // The original batch plus the follow-up batch each pushed exactly once.
        expect(data.syncCalls.filter((c) => c.reason === "bridge")).toHaveLength(2);
    });
});
