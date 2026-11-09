import { describe, expect, it } from "vitest";
import { defaultAppState, startWorkTimer, setActiveTask } from "./engine";
import type { Habit, HabitCompletion, PMTask, PomodoroLogEntry, Project, Task } from "../state/types";
import {
    computeActiveFractionComplete,
    buildProjectionBacklogs,
    collectEligibleProjectionTasks,
    getLocalWeekWindow,
} from "./timer";
import {
    buildTodayHabits,
    buildTodayOverview,
    buildTodayPomodoros,
    buildTodayTasks,
} from "./today";

const REFERENCE = new Date(2026, 7, 12, 9, 30);

function pmTask(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-task",
        title: "Task",
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
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

function backendTask(overrides: Partial<Task> = {}): Task {
    return {
        id: "app-task",
        name: "App task",
        target_pomodoros: 1,
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
        name: "Project one",
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
        name: "Habit",
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

function completion(habitId: string, bucket: string): HabitCompletion {
    return {
        id: `${habitId}-${bucket}`,
        habitId,
        bucket,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function log(overrides: Partial<PomodoroLogEntry> = {}): PomodoroLogEntry {
    return {
        id: "log-1",
        task_id: "app-task",
        duration_minutes: 25,
        finished_at: "2026-08-12T10:00:00",
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

describe("buildTodayTasks", () => {
    it("pins waiting first, then bucket, due date and title without changing scope or remaining work", () => {
        const waiting = { type: "agent" as const, since: "2026-08-12T09:00:00Z" };
        const pmTasks = [
            pmTask({ id: "normal-flex", title: "A", estimatePomos: 2 }),
            pmTask({ id: "wait-flex", title: "Z", estimatePomos: 1.5, waiting }),
            pmTask({ id: "wait-today", dueDate: "2026-08-12", estimatePomos: 3, waiting }),
            pmTask({ id: "wait-overdue-z", title: "Z", dueDate: "2026-08-11", estimatePomos: 1, waiting }),
            pmTask({ id: "normal-today", dueDate: "2026-08-12", estimatePomos: 1 }),
            pmTask({ id: "wait-overdue-a", title: "A", dueDate: "2026-08-11", estimatePomos: 2, waiting }),
            pmTask({ id: "wait-earliest", title: "Z", dueDate: "2026-08-10", estimatePomos: 1, waiting }),
            pmTask({ id: "normal-overdue-z", title: "Z", dueDate: "2026-08-11", estimatePomos: 1 }),
            pmTask({ id: "normal-overdue-a", title: "A", dueDate: "2026-08-11", estimatePomos: 1 }),
            pmTask({ id: "normal-earliest", dueDate: "2026-08-09", estimatePomos: 1 }),
            pmTask({ id: "future", dueDate: "2026-08-17", estimatePomos: 8, waiting }),
            pmTask({ id: "done", status: "Done", estimatePomos: 8, waiting }),
            pmTask({ id: "archived", isArchived: true, estimatePomos: 8, waiting }),
            pmTask({ id: "unestimated", waiting }),
        ];
        const input = { reference: REFERENCE, backendTasks: {}, projects: {} };
        const pinned = buildTodayTasks({ ...input, pmTasks });
        const unpinned = buildTodayTasks({ ...input, pmTasks: pmTasks.map((task) => ({ ...task, waiting: null })) });

        expect(pinned.tasks.map((task) => task.id)).toEqual([
            "wait-earliest", "wait-overdue-a", "wait-overdue-z", "wait-today", "wait-flex",
            "normal-earliest", "normal-overdue-a", "normal-overdue-z", "normal-today", "normal-flex",
        ]);
        expect(pinned.remainingPomodoros).toBe(unpinned.remainingPomodoros);
        expect(pinned.remainingPomodoros).toBe(14.5);
        expect(pinned.tasks.map((task) => task.id).sort()).toEqual(unpinned.tasks.map((task) => task.id).sort());
        expect(pinned.tasks[0].waiting).toEqual(waiting);
        expect(pinned.tasks[pinned.tasks.length - 1].waiting).toBeNull();
    });

    it("classifies due-today, overdue, and undated work against one reference date", () => {
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "overdue", title: "Overdue", dueDate: "2026-08-10", estimatePomos: 2 }),
                pmTask({ id: "today", title: "Due today", dueDate: "2026-08-12", estimatePomos: 1 }),
                pmTask({ id: "flexible", title: "Flexible", estimatePomos: 3 }),
                pmTask({ id: "this-week", title: "This week", dueDate: "2026-08-14", estimatePomos: 4 }),
                pmTask({ id: "future", title: "Future", dueDate: "2026-08-17", estimatePomos: 5 }),
            ],
            backendTasks: {},
            projects: {},
        });

        expect(result.tasks.map((task) => task.id)).toEqual(["overdue", "today", "flexible"]);
        expect(result.tasks.map((task) => task.bucket)).toEqual(["overdue", "today", "flexible"]);
        expect(result.remainingPomodoros).toBe(6);
    });

    it("excludes archived, Done, completed backend, and no-estimate tasks", () => {
        const completed = backendTask({ id: "completed-app", completed_at: "2026-08-11T10:00:00.000Z" });
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "archived", estimatePomos: 2, isArchived: true }),
                pmTask({ id: "done", estimatePomos: 2, status: "Done" }),
                pmTask({ id: "completed", estimatePomos: 2, appTaskId: completed.id }),
                pmTask({ id: "no-estimate" }),
                pmTask({ id: "kept", estimatePomos: 1 }),
            ],
            backendTasks: { [completed.id]: completed },
            projects: {},
        });

        expect(result.tasks.map((task) => task.id)).toEqual(["kept"]);
    });

    it("uses the backend target when a task has no explicit estimate", () => {
        const backend = backendTask({ id: "target-app", target_pomodoros: 3, completed_pomodoros: 1 });
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [pmTask({ id: "target", appTaskId: backend.id })],
            backendTasks: { [backend.id]: backend },
            projects: {},
        });

        expect(result.tasks[0]).toMatchObject({ estimatePomos: 3, workedPomos: 1, remainingPomodoros: 2 });
    });

    it("counts a partially completed active timer against the remaining estimate", () => {
        const backend = backendTask({ id: "active-app", target_pomodoros: 2, completed_pomodoros: 0 });
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [pmTask({ id: "active", appTaskId: backend.id, estimatePomos: 2 })],
            backendTasks: { [backend.id]: backend },
            projects: {},
            activeWorkTaskId: backend.id,
            activeWorkFraction: 0.5,
        });

        expect(result.tasks[0].isActive).toBe(true);
        expect(result.tasks[0].remainingPomodoros).toBeCloseTo(1.5, 5);
        expect(result.remainingPomodoros).toBeCloseTo(1.5, 5);
    });

    it("leaves one pomodoro of work for an over-estimated unfinished task", () => {
        const backend = backendTask({ id: "over-app", completed_pomodoros: 3 });
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [pmTask({ id: "over", appTaskId: backend.id, estimatePomos: 2 })],
            backendTasks: { [backend.id]: backend },
            projects: {},
        });

        expect(result.tasks[0].remainingPomodoros).toBe(1);
    });

    it("resolves project metadata and marks unknown projects as no project", () => {
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "with-project", projectId: "project-1", estimatePomos: 1 }),
                pmTask({ id: "missing-project", projectId: "gone", estimatePomos: 1 }),
            ],
            backendTasks: {},
            projects: { "project-1": project() },
        });

        const withProject = result.tasks.find((task) => task.id === "with-project");
        const missingProject = result.tasks.find((task) => task.id === "missing-project");
        expect(withProject?.projectName).toBe("Project one");
        expect(withProject?.projectColor).toBe("#10B981");
        expect(missingProject?.projectId).toBeNull();
        expect(missingProject?.projectName).toBeNull();
    });

    it("includes only workable and unassigned tasks on Saturday", () => {
        const result = buildTodayTasks({
            reference: new Date(2026, 7, 15, 0, 1),
            pmTasks: [
                pmTask({ id: "weekday-due", projectId: "weekday", dueDate: "2026-08-15", estimatePomos: 2 }),
                pmTask({ id: "weekday-overdue", projectId: "weekday", dueDate: "2026-08-14", estimatePomos: 3 }),
                pmTask({ id: "weekday-flexible", projectId: "weekday", estimatePomos: 4 }),
                pmTask({ id: "saturday", projectId: "saturday", estimatePomos: 1.5 }),
                pmTask({ id: "unassigned", dueDate: "2026-08-15", estimatePomos: 2 }),
                pmTask({ id: "missing-project", projectId: "gone", dueDate: "2026-08-14", estimatePomos: 1 }),
            ],
            backendTasks: {},
            projects: {
                weekday: project({ id: "weekday" }),
                saturday: project({ id: "saturday", workableDays: [6] }),
            },
        });

        expect(result.tasks.map((task) => task.id)).toEqual(["missing-project", "unassigned", "saturday"]);
        expect(result.remainingPomodoros).toBe(4.5);
    });

    it("agrees with the daily projected-finish backlog", () => {
        const input = {
            reference: REFERENCE,
            backendTasks: {},
            projects: { weekend: project({ id: "weekend", workableDays: [0, 6] }) },
            pmTasks: [
                pmTask({ id: "overdue", dueDate: "2026-08-10", estimatePomos: 2, waiting: { type: "person", since: "2026-08-10T09:00:00Z" } }),
                pmTask({ id: "today", dueDate: "2026-08-12", estimatePomos: 1.5 }),
                pmTask({ id: "flexible", estimatePomos: 3 }),
                pmTask({ id: "this-week", dueDate: "2026-08-14", estimatePomos: 4 }),
                pmTask({ id: "future", dueDate: "2026-08-17", estimatePomos: 5 }),
                pmTask({ id: "off-today", projectId: "weekend", dueDate: "2026-08-12", estimatePomos: 6 }),
            ],
        };
        const eligible = collectEligibleProjectionTasks(input);
        const { daily } = buildProjectionBacklogs(eligible, input.reference, input.projects);
        const today = buildTodayTasks(input);

        expect(today.remainingPomodoros).toBeCloseTo(daily.totalPomodoros, 10);
        expect(today.tasks.map((task) => task.id)).toEqual(["overdue", "today", "flexible"]);
        expect(getLocalWeekWindow(REFERENCE).endKey).toBe("2026-08-16");
    });
});

describe("buildTodayHabits", () => {
    it("uses the current day, week, and month buckets for each frequency", () => {
        const result = buildTodayHabits({
            reference: REFERENCE,
            habits: [
                habit({ id: "daily", frequency: "daily", position: 0 }),
                habit({ id: "weekly", frequency: "weekly", position: 1 }),
                habit({ id: "monthly", frequency: "monthly", position: 2 }),
            ],
            completions: [],
        });

        expect(result.map((entry) => [entry.id, entry.bucket])).toEqual([
            ["daily", "2026-08-12"],
            ["weekly", "2026-08-09"],
            ["monthly", "2026-08-01"],
        ]);
    });

    it("reports completion state only for the current bucket", () => {
        const result = buildTodayHabits({
            reference: REFERENCE,
            habits: [
                habit({ id: "done", name: "Done habit", position: 0 }),
                habit({ id: "open", name: "Open habit", position: 1 }),
            ],
            completions: [
                completion("done", "2026-08-12"),
                completion("open", "2026-08-11"),
            ],
        });

        expect(result[0]).toMatchObject({ completed: true, name: "Done habit" });
        expect(result[1]).toMatchObject({ completed: false, name: "Open habit" });
    });

    it("excludes archived habits and keeps position order", () => {
        const result = buildTodayHabits({
            reference: REFERENCE,
            habits: [
                habit({ id: "second", position: 2 }),
                habit({ id: "archived", position: 0, isArchived: true }),
                habit({ id: "first", position: 1 }),
            ],
            completions: [],
        });

        expect(result.map((entry) => entry.id)).toEqual(["first", "second"]);
    });
});

describe("buildTodayPomodoros", () => {
    it("counts only today's completed focus sessions by local finished date", () => {
        const result = buildTodayPomodoros({
            reference: REFERENCE,
            logs: [
                log({ id: "morning", duration_minutes: 25, finished_at: "2026-08-12T09:00:00" }),
                log({ id: "afternoon", duration_minutes: 30, finished_at: "2026-08-12T14:00:00" }),
                log({ id: "break", duration_minutes: 5, finished_at: "2026-08-12T10:30:00", was_break: true }),
                log({ id: "yesterday", duration_minutes: 25, finished_at: "2026-08-11T23:00:00" }),
                log({ id: "invalid", finished_at: "not-a-date" }),
            ],
        });

        expect(result.count).toBe(2);
        expect(result.minutes).toBe(55);
        expect(result.sessions.map((session) => session.id)).toEqual(["afternoon", "morning"]);
    });

    describe("window counting (D7)", () => {
        const at = (id: string, duration: number, extra: Partial<PomodoroLogEntry> = {}) =>
            log({ id, duration_minutes: duration, finished_at: "2026-08-12T10:00:00", ...extra });

        it("counts a switched window as one pomodoro", () => {
            const result = buildTodayPomodoros({
                reference: REFERENCE,
                logs: [at("a", 10, { work_window_id: "w1" }), at("b", 15, { work_window_id: "w1" })],
            });
            expect(result.count).toBe(1);
            expect(result.minutes).toBe(25);
        });

        it("counts logs with null or absent window ids individually", () => {
            const result = buildTodayPomodoros({
                reference: REFERENCE,
                logs: [at("a", 10, { work_window_id: null }), at("b", 15)],
            });
            expect(result.count).toBe(2);
            expect(result.minutes).toBe(25);
        });

        it("treats an empty-string window id like null", () => {
            const result = buildTodayPomodoros({
                reference: REFERENCE,
                logs: [at("a", 10, { work_window_id: "" }), at("b", 15, { work_window_id: "" })],
            });
            expect(result.count).toBe(2);
        });

        it("handles a mixed day with a window, a legacy log and a break", () => {
            const result = buildTodayPomodoros({
                reference: REFERENCE,
                logs: [
                    at("a", 10, { work_window_id: "w1" }),
                    at("b", 15, { work_window_id: "w1" }),
                    at("legacy", 20),
                    at("break", 5, { was_break: true, work_window_id: "w1" }),
                ],
            });
            expect(result.count).toBe(2);
            expect(result.minutes).toBe(45);
        });
    });

    it("labels sessions with the project task title, backend name, or a fallback", () => {
        const result = buildTodayPomodoros({
            reference: REFERENCE,
            backendTasks: {
                "app-task": backendTask({ id: "app-task", name: "Backend name" }),
                "other-app": backendTask({ id: "other-app", name: "Backend only" }),
            },
            pmTasks: [pmTask({ id: "pm-task", title: "Project title", appTaskId: "app-task" })],
            logs: [
                log({ id: "linked", task_id: "app-task" }),
                log({ id: "backend-only", task_id: "other-app" }),
                log({ id: "missing", task_id: "ghost" }),
            ],
        });

        expect(result.sessions.find((session) => session.id === "linked")?.taskTitle).toBe("Project title");
        expect(result.sessions.find((session) => session.id === "backend-only")?.taskTitle).toBe("Backend only");
        expect(result.sessions.find((session) => session.id === "missing")?.taskTitle).toBe("Unassigned task");
    });
});

describe("buildTodayOverview", () => {
    it("assembles the three groups from one reference date", () => {
        const overview = buildTodayOverview({
            reference: REFERENCE,
            pmTasks: [pmTask({ id: "task", estimatePomos: 2, dueDate: "2026-08-12" })],
            backendTasks: {},
            projects: {},
            habits: [habit({ id: "h1" }), habit({ id: "h2", position: 1 })],
            completions: [completion("h1", "2026-08-12")],
            logs: [log({ id: "log", finished_at: "2026-08-12T11:00:00" })],
        });

        expect(overview.tasks.map((task) => task.id)).toEqual(["task"]);
        expect(overview.remainingPomodoros).toBe(2);
        expect(overview.habitsCompleted).toBe(1);
        expect(overview.pomodoros.count).toBe(1);
    });
});


describe("post-review Today accounting", () => {
    it("preserves 1.6p remaining when A switches to B at ten minutes", () => {
        const state = defaultAppState();
        state.tasks = { a: backendTask({ id: "a" }), b: backendTask({ id: "b" }) };
        state.active_task = "a";
        const running = startWorkTimer(state, REFERENCE).state;
        const now = new Date(REFERENCE.getTime() + 600_000);
        const switched = setActiveTask(running, "b", now, "switch").state;
        const tasks = [pmTask({ id: "a", appTaskId: "a", estimatePomos: 1 }), pmTask({ id: "b", appTaskId: "b", estimatePomos: 1 })];
        const remaining = (s: typeof state) => buildTodayTasks({ reference: REFERENCE, pmTasks: tasks, backendTasks: s.tasks, projects: {}, activeWorkTaskId: s.timer!.task_id, activeWorkFraction: computeActiveFractionComplete(s.timer, now.getTime(), 25) }).remainingPomodoros;
        expect(remaining(running)).toBeCloseTo(1.6);
        expect(remaining(switched)).toBeCloseTo(remaining(running));
    });
    it("orders equal titles and due dates by id independently of insertion order", () => {
        const tasks = [pmTask({ id: "b", estimatePomos: 1 }), pmTask({ id: "a", estimatePomos: 1 })];
        for (const pmTasks of [tasks, [...tasks].reverse()]) {
            expect(buildTodayTasks({ reference: REFERENCE, pmTasks, backendTasks: {}, projects: {} }).tasks.map(t => t.id)).toEqual(["a", "b"]);
        }
    });

});
