import { describe, expect, it, vi } from "vitest";
import type { PMTask, PomodoroLogEntry, Project, Task } from "../../state/types";
import type { PeriodBounds } from "./periods";
import { buildGoalFixture } from "./testFixtures";
import {
    buildGoalEvidence,
    evidencePrefillText,
    formatEvidenceHours,
    type EvidenceInput,
    type EvidenceWindowInstants,
} from "./evidence";

const PERIOD: PeriodBounds = { periodStart: "2026-10-04", periodEnd: "2026-10-18" };
const WINDOW: EvidenceWindowInstants = { start: 1_000, end: 2_000 };

function project(overrides: Partial<Project> = {}): Project {
    return {
        id: "project-1",
        name: "Deep Work",
        color: "#6366F1",
        workableStart: "09:00",
        workableEnd: "17:00",
        workableDays: [1, 2, 3, 4, 5],
        isArchived: false,
        sortOrder: 0,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        ...overrides,
    };
}

function pmTask(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-1",
        title: "Ship the release",
        projectId: "project-1",
        status: "Done",
        priority: "Medium",
        timeSpentMinutes: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        appTaskId: "app-1",
        relatedTo: [],
        ...overrides,
    };
}

function backendTask(overrides: Partial<Task> = {}): Task {
    return {
        id: "app-1",
        name: "Ship the release",
        target_pomodoros: 1,
        completed_pomodoros: 1,
        created_at: "2026-10-01T00:00:00.000Z",
        completed_at: new Date(1_500).toISOString(),
        break_skips: 0,
        archived: false,
        ...overrides,
    };
}

function log(overrides: Partial<PomodoroLogEntry> = {}): PomodoroLogEntry {
    return {
        id: "log-1",
        task_id: "app-1",
        duration_minutes: 25,
        finished_at: new Date(1_500).toISOString(),
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
    return {
        goal: buildGoalFixture({ projectId: "project-1" }),
        checkIn: { evidenceTaskIds: [] },
        period: PERIOD,
        projects: [project()],
        pmTasks: [pmTask()],
        backendTasks: [backendTask()],
        logs: [],
        boundaryInstants: () => WINDOW,
        ...overrides,
    };
}

describe("buildGoalEvidence", () => {
    it("includes an instant on the inclusive start and excludes the exclusive end", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [
                pmTask({ id: "pm-start", title: "At start", appTaskId: "app-start" }),
                pmTask({ id: "pm-inside", title: "Inside", appTaskId: "app-inside" }),
                pmTask({ id: "pm-end", title: "At end", appTaskId: "app-end" }),
            ],
            backendTasks: [
                backendTask({ id: "app-start", completed_at: new Date(WINDOW.start).toISOString() }),
                backendTask({ id: "app-inside", completed_at: new Date(WINDOW.end - 1).toISOString() }),
                backendTask({ id: "app-end", completed_at: new Date(WINDOW.end).toISOString() }),
            ],
        }));

        expect(evidence.completedTasks.map(item => item.pmTaskId)).toEqual(["pm-start", "pm-inside"]);
        expect(evidence.completedTaskCount).toBe(2);
        expect(evidence.brokenProject).toBe(false);
    });

    it("sums only non-break logs for the linked project within the window", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [
                pmTask({ id: "pm-1", appTaskId: "app-1" }),
                pmTask({ id: "pm-2", appTaskId: "app-2" }),
                pmTask({ id: "pm-other", projectId: "project-2", appTaskId: "app-3" }),
            ],
            backendTasks: [
                backendTask({ id: "app-1" }),
                backendTask({ id: "app-2" }),
                backendTask({ id: "app-3" }),
            ],
            projects: [project(), project({ id: "project-2", name: "Other" })],
            logs: [
                log({ id: "l-1", task_id: "app-1", duration_minutes: 25 }),
                log({ id: "l-2", task_id: "app-2", duration_minutes: 30 }),
                log({ id: "l-3", task_id: "app-3", duration_minutes: 15 }),
                log({ id: "l-4", task_id: "app-1", duration_minutes: 10, was_break: true }),
                log({ id: "l-5", task_id: "app-1", duration_minutes: 60, finished_at: new Date(WINDOW.start - 1).toISOString() }),
                log({ id: "l-6", task_id: "app-1", duration_minutes: 60, finished_at: new Date(WINDOW.end).toISOString() }),
                log({ id: "l-7", task_id: "missing-backend", duration_minutes: 90 }),
            ],
        }));

        expect(evidence.hoursMinutes).toBe(55);
    });

    it("orders completed suggestions by completion instant, then title, then id", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [
                pmTask({ id: "pm-late", title: "Alpha", appTaskId: "app-late" }),
                pmTask({ id: "pm-b", title: "Beta", appTaskId: "app-b" }),
                pmTask({ id: "pm-a", title: "Alpha", appTaskId: "app-a" }),
                pmTask({ id: "pm-first", title: "Zulu", appTaskId: "app-first" }),
            ],
            backendTasks: [
                backendTask({ id: "app-late", completed_at: new Date(1_900).toISOString() }),
                backendTask({ id: "app-b", completed_at: new Date(1_500).toISOString() }),
                backendTask({ id: "app-a", completed_at: new Date(1_500).toISOString() }),
                backendTask({ id: "app-first", completed_at: new Date(1_200).toISOString() }),
            ],
        }));

        expect(evidence.completedTasks.map(item => item.pmTaskId)).toEqual(["pm-first", "pm-a", "pm-b", "pm-late"]);
    });

    it("keeps Done tasks without a backend completion invisible (best effort)", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [
                pmTask({ id: "pm-no-link", appTaskId: undefined }),
                pmTask({ id: "pm-missing-row", appTaskId: "app-missing" }),
                pmTask({ id: "pm-unfinished", appTaskId: "app-unfinished" }),
                pmTask({ id: "pm-visible", appTaskId: "app-visible" }),
            ],
            backendTasks: [
                backendTask({ id: "app-unfinished", completed_at: null }),
                backendTask({ id: "app-visible", completed_at: new Date(1_500).toISOString() }),
            ],
        }));

        expect(evidence.completedTasks.map(item => item.pmTaskId)).toEqual(["pm-visible"]);
        expect(evidence.completedTaskCount).toBe(1);
    });

    it("keeps a deleted backend row and non-Done status invisible", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [
                pmTask({ id: "pm-deleted", appTaskId: "app-deleted" }),
                pmTask({ id: "pm-progress", status: "In Progress", appTaskId: "app-progress" }),
            ],
            backendTasks: [backendTask({ id: "app-progress" })],
        }));

        expect(evidence.completedTasks).toEqual([]);
        expect(evidence.completedTaskCount).toBe(0);
        expect(evidence.hoursMinutes).toBe(0);
        expect(evidence.inProgress.map(item => item.pmTaskId)).toEqual(["pm-progress"]);
    });

    it("returns empty evidence for an unlinked goal", () => {
        const evidence = buildGoalEvidence(input({
            goal: buildGoalFixture({ projectId: null }),
            projects: [project()],
        }));

        expect(evidence).toEqual({
            completedTasks: [],
            inProgress: [],
            completedTaskCount: 0,
            hoursMinutes: 0,
            brokenProject: false,
        });
    });

    it("flags a missing project and still accepts archived projects as valid links", () => {
        const broken = buildGoalEvidence(input({ projects: [] }));
        expect(broken.brokenProject).toBe(true);
        expect(broken.completedTasks).toEqual([]);
        expect(broken.inProgress).toEqual([]);
        expect(broken.hoursMinutes).toBe(0);

        const archived = buildGoalEvidence(input({ projects: [project({ isArchived: true })] }));
        expect(archived.brokenProject).toBe(false);
        expect(archived.completedTaskCount).toBe(1);
    });

    it("marks suggestions accepted from evidenceTaskIds and leaves stale IDs untouched", () => {
        const evidence = buildGoalEvidence(input({
            checkIn: { evidenceTaskIds: ["pm-1", "stale-id"] },
        }));

        expect(evidence.completedTasks).toEqual([{
            pmTaskId: "pm-1",
            appTaskId: "app-1",
            title: "Ship the release",
            completedOn: expect.any(String),
            accepted: true,
        }]);
    });

    it("orders In Progress items by sortOrder, then title, then id", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [
                pmTask({ id: "pm-c", title: "Charlie", status: "In Progress", sortOrder: 1 }),
                pmTask({ id: "pm-b", title: "Beta", status: "In Progress", sortOrder: 0 }),
                pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", sortOrder: 0 }),
                pmTask({ id: "pm-done", title: "Done task", status: "Done" }),
            ],
        }));

        expect(evidence.inProgress.map(item => item.title)).toEqual(["Alpha", "Beta", "Charlie"]);
        expect(evidence.inProgress.map(item => item.sortOrder)).toEqual([0, 0, 1]);
        expect(evidencePrefillText(evidence.inProgress)).toBe("Alpha, Beta, Charlie");
    });

    it("uses the injected boundary converter once for a DST-safe instant window", () => {
        const boundaryInstants = vi.fn(() => WINDOW);
        const evidence = buildGoalEvidence(input({
            period: { periodStart: "2026-03-08", periodEnd: "2026-03-09" },
            boundaryInstants,
            pmTasks: [pmTask({ id: "pm-1", appTaskId: "app-1" })],
            backendTasks: [backendTask({ id: "app-1", completed_at: new Date(WINDOW.end).toISOString() })],
            logs: [log({ task_id: "app-1", finished_at: new Date(WINDOW.end).toISOString() })],
        }));

        expect(boundaryInstants).toHaveBeenCalledTimes(1);
        expect(boundaryInstants).toHaveBeenCalledWith({ periodStart: "2026-03-08", periodEnd: "2026-03-09" });
        expect(evidence.completedTasks).toEqual([]);
        expect(evidence.hoursMinutes).toBe(0);
    });

    it("derives completedOn from the selection projection only, never as a filter", () => {
        const localDateOf = vi.fn(() => "2026-10-10" as const);
        const evidence = buildGoalEvidence(input({
            localDateOf,
            pmTasks: [
                pmTask({ id: "pm-selected", appTaskId: "app-selected" }),
                pmTask({ id: "pm-outside", appTaskId: "app-outside" }),
            ],
            backendTasks: [
                backendTask({ id: "app-selected", completed_at: new Date(1_500).toISOString() }),
                backendTask({ id: "app-outside", completed_at: new Date(WINDOW.end).toISOString() }),
            ],
        }));

        expect(evidence.completedTasks.map(item => item.completedOn)).toEqual(["2026-10-10"]);
        expect(localDateOf).toHaveBeenCalledTimes(1);
        expect(localDateOf).toHaveBeenCalledWith(new Date(1_500).toISOString());
    });

    it("uses only task titles, never task descriptions or notes", () => {
        const evidence = buildGoalEvidence(input({
            pmTasks: [pmTask({ id: "pm-1", title: "Ship the release", description: "Secret notes" })],
        }));

        expect(evidence.completedTasks[0].title).toBe("Ship the release");
        expect(JSON.stringify(evidence)).not.toContain("Secret notes");
    });
});

describe("formatEvidenceHours", () => {
    it("rounds to one decimal and omits a trailing .0", () => {
        expect(formatEvidenceHours(840)).toBe("14h");
        expect(formatEvidenceHours(870)).toBe("14.5h");
        expect(formatEvidenceHours(865)).toBe("14.4h");
        expect(formatEvidenceHours(0)).toBe("0h");
    });
});
