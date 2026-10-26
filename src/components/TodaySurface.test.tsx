import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodaySurface } from "./TodaySurface";
import { AppStateProvider, useAppState } from "../state/AppStateContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { HabitProvider } from "../state/HabitContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { toLocalDateKey } from "../lib/timer";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";
import type { AppStateData, Habit, PMTask, PomodoroLogEntry, Project, Task } from "../state/types";

vi.mock("../hooks/useSounds", () => ({
    useSounds: () => ({ play: () => {} }),
}));

const OWNER = "today-surface-owner";

function pmTask(overrides: Partial<PMTask>): PMTask {
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

function appTask(id: string, name: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        name,
        target_pomodoros: 2,
        completed_pomodoros: 0,
        created_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
        break_skips: 0,
        archived: false,
        ...overrides,
    };
}

function project(overrides: Partial<Project> = {}): Project {
    return {
        id: "project-1",
        name: "Deep Work",
        color: "#10B981",
        workableStart: "09:00",
        workableEnd: "17:00",
        workableDays: [1, 2, 3, 4, 5],
        isArchived: false,
        sortOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function habit(overrides: Partial<Habit> = {}): Habit {
    return {
        id: "habit-1",
        name: "Morning walk",
        description: "",
        color: "#6366F1",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function log(overrides: Partial<PomodoroLogEntry> = {}): PomodoroLogEntry {
    const now = new Date();
    return {
        id: "log-1",
        task_id: "app-1",
        duration_minutes: 25,
        finished_at: now.toISOString(),
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

function todayKey(): string {
    return toLocalDateKey(new Date());
}

const TimerProbe = () => {
    const { state } = useAppState();
    return <span hidden data-testid="timer-task">{state?.timer?.task_id ?? ""}</span>;
};

interface WrapOptions {
    appState?: Partial<AppStateData>;
    tasks?: Record<string, PMTask>;
    projects?: Record<string, Project>;
    habits?: Habit[];
    completions?: Array<{ id: string; habitId: string; bucket: string; createdAt: string; updatedAt: string }>;
    onSelectTask?: (taskId: string) => void;
}

async function renderSurface(options: WrapOptions = {}) {
    const data = new InMemoryDataAccess(makeAppState(options.appState));
    const tasks = options.tasks ?? {};
    const projects = options.projects ?? {};
    if (Object.keys(tasks).length > 0 || Object.keys(projects).length > 0) {
        await data.savePMState({ projects, tasks, meta: { initializedAt: "2026-01-01T00:00:00.000Z" } });
    }
    if (options.habits || options.completions) {
        await data.saveHabits(options.habits ?? [], options.completions ?? []);
    }
    render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <HabitProvider>
                                <TimerProbe />
                                <TodaySurface onSelectTask={options.onSelectTask ?? (() => {})} />
                            </HabitProvider>
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>,
    );
    return data;
}

function expandSurface() {
    fireEvent.click(screen.getByRole("button", { name: /Today/ }));
}

beforeEach(() => localStorage.clear());

describe("TodaySurface", () => {
    it("summarises the day while collapsed and reveals the groups when expanded", async () => {
        await renderSurface({
            tasks: {
                "task-a": pmTask({ id: "task-a", title: "Ship the report", projectId: "project-1", estimatePomos: 3, dueDate: todayKey() }),
                "task-b": pmTask({ id: "task-b", title: "Clear inbox", estimatePomos: 1 }),
            },
            projects: { "project-1": project() },
            habits: [habit()],
            completions: [{ id: "c1", habitId: "habit-1", bucket: todayKey(), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
            appState: {
                logs: [
                    log({ id: "log-1", duration_minutes: 25, task_id: "app-1" }),
                    log({ id: "log-2", duration_minutes: 30, task_id: "app-1", was_break: true }),
                ],
            },
        });

        const toggle = await screen.findByRole("button", { name: /Today/ });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(await screen.findByText("2 tasks · 4p left")).toBeInTheDocument();
        expect(await screen.findByText("1/1 habits")).toBeInTheDocument();
        expect(screen.getByText("1p · 25m")).toBeInTheDocument();
        expect(screen.queryByText("Ship the report")).not.toBeInTheDocument();
        expect(document.getElementById("today-surface-content")).toBeNull();

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute("aria-expanded", "true");
        const content = document.getElementById("today-surface-content");
        expect(content).not.toBeNull();
        expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Habits" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Pomodoros" })).toBeInTheDocument();
        expect(screen.getByText("Ship the report")).toBeInTheDocument();
        expect(screen.getByText("Deep Work")).toBeInTheDocument();
        expect(screen.getByText("3p left of 3p")).toBeInTheDocument();
        expect(screen.getByText("Clear inbox")).toBeInTheDocument();
        expect(screen.getByText("No project")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Morning walk (daily)" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("Unassigned task")).toBeInTheDocument();
        expect(screen.getAllByText("1p · 25m")).toHaveLength(2);
    });

    it("marks the active task and reports remaining pomodoros against its estimate", async () => {
        const active = appTask("app-active", "Active app task", { target_pomodoros: 2, completed_pomodoros: 0 });
        const startedAt = new Date(Date.now() - 12.5 * 60_000).toISOString();
        const endsAt = new Date(Date.now() + 12.5 * 60_000).toISOString();
        await renderSurface({
            tasks: {
                active: pmTask({ id: "active", title: "Active task", appTaskId: active.id, estimatePomos: 2, dueDate: todayKey() }),
            },
            appState: {
                tasks: { [active.id]: active },
                active_task: active.id,
                timer: makeActiveTimer({ task_id: active.id, started_at: startedAt, ends_at: endsAt }),
            },
        });

        expandSurface();
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent("app-active"));
        expect(await screen.findByText("Running")).toBeInTheDocument();
        expect(screen.getByText("1.5p left of 2p")).toBeInTheDocument();
    });

    it("checks and unchecks a habit through the habit context", async () => {
        const user = userEvent.setup();
        const data = await renderSurface({ habits: [habit()] });
        expandSurface();

        const habitButton = await screen.findByRole("button", { name: "Morning walk (daily)" });
        expect(habitButton).toHaveAttribute("aria-pressed", "false");

        await user.click(habitButton);
        await waitFor(() => expect(habitButton).toHaveAttribute("aria-pressed", "true"));
        await waitFor(async () => {
            const stored = await data.loadHabits();
            expect(stored.completions.map((completion) => completion.bucket)).toContain(todayKey());
        });

        await user.click(habitButton);
        await waitFor(() => expect(habitButton).toHaveAttribute("aria-pressed", "false"));
        await waitFor(async () => expect((await data.loadHabits()).completions).toHaveLength(0));
    });

    it("selects a task from the list", async () => {
        const user = userEvent.setup();
        const onSelectTask = vi.fn();
        await renderSurface({
            tasks: { "task-a": pmTask({ id: "task-a", title: "Ship the report", estimatePomos: 2 }) },
            onSelectTask,
        });
        expandSurface();

        await user.click(await screen.findByRole("button", { name: "Select Ship the report" }));
        expect(onSelectTask).toHaveBeenCalledWith("task-a");
    });

    it("starts focus on a linked task", async () => {
        const user = userEvent.setup();
        const linked = appTask("app-linked", "Linked app task");
        await renderSurface({
            tasks: { linked: pmTask({ id: "linked", title: "Linked task", appTaskId: linked.id, estimatePomos: 2 }) },
            appState: { tasks: { [linked.id]: linked } },
        });
        expandSurface();

        await user.click(await screen.findByRole("button", { name: "Start focus on Linked task" }));
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent("app-linked"));
    });

    it("creates and links a timer task when starting focus on an unlinked task", async () => {
        const user = userEvent.setup();
        const data = await renderSurface({
            tasks: { unlinked: pmTask({ id: "unlinked", title: "Unlinked task", estimatePomos: 2 }) },
        });
        expandSurface();

        await user.click(await screen.findByRole("button", { name: "Start focus on Unlinked task" }));
        await waitFor(async () => {
            const stored = await data.loadPMState();
            expect(stored?.tasks.unlinked.appTaskId).toBeTruthy();
        });
        const linkedId = (await data.loadPMState())?.tasks.unlinked.appTaskId;
        expect(linkedId).toBeTruthy();
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent(linkedId!));
    });

    it("communicates that a timer is already running instead of starting another", async () => {
        const user = userEvent.setup();
        const running = appTask("app-running", "Running app task");
        await renderSurface({
            tasks: {
                running: pmTask({ id: "running", title: "Running task", appTaskId: running.id, estimatePomos: 2 }),
                other: pmTask({ id: "other", title: "Other task", estimatePomos: 2 }),
            },
            appState: {
                tasks: { [running.id]: running },
                active_task: running.id,
                timer: makeActiveTimer({ task_id: running.id }),
            },
        });
        expandSurface();
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent("app-running"));

        await user.click(await screen.findByRole("button", { name: "Start focus on Other task" }));
        expect(await screen.findByRole("status")).toHaveTextContent("A timer is already running.");
        expect(screen.getByTestId("timer-task")).toHaveTextContent("app-running");
    });

    it("shows an empty state for each group", async () => {
        await renderSurface();

        expandSurface();

        expect(await screen.findByText("No tasks are due today.")).toBeInTheDocument();
        expect(screen.getByText("No habits yet.")).toBeInTheDocument();
        expect(screen.getByText("No pomodoros completed today.")).toBeInTheDocument();
        expect(screen.getByText("No tasks")).toBeInTheDocument();
        expect(screen.getByText("No habits")).toBeInTheDocument();
        expect(screen.getByText("No pomodoros")).toBeInTheDocument();
    });
});
