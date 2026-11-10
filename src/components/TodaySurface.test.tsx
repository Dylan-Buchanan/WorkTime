import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodaySurface } from "./TodaySurface";
import { AppStateProvider, useAppState } from "../state/AppStateContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { HabitProvider } from "../state/HabitContext";
import { TodoProvider } from "../state/TodoContext";
import type { Todo, TodoCompletion } from "../lib/todos/types";
import * as soundHooks from "../hooks/useSounds";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { toLocalDateKey } from "../lib/timer";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";
import type { AppStateData, Habit, PMTask, PomodoroLogEntry, Project, Task, WorkableWeekday } from "../state/types";

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
    todos?: Todo[];
    todoCompletions?: TodoCompletion[];
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
    if (options.todos || options.todoCompletions) {
        await data.saveTodos(options.todos ?? [], options.todoCompletions ?? []);
    }
    render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <HabitProvider>
                                <TodoProvider>
                                    <TimerProbe />
                                    <TodaySurface onSelectTask={options.onSelectTask ?? (() => {})} />
                                </TodoProvider>
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

function surfaceTodo(overrides: Partial<Todo> = {}): Todo {
    return { id: "todo-1", title: "Agenda to-do", rule: null, dueDate: todayKey() as Todo["dueDate"],
        estimate: 1, currentTaskId: null, position: 0, isArchived: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides };
}

describe("Today to-do group", () => {
    it("renders between Tasks and Habits, with an overdue checkbox that completes through the to-do path without focus or selection", async () => {
        const play = vi.fn();
        const sounds = vi.spyOn(soundHooks, "useSounds").mockReturnValue({ play });
        try {
            const onSelectTask = vi.fn();
            const data = await renderSurface({ todos: [surfaceTodo({ dueDate: "2020-01-01" })], onSelectTask });
            expandSurface();
            const checkbox = await screen.findByRole("button", { name: "Complete Agenda to-do" });
            expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Tasks", "To-dos", "Habits", "Pomodoros"]);
            expect(checkbox).toHaveAttribute("aria-pressed", "false");
            expect(within(checkbox.closest("li")!).getByText("Overdue")).toBeInTheDocument();
            fireEvent.click(checkbox);
            await waitFor(async () => expect((await data.loadTodos()).completions).toHaveLength(1));
            expect((await data.loadTodos()).todos[0].isArchived).toBe(true);
            expect(data.store.state.timer).toBeNull();
            expect(Object.keys(data.store.state.tasks)).toHaveLength(0);
            expect(play).toHaveBeenCalledWith("completeTask");
            expect(play).not.toHaveBeenCalledWith("startPomodoro");
            expect(onSelectTask).not.toHaveBeenCalled();
        } finally { sounds.mockRestore(); }
    });

    it("keeps a running linked to-do's timer and shows its Done pending hint without an error", async () => {
        const running = appTask("todo-running", "Running to-do");
        const data = await renderSurface({ todos: [surfaceTodo({ currentTaskId: running.id })],
            appState: { tasks: { [running.id]: running }, active_task: running.id, timer: makeActiveTimer({ task_id: running.id }) } });
        expandSurface();
        await screen.findByText("Running");
        const original = structuredClone(data.store.state.timer);
        fireEvent.click(screen.getByRole("button", { name: "Complete Agenda to-do" }));
        fireEvent.click(await screen.findByRole("button", { name: "Done today (1)" }));
        expect(await screen.findByText("finishing after this pomodoro")).toBeInTheDocument();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(data.store.state.timer).toEqual(original);
        expect(data.store.state.tasks[running.id].completed_at).toBeNull();
        expect((await data.loadTodos()).completions).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Select Agenda to-do" })).not.toBeInTheDocument();
    });

    it("promotes a to-do into a linked backend task and starts focus", async () => {
        const play = vi.fn();
        const sounds = vi.spyOn(soundHooks, "useSounds").mockReturnValue({ play });
        try {
            const data = await renderSurface({ todos: [surfaceTodo({ estimate: 2 })] });
            expandSurface();
            fireEvent.click(await screen.findByRole("button", { name: "Start focus on Agenda to-do" }));
            await waitFor(async () => expect((await data.loadTodos()).todos[0].currentTaskId).toBeTruthy());
            const linked = (await data.loadTodos()).todos[0].currentTaskId!;
            await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent(linked));
            expect(data.store.state.tasks[linked]).toMatchObject({ name: "Agenda to-do", target_pomodoros: 2 });
            expect(data.store.state.timer).toMatchObject({ kind: "Work", task_id: linked });
            expect((await data.loadTodos()).completions).toHaveLength(0);
            expect(play).toHaveBeenCalledWith("startPomodoro");
        } finally { sounds.mockRestore(); }
    });

    it("shows a deferred hint only on the most recent Done occurrence of a to-do", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 12, 9));
        try {
            const running = appTask("recurring-owner", "Recurring work");
            const earlier = new Date(2026, 7, 12, 8).toISOString();
            await renderSurface({
                todos: [surfaceTodo({ currentTaskId: running.id, rule: { type: "weekly", weekdays: [3, 5] } })],
                todoCompletions: [{ id: "earlier", todoId: "todo-1", bucket: "2026-08-10", createdAt: earlier, updatedAt: earlier }],
                appState: { tasks: { [running.id]: running }, active_task: running.id, timer: makeActiveTimer({ task_id: running.id }) },
            });
            expandSurface();
            await screen.findByText("Running");
            fireEvent.click(await screen.findByRole("button", { name: "Complete Agenda to-do" }));
            fireEvent.click(await screen.findByRole("button", { name: "Done today (2)" }));
            const hint = await screen.findByText("finishing after this pomodoro");
            const rows = within(hint.closest("ul")!).getAllByRole("listitem");
            expect(rows).toHaveLength(2);
            expect(within(rows[0]).getByText("finishing after this pomodoro")).toBeInTheDocument();
            expect(within(rows[1]).queryByText("finishing after this pomodoro")).not.toBeInTheDocument();
        } finally { vi.useRealTimers(); }
    });

    it("shows focus promotion errors as a notice without playing the start sound", async () => {
        const play = vi.fn();
        const sounds = vi.spyOn(soundHooks, "useSounds").mockReturnValue({ play });
        try {
            const data = await renderSurface({ todos: [surfaceTodo()] });
            expandSurface();
            const focus = await screen.findByRole("button", { name: "Start focus on Agenda to-do" });
            const create = vi.spyOn(data, "createTask").mockRejectedValueOnce(new Error("Unable to create focus task"));
            try {
                fireEvent.click(focus);
                expect(await screen.findByRole("status")).toHaveTextContent("Unable to create focus task");
                expect(play).not.toHaveBeenCalledWith("startPomodoro");
                expect((await data.loadTodos()).completions).toHaveLength(0);
            } finally { create.mockRestore(); }
        } finally { sounds.mockRestore(); }
    });

    it("shows the break notice when focusing a to-do during a break", async () => {
        const running = appTask("break-owner", "Break owner");
        const data = await renderSurface({ todos: [surfaceTodo()], appState: {
            tasks: { [running.id]: running }, active_task: running.id,
            timer: makeActiveTimer({ task_id: running.id, kind: "ShortBreak" }),
        } });
        expandSurface();
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent(running.id));
        const original = structuredClone(data.store.state.timer);
        fireEvent.click(await screen.findByRole("button", { name: "Start focus on Agenda to-do" }));
        expect(await screen.findByRole("status")).toHaveTextContent("A break is running.");
        expect(data.store.state.timer).toEqual(original);
        expect((await data.loadTodos()).todos[0].currentTaskId).toBeNull();
        expect(Object.keys(data.store.state.tasks)).toEqual([running.id]);
    });

    it("always renders an empty To-dos group with No to-dos due.", async () => {
        await renderSurface();
        expandSurface();
        expect(screen.getByRole("heading", { name: "To-dos" })).toBeInTheDocument();
        expect(screen.getByText("No to-dos due.")).toBeInTheDocument();
    });

    it("shares one Done today group between a task and a to-do", async () => {
        const now = new Date().toISOString();
        await renderSurface({ tasks: { done: pmTask({ id: "done", title: "Done task", status: "Done", completedAt: now }) },
            todos: [surfaceTodo({ isArchived: true })],
            todoCompletions: [{ id: "completion", todoId: "todo-1", bucket: todayKey(), createdAt: now, updatedAt: now }] });
        expandSurface();
        const doneToggle = await screen.findByRole("button", { name: "Done today (2)" });
        expect(screen.getAllByRole("button", { name: /Done today/ })).toHaveLength(1);
        expect(doneToggle).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(doneToggle);
        const doneGroup = within(doneToggle.parentElement!);
        expect(doneGroup.getAllByRole("listitem")).toHaveLength(2);
        expect(doneGroup.getByRole("button", { name: "Select Done task" })).toBeInTheDocument();
        expect(doneGroup.getByText("Agenda to-do")).toBeInTheDocument();
        const content = document.getElementById("today-surface-content")!;
        expect(Array.from(content.children).map((group) => group.querySelector("h3")?.textContent ?? group.querySelector("button")?.textContent))
            .toEqual(["Tasks", "To-dos", "Done today (2)", "Habits", "Pomodoros"]);
    });

    it("sums task and to-do work in the header chip", async () => {
        await renderSurface({ tasks: { task: pmTask({ id: "task", estimatePomos: 2, dueDate: todayKey() }) }, todos: [surfaceTodo()] });
        expect(await screen.findByText("3p this week")).toBeInTheDocument();
    });

    it.each([new Error("Unable to save occurrence"), null])("surfaces completion failures as a card notice: %s", async error => {
        const data = await renderSurface({ todos: [surfaceTodo()] });
        expandSurface();
        const checkbox = await screen.findByRole("button", { name: "Complete Agenda to-do" });
        const save = vi.spyOn(data, "saveTodos").mockRejectedValueOnce(error);
        try {
            fireEvent.click(checkbox);
            expect(await screen.findByRole("status")).toHaveTextContent(error?.message ?? "Unable to complete the to-do.");
        } finally { save.mockRestore(); }
    });
});

describe("TodaySurface", () => {
    it("hides Done today when no tasks were completed today", async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        await renderSurface({ tasks: {
            legacy: pmTask({ id: "legacy", status: "Done" }),
            old: pmTask({ id: "old", status: "Done", completedAt: yesterday.toISOString() }),
        } });
        expandSurface();
        await screen.findByText("Nothing left for today!");
        expect(screen.queryByRole("button", { name: /^Done today/ })).not.toBeInTheDocument();
    });

    it("renders Done today collapsed and expands selectable completed rows without focus or checkbox controls", async () => {
        const onSelectTask = vi.fn();
        await renderSurface({ tasks: {
            done: pmTask({ id: "done", title: "Finished report", status: "Done", completedAt: new Date().toISOString() }),
        }, onSelectTask });
        expandSurface();
        const toggle = await screen.findByRole("button", { name: "Done today (1)" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("button", { name: "Select Finished report" })).not.toBeInTheDocument();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        const select = screen.getByRole("button", { name: "Select Finished report" });
        const row = select.closest("li")!;
        expect(within(row).getAllByRole("button")).toEqual([select]);
        expect(within(row).queryByRole("button", { name: /focus/i })).not.toBeInTheDocument();
        expect(within(row).queryByRole("button", { name: /^Complete / })).not.toBeInTheDocument();
        expect(select).toHaveClass("line-through");
        fireEvent.click(select);
        expect(onSelectTask).toHaveBeenCalledWith("done");
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("moves a checked active row into Done today and persists its completedAt", async () => {
        const data = await renderSurface({ tasks: {
            done: pmTask({ id: "done", title: "Already finished", status: "Done", completedAt: new Date().toISOString() }),
            active: pmTask({ id: "active", title: "Finish next", dueDate: todayKey(), estimatePomos: 2 }),
        } });
        expandSurface();
        expect(await screen.findByRole("button", { name: "Done today (1)" })).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(screen.getByRole("button", { name: "Complete Finish next" }));
        const toggle = await screen.findByRole("button", { name: "Done today (2)" });
        expect(screen.queryByRole("button", { name: "Complete Finish next" })).not.toBeInTheDocument();
        await waitFor(async () => {
            const stored = (await data.loadPMState())?.tasks.active;
            expect(stored).toMatchObject({ status: "Done", completedAt: expect.any(String) });
            expect(toLocalDateKey(new Date(stored!.completedAt!))).toBe(todayKey());
        });
        fireEvent.click(toggle);
        expect(screen.getByRole("button", { name: "Select Finish next" })).toBeInTheDocument();
    });

    it("pins waiting entries with accessible dots and includes their work in the summary", async () => {
        await renderSurface({ tasks: {
            due: pmTask({ id: "due", title: "Due now", estimatePomos: 2, dueDate: todayKey() }),
            waiting: pmTask({ id: "waiting", title: "Waiting flexible", estimatePomos: 3, dueDate: todayKey(), waiting: { type: "agent", since: "2026-08-12T09:00:00Z" } }),
            person: pmTask({ id: "person", title: "Waiting due", estimatePomos: 1, dueDate: todayKey(), waiting: { type: "person", since: "2026-08-12T09:00:00Z" } }),
        } });
        expect(await screen.findByText("6p this week")).toBeInTheDocument();
        expandSurface();
        const rows = screen.getAllByRole("listitem");
        expect(rows.map((row) => within(row).getByRole("button", { name: /^Select / }).getAttribute("aria-label")))
            .toEqual(["Select Waiting due", "Select Waiting flexible", "Select Due now"]);
        expect(within(rows[0]).getByRole("img", { name: "Waiting on person" })).toHaveAttribute("title", "Waiting on person");
        expect(within(rows[1]).getByRole("img", { name: "Waiting on agent" })).toBeInTheDocument();
        expect(screen.getByText("3p left of 3p")).toBeInTheDocument();
        expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Tasks", "To-dos", "Habits", "Pomodoros"]);
    });

    it("summarises the day while collapsed and reveals the groups when expanded", async () => {
        await renderSurface({
            tasks: {
                "task-a": pmTask({ id: "task-a", title: "Ship the report", projectId: "project-1", estimatePomos: 3, dueDate: todayKey() }),
                "task-b": pmTask({ id: "task-b", title: "Clear inbox", estimatePomos: 1, dueDate: todayKey() }),
            },
            projects: { "project-1": project({ workableDays: [new Date().getDay() as WorkableWeekday] }) },
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
        expect(await screen.findByText("4p this week")).toBeInTheDocument();
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

    it("lists Saturday work and excludes weekday-project pomodoros from the summary", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 15, 10));
        try {
            await renderSurface({
                tasks: {
                    weekday: pmTask({ id: "weekday", title: "Weekday work", projectId: "weekday", estimatePomos: 3, dueDate: todayKey() }),
                    saturday: pmTask({ id: "saturday", title: "Saturday work", projectId: "saturday", estimatePomos: 2, dueDate: todayKey() }),
                },
                projects: {
                    weekday: project({ id: "weekday" }),
                    saturday: project({ id: "saturday", workableDays: [6] }),
                },
            });

            expect(await screen.findByText("2p this week")).toBeInTheDocument();
            expandSurface();
            expect(screen.getByText("Saturday work")).toBeInTheDocument();
            expect(screen.queryByText("Weekday work")).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
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

    it("completes a task from its checkbox without selecting the row", async () => {
        const user = userEvent.setup();
        const onSelectTask = vi.fn();
        const data = await renderSurface({
            tasks: { "task-a": pmTask({ id: "task-a", title: "Ship the report", estimatePomos: 2, dueDate: todayKey() }) },
            onSelectTask,
        });
        expandSurface();

        const checkbox = await screen.findByRole("button", { name: "Complete Ship the report" });
        expect(checkbox).toHaveAttribute("aria-pressed", "false");

        await user.click(checkbox);

        await waitFor(async () => {
            const stored = await data.loadPMState();
            expect(stored?.tasks["task-a"].status).toBe("Done");
        });
        await waitFor(() => expect(screen.queryByRole("button", { name: "Select Ship the report" })).not.toBeInTheDocument());
        expect(screen.queryByRole("button", { name: "Complete Ship the report" })).not.toBeInTheDocument();
        expect(onSelectTask).not.toHaveBeenCalled();
    });

    it("shows a this-week badge and horizon chip for work due later this week", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 12, 10));
        try {
            await renderSurface({
                tasks: { "task-week": pmTask({ id: "task-week", title: "Friday work", estimatePomos: 2, dueDate: "2026-08-14" }) },
            });

            expect(await screen.findByText("2p this week")).toBeInTheDocument();
            expandSurface();
            expect(await screen.findByText("This week")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("selects a task from the list", async () => {
        const user = userEvent.setup();
        const onSelectTask = vi.fn();
        await renderSurface({
            tasks: { "task-a": pmTask({ id: "task-a", title: "Ship the report", estimatePomos: 2, dueDate: todayKey() }) },
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
            tasks: { linked: pmTask({ id: "linked", title: "Linked task", appTaskId: linked.id, estimatePomos: 2, dueDate: todayKey() }) },
            appState: { tasks: { [linked.id]: linked } },
        });
        expandSurface();

        await user.click(await screen.findByRole("button", { name: "Start focus on Linked task" }));
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent("app-linked"));
    });

    it("creates and links a timer task when starting focus on an unlinked task", async () => {
        const user = userEvent.setup();
        const data = await renderSurface({
            tasks: { unlinked: pmTask({ id: "unlinked", title: "Unlinked task", estimatePomos: 2, dueDate: todayKey() }) },
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

    it("communicates that a break is running instead of starting focus", async () => {
        const user = userEvent.setup();
        const running = appTask("app-running", "Running app task");
        await renderSurface({
            tasks: {
                running: pmTask({ id: "running", title: "Running task", appTaskId: running.id, estimatePomos: 2, dueDate: todayKey() }),
                other: pmTask({ id: "other", title: "Other task", estimatePomos: 2, dueDate: todayKey() }),
            },
            appState: {
                tasks: { [running.id]: running },
                active_task: running.id,
                timer: makeActiveTimer({ task_id: running.id, kind: "ShortBreak" }),
            },
        });
        expandSurface();
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent("app-running"));

        await user.click(await screen.findByRole("button", { name: "Start focus on Other task" }));
        expect(await screen.findByRole("status")).toHaveTextContent("A break is running.");
        expect(screen.getByTestId("timer-task")).toHaveTextContent("app-running");
    });

    it("renders the window count for a switched window", async () => {
        await renderSurface({
            appState: {
                logs: [
                    log({ id: "w-1", duration_minutes: 10, work_window_id: "window-1" }),
                    log({ id: "w-2", duration_minutes: 15, work_window_id: "window-1" }),
                ],
            },
        });

        expect(await screen.findByText("1p · 25m")).toBeInTheDocument();
        expect(screen.queryByText("2p · 25m")).not.toBeInTheDocument();
    });

    it("shows an empty state for each group", async () => {
        await renderSurface();

        expandSurface();

        expect(await screen.findByText("Nothing left for today!")).toBeInTheDocument();
        expect(screen.getByText("No habits yet.")).toBeInTheDocument();
        expect(screen.getByText("No pomodoros completed today.")).toBeInTheDocument();
        expect(screen.getByText("No tasks")).toBeInTheDocument();
        expect(screen.getByText("No habits")).toBeInTheDocument();
        expect(screen.getByText("No pomodoros")).toBeInTheDocument();
    });
});


describe("Today work-window handoff", () => {
    it("joins an existing Work window from another task's Start focus action", async () => {
        const running = appTask("running", "Running");
        const incoming = appTask("incoming", "Incoming");
        const data = await renderSurface({ tasks: {
            other: pmTask({ id: "other", title: "Incoming", appTaskId: incoming.id, estimatePomos: 2, dueDate: todayKey() }),
        }, appState: { tasks: { running, incoming }, active_task: running.id,
            timer: makeActiveTimer({ task_id: running.id, window_started_at: new Date().toISOString() }) } });
        const original = data.store.state.timer!;
        expandSurface();
        fireEvent.click(await screen.findByRole("button", { name: "Start focus on Incoming" }));
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent(incoming.id));
        expect(data.store.state.timer?.ends_at).toBe(original.ends_at);
        expect(data.store.state.timer?.window_started_at).toBe(original.window_started_at);
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
});

describe("Today deferred finalize", () => {
    it("keeps the running Work window and shows the pending hint when checking the task that owns it", async () => {
        const user = userEvent.setup();
        const running = appTask("app-running", "Running app task");
        const windowStartedAt = new Date(Date.now() - 5 * 60_000).toISOString();
        const data = await renderSurface({
            tasks: {
                running: pmTask({ id: "running", title: "Running task", appTaskId: running.id, estimatePomos: 2, dueDate: todayKey() }),
            },
            appState: {
                tasks: { [running.id]: running },
                active_task: running.id,
                timer: makeActiveTimer({ task_id: running.id, window_started_at: windowStartedAt }),
            },
        });
        expandSurface();
        await waitFor(() => expect(screen.getByTestId("timer-task")).toHaveTextContent(running.id));

        await user.click(screen.getByRole("button", { name: "Complete Running task" }));

        const toggle = await screen.findByRole("button", { name: "Done today (1)" });
        await waitFor(async () => {
            expect((await data.loadPMState())?.tasks.running.status).toBe("Done");
        });
        expect(data.store.state.timer?.task_id).toBe(running.id);
        expect(data.store.state.timer?.window_started_at).toBe(windowStartedAt);
        expect(data.store.state.tasks[running.id].completed_at).toBeNull();

        fireEvent.click(toggle);
        expect(await screen.findByText("finishing after this pomodoro")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Select Running task" })).toBeInTheDocument();
        expect(data.store.state.timer?.task_id).toBe(running.id);
        expect(data.store.state.timer?.window_started_at).toBe(windowStartedAt);
        expect(data.store.state.tasks[running.id].completed_at).toBeNull();
    });

    it("finalizes a linked task immediately when it is not running and shows no hint", async () => {
        const user = userEvent.setup();
        const linked = appTask("app-linked", "Linked app task", { completed_pomodoros: 1 });
        const data = await renderSurface({
            tasks: {
                linked: pmTask({ id: "linked", title: "Linked task", appTaskId: linked.id, estimatePomos: 2, dueDate: todayKey() }),
            },
            appState: { tasks: { [linked.id]: linked } },
        });
        expandSurface();
        await screen.findByText("1p left of 2p");

        await user.click(screen.getByRole("button", { name: "Complete Linked task" }));

        await waitFor(() => {
            expect(data.store.state.tasks[linked.id].completed_at).toEqual(expect.any(String));
            expect(data.store.state.tasks[linked.id].archived).toBe(true);
        });
        const toggle = await screen.findByRole("button", { name: "Done today (1)" });
        fireEvent.click(toggle);
        expect(screen.getByRole("button", { name: "Select Linked task" })).toBeInTheDocument();
        expect(screen.queryByText("finishing after this pomodoro")).not.toBeInTheDocument();
    });

    it("completes an unlinked task on the PM side only", async () => {
        const user = userEvent.setup();
        const data = await renderSurface({
            tasks: { unlinked: pmTask({ id: "unlinked", title: "Unlinked task", estimatePomos: 2, dueDate: todayKey() }) },
        });
        expandSurface();

        await user.click(await screen.findByRole("button", { name: "Complete Unlinked task" }));

        await waitFor(async () => {
            expect((await data.loadPMState())?.tasks.unlinked.status).toBe("Done");
        });
        expect(Object.keys(data.store.state.tasks)).toHaveLength(0);
        expect(data.store.state.timer).toBeNull();
        await screen.findByRole("button", { name: "Done today (1)" });
    });

    it("completes a PM task whose backend task is missing without an error notice", async () => {
        const user = userEvent.setup();
        const data = await renderSurface({
            tasks: {
                orphan: pmTask({ id: "orphan", title: "Orphan task", appTaskId: "app-missing", estimatePomos: 2, dueDate: todayKey() }),
            },
        });
        expandSurface();

        await user.click(await screen.findByRole("button", { name: "Complete Orphan task" }));

        await waitFor(async () => {
            expect((await data.loadPMState())?.tasks.orphan.status).toBe("Done");
        });
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(data.store.state.tasks["app-missing"]).toBeUndefined();
    });

    it("shows the finalize notice when the backend rejects and still marks the PM task Done", async () => {
        const user = userEvent.setup();
        const linked = appTask("app-linked", "Linked app task", { completed_pomodoros: 1 });
        const data = await renderSurface({
            tasks: {
                linked: pmTask({ id: "linked", title: "Linked task", appTaskId: linked.id, estimatePomos: 2, dueDate: todayKey() }),
            },
            appState: { tasks: { [linked.id]: linked } },
        });
        const finalizeSpy = vi.spyOn(data, "finalizeTask").mockRejectedValueOnce(new Error("Task not found"));
        expandSurface();
        await screen.findByText("1p left of 2p");

        await user.click(screen.getByRole("button", { name: "Complete Linked task" }));

        expect(await screen.findByRole("status")).toHaveTextContent("Couldn't finish “Linked task” on the timer.");
        expect(finalizeSpy).toHaveBeenCalledWith(linked.id);
        await waitFor(async () => {
            expect((await data.loadPMState())?.tasks.linked.status).toBe("Done");
        });
        expect(data.store.state.tasks[linked.id].completed_at).toBeNull();
    });
});
