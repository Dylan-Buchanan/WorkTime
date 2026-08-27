import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimerPanel } from "./TimerPanel";
import { AppStateProvider, useAppState } from "../state/AppStateContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider, usePM } from "../state/ProjectManagerContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { toLocalDateKey } from "../lib/timer";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";
import type { PMTask, Task } from "../state/types";

vi.mock("../hooks/useSounds", () => ({
    useSounds: () => ({ play: () => {} }),
}));

const OWNER = "timer-panel-owner";

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
                                <SelectionProbe />
                                {switchTaskId && <ActiveTaskSwitcher taskId={switchTaskId} />}
                                <TimerPanel />
                            </ProjectManagerProvider>
                        </AppStateProvider>
                    </SyncProvider>
                </DataProvider>
            </TauriCloseProvider>
        </MemoryRouter>
    );
}

async function renderWithTasks(tasks: Record<string, PMTask>) {
    const data = new InMemoryDataAccess(makeAppState());
    await data.savePMState({
        projects: {},
        tasks,
        meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
    });
    render(wrap(data));
    return data;
}

beforeEach(() => localStorage.clear());

describe("TimerPanel task details", () => {
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
    it("discloses future-due work instead of claiming the day is complete", async () => {
        await renderWithTasks({
            future: makePMTask({ id: "future", estimatePomos: 2, dueDate: futureDateKey() }),
        });

        await waitFor(() => expect(screen.getByText("No work due today. 2p future-due work remains outside this projection.")).toBeInTheDocument());
        expect(screen.queryByText("You're all caught up for today. Great work!")).not.toBeInTheDocument();
        expect(screen.queryByText("Includes no due date and due today/overdue. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.")).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Info" })[0]);
        expect(screen.getByText("Includes no due date and due today/overdue. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.")).toBeInTheDocument();
    });

    it("labels the included and excluded task rules when work is projected", async () => {
        const today = toLocalDateKey(new Date());
        await renderWithTasks({
            today: makePMTask({ id: "today", estimatePomos: 1, dueDate: today }),
            future: makePMTask({ id: "future", estimatePomos: 2, dueDate: futureDateKey() }),
        });

        await waitFor(() => expect(screen.getByText("Daily projected finish")).toBeInTheDocument());
        expect(screen.getByText("Due now · 1p")).toBeInTheDocument();
        expect(screen.queryByText("Includes no due date and due today/overdue. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.")).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Info" })[0]);
        expect(screen.getByText("Includes no due date and due today/overdue. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.")).toBeInTheDocument();
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
});
