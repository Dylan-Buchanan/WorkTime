import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { TimerPanel } from "./TimerPanel";
import { AppStateProvider, useAppState } from "../state/AppStateContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider, usePM } from "../state/ProjectManagerContext";
import { HabitProvider } from "../state/HabitContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { normalizeProjectSchedule } from "../lib/projectSchedule";
import { toLocalDateKey } from "../lib/timer";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";
import type { AppStateData, PMTask, Project, Task } from "../state/types";

vi.mock("../hooks/useSounds", () => ({
    useSounds: () => ({ play: () => {} }),
}));

const OWNER = "timer-panel-owner";
const DAILY_RULES = "Includes no due date and due today/overdue. Projects must be workable today. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.";

function makePMTask(overrides: Partial<PMTask>): PMTask {
    return {
        id: "pm-task",
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
        ...overrides,
    };
}

function futureDateKey(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return toLocalDateKey(date);
}

function makeAppTask(id: string, name: string): Task {
    return {
        id,
        name,
        target_pomodoros: 2,
        completed_pomodoros: 0,
        created_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
        break_skips: 0,
        archived: false,
    };
}

function makeProject(id: string, workableDays?: Project["workableDays"]): Project {
    return {
        id,
        name: id,
        color: "#10B981",
        isArchived: false,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...normalizeProjectSchedule({ workableDays }),
    };
}

const SelectionProbe = () => {
    const { state } = usePM();
    return <span hidden data-testid="pm-selected-task">{state.ui.selectedTaskId ?? ""}</span>;
};

const ActiveTaskSwitcher: React.FC<{ taskId: string }> = ({ taskId }) => {
    const { setActiveTask } = useAppState();
    return <button onClick={() => void setActiveTask(taskId)}>Switch active timer task</button>;
};

const SelectedTaskActions = () => {
    const { state, updateTask } = usePM();
    const id = state.ui.selectedTaskId;
    return id ? <>
        <button onClick={() => updateTask(id, { status: "Done" })}>Complete selected PM task</button>
        <button onClick={() => updateTask(id, { isArchived: true })}>Archive selected PM task</button>
    </> : null;
};

function wrap(data: InMemoryDataAccess, switchTaskId?: string, children?: React.ReactNode) {
    return (
        <MemoryRouter>
            <TauriCloseProvider>
                <DataProvider dataAccess={data}>
                    <SyncProvider ownerId={OWNER}>
                        <AppStateProvider>
                            <ProjectManagerProvider>
                                <HabitProvider>
                                    <SelectionProbe />
                                    {children}
                                    <SelectedTaskActions />
                                    {switchTaskId && <ActiveTaskSwitcher taskId={switchTaskId} />}
                                    <TimerPanel />
                                </HabitProvider>
                            </ProjectManagerProvider>
                        </AppStateProvider>
                    </SyncProvider>
                </DataProvider>
            </TauriCloseProvider>
        </MemoryRouter>
    );
}

async function renderWithTasks(tasks: Record<string, PMTask>, projects: Record<string, Project> = {}, appState?: Partial<AppStateData>) {
    const data = new InMemoryDataAccess(makeAppState(appState));
    await data.savePMState({
        projects,
        tasks,
        meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
    });
    render(wrap(data));
    return data;
}

beforeEach(() => localStorage.clear());

type HandoffControls = { app: ReturnType<typeof useAppState>; pm: ReturnType<typeof usePM> };
function HandoffProbe({ onChange }: { onChange: (value: HandoffControls) => void }) {
    const app = useAppState();
    const pm = usePM();
    useLayoutEffect(() => onChange({ app, pm }), [app, pm, onChange]);
    return null;
}
async function setupHandoff(options: { paused?: boolean; unlinked?: boolean; noTimer?: boolean; kind?: "Work" | "ShortBreak"; missingOccupant?: boolean } = {}) {
    const a = makeAppTask("a", "Task A");
    const b = makeAppTask("b", "Task B");
    const timer = makeActiveTimer({ task_id: "a", paused: options.paused ?? false, paused_remaining_secs: options.paused ? 900 : 0, kind: options.kind ?? "Work" });
    const data = new InMemoryDataAccess(makeAppState({ tasks: { a, b }, active_task: "a", timer: options.noTimer ? null : timer }));
    await data.savePMState({ projects: {}, tasks: {
        ...(!options.missingOccupant ? { pa: makePMTask({ id: "pa", title: "Task A", appTaskId: "a", estimatePomos: 2 }) } : {}),
        pb: makePMTask({ id: "pb", title: "Task B", appTaskId: options.unlinked ? undefined : "b", estimatePomos: 2 }),
    }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
    let current!: HandoffControls;
    const view = render(wrap(data, undefined, <HandoffProbe onChange={(value) => { current = value; }} />));
    await waitFor(() => expect(current?.pm.state.tasks.pb).toBeDefined());
    await waitFor(() => expect(current.app.state).not.toBeNull());
    return { ...view, data, timer, get current() { return current; } };
}
async function expireHandoffWindow(view: Awaited<ReturnType<typeof setupHandoff>>) {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date(Date.parse(view.timer.ends_at) + 1));
        await act(async () => { await view.current.app.completeTimer(); });
        expect(view.current.app.state?.timer?.kind).toBe("ShortBreak");
    } finally { vi.useRealTimers(); }
}

describe("TimerPanel Switch/Waiting sheet", () => {
    it.each([{ noTimer: true }, { kind: "ShortBreak" as const }])("hides both buttons without a live Work window: %j", async (options) => {
        await setupHandoff(options);
        expect(screen.queryByRole("button", { name: "Switch" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Waiting…" })).toBeNull();
    });
    it("disables Waiting with an explanation when the occupant has no PM row", async () => {
        await setupHandoff({ missingOccupant: true });
        expect(screen.getByRole("button", { name: "Waiting…" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Waiting…" })).toHaveAttribute("title", expect.stringContaining("no linked project-manager task"));
        expect(screen.getByRole("button", { name: "Switch" })).toBeEnabled();
    });
    it("marks the occupant waiting, preserves since on type change, and cancellation leaves the flag and timer running", async () => {
        const view = await setupHandoff();
        const pause = vi.spyOn(view.data, "pauseTimer");
        const resume = vi.spyOn(view.data, "resumeTimer");
        const stop = vi.spyOn(view.data, "stopWorkTimer");
        fireEvent.click(screen.getByRole("button", { name: "Waiting…" }));
        const dialog = screen.getByRole("dialog", { name: "Waiting — switch task" });
        await waitFor(() => expect(view.current.pm.state.tasks.pa.waiting?.type).toBe("agent"));
        const since = view.current.pm.state.tasks.pa.waiting!.since;
        expect(Number.isNaN(Date.parse(since))).toBe(false);
        fireEvent.click(within(dialog).getByRole("button", { name: "Person" }));
        await waitFor(() => expect(view.current.pm.state.tasks.pa.waiting).toEqual({ type: "person", since }));
        const before = view.current.app.remainingMs();
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
        expect(view.current.app.remainingMs()).toBeLessThan(before - 500);
        expect(within(dialog).queryByText(/^\d{2}:\d{2}$/)).toBeNull();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: "Waiting…" })).toHaveFocus();
        expect(view.current.pm.state.tasks.pa.waiting).toEqual({ type: "person", since });
        expect(view.data.store.state.timer).toMatchObject({ ends_at: view.timer.ends_at, paused: false });
        expect(pause).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
    });
    it.each([false, true])("hands over a linked task (paused=%s), resumes before joining, and closes", async (paused) => {
        const view = await setupHandoff({ paused });
        const resume = vi.spyOn(view.data, "resumeTimer");
        const setActive = vi.spyOn(view.data, "setActiveTask");
        const start = vi.spyOn(view.current.app, "startTaskWork");
        expect(screen.getByRole("button", { name: "Waiting…" })).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        const endsAt = view.data.store.state.timer!.ends_at;
        expect(view.current.pm.state.tasks.pa.waiting).toBeNull();
        fireEvent.click(within(screen.getByRole("dialog", { name: "Switch task" })).getByRole("button", { name: /Task B/ }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        if (!paused) expect(start).toHaveBeenCalledWith("b");
        expect(view.data.store.state.timer).toMatchObject({ task_id: "b", paused: false });
        if (paused) {
            expect(resume).toHaveBeenCalledOnce();
            expect(resume.mock.invocationCallOrder[0]).toBeLessThan(setActive.mock.invocationCallOrder[0]);
            const resumed = await resume.mock.results[0].value;
            expect(view.data.store.state.timer?.ends_at).toBe(resumed.state.timer.ends_at);
        } else {
            expect(resume).not.toHaveBeenCalled();
            expect(view.data.store.state.timer?.ends_at).toBe(endsAt);
        }
    });
    it("lines up the selected task if the window becomes a break while open", async () => {
        const view = await setupHandoff();
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        await expireHandoffWindow(view);
        await waitFor(() => expect(view.current.app.state?.timer?.kind).toBe("ShortBreak"));
        const before = { ...view.data.store.state.timer! };
        const start = vi.spyOn(view.current.app, "startTaskWork");
        const setActive = vi.spyOn(view.data, "setActiveTask");
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ }));
        expect(await screen.findByText("Task B is lined up for the next focus window.")).toBeVisible();
        expect(setActive).toHaveBeenCalledWith("b"); expect(start).not.toHaveBeenCalled();
        expect(view.data.store.state.active_task).toBe("b");
        expect(view.data.store.state.timer).toEqual(before);
    });
    it("starts a fresh window if the timer disappears while open", async () => {
        const view = await setupHandoff();
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        await act(async () => { await view.current.app.stopWork(); });
        const start = vi.spyOn(view.data, "startWorkTimer");
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(start).toHaveBeenCalledOnce();
        expect(view.data.store.state.timer).toMatchObject({ kind: "Work", task_id: "b" });
    });
    it("waits for an unlinked task, then joins once its appTaskId appears", async () => {
        const view = await setupHandoff({ unlinked: true });
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ }));
        expect(screen.getByText("preparing…")).toBeVisible();
        expect(view.data.store.state.timer?.task_id).toBe("a");
        await act(async () => { view.current.pm.updateTask("pb", { appTaskId: "b" }); });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(view.data.store.state.timer).toMatchObject({ task_id: "b", ends_at: view.timer.ends_at });
    });
    it("surfaces a permanent link failure and can retry without hanging", async () => {
        const view = await setupHandoff({ unlinked: true });
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ }));
        await act(async () => { view.current.pm.reportLink("pb", false, "Cannot create task"); });
        expect(screen.getByRole("alert")).toHaveTextContent("Cannot create task");
        expect(screen.queryByText("preparing…")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await act(async () => { view.current.pm.updateTask("pb", { appTaskId: "b" }); });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(view.data.store.state.timer?.task_id).toBe("b");
    });
    it("times out an unlinked selection after 15 seconds", async () => {
        const view = await setupHandoff({ unlinked: true });
        vi.useFakeTimers();
        try {
            fireEvent.click(screen.getByRole("button", { name: "Switch" }));
            fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ }));
            await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
            expect(screen.getByRole("alert")).toHaveTextContent("timed out after 15 seconds");
            expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
            expect(view.data.store.state.timer?.task_id).toBe("a");
        } finally { vi.useRealTimers(); }
    });
    it.each(["work", "break"])("keeps the sheet open with a %s command error", async (kind) => {
        const view = await setupHandoff();
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        if (kind === "break") await expireHandoffWindow(view);
        vi.spyOn(view.data, "setActiveTask").mockRejectedValueOnce(new Error("Handoff unavailable"));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ }));
        await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Handoff unavailable"));
        expect(view.data.store.state.active_task).toBe("a");
    });
    it("preserves the details selection through opening and closing the sheet", async () => {
        const view = await setupHandoff();
        fireEvent.click(screen.getByRole("button", { name: "Task Details" }));
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("pa");
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("pa");
        expect(document.getElementById("timer-task-details-panel")).toHaveAttribute("aria-hidden", "false");
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("");
        expect(view.data.store.state.timer?.task_id).toBe("a");
    });
});

describe("TimerPanel waiting badge", () => {
    it.each([
        { type: "agent" as const, paused: false },
        { type: "person" as const, paused: false },
        { type: "agent" as const, paused: true },
        { type: "person" as const, paused: true },
    ])("shows $type waiting while paused=$paused and clears only the flag", async ({ type, paused }) => {
        const task = makeAppTask("app-waiting", "Waiting work");
        const timer = makeActiveTimer({ task_id: task.id, paused, paused_remaining_secs: paused ? 713 : 0 });
        const data = await renderWithTasks({
            waiting: makePMTask({ id: "waiting", appTaskId: task.id, waiting: { type, since: "2026-01-01T00:00:00Z" } }),
        }, {}, { tasks: { [task.id]: task }, active_task: task.id, timer });
        const badge = await screen.findByText(`WAITING · ${type.toUpperCase()}`);
        expect(badge.parentElement).toHaveAttribute("title", expect.stringMatching(new RegExp(`^Waiting on ${type} · \\d+ days$`)));
        expect(screen.getByText(paused ? "PAUSED" : "WORK")).toBeInTheDocument();
        const pause = vi.spyOn(data, "pauseTimer");
        const resume = vi.spyOn(data, "resumeTimer");
        const stop = vi.spyOn(data, "stopWorkTimer");
        const before = { ...data.store.state.timer! };

        fireEvent.click(screen.getByRole("button", { name: "Clear waiting" }));

        await waitFor(() => expect(screen.queryByText(`WAITING · ${type.toUpperCase()}`)).not.toBeInTheDocument());
        await waitFor(async () => expect((await data.loadPMState())?.tasks.waiting.waiting).toBeNull());
        expect(data.store.state.timer).toEqual(before);
        expect(data.store.state.timer).toMatchObject({ ends_at: timer.ends_at, paused, paused_remaining_secs: timer.paused_remaining_secs });
        expect(pause).not.toHaveBeenCalled();
        expect(resume).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
    });

    it.each(["ShortBreak", "LongBreak"] as const)("does not show waiting on a %s", async (kind) => {
        const task = makeAppTask("app-break", "Break task");
        await renderWithTasks({ waiting: makePMTask({ id: "waiting", appTaskId: task.id, waiting: { type: "agent", since: "2026-01-01T00:00:00Z" } }) },
            {}, { tasks: { [task.id]: task }, active_task: task.id, timer: makeActiveTimer({ task_id: task.id, kind }) });
        await screen.findByText(kind.toUpperCase());
        expect(screen.queryByText(/WAITING ·/)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Clear waiting" })).not.toBeInTheDocument();
    });

    it("uses the deterministic app-task link instead of a title fallback or details selection", async () => {
        const task = makeAppTask("app-work", "Title fallback");
        await renderWithTasks({
            other: makePMTask({ id: "other", title: task.name, waiting: { type: "person", since: "2026-01-01T00:00:00Z" } }),
            later: makePMTask({ id: "later", appTaskId: task.id, sortOrder: 2, waiting: { type: "person", since: "2026-01-01T00:00:00Z" } }),
            first: makePMTask({ id: "first", appTaskId: task.id, sortOrder: 1, waiting: { type: "agent", since: "2026-01-01T00:00:00Z" } }),
        }, {}, { tasks: { [task.id]: task }, active_task: task.id, timer: makeActiveTimer({ task_id: task.id }) });
        expect(await screen.findByText("WAITING · AGENT")).toBeInTheDocument();
        expect(screen.queryByText("WAITING · PERSON")).not.toBeInTheDocument();
    });
});

describe("TimerPanel task details", () => {
    it("offers a retry when an expired timer cannot transition", async () => {
        const task = makeAppTask("stuck-task", "Stuck task");
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { [task.id]: task },
            active_task: task.id,
            timer: makeActiveTimer({ task_id: task.id, ends_at: new Date(Date.now() - 1000).toISOString() }),
        }));
        vi.spyOn(data, "fetchState").mockImplementation(async () => ({
            state: data.store.state,
            value: data.store.state,
            reconciledTimer: null,
        }));
        const complete = vi.spyOn(data, "completeTimer").mockRejectedValue(new Error("completion unavailable"));
        render(wrap(data));

        const retry = await screen.findByRole("button", { name: "Retry Transition" });
        await waitFor(() => expect(screen.getByText("completion unavailable")).toBeInTheDocument());
        const attempts = complete.mock.calls.length;
        fireEvent.click(retry);
        await waitFor(() => expect(complete.mock.calls.length).toBeGreaterThan(attempts));
    });

    it("replaces a persisted Projects selection with the active timer task and follows timer task changes", async () => {
        localStorage.setItem("pm_state_v1", JSON.stringify({ ui: { selectedTaskId: "projects-task" } }));
        const appTaskOne = makeAppTask("app-active-one", "Active application task one");
        const appTaskTwo = makeAppTask("app-active-two", "Active application task two");
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { [appTaskOne.id]: appTaskOne, [appTaskTwo.id]: appTaskTwo },
            active_task: appTaskOne.id,
            timer: makeActiveTimer({ task_id: appTaskOne.id }),
        }));
        await data.savePMState({
            projects: {},
            tasks: {
                "projects-task": makePMTask({ id: "projects-task", title: "Previously selected project task" }),
                "timer-task-one": makePMTask({ id: "timer-task-one", title: "Active timer task one", appTaskId: appTaskOne.id }),
                "timer-task-two": makePMTask({ id: "timer-task-two", title: "Active timer task two", appTaskId: appTaskTwo.id }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
        });
        render(wrap(data, appTaskTwo.id));

        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("projects-task"));
        fireEvent.click(screen.getByRole("button", { name: "Task Details" }));

        const details = document.getElementById("timer-task-details-panel");
        expect(details).not.toBeNull();
        await waitFor(() => expect(within(details!).getByText("Active timer task one")).toBeInTheDocument());
        expect(within(details!).queryByText("Previously selected project task")).not.toBeInTheDocument();
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("timer-task-one");

        fireEvent.click(screen.getByRole("button", { name: "Switch active timer task" }));

        await waitFor(() => expect(within(details!).getByText("Active timer task two")).toBeInTheDocument());
        expect(within(details!).queryByText("Active timer task one")).not.toBeInTheDocument();
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("timer-task-two");
    });
});

describe("TimerPanel projected finish", () => {
    it("projects Saturday work without counting the weekday project's running timer", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date(2026, 7, 15, 10);
        vi.setSystemTime(start);
        try {
            const weekdayTask = makeAppTask("app-weekday", "Weekday work");
            await renderWithTasks({
                weekday: makePMTask({ id: "weekday", appTaskId: weekdayTask.id, projectId: "weekday", estimatePomos: 3, dueDate: "2026-08-15" }),
                saturday: makePMTask({ id: "saturday", projectId: "saturday", estimatePomos: 2 }),
            }, {
                weekday: makeProject("weekday"),
                saturday: makeProject("saturday", [6]),
            }, {
                tasks: { [weekdayTask.id]: weekdayTask },
                active_task: weekdayTask.id,
                timer: makeActiveTimer({
                    task_id: weekdayTask.id,
                    started_at: new Date(start.getTime() - 12.5 * 60_000).toISOString(),
                    ends_at: new Date(start.getTime() + 12.5 * 60_000).toISOString(),
                }),
            });

            expect(await screen.findByText("2p in scope")).toBeInTheDocument();
            expect(screen.getByText("Flexible · 2p")).toBeInTheDocument();
            expect(screen.queryByText(/Due now ·/)).not.toBeInTheDocument();
            expect(screen.getByText("55m total")).toBeInTheDocument();
            const finish = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
                .format(new Date(2026, 7, 15, 10, 55));
            expect(screen.getByText(finish)).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: /This week/ }));
            expect(screen.getByText("4.5p in scope")).toBeInTheDocument();
            expect(screen.getByText("Due now · 2.5p")).toBeInTheDocument();
            expect(screen.getByText("Flexible · 2p")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        { futureTask: false, message: "You're all caught up for today. Great work!" },
        { futureTask: true, message: "No work due today. 2p future-due work remains outside this projection." },
    ])("shows the daily empty state with future task = $futureTask", async ({ futureTask, message }) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 15, 10));
        try {
            const tasks = {
                weekday: makePMTask({ id: "weekday", projectId: "weekday", estimatePomos: 3, dueDate: "2026-08-15" }),
                ...(futureTask && { future: makePMTask({ id: "future", projectId: "weekday", estimatePomos: 2, dueDate: "2026-08-16" }) }),
            };
            await renderWithTasks(tasks, { weekday: makeProject("weekday") });
            fireEvent.click(await screen.findByRole("button", { name: /This week/ }));
            expect(await screen.findByText("Due now · 3p")).toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: /^Today/, pressed: false }));
            expect(screen.getByText(message)).toBeInTheDocument();
            expect(screen.getByText("No tasks")).toBeInTheDocument();
            expect(screen.queryByText("Finish by")).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("discloses future-due work instead of claiming the day is complete", async () => {
        await renderWithTasks({
            future: makePMTask({ id: "future", estimatePomos: 2, dueDate: futureDateKey() }),
        });

        await waitFor(() => expect(screen.getByText("No work due today. 2p future-due work remains outside this projection.")).toBeInTheDocument());
        expect(screen.queryByText("You're all caught up for today. Great work!")).not.toBeInTheDocument();
        expect(screen.queryByText(DAILY_RULES)).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Info" })[0]);
        expect(screen.getByText(DAILY_RULES)).toBeInTheDocument();
    });

    it("labels the included and excluded task rules when work is projected", async () => {
        const today = toLocalDateKey(new Date());
        await renderWithTasks({
            today: makePMTask({ id: "today", estimatePomos: 1, dueDate: today }),
            future: makePMTask({ id: "future", estimatePomos: 2, dueDate: futureDateKey() }),
        });

        await waitFor(() => expect(screen.getByText("Daily projected finish")).toBeInTheDocument());
        expect(screen.getByText("Due now · 1p")).toBeInTheDocument();
        expect(screen.queryByText(DAILY_RULES)).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Info" })[0]);
        expect(screen.getByText(DAILY_RULES)).toBeInTheDocument();
    });

    it("includes later-this-week tasks in a distinct weekly projection", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 12, 10, 0));
        try {
            await renderWithTasks({
                friday: makePMTask({ id: "friday", estimatePomos: 2, dueDate: "2026-08-14" }),
                nextWeek: makePMTask({ id: "next-week", estimatePomos: 3, dueDate: "2026-08-17" }),
            });

            await waitFor(() => expect(screen.getByText("No work due today. 5p future-due work remains outside this projection.")).toBeInTheDocument());
            fireEvent.click(screen.getByRole("button", { name: /This week/ }));
            expect(screen.getByText("Weekly projected finish")).toBeInTheDocument();
            expect(screen.getByText("Later this week · 2p")).toBeInTheDocument();
            expect(screen.queryByText("Later this week · 5p")).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("shows overage against the original goal and keeps the unfinished task projected", async () => {
        const now = Date.now();
        const appTask = {
            ...makeAppTask("app-overage", "Over estimate"),
            completed_pomodoros: 2.5,
        };
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { [appTask.id]: appTask },
            active_task: appTask.id,
            timer: makeActiveTimer({
                task_id: appTask.id,
                started_at: new Date(now - 12.5 * 60_000).toISOString(),
                ends_at: new Date(now + 12.5 * 60_000).toISOString(),
            }),
        }));
        await data.savePMState({
            projects: {},
            tasks: {
                overage: makePMTask({
                    id: "overage",
                    title: "Over estimate",
                    appTaskId: appTask.id,
                    estimatePomos: 2,
                    workedPomos: 3,
                    dueDate: toLocalDateKey(new Date()),
                }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
        });

        render(wrap(data));

        await waitFor(() => expect(screen.getByText("3p")).toBeInTheDocument());
        expect(screen.queryByText("3.5p")).not.toBeInTheDocument();
        expect(screen.getByText(/goal 2p/)).toBeInTheDocument();
        expect(screen.getByText("0p")).toBeInTheDocument();
        expect(screen.getByText("Due now · 1p")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Task Details" }));
        const estimateInput = await screen.findByRole("spinbutton");
        expect(estimateInput).toHaveAttribute("min", "1");
        fireEvent.change(estimateInput, { target: { value: "1" } });
        fireEvent.blur(estimateInput);
        await waitFor(async () => expect((await data.loadPMState())?.tasks.overage?.estimatePomos).toBe(1));
    });

    it("shows pomodoro progress for the active task when no timer is running", async () => {
        const appTask = {
            ...makeAppTask("app-no-timer", "No timer task"),
            completed_pomodoros: 1,
        };
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { [appTask.id]: appTask },
            active_task: appTask.id,
        }));

        render(wrap(data));

        await waitFor(() => expect(screen.getByText(/goal 2p/)).toBeInTheDocument());
        const card = screen.getByText((_, node) =>
            node?.textContent?.replace(/\s+/g, " ").trim() === "Focus progress: 1p done · 1p left (goal 2p)"
        );
        expect(card).toBeInTheDocument();
        expect(screen.getByText("READY")).toBeInTheDocument();
    });
});

describe("TimerPanel today surface", () => {
    it.each([
        ["Done", "Complete selected PM task"],
        ["archived", "Archive selected PM task"],
    ])("clears a waiting Today selection and closes details when it becomes %s", async (_state, action) => {
        await renderWithTasks({ today: makePMTask({ id: "today", title: "Waiting Today task", estimatePomos: 2,
            waiting: { type: "agent", since: "2026-01-01T00:00:00Z" } }) });
        const todayRegion = screen.getByRole("region", { name: "Today" });
        fireEvent.click(within(todayRegion).getByRole("button", { name: /Today/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Select Waiting Today task" }));
        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("today"));
        expect(document.getElementById("timer-task-details-panel")).toHaveAttribute("aria-hidden", "false");

        fireEvent.click(screen.getByRole("button", { name: action }));

        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toBeEmptyDOMElement());
        expect(document.getElementById("timer-task-details-panel")).toHaveAttribute("aria-hidden", "true");
        expect(within(todayRegion).queryByRole("button", { name: "Select Waiting Today task" })).not.toBeInTheDocument();
        expect(within(todayRegion).queryByRole("img", { name: "Waiting on agent" })).not.toBeInTheDocument();
    });

    it("returns details to the running task after the explicit Today task becomes Done", async () => {
        const task = makeAppTask("running", "Running work");
        await renderWithTasks({
            running: makePMTask({ id: "running", appTaskId: task.id, title: "Running PM task", estimatePomos: 2 }),
            today: makePMTask({ id: "today", title: "Waiting Today task", estimatePomos: 2, waiting: { type: "agent", since: "2026-01-01T00:00:00Z" } }),
        }, {}, { tasks: { [task.id]: task }, active_task: task.id, timer: makeActiveTimer({ task_id: task.id }) });
        const todayRegion = screen.getByRole("region", { name: "Today" });
        fireEvent.click(within(todayRegion).getByRole("button", { name: /Today/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Select Waiting Today task" }));
        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("today"));
        fireEvent.click(screen.getByRole("button", { name: "Complete selected PM task" }));
        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("running"));
        const details = document.getElementById("timer-task-details-panel")!;
        expect(details).toHaveAttribute("aria-hidden", "false");
        expect(within(details).getByText("Running PM task")).toBeInTheDocument();
        expect(within(details).queryByText("Waiting Today task")).not.toBeInTheDocument();
    });

    it("renders the today surface below the projected-finish card", async () => {
        await renderWithTasks({
            today: makePMTask({ id: "today", title: "Due today", estimatePomos: 1, dueDate: toLocalDateKey(new Date()) }),
        });

        await waitFor(() => expect(screen.getByText("Daily projected finish")).toBeInTheDocument());
        const projectionLabel = screen.getByText("Daily projected finish");
        const todayRegion = screen.getByRole("region", { name: "Today" });
        expect(projectionLabel.compareDocumentPosition(todayRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText("1 task · 1p left")).toBeInTheDocument();
    });

    it("selects a today task in the project manager and opens its details panel", async () => {
        await renderWithTasks({
            today: makePMTask({ id: "today", title: "Due today task", estimatePomos: 1, dueDate: toLocalDateKey(new Date()) }),
        });

        await waitFor(() => expect(screen.getByText("1 task · 1p left")).toBeInTheDocument());
        const todayRegion = screen.getByRole("region", { name: "Today" });
        fireEvent.click(within(todayRegion).getByRole("button", { name: /Today/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Select Due today task" }));

        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("today"));
        const details = document.getElementById("timer-task-details-panel");
        expect(details).not.toBeNull();
        await waitFor(() => expect(within(details!).getByText("Due today task")).toBeInTheDocument());
    });

    it("opens details for a selected today task even while another task is running", async () => {
        const runningAppTask = makeAppTask("app-running", "Running application task");
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { [runningAppTask.id]: runningAppTask },
            active_task: runningAppTask.id,
            timer: makeActiveTimer({ task_id: runningAppTask.id }),
        }));
        await data.savePMState({
            projects: {},
            tasks: {
                running: makePMTask({ id: "running", title: "Running project task", appTaskId: runningAppTask.id, estimatePomos: 1 }),
                today: makePMTask({ id: "today", title: "Due today task", estimatePomos: 1, dueDate: toLocalDateKey(new Date()) }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
        });
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("2 tasks · 2p left")).toBeInTheDocument());
        const todayRegion = screen.getByRole("region", { name: "Today" });
        fireEvent.click(within(todayRegion).getByRole("button", { name: /Today/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Select Due today task" }));

        await waitFor(() => expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("today"));
        const details = document.getElementById("timer-task-details-panel");
        await waitFor(() => expect(within(details!).getByText("Due today task")).toBeInTheDocument());
        expect(within(details!).queryByText("Running project task")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Switch" }));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("today");
        expect(within(details!).getByText("Due today task")).toBeInTheDocument();
        // An explicit Today selection is not the aside's auto-selection and
        // remains selected after closing its details.
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.getByTestId("pm-selected-task")).toHaveTextContent("today");
    });
});


describe("focus window display", () => {
    it("keeps the ring and elapsed display after a switch and labels the stop action End focus", async () => {
        const nowMs = Date.now();
        const clock = vi.spyOn(Date, "now").mockReturnValue(nowMs);
        try {
            const first = makeAppTask("first", "First");
            const second = makeAppTask("second", "Second");
            const data = new InMemoryDataAccess(makeAppState({ tasks: { first, second }, active_task: first.id,
                timer: makeActiveTimer({ task_id: first.id, started_at: new Date(nowMs - 600000).toISOString(),
                    ends_at: new Date(nowMs + 900000).toISOString(), planned_secs: 1500,
                    window_started_at: new Date(nowMs - 600000).toISOString() }) }), { now: () => new Date(nowMs) });
            const view = render(wrap(data, second.id));
            await screen.findByRole("button", { name: "End focus" });
            expect(screen.getByText("10m / 25m")).toBeInTheDocument();
            const ring = () => view.container.querySelector('[style*="conic-gradient"]') as HTMLElement;
            const before = ring().style.background;
            expect(before).toContain("40%");
            fireEvent.click(screen.getByRole("button", { name: "Switch active timer task" }));
            await waitFor(() => expect(data.store.state.timer?.task_id).toBe(second.id));
            expect(data.store.state.timer?.planned_secs).toBe(900);
            await waitFor(() => expect(screen.getByText(/Focus progress:/).textContent).toContain("0p done"));
            expect(ring().style.background).toBe(before);
            expect(screen.getByText("10m / 25m")).toBeInTheDocument();
            fireEvent.click(screen.getByRole("button", { name: "End focus" }));
            await waitFor(() => expect(data.store.state.timer).toBeNull());
        } finally { clock.mockRestore(); }
    });
});


it.each([
    { status: "Done" as const }, { status: "Blocked" as const }, { isArchived: true },
    { waiting: { type: "person" as const, since: "2026-01-01T00:00:00Z" } },
])("refreshes open sheet candidates when a PM task becomes ineligible: %j", async (patch) => {
    const view = await setupHandoff();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ })).toBeVisible();
    await act(async () => { view.current.pm.updateTask("pb", patch); });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /Task B/ })).toBeNull();
});

it("refreshes open sheet candidates when the backend is archived", async () => {
    const view = await setupHandoff();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    await act(async () => { await view.current.app.archiveTask("b"); });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /Task B/ })).toBeNull();
});


it("rechecks project workability using the sheet's open-time date", async () => {
    const view = await setupHandoff();
    const opened = new Date();
    const today = opened.getDay();
    const tomorrow = (today + 1) % 7 as NonNullable<Project["workableDays"]>[number];
    const p = { ...makeProject("p"), workableDays: [today as NonNullable<Project["workableDays"]>[number]] };
    // Introduce the project through the provider's supported creation/update API.
    let projectId!: string;
    await act(async () => {
        const created = view.current.pm.createProject("Scheduled");
        projectId = created.id;
    });
    await act(async () => {
        view.current.pm.updateProject(projectId, { workableDays: p.workableDays });
        view.current.pm.updateTask("pb", { projectId });
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B/ })).toBeVisible();
    // Move the wall clock to tomorrow while the sheet retains today's date.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
        vi.setSystemTime(new Date(opened.getTime() + 86_400_000));
        await act(async () => { view.current.pm.updateTask("pb", { title: "Task B updated" }); });
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: /Task B updated/ })).toBeVisible();
    } finally { vi.useRealTimers(); }
    await act(async () => { view.current.pm.updateProject(projectId, { workableDays: [tomorrow] }); });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /Task B/ })).toBeNull();
});
