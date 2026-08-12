import { describe, expect, it } from "vitest";
import type { PMTask, Project } from "../../state/types";
import { buildWeekOverview } from "./weekOverview";

function task(id: string, overrides: Partial<PMTask> = {}): PMTask {
    return {
        id,
        title: id,
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
        relatedTo: [],
        ...overrides,
    };
}

function project(id: string, workableDays: Project["workableDays"]): Project {
    return {
        id,
        name: id,
        color: "#6366f1",
        workableStart: "09:00",
        workableEnd: "17:00",
        workableDays,
        isArchived: false,
        sortOrder: 0,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
    };
}

const WEDNESDAY = new Date(2026, 7, 12, 10, 0);

describe("buildWeekOverview", () => {
    it("groups current-week due work and moves overdue work to today", () => {
        const result = buildWeekOverview({
            reference: WEDNESDAY,
            projects: {},
            tasks: [
                task("overdue", { dueDate: "2026-08-03", estimatePomos: 2 }),
                task("today", { dueDate: "2026-08-12", estimatePomos: 3, workedPomos: 1 }),
                task("friday", { dueDate: "2026-08-14", estimatePomos: 4 }),
                task("future", { dueDate: "2026-08-17", estimatePomos: 9 }),
            ],
        });

        expect(result.days.map((day) => day.duePomodoros)).toEqual([0, 0, 4, 0, 4, 0, 0]);
        expect(result.duePomodoros).toBe(8);
        expect(result.startKey).toBe("2026-08-10");
        expect(result.endKey).toBe("2026-08-16");
    });

    it("balances undated work across remaining project workdays", () => {
        const result = buildWeekOverview({
            reference: WEDNESDAY,
            projects: { p1: project("p1", [1, 3, 5]) },
            tasks: [task("flexible", { projectId: "p1", estimatePomos: 5 })],
        });

        expect(result.days.map((day) => day.unscheduledPomodoros)).toEqual([0, 0, 3, 0, 2, 0, 0]);
        expect(result.unscheduledPomodoros).toBe(5);
    });

    it("uses existing due load when balancing flexible work", () => {
        const result = buildWeekOverview({
            reference: WEDNESDAY,
            projects: {},
            tasks: [
                task("due", { dueDate: "2026-08-12", estimatePomos: 4 }),
                task("flexible", { estimatePomos: 4 }),
            ],
        });

        expect(result.days.map((day) => day.unscheduledPomodoros)).toEqual([0, 0, 0, 2, 2, 0, 0]);
    });

    it("falls back to today when the project has no workable day left this week", () => {
        const result = buildWeekOverview({
            reference: new Date(2026, 7, 16, 10, 0),
            projects: { p1: project("p1", [1]) },
            tasks: [task("flexible", { projectId: "p1", estimatePomos: 2 })],
        });

        expect(result.days[6].unscheduledPomodoros).toBe(2);
    });

    it("excludes completed, archived, and fully worked tasks and defaults missing estimates to one", () => {
        const result = buildWeekOverview({
            reference: WEDNESDAY,
            projects: {},
            tasks: [
                task("done", { status: "Done", estimatePomos: 5 }),
                task("archived", { isArchived: true, estimatePomos: 5 }),
                task("worked", { estimatePomos: 2, workedPomos: 2 }),
                task("unestimated"),
            ],
        });

        expect(result.totalPomodoros).toBe(1);
        expect(result.unscheduledPomodoros).toBe(1);
    });
});
