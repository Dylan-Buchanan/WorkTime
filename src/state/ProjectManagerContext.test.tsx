import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { AppStateProvider } from "./AppStateContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import StateSyncBridge from "./StateSyncBridge";
import { DataProvider } from "./DataContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { SyncOptions, SyncResult } from "../lib/data/DataAccess";
import { stagingKey } from "../lib/data/staging/LocalStagingStore";
import { makeAppState } from "../test/mockTauri";
import type { PMTask, TaskPriority, TaskStatus } from "./types";

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

beforeEach(() => localStorage.clear());

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

describe("StateSyncBridge", () => {
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

    it("marks PM tasks Done when the backend task completes", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { bt1: { id: "bt1", name: "Done task", target_pomodoros: 2, completed_pomodoros: 2, created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-05T00:00:00Z", break_skips: 0, archived: false } } }));
        await data.savePMState({ projects: {}, tasks: { pt1: { id: "pt1", title: "Done task", projectId: null, status: "In Progress", priority: "Medium", timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [], sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", appTaskId: "bt1", relatedTo: [] } }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        render(wrap(data, <PMProbe />));
        await waitFor(async () => expect((await data.loadPMState())?.tasks.pt1?.status).toBe("Done"));
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
