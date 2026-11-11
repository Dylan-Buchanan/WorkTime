import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PMTask } from "../../state/types";
import { AppStateProvider } from "../../state/AppStateContext";
import { DataProvider } from "../../state/DataContext";
import { ProjectManagerProvider, usePM } from "../../state/ProjectManagerContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import { TaskInspector } from "./TaskInspector";

const drag = vi.hoisted(() => ({ end: undefined as ((event: DragEndEvent) => void) | undefined }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@dnd-kit/core")>();
    return {
        ...actual,
        DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
            drag.end = props.onDragEnd;
            return <actual.DndContext {...props} />;
        },
    };
});

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

async function renderInspector(data: InMemoryDataAccess, children?: React.ReactNode) {
    localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedTaskId: "pt1" } }));
    const view = render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <MemoryRouter initialEntries={["/projects"]}>
                                <TaskInspector />
                                {children}
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

beforeEach(() => {
    localStorage.clear();
    drag.end = undefined;
});

describe("TaskInspector checklist", () => {
    const openA = { id: "a", title: "Open A", done: false };
    const openB = { id: "b", title: "Open B", done: false };
    const openC = { id: "e", title: "Open C", done: false };
    const doneA = { id: "c", title: "Done A", done: true };
    const doneB = { id: "d", title: "Done B", done: true };
    const checklist = [openA, doneA, openB, doneB, openC];

    async function drop(active: string, over: string) {
        await act(async () => drag.end!({ active: { id: active }, over: { id: over } } as DragEndEvent));
    }

    async function expectRows(...titles: string[]) {
        expect(await screen.findAllByRole("checkbox")).toHaveLength(titles.length);
        const rows = await Promise.all(titles.map((name) => screen.findByRole("checkbox", { name })));
        expect(await screen.findAllByRole("checkbox")).toEqual(rows);
    }

    it("renders one item per zone with a divider and without the sortable surface", async () => {
        await renderInspector(await seededData({ checklist: [doneA, openA] }));
        await expectRows(openA.title, doneA.title);
        expect(await screen.findByRole("separator")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
        expect(drag.end).toBeUndefined();
    });

    it("keeps checkbox and add actions independent of the stored drag order", async () => {
        const data = await seededData({ checklist: [openA, openB, openC, doneA] });
        await renderInspector(data);
        const stored = async () => (await data.loadPMState())?.tasks.pt1.checklist;
        const handle = await screen.findByRole("button", { name: "Reorder Open B" });
        await act(async () => handle.click());
        expect(await stored()).toEqual([openA, openB, openC, doneA]);

        await act(async () => (await screen.findByRole("checkbox", { name: openB.title })).click());
        const tickedB = { ...openB, done: true };
        await waitFor(async () => expect(await stored()).toEqual([openA, tickedB, openC, doneA]));
        await expectRows(openA.title, openC.title, openB.title, doneA.title);

        const input = screen.getByPlaceholderText("Add checklist item");
        fireEvent.change(input, { target: { value: "New step" } });
        await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
        const added = expect.objectContaining({ title: "New step", done: false });
        await waitFor(async () => expect(await stored()).toEqual([openA, tickedB, openC, added, doneA]));

        await act(async () => (await screen.findByRole("checkbox", { name: openB.title })).click());
        await expectRows(openA.title, openB.title, openC.title, "New step", doneA.title);

        await drop(openB.id, openC.id);
        await waitFor(async () => expect(await stored()).toEqual([openA, openC, openB, added, doneA]));
        await act(async () => (await screen.findByRole("checkbox", { name: doneA.title })).click());
        await expectRows(openA.title, openC.title, openB.title, "New step", doneA.title);
        await waitFor(async () => expect(await stored()).toEqual([openA, openC, openB, added, { ...doneA, done: false }]));
    });

    it.each([{ status: "Done" as const }, { isArchived: true }])("persists both zone orders without changing task metadata for %j", async (patch) => {
        const data = await seededData({ ...patch, checklist });
        const original = (await data.loadPMState())!.tasks.pt1;
        const view = await renderInspector(data);
        await screen.findByRole("button", { name: "Reorder Done A" });
        const updated = screen.getByText(/^Updated /).textContent;

        await drop(openA.id, doneB.id);
        await drop(openA.id, "unknown");
        expect((await data.loadPMState())!.tasks.pt1).toEqual(original);

        await drop(openA.id, openC.id);
        await drop(doneB.id, doneA.id);
        const reordered = [openB, openC, openA, doneB, doneA];
        await waitFor(async () => expect((await data.loadPMState())!.tasks.pt1).toEqual({ ...original, checklist: reordered }));
        expect(screen.getByText(/^Updated /)).toHaveTextContent(updated!);

        view.unmount();
        await renderInspector(data);
        await expectRows(...reordered.map((item) => item.title));
    });

    it("ignores a drag end from an inspector whose selected task changed", async () => {
        const data = await seededData({ checklist });
        const original = (await data.loadPMState())!;
        await data.savePMState({ ...original, tasks: { ...original.tasks, pt2: task({ id: "pt2", title: "Second task", checklist }) } });
        function SelectOtherTask() {
            const { setSelectedTask } = usePM();
            return <>
                <button onClick={() => setSelectedTask("pt1")}>Select first task</button>
                <button onClick={() => setSelectedTask("pt2")}>Select second task</button>
            </>;
        }
        await renderInspector(data, <SelectOtherTask />);
        await screen.findByRole("button", { name: "Reorder Open A" });
        const oldDragEnd = drag.end!;
        await act(async () => screen.getByRole("button", { name: "Select second task" }).click());
        await screen.findByText("Second task");
        await act(async () => oldDragEnd({ active: { id: openA.id }, over: { id: openB.id } } as DragEndEvent));
        await act(async () => screen.getByRole("button", { name: "Select first task" }).click());
        await screen.findByText("Task");
        await act(async () => oldDragEnd({ active: { id: openA.id }, over: { id: openB.id } } as DragEndEvent));
        const saved = (await data.loadPMState())!;
        expect(saved.tasks.pt1.checklist).toEqual(checklist);
        expect(saved.tasks.pt2.checklist).toEqual(checklist);
    });
});

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


it("disables Inspector Start while pending and creates only once on a double click", async () => {
    const data = await seededData();
    const original = data.createTask.bind(data);
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const create = vi.spyOn(data, "createTask").mockImplementation(async (...args) => { await gate; return original(...args); });
    await renderInspector(data);
    const start = screen.getByRole("button", { name: "Start" });
    act(() => { start.click(); start.click(); });
    expect(start).toBeDisabled();
    expect(create).toHaveBeenCalledOnce();
    await act(async () => { release(); });
    await waitFor(() => expect(data.store.state.timer?.kind).toBe("Work"));
    expect(Object.keys(data.store.state.tasks)).toHaveLength(1);
});

it("refuses Inspector Start during a break before creating or linking anything", async () => {
    const data = await seededData();
    const active = (await data.createTask("Existing", 1)).value;
    await data.setActiveTask(active.id);
    await data.startBreakTimer();
    const create = vi.spyOn(data, "createTask");
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
        await renderInspector(data);
        await act(async () => screen.getByRole("button", { name: "Start" }).click());
        expect(create).not.toHaveBeenCalled();
        expect((await data.loadPMState())!.tasks.pt1.appTaskId).toBeUndefined();
        expect(warn).toHaveBeenCalledWith("Failed to create timer task", expect.objectContaining({ message: "A break is running" }));
    } finally { warn.mockRestore(); }
});
