import { describe, expect, it } from "vitest";
import { defaultAppState, startWorkTimer, setActiveTask } from "./engine";
import type { Habit, HabitCompletion, PMTask, PomodoroLogEntry, Project, Task } from "../state/types";
import {
    computeActiveFractionComplete,
    buildProjectionBacklogs,
    classifyDueScope,
    collectEligibleProjectionTasks,
    getDailyProjectionScope,
    getLocalWeekWindow,
} from "./timer";
import {
    buildTodayDone,
    buildTodayHabits,
    buildTodayOverview,
    buildTodayPomodoros,
    buildTodayTasks,
    getTodayDueScope,
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

describe("getTodayDueScope", () => {
    const weekendProject = project({ id: "weekend", workableDays: [0, 6] });

    it.each([
        { dueDate: "2026-08-10", project: undefined, expected: "overdue" },
        { dueDate: "2026-08-12", project: undefined, expected: "today" },
        { dueDate: "2026-08-13", project: undefined, expected: "thisWeek" },
        { dueDate: "2026-08-16", project: undefined, expected: "thisWeek" },
        { dueDate: "2026-08-17", project: undefined, expected: null },
        { dueDate: null, project: undefined, expected: null },
        { dueDate: "", project: undefined, expected: null },
        { dueDate: "2026-08-10", project: weekendProject, expected: null },
        { dueDate: "2026-08-12", project: weekendProject, expected: null },
        { dueDate: "2026-08-14", project: weekendProject, expected: "thisWeek" },
    ])("classifies $dueDate with the worked-example table", ({ dueDate, project: scheduled, expected }) => {
        expect(getTodayDueScope(dueDate, scheduled, REFERENCE)).toBe(expected);
    });

    it("uses the Sunday reference window", () => {
        const sunday = new Date(2026, 7, 16, 10);
        expect(getTodayDueScope("2026-08-16", undefined, sunday)).toBe("today");
        expect(getTodayDueScope("2026-08-17", undefined, sunday)).toBeNull();
    });

    it("uses the Monday reference window", () => {
        const monday = new Date(2026, 7, 17, 10);
        expect(getTodayDueScope("2026-08-16", undefined, monday)).toBe("overdue");
        expect(getTodayDueScope("2026-08-23", undefined, monday)).toBe("thisWeek");
    });
});

describe("buildTodayTasks", () => {
    it("pins waiting first, then bucket, due date and title without changing scope or remaining work", () => {
        const waiting = { type: "agent" as const, since: "2026-08-12T09:00:00Z" };
        const pmTasks = [
            pmTask({ id: "normal-flex", title: "A", dueDate: "2026-08-14", estimatePomos: 2 }),
            pmTask({ id: "wait-flex", title: "Z", dueDate: "2026-08-14", estimatePomos: 1.5, waiting }),
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

    it("classifies due-today, overdue, this-week, and undated work against one reference date", () => {
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

        expect(result.tasks.map((task) => task.id)).toEqual(["overdue", "today", "this-week"]);
        expect(result.tasks.map((task) => task.bucket)).toEqual(["overdue", "today", "thisWeek"]);
        expect(result.remainingPomodoros).toBe(7);
    });

    it("excludes archived, Done, completed backend, and no-estimate tasks", () => {
        const completed = backendTask({ id: "completed-app", completed_at: "2026-08-11T10:00:00.000Z" });
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "archived", dueDate: "2026-08-12", estimatePomos: 2, isArchived: true }),
                pmTask({ id: "done", dueDate: "2026-08-12", estimatePomos: 2, status: "Done" }),
                pmTask({ id: "completed", dueDate: "2026-08-12", estimatePomos: 2, appTaskId: completed.id }),
                pmTask({ id: "no-estimate", dueDate: "2026-08-12" }),
                pmTask({ id: "kept", dueDate: "2026-08-12", estimatePomos: 1 }),
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
            pmTasks: [pmTask({ id: "target", dueDate: "2026-08-12", appTaskId: backend.id })],
            backendTasks: { [backend.id]: backend },
            projects: {},
        });

        expect(result.tasks[0]).toMatchObject({ estimatePomos: 3, workedPomos: 1, remainingPomodoros: 2 });
    });

    it("counts a partially completed active timer against the remaining estimate", () => {
        const backend = backendTask({ id: "active-app", target_pomodoros: 2, completed_pomodoros: 0 });
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [pmTask({ id: "active", appTaskId: backend.id, dueDate: "2026-08-12", estimatePomos: 2 })],
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
            pmTasks: [pmTask({ id: "over", appTaskId: backend.id, dueDate: "2026-08-12", estimatePomos: 2 })],
            backendTasks: { [backend.id]: backend },
            projects: {},
        });

        expect(result.tasks[0].remainingPomodoros).toBe(1);
    });

    it("resolves project metadata and marks unknown projects as no project", () => {
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "with-project", projectId: "project-1", dueDate: "2026-08-12", estimatePomos: 1 }),
                pmTask({ id: "missing-project", projectId: "gone", dueDate: "2026-08-12", estimatePomos: 1 }),
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
                pmTask({ id: "weekday-this-week", projectId: "weekday", dueDate: "2026-08-16", estimatePomos: 2 }),
                pmTask({ id: "saturday", projectId: "saturday", dueDate: "2026-08-15", estimatePomos: 1.5 }),
                pmTask({ id: "unassigned", dueDate: "2026-08-15", estimatePomos: 2 }),
                pmTask({ id: "missing-project", projectId: "gone", dueDate: "2026-08-14", estimatePomos: 1 }),
            ],
            backendTasks: {},
            projects: {
                weekday: project({ id: "weekday" }),
                saturday: project({ id: "saturday", workableDays: [6] }),
            },
        });

        expect(result.tasks.map((task) => task.id)).toEqual(["missing-project", "saturday", "unassigned", "weekday-this-week"]);
        expect(result.remainingPomodoros).toBe(6.5);
    });

    it("measures a different set than the daily projected-finish backlog", () => {
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

        expect(today.tasks.map((task) => task.id)).toEqual(["overdue", "today", "this-week"]);
        expect(today.remainingPomodoros).toBe(7.5);
        expect(daily.totalPomodoros).toBe(6.5);
        expect(getLocalWeekWindow(REFERENCE).endKey).toBe("2026-08-16");
    });

    it("keeps the daily projection scope and backlog values unchanged", () => {
        const projects: Readonly<Record<string, Project>> = { weekend: project({ id: "weekend", workableDays: [0, 6] }) };
        const input = {
            reference: REFERENCE,
            backendTasks: {},
            projects,
            pmTasks: [
                pmTask({ id: "overdue", dueDate: "2026-08-10", estimatePomos: 2 }),
                pmTask({ id: "today", dueDate: "2026-08-12", estimatePomos: 1.5 }),
                pmTask({ id: "unscheduled", estimatePomos: 3 }),
                pmTask({ id: "this-week", dueDate: "2026-08-14", estimatePomos: 4 }),
                pmTask({ id: "future", dueDate: "2026-08-17", estimatePomos: 5 }),
                pmTask({ id: "off-today", projectId: "weekend", dueDate: "2026-08-12", estimatePomos: 6 }),
            ],
        };
        const eligible = collectEligibleProjectionTasks(input);
        const { daily } = buildProjectionBacklogs(eligible, input.reference, input.projects);

        expect(daily.totalPomodoros).toBe(6.5);
        expect(daily.dueTodayOrOverduePomodoros).toBe(3.5);
        expect(daily.unscheduledPomodoros).toBe(3);

        const scopes = Object.fromEntries(eligible.map((entry) => [
            entry.task.id,
            getDailyProjectionScope(
                classifyDueScope(entry.dueDate, input.reference),
                entry.projectId ? input.projects[entry.projectId] : undefined,
                input.reference,
            ),
        ]));
        expect(scopes).toEqual({
            overdue: "due",
            today: "due",
            unscheduled: "unscheduled",
            "this-week": null,
            future: null,
            "off-today": null,
        });
    });

    it("admits tomorrow and this-week work, and excludes next-month, unscheduled, and non-workable overdue work", () => {
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "tomorrow", title: "Tomorrow", dueDate: "2026-08-13", estimatePomos: 1 }),
                pmTask({ id: "next-month", title: "Next month", dueDate: "2026-09-12", estimatePomos: 2 }),
                pmTask({ id: "unscheduled", title: "Unscheduled", estimatePomos: 3 }),
                pmTask({ id: "off-overdue", title: "Off overdue", projectId: "weekend", dueDate: "2026-08-10", estimatePomos: 4 }),
                pmTask({ id: "off-this-week", title: "Off this week", projectId: "weekend", dueDate: "2026-08-14", estimatePomos: 5 }),
            ],
            backendTasks: {},
            projects: { weekend: project({ id: "weekend", workableDays: [0, 6] }) },
        });

        expect(result.tasks.map((task) => task.id)).toEqual(["tomorrow", "off-this-week"]);
        expect(result.tasks.map((task) => task.bucket)).toEqual(["thisWeek", "thisWeek"]);
        expect(result.remainingPomodoros).toBe(6);
    });

    it("sorts waiting first, then overdue, today, thisWeek, dueKey, title, and id", () => {
        const result = buildTodayTasks({
            reference: REFERENCE,
            pmTasks: [
                pmTask({ id: "tw-b", title: "B", dueDate: "2026-08-14", estimatePomos: 1 }),
                pmTask({ id: "tw-a2", title: "A", dueDate: "2026-08-14", estimatePomos: 1 }),
                pmTask({ id: "tw-a1", title: "A", dueDate: "2026-08-14", estimatePomos: 1 }),
                pmTask({ id: "today-z", title: "Z", dueDate: "2026-08-12", estimatePomos: 1 }),
                pmTask({ id: "od-b", title: "B", dueDate: "2026-08-11", estimatePomos: 1 }),
                pmTask({ id: "od-a", title: "A", dueDate: "2026-08-11", estimatePomos: 1 }),
                pmTask({ id: "wait-tw", title: "A", dueDate: "2026-08-14", estimatePomos: 1, waiting: { type: "agent", since: "2026-08-12T09:00:00Z" } }),
                pmTask({ id: "wait-od", title: "A", dueDate: "2026-08-10", estimatePomos: 1, waiting: { type: "agent", since: "2026-08-12T09:00:00Z" } }),
            ],
            backendTasks: {},
            projects: {},
        });

        expect(result.tasks.map((task) => task.id)).toEqual([
            "wait-od", "wait-tw", "od-a", "od-b", "today-z", "tw-a1", "tw-a2", "tw-b",
        ]);
    });
});

describe("buildTodayDone", () => {
    const today = new Date(2026, 7, 12, 8).toISOString();
    const yesterday = new Date(2026, 7, 11, 20).toISOString();

    it.each<{ name: string; task: Partial<PMTask>; backend?: Partial<Task>; included: boolean }>([
        { name: "unlinked Done today", task: { completedAt: today }, included: true },
        { name: "unlinked Done yesterday", task: { completedAt: yesterday }, included: false },
        { name: "linked Done without PM stamp", task: { appTaskId: "app-task" }, backend: { completed_at: today }, included: true },
        { name: "linked pending finalize uses PM stamp", task: { appTaskId: "app-task", completedAt: today }, backend: { completed_at: null }, included: true },
        { name: "backend yesterday wins over PM today", task: { appTaskId: "app-task", completedAt: today }, backend: { completed_at: yesterday }, included: false },
        { name: "linked not Done despite backend completion", task: { appTaskId: "app-task", status: "In Progress" }, backend: { completed_at: today }, included: false },
        { name: "legacy Done is never backfilled from updatedAt", task: { updatedAt: today }, included: false },
        { name: "reopened Backlog with stale stamp", task: { status: "Backlog", completedAt: today }, included: false },
        { name: "archived and Done counts once", task: { isArchived: true, completedAt: today }, included: true },
        { name: "unparseable stamp", task: { completedAt: "not-a-date" }, included: false },
        { name: "unparseable backend wins over valid PM stamp", task: { appTaskId: "app-task", completedAt: today }, backend: { completed_at: "not-a-date" }, included: false },
        { name: "missing backend falls back to PM stamp", task: { appTaskId: "missing", completedAt: today }, included: true },
    ])("$name", ({ task, backend, included }) => {
        const entry = pmTask({ status: "Done", ...task });
        const backendTasks: Record<string, Task> = backend ? { "app-task": backendTask(backend) } : {};
        const input = { reference: REFERENCE, pmTasks: [entry, entry], backendTasks };
        const before = structuredClone(input);
        const result = buildTodayDone(input);
        expect(result).toEqual(included ? [{
            kind: "task", key: `task:${entry.id}`, id: entry.id, title: entry.title,
            completedAt: backend?.completed_at || entry.completedAt, appTaskId: entry.appTaskId ?? null,
        }] : []);
        expect(input).toEqual(before);
    });

    it("sorts by completion instant descending then key ascending and falls back for empty titles", () => {
        const early = new Date(2026, 7, 12, 7).toISOString();
        const pmTasks = [
            pmTask({ id: "old", status: "Done", completedAt: early }),
            pmTask({ id: "z", status: "Done", completedAt: today }),
            pmTask({ id: "a", status: "Done", completedAt: new Date(2026, 7, 12, 8).toString(), title: "" }),
        ];
        for (const tasks of [pmTasks, [...pmTasks].reverse()]) {
            const result = buildTodayDone({ reference: REFERENCE, pmTasks: tasks, backendTasks: {} });
            expect(result.map((entry) => entry.key)).toEqual(["task:a", "task:z", "task:old"]);
            expect(result[0].title).toBe("Untitled task");
        }
    });

    it("exposes done in buildTodayOverview", () => {
        const input = { reference: REFERENCE, pmTasks: [pmTask({ status: "Done", completedAt: today })],
            backendTasks: {}, projects: {}, habits: [], completions: [], logs: [] };
        expect(buildTodayOverview(input).done).toEqual(buildTodayDone(input));
        expect(buildTodayOverview(input).tasks).toEqual([]);
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
        const tasks = [pmTask({ id: "a", appTaskId: "a", dueDate: "2026-08-12", estimatePomos: 1 }), pmTask({ id: "b", appTaskId: "b", dueDate: "2026-08-12", estimatePomos: 1 })];
        const remaining = (s: typeof state) => buildTodayTasks({ reference: REFERENCE, pmTasks: tasks, backendTasks: s.tasks, projects: {}, activeWorkTaskId: s.timer!.task_id, activeWorkFraction: computeActiveFractionComplete(s.timer, now.getTime(), 25) }).remainingPomodoros;
        expect(remaining(running)).toBeCloseTo(1.6);
        expect(remaining(switched)).toBeCloseTo(remaining(running));
    });
    it("orders equal titles and due dates by id independently of insertion order", () => {
        const tasks = [pmTask({ id: "b", dueDate: "2026-08-12", estimatePomos: 1 }), pmTask({ id: "a", dueDate: "2026-08-12", estimatePomos: 1 })];
        for (const pmTasks of [tasks, [...tasks].reverse()]) {
            expect(buildTodayTasks({ reference: REFERENCE, pmTasks, backendTasks: {}, projects: {} }).tasks.map(t => t.id)).toEqual(["a", "b"]);
        }
    });

});
