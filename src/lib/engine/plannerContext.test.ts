import { describe, expect, it } from "vitest";
import type { PMTask, PomodoroLogEntry, ProjectManagerState } from "../../state/types";
import { buildPlannerContext } from "./plannerContext";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function task(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-1",
        title: "Write report",
        projectId: "project-1",
        status: "In Progress",
        priority: "Medium",
        estimatePomos: 4,
        workedPomos: 2,
        timeSpentMinutes: 50,
        tags: ["work"],
        links: ["https://example.com/private"],
        checklist: [{ id: "check-1", title: "Outline", done: false }],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
        appTaskId: "app-1",
        relatedTo: ["pm-0"],
        ...overrides,
    };
}

function log(taskId: string, finishedAt: string, overrides: Partial<PomodoroLogEntry> = {}): PomodoroLogEntry {
    return {
        id: `${taskId}-${finishedAt}`,
        task_id: taskId,
        duration_minutes: 25,
        finished_at: finishedAt,
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

function pmState(tasks: PMTask[]): ProjectManagerState {
    return {
        projects: {},
        tasks: Object.fromEntries(tasks.map((item) => [item.id, item])),
        ui: {
            selectedProjectIds: ["project-1"],
            selectedTaskId: null,
            view: "list",
            listGrouping: "none",
            statusFilter: [],
            tagFilter: [],
            priorityFilter: [],
            search: "",
            showArchived: false,
            sort: "manual",
            dueFilter: "all",
            boardShowAllTasks: false,
        },
        meta: { initializedAt: NOW.toISOString() },
    };
}

describe("buildPlannerContext", () => {
    it("includes selected-project tasks across all statuses (including archived context) and sanitizes them", () => {
        const done = task({ id: "pm-done", title: "Already done", status: "Done", sortOrder: 1 });
        const otherProject = task({ id: "pm-other", projectId: "project-2", sortOrder: 2 });
        const archived = task({ id: "pm-archived", isArchived: true, sortOrder: 3 });

        const result = buildPlannerContext({
            pmState: pmState([task(), done, otherProject, archived]),
            logs: [],
            settings: { work_minutes: 25 },
            now: NOW,
            workUntil: new Date("2026-07-15T17:00:00.000Z"),
        });

        expect(result.tasks.map((item) => item.id)).toEqual(["pm-1", "pm-done", "pm-archived"]);
        expect(result.tasks[1].status).toBe("Done");
        expect(result.tasks[2].isArchived).toBe(true);
        expect(result.tasks[0]).not.toHaveProperty("appTaskId");
        expect(result.tasks[0]).not.toHaveProperty("links");
        expect(result.tasks[0].checklist).toEqual([{ id: "check-1", title: "Outline", done: false }]);
    });

    it("converts the remaining work-until window into whole work pomodoros", () => {
        const result = buildPlannerContext({
            pmState: pmState([]),
            logs: [],
            settings: { work_minutes: 25 },
            now: NOW,
            workUntil: new Date("2026-07-15T14:01:00.000Z"),
        });

        expect(result.now).toBe(NOW.toISOString());
        expect(result.workUntil).toBe("2026-07-15T14:01:00.000Z");
        expect(result.workBudgetPomos).toBe(4);
    });

    it("returns no budget for an already-passed or invalid work-until time", () => {
        const base = {
            pmState: pmState([]),
            logs: [],
            settings: { work_minutes: 25 },
            now: NOW,
        };
        expect(buildPlannerContext({ ...base, workUntil: new Date("2026-07-15T11:59:00.000Z") }).workBudgetPomos).toBe(0);
        expect(buildPlannerContext({ ...base, workUntil: "not-a-time" }).workBudgetPomos).toBe(0);
        expect(buildPlannerContext({ ...base, workUntil: "not-a-time" }).workUntil).toBeNull();
    });

    it("aggregates recent estimate accuracy by task, priority, and tag", () => {
        const first = task({ id: "pm-1", estimatePomos: 4, workedPomos: 2, priority: "High", tags: ["work", "writing"] });
        const second = task({ id: "pm-2", appTaskId: "app-2", estimatePomos: 2, workedPomos: 4, priority: "High", tags: ["work"] });
        const third = task({ id: "pm-3", appTaskId: "app-3", estimatePomos: 4, workedPomos: 8, priority: "Low", tags: ["writing"] });
        const old = task({ id: "pm-old", appTaskId: "app-old", estimatePomos: 1, workedPomos: 10, lastWorkedAt: "2026-04-15T12:00:00.000Z" });

        const result = buildPlannerContext({
            pmState: pmState([first, second, third, old]),
            logs: [
                log("app-1", "2026-07-01T12:00:00.000Z"),
                log("app-1", "2026-07-02T12:00:00.000Z", { was_break: true }),
                log("app-2", "2026-06-30T12:00:00.000Z"),
                log("app-3", "2026-06-29T12:00:00.000Z"),
                log("app-old", "2026-04-15T12:00:00.000Z"),
            ],
            settings: { work_minutes: 25 },
            now: NOW,
            workUntil: "17:00",
        });

        expect(result.accuracy).toMatchObject({
            meanRatio: (0.5 + 2 + 2) / 3,
            medianRatio: 2,
            sampleCount: 3,
        });
        expect(result.accuracy.byPriority.High).toMatchObject({ meanRatio: 1.25, medianRatio: 1.25, sampleCount: 2 });
        expect(result.accuracy.byTag.work).toMatchObject({ meanRatio: 1.25, medianRatio: 1.25, sampleCount: 2 });
        expect(result.accuracy.byTag.writing).toMatchObject({ meanRatio: 1.25, medianRatio: 1.25, sampleCount: 2 });
        expect(result.accuracy.byPriority.Low).toMatchObject({ sampleCount: 1 });
    });

    it("uses lastWorkedAt when recent logs are unavailable and ignores zero-work tasks", () => {
        const recent = task({ id: "pm-recent", estimatePomos: 3, workedPomos: 1, lastWorkedAt: "2026-07-10T12:00:00.000Z" });
        const zero = task({ id: "pm-zero", estimatePomos: 3, workedPomos: 0, lastWorkedAt: "2026-07-10T12:00:00.000Z" });

        const result = buildPlannerContext({
            pmState: pmState([recent, zero]),
            logs: [],
            settings: { work_minutes: 25 },
            now: NOW,
            workUntil: "17:00",
        });

        expect(result.accuracy.sampleCount).toBe(1);
        expect(result.accuracy.meanRatio).toBeCloseTo(1 / 3, 8);
    });
});
