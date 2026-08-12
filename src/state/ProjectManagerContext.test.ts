import { describe, it, expect } from "vitest";
import { normalizeState, quickAddParse } from "./ProjectManagerContext";

describe("quickAddParse", () => {
    it("parses a bare title", () => {
        const { task, projectName } = quickAddParse("Write the report");
        expect(task.title).toBe("Write the report");
        expect(projectName).toBeUndefined();
        expect(task.tags).toEqual([]);
    });

    it("parses project, tag, priority, estimate, and due date", () => {
        const { task, projectName } = quickAddParse(
            "Fix login bug @Main App #urgent !high 3p ^2026-08-15"
        );
        expect(task.title).toBe("Fix login bug");
        expect(projectName).toBe("Main App");
        expect(task.tags).toEqual(["urgent"]);
        expect(task.priority).toBe("High");
        expect(task.estimatePomos).toBe(3);
        expect(task.dueDate).toBe("2026-08-15");
    });

    it("supports multi-word project names", () => {
        const { projectName } = quickAddParse("Ship v2 @Product Backlog #dev");
        expect(projectName).toBe("Product Backlog");
    });

    it("ignores malformed tokens but keeps title", () => {
        const { task, projectName } = quickAddParse("Do thing @ bad ^notadate !extreme #");
        expect(task.title).toBe("Do thing");
        expect(task.priority).toBeUndefined();
        expect(task.dueDate).toBeUndefined();
        expect(task.tags).toEqual([]);
        // "@ bad" -> project name "bad" (parser accepts any non-empty @-candidate)
        expect(projectName).toBe("bad");
    });

    it("parses priority case-insensitively", () => {
        const { task } = quickAddParse("Ship !MEDIUM");
        expect(task.priority).toBe("Medium");
    });

    it("empty input yields empty title", () => {
        const { task } = quickAddParse("   ");
        expect(task.title).toBe("");
    });
});

describe("normalizeState", () => {
    it("returns a valid default state when given nothing", () => {
        const s = normalizeState(null);
        expect(Object.keys(s.projects).length).toBe(1);
        expect(Object.values(s.projects)[0].name).toBe("General");
        expect(s.tasks).toEqual({});
        expect(s.ui.view).toBe("list");
        expect(s.ui.selectedProjectIds).toHaveLength(1);
        expect(s.ui.selectedProjectIds[0]).toBe(Object.keys(s.projects)[0]);
        expect(Object.values(s.projects)[0]).toMatchObject({ workableStart: "09:00", workableEnd: "17:00", workableDays: [1, 2, 3, 4, 5] });
    });

    it("coerces invalid statuses and priorities", () => {
        const s = normalizeState({
            projects: { p1: { id: "p1", name: "P", color: "#fff", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } },
            tasks: {
                t1: {
                    id: "t1",
                    title: "x",
                    projectId: "p1",
                    status: "Bogus" as any,
                    priority: "Urgent" as any,
                    tags: ["a", 5 as any],
                    links: "notarray" as any,
                    timeSpentMinutes: "abc" as any,
                    createdAt: "2026-01-01T00:00:00Z",
                    updatedAt: "2026-01-01T00:00:00Z",
                } as any,
            },
        } as any);
        expect(s.tasks.t1.status).toBe("Backlog");
        expect(s.tasks.t1.priority).toBe("Medium");
        expect(s.tasks.t1.tags).toEqual(["a"]);
        expect(s.tasks.t1.links).toEqual([]);
        expect(s.tasks.t1.timeSpentMinutes).toBe(0);
    });

    it("fixes missing timestamps", () => {
        const s = normalizeState({
            projects: { p1: { id: "p1", name: "P", color: "#fff", isArchived: false, sortOrder: 0, createdAt: "", updatedAt: "" } },
        } as any);
        const p = s.projects.p1;
        expect(p.createdAt.length).toBeGreaterThan(0);
        expect(p.updatedAt).toBe(p.createdAt);
    });

    it("normalizes invalid project scheduling and preserves valid values", () => {
        const invalid = normalizeState({ projects: { p1: { id: "p1", workableStart: "18:00", workableEnd: "09:00", workableDays: [9] } } } as any);
        expect(invalid.projects.p1).toMatchObject({ workableStart: "09:00", workableEnd: "17:00", workableDays: [1, 2, 3, 4, 5] });
        const valid = normalizeState({ projects: { p1: { id: "p1", workableStart: "07:30", workableEnd: "15:00", workableDays: [6, 2, 2] } } } as any);
        expect(valid.projects.p1).toMatchObject({ workableStart: "07:30", workableEnd: "15:00", workableDays: [2, 6] });
    });

    it("filters selectedProjectIds to existing projects and defaults when empty", () => {
        const s = normalizeState({
            projects: {
                p1: { id: "p1", name: "P", color: "#fff", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
                p2: { id: "p2", name: "P2", color: "#eee", isArchived: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
            },
            ui: { selectedProjectIds: ["p2", "ghost"] } as any,
        } as any);
        expect(s.ui.selectedProjectIds).toEqual(["p2"]);

        const empty = normalizeState({
            projects: {},
            ui: { selectedProjectIds: [] } as any,
        } as any);
        expect(empty.ui.selectedProjectIds).toHaveLength(1);
    });

    it("clamps estimatePomos to at least 1", () => {
        const s = normalizeState({
            projects: { p1: { id: "p1", name: "P", color: "#fff", isArchived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } },
            tasks: {
                t1: {
                    id: "t1",
                    title: "x",
                    projectId: "p1",
                    status: "Backlog",
                    priority: "Medium",
                    estimatePomos: 0.4,
                    createdAt: "2026-01-01T00:00:00Z",
                    updatedAt: "2026-01-01T00:00:00Z",
                } as any,
            },
        } as any);
        expect(s.tasks.t1.estimatePomos).toBe(1);
    });
});
