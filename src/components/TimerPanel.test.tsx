import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function wrap(data: InMemoryDataAccess, switchTaskId?: string) {
    return (
        <MemoryRouter>
            <TauriCloseProvider>
                <DataProvider dataAccess={data}>
                    <SyncProvider ownerId={OWNER}>
                        <AppStateProvider>
                            <ProjectManagerProvider>
                                <HabitProvider>
                                    <SelectionProbe />
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
            expect(ring().style.background).toBe(before);
            expect(screen.getByText("10m / 25m")).toBeInTheDocument();
            fireEvent.click(screen.getByRole("button", { name: "End focus" }));
            await waitFor(() => expect(data.store.state.timer).toBeNull());
        } finally { clock.mockRestore(); }
    });
});
