import { describe, expect, it } from "vitest";
import type { PMTask, Project, Task } from "../state/types";
import { PRIORITY_RANK, rankWhatsNext } from "./whatsNext";

// Wednesday 12 August 2026; the local week ends on Sunday 16 August.
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

function rank(overrides: {
    pmTasks: readonly PMTask[];
    backendTasks?: Readonly<Record<string, Task>>;
    projects?: Readonly<Record<string, Project>>;
    currentOccupantId?: string | null;
    reference?: Date;
}) {
    return rankWhatsNext({
        pmTasks: overrides.pmTasks,
        backendTasks: overrides.backendTasks ?? {},
        projects: overrides.projects ?? {},
        currentOccupantId: overrides.currentOccupantId ?? null,
        reference: overrides.reference ?? REFERENCE,
    });
}

describe("PRIORITY_RANK", () => {
    it("matches the task panel ordering", () => {
        expect(PRIORITY_RANK).toEqual({ High: 0, Medium: 1, Low: 2 });
    });
});

describe("one-per-tier promotion", () => {
    it("promotes a high-priority long task and a small low-priority task once each", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "long", title: "Long high task", priority: "High", estimatePomos: 8 }),
                pmTask({ id: "small", title: "Small low task", priority: "Low", estimatePomos: 1, dueDate: "2026-08-12" }),
            ],
        });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["long", "top-pick"],
            ["small", "quick-win"],
        ]);
        expect(result.continuation).toEqual([]);
    });

    it("never lets one candidate fill two slots", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "only-high", priority: "High", estimatePomos: 1, dueDate: "2026-08-12" }),
                pmTask({ id: "filler", priority: "Low", estimatePomos: 9 }),
            ],
        });

        expect(result.top.map((entry) => entry.task.id)).toEqual(["only-high", "filler"]);
        const allIds = [...result.top, ...result.continuation].map((entry) => entry.task.id);
        expect(new Set(allIds).size).toBe(allIds.length);
        expect(result.top.filter((entry) => entry.task.id === "only-high")).toHaveLength(1);
    });
});

describe("base comparator tiebreaks", () => {
    it("ranks priority first", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "medium", title: "A task", priority: "Medium", estimatePomos: 2 }),
                pmTask({ id: "high", title: "B task", priority: "High", estimatePomos: 2 }),
            ],
        });

        expect(result.top[0].task.id).toBe("high");
    });

    it("ranks due dates ascending with nulls last", () => {
        const nullsLast = rank({
            pmTasks: [
                pmTask({ id: "undated", estimatePomos: 2 }),
                pmTask({ id: "dated", estimatePomos: 2, dueDate: "2026-08-20" }),
            ],
        });
        expect(nullsLast.top[0].task.id).toBe("dated");

        const ascending = rank({
            pmTasks: [
                pmTask({ id: "later", estimatePomos: 2, dueDate: "2026-08-14" }),
                pmTask({ id: "earlier", estimatePomos: 2, dueDate: "2026-08-10" }),
            ],
        });
        expect(ascending.top[0].task.id).toBe("earlier");
    });

    it("ranks smaller remaining pomodoros before larger ones", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "large", estimatePomos: 3 }),
                pmTask({ id: "small", estimatePomos: 1 }),
            ],
        });

        expect(result.top[0].task.id).toBe("small");
    });

    it("ranks sortOrder before title", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "late-sort", title: "A task", estimatePomos: 2, sortOrder: 5 }),
                pmTask({ id: "early-sort", title: "Z task", estimatePomos: 2, sortOrder: 2 }),
            ],
        });

        expect(result.top[0].task.id).toBe("early-sort");
    });

    it("ranks title with a stable locale comparison", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "beta", title: "Beta", estimatePomos: 2 }),
                pmTask({ id: "alpha", title: "Alpha", estimatePomos: 2 }),
            ],
        });

        expect(result.top[0].task.id).toBe("alpha");
    });

    it("uses the id as the final tiebreak", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "b-task", title: "Same", estimatePomos: 2 }),
                pmTask({ id: "a-task", title: "Same", estimatePomos: 2 }),
            ],
        });

        expect(result.top[0].task.id).toBe("a-task");
    });

    it("breaks quick-win ties with the base comparator", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "top", title: "Top", priority: "High", estimatePomos: 10 }),
                pmTask({ id: "medium-tie", title: "Medium tie", priority: "Medium", estimatePomos: 2 }),
                pmTask({ id: "low-tie", title: "Low tie", priority: "Low", estimatePomos: 2 }),
            ],
        });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["top", "top-pick"],
            ["medium-tie", "quick-win"],
        ]);
    });

    it("breaks next-up ties with the base comparator", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "top", title: "Top", priority: "High", estimatePomos: 2 }),
                pmTask({ id: "quick", title: "Quick", priority: "Low", estimatePomos: 1 }),
                pmTask({ id: "due-medium", title: "Due medium", priority: "Medium", estimatePomos: 3, dueDate: "2026-08-12" }),
                pmTask({ id: "high-undated", title: "High undated", priority: "High", estimatePomos: 4 }),
            ],
        });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["top", "top-pick"],
            ["quick", "quick-win"],
            ["high-undated", "next-up"],
        ]);
    });
});

describe("next-up due-soon scope (D4)", () => {
    function pool(dueDate?: string): readonly PMTask[] {
        return [
            pmTask({ id: "high-top", title: "High top", priority: "High", estimatePomos: 2 }),
            pmTask({ id: "quick", title: "Quick", priority: "Low", estimatePomos: 1 }),
            pmTask({ id: "candidate", title: "Candidate", priority: "Medium", estimatePomos: 4, dueDate }),
        ];
    }

    it("promotes a task due later this week", () => {
        const result = rank({ pmTasks: pool("2026-08-14") });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["high-top", "top-pick"],
            ["quick", "quick-win"],
            ["candidate", "next-up"],
        ]);
    });

    it("does not promote a medium-priority task due next week", () => {
        const result = rank({ pmTasks: pool("2026-08-19") });

        expect(result.top.map((entry) => entry.task.id)).toEqual(["high-top", "quick"]);
        expect(result.continuation.map((entry) => entry.task.id)).toEqual(["candidate"]);
    });

    it("promotes a high-priority undated task", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "high-top", title: "High top", priority: "High", estimatePomos: 2 }),
                pmTask({ id: "quick", title: "Quick", priority: "Low", estimatePomos: 1 }),
                pmTask({ id: "candidate", title: "Candidate", priority: "High", estimatePomos: 4 }),
            ],
        });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["high-top", "top-pick"],
            ["quick", "quick-win"],
            ["candidate", "next-up"],
        ]);
    });
});

describe("continuation list", () => {
    it("dedupes against the top slots, keeps base order, and puts un-estimated tasks last", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "top-pick", title: "Top pick", priority: "High", estimatePomos: 3 }),
                pmTask({ id: "quick-win", title: "Quick win", priority: "Low", estimatePomos: 1 }),
                pmTask({ id: "next-up", title: "Next up", priority: "Medium", estimatePomos: 5, dueDate: "2026-08-13" }),
                pmTask({ id: "due-later", title: "Due later", priority: "Medium", estimatePomos: 2, dueDate: "2026-08-20" }),
                pmTask({ id: "undated", title: "Undated", priority: "Medium", estimatePomos: 4 }),
                pmTask({ id: "unknown-high", title: "Unknown high", priority: "High" }),
                pmTask({ id: "unknown-medium", title: "Unknown medium", priority: "Medium" }),
            ],
        });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["top-pick", "top-pick"],
            ["quick-win", "quick-win"],
            ["next-up", "next-up"],
        ]);
        expect(result.continuation.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["due-later", null],
            ["undated", null],
            ["unknown-high", null],
            ["unknown-medium", null],
        ]);
        expect(result.continuation.slice(-2).map((entry) => entry.remainingPomodoros)).toEqual([0, 0]);

        const allIds = [...result.top, ...result.continuation].map((entry) => entry.task.id);
        expect(new Set(allIds).size).toBe(allIds.length);
    });

    it("never puts an un-estimated task in the top slots", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "estimated", estimatePomos: 2 }),
                pmTask({ id: "unestimated", priority: "High" }),
            ],
        });

        expect(result.top.map((entry) => entry.task.id)).toEqual(["estimated"]);
        expect(result.continuation.map((entry) => entry.task.id)).toEqual(["unestimated"]);
        expect(result.continuation[0].remainingPomodoros).toBe(0);
    });
});

describe("pool shapes", () => {
    it("returns a pool of one once with an empty continuation", () => {
        const result = rank({ pmTasks: [pmTask({ id: "only", estimatePomos: 2 })] });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([["only", "top-pick"]]);
        expect(result.continuation).toEqual([]);
    });

    it("returns an explicit empty result for an empty pool", () => {
        expect(rank({ pmTasks: [] })).toEqual({ top: [], continuation: [] });
    });

    it("returns the explicit empty result when every task is ineligible", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "done", status: "Done", estimatePomos: 2 }),
                pmTask({ id: "blocked", status: "Blocked", estimatePomos: 2 }),
            ],
        });

        expect(result).toEqual({ top: [], continuation: [] });
    });
});

describe("estimates", () => {
    it("floors only a non-positive remainder to one for over-worked tasks", () => {
        const byPmWorked = rank({
            pmTasks: [pmTask({ id: "pm-over", estimatePomos: 2, workedPomos: 3 })],
        });
        expect(byPmWorked.top[0].remainingPomodoros).toBe(1);

        const backend = backendTask({ id: "over-app", completed_pomodoros: 3 });
        const byBackendWorked = rank({
            pmTasks: [pmTask({ id: "backend-over", estimatePomos: 2, appTaskId: backend.id })],
            backendTasks: { [backend.id]: backend },
        });
        expect(byBackendWorked.top[0].remainingPomodoros).toBe(1);
    });

    it("keeps a fractional remainder instead of raising it to one", () => {
        const result = rank({
            pmTasks: [pmTask({ id: "fractional", estimatePomos: 3, workedPomos: 2.5 })],
        });

        expect(result.top[0].remainingPomodoros).toBe(0.5);
    });

    it("floors an over-worked task to one", () => {
        const result = rank({
            pmTasks: [pmTask({ id: "over", estimatePomos: 2, workedPomos: 5 })],
        });

        expect(result.top[0].remainingPomodoros).toBe(1);
    });

    it("lets a fractional remainder win quick-win over a full pomodoro", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "top", title: "Top", priority: "High", estimatePomos: 8 }),
                pmTask({ id: "fractional", title: "Fractional", priority: "Medium", estimatePomos: 3, workedPomos: 2.5 }),
                pmTask({ id: "whole", title: "Whole", priority: "Low", estimatePomos: 1 }),
            ],
        });

        expect(result.top.map((entry) => [entry.task.id, entry.tier])).toEqual([
            ["top", "top-pick"],
            ["fractional", "quick-win"],
        ]);
        expect(result.top[1].remainingPomodoros).toBe(0.5);
        expect(result.continuation.map((entry) => [entry.task.id, entry.remainingPomodoros])).toEqual([
            ["whole", 1],
        ]);
    });

    it("falls back to the backend target when the PM estimate is absent", () => {
        const backend = backendTask({ id: "target-app", target_pomodoros: 3, completed_pomodoros: 1 });
        const result = rank({
            pmTasks: [pmTask({ id: "target", appTaskId: backend.id })],
            backendTasks: { [backend.id]: backend },
        });

        expect(result.top[0].task.id).toBe("target");
        expect(result.top[0].remainingPomodoros).toBe(2);
    });

    it("treats a zero or absent estimate as un-estimated", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "zero", estimatePomos: 0 }),
                pmTask({ id: "absent" }),
            ],
        });

        expect(result.top).toEqual([]);
        expect(result.continuation.map((entry) => [entry.task.id, entry.remainingPomodoros])).toEqual([
            ["absent", 0],
            ["zero", 0],
        ]);
    });
});

describe("project resolution and workability", () => {
    it("includes a missing project with a null projectId and excludes non-workable projects", () => {
        const result = rank({
            pmTasks: [
                pmTask({ id: "workable", projectId: "weekday", estimatePomos: 1 }),
                pmTask({ id: "missing", projectId: "gone", estimatePomos: 2 }),
                pmTask({ id: "off-today", projectId: "weekend", estimatePomos: 1 }),
            ],
            projects: {
                weekday: project({ id: "weekday", workableDays: [1, 2, 3, 4, 5] }),
                weekend: project({ id: "weekend", workableDays: [0, 6] }),
            },
        });

        expect(result.top.map((entry) => entry.task.id)).toEqual(["workable", "missing"]);
        expect(result.top.find((entry) => entry.task.id === "missing")?.projectId).toBeNull();
        expect(result.top.find((entry) => entry.task.id === "workable")?.projectId).toBe("weekday");
        expect(result.continuation).toEqual([]);
    });
});

describe("exclusions", () => {
    it("drops Done, Blocked, archived, waiting, occupant, and finished backend tasks", () => {
        const completed = backendTask({ id: "completed-app", completed_at: "2026-08-11T10:00:00.000Z" });
        const archived = backendTask({ id: "archived-app", archived: true });
        const result = rank({
            pmTasks: [
                pmTask({ id: "done", status: "Done", estimatePomos: 2 }),
                pmTask({ id: "blocked", status: "Blocked", estimatePomos: 2 }),
                pmTask({ id: "archived", isArchived: true, estimatePomos: 2 }),
                pmTask({ id: "waiting", estimatePomos: 2, waiting: { type: "agent", since: "2026-08-11T10:00:00.000Z" } }),
                pmTask({ id: "occupant", estimatePomos: 2 }),
                pmTask({ id: "completed", appTaskId: completed.id, estimatePomos: 2 }),
                pmTask({ id: "finished-backend", appTaskId: archived.id, estimatePomos: 2 }),
                pmTask({ id: "kept", estimatePomos: 1 }),
            ],
            backendTasks: { [completed.id]: completed, [archived.id]: archived },
            currentOccupantId: "occupant",
        });

        expect(result.top.map((entry) => entry.task.id)).toEqual(["kept"]);
        expect(result.continuation).toEqual([]);
    });
});

describe("determinism", () => {
    const tasks: readonly PMTask[] = [
        pmTask({ id: "a", title: "Alpha", priority: "High", estimatePomos: 4, dueDate: "2026-08-13" }),
        pmTask({ id: "b", title: "Beta", priority: "Medium", estimatePomos: 1 }),
        pmTask({ id: "c", title: "Gamma", priority: "Low", estimatePomos: 2, dueDate: "2026-08-14" }),
        pmTask({ id: "d", title: "Delta", priority: "Medium", estimatePomos: 3 }),
        pmTask({ id: "e", title: "Epsilon", priority: "High" }),
        pmTask({ id: "f", title: "Zeta", priority: "Low", estimatePomos: 2, dueDate: "2026-08-14" }),
    ];

    it("returns deep-equal output for repeated calls", () => {
        expect(rank({ pmTasks: tasks })).toEqual(rank({ pmTasks: tasks }));
    });

    it("does not depend on input array order", () => {
        const forward = rank({ pmTasks: tasks });
        const reversed = rank({ pmTasks: [...tasks].reverse() });
        const rotated = rank({ pmTasks: [...tasks.slice(3), ...tasks.slice(0, 3)] });

        expect(reversed).toEqual(forward);
        expect(rotated).toEqual(forward);
    });
});
