import { describe, it, expect } from "vitest";
import {
    AnalyticsFilters,
    computeDeepWorkSessions,
    computeMetrics,
    filterLogs,
} from "./analytics";
import { PomodoroLogEntry } from "../state/types";

const NOW = new Date("2026-07-15T12:00:00Z");

function log(
    finishedAt: string,
    overrides: Partial<PomodoroLogEntry> = {}
): PomodoroLogEntry {
    return {
        task_id: "t1",
        duration_minutes: 25,
        finished_at: finishedAt,
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

function filters(overrides: Partial<AnalyticsFilters> = {}): AnalyticsFilters {
    return {
        from: new Date("2026-07-01T00:00:00Z"),
        to: new Date("2026-07-31T23:59:59Z"),
        projectIds: [],
        includeBreaks: false,
        workHoursOnly: false,
        deepOnly: false,
        tags: [],
        statuses: [],
        ...overrides,
    };
}

describe("filterLogs", () => {
    it("excludes logs outside the date range", () => {
        const logs = [
            log("2026-06-01T00:00:00Z"),
            log("2026-07-10T00:00:00Z"),
        ];
        expect(filterLogs(logs, filters(), {}, {})).toHaveLength(1);
    });

    it("excludes breaks unless includeBreaks", () => {
        const logs = [log("2026-07-10T00:00:00Z", { was_break: true })];
        expect(filterLogs(logs, filters(), {}, {})).toHaveLength(0);
        expect(filterLogs(logs, filters({ includeBreaks: true }), {}, {})).toHaveLength(1);
    });

    it("filters by project id", () => {
        const logs = [
            log("2026-07-10T00:00:00Z", { task_id: "a" }),
            log("2026-07-10T01:00:00Z", { task_id: "b" }),
        ];
        const projectMap = { a: "p1", b: "p2" };
        const result = filterLogs(logs, filters({ projectIds: ["p1"] }), projectMap, {});
        expect(result.map((l) => l.task_id)).toEqual(["a"]);
    });

    it("keeps unmapped tasks when a project filter is active (current behavior)", () => {
        const logs = [log("2026-07-10T00:00:00Z", { task_id: "unmapped" })];
        const projectMap = { other: "p1" };
        expect(filterLogs(logs, filters({ projectIds: ["p1"] }), projectMap, {})).toHaveLength(1);
    });

    it("filters by tag and status", () => {
        const logs = [
            log("2026-07-10T00:00:00Z", { task_id: "a" }),
            log("2026-07-10T01:00:00Z", { task_id: "b" }),
        ];
        const meta = {
            a: { tags: ["urgent"], status: "In Progress", projectId: null },
            b: { tags: ["later"], status: "Backlog", projectId: null },
        };
        const byTag = filterLogs(logs, filters({ tags: ["urgent"] }), {}, meta);
        expect(byTag.map((l) => l.task_id)).toEqual(["a"]);
        const byStatus = filterLogs(logs, filters({ statuses: ["Backlog"] }), {}, meta);
        expect(byStatus.map((l) => l.task_id)).toEqual(["b"]);
    });

    it("filters by work hours (8-18 local)", () => {
        // 06:00 local in this TZ is outside window
        const early = log("2026-07-10T06:00:00Z");
        const mid = log("2026-07-10T15:00:00Z");
        expect(filterLogs([early, mid], filters({ workHoursOnly: true }), {}, {})).toHaveLength(1);
    });
});

describe("computeDeepWorkSessions", () => {
    it("marks consecutive sessions with <=10m gap as deep", () => {
        const sessions = [
            log("2026-07-10T09:00:00Z"),
            log("2026-07-10T09:30:00Z"), // 30m gap -> separate run
            log("2026-07-10T09:35:00Z"), // 5m gap -> joins run of length 2
        ];
        const deep = computeDeepWorkSessions(sessions);
        expect(deep.has("2026-07-10T09:30:00Z")).toBe(true);
        expect(deep.has("2026-07-10T09:35:00Z")).toBe(true);
        expect(deep.has("2026-07-10T09:00:00Z")).toBe(false);
    });

    it("isolated sessions are not deep", () => {
        const sessions = [
            log("2026-07-10T09:00:00Z"),
            log("2026-07-10T11:00:00Z"),
        ];
        expect(computeDeepWorkSessions(sessions).size).toBe(0);
    });
});

describe("computeMetrics", () => {
    const settings = { work_minutes: 25, short_break_minutes: 5, long_break_minutes: 20 };

    it("classifies completed vs aborted at >=95% planned", () => {
        const logs = [
            log("2026-07-15T09:00:00Z", { duration_minutes: 25 }), // completed
            log("2026-07-15T10:00:00Z", { duration_minutes: 10 }), // aborted
        ];
        const m = computeMetrics(logs, settings, NOW);
        expect(m.completed).toBe(1);
        expect(m.aborted).toBe(1);
        expect(m.completionRate).toBeCloseTo(0.5, 5);
    });

    it("counts today and this week", () => {
        const today = log("2026-07-15T09:00:00Z", { duration_minutes: 25 });
        const earlierWeek = log("2026-07-13T09:00:00Z", { duration_minutes: 25 });
        const lastWeek = log("2026-07-05T09:00:00Z", { duration_minutes: 25 });
        const m = computeMetrics([today, earlierWeek, lastWeek], settings, NOW);
        expect(m.todayCount).toBe(1);
        expect(m.todayMinutes).toBeCloseTo(25);
        expect(m.weekCount).toBe(2);
    });

    it("computes streak for days with >=4 sessions", () => {
        // Build timestamps from LOCAL dates so the test is timezone-independent.
        const localNoon = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0).toISOString();
        const now = new Date(2026, 6, 15, 12, 0, 0);
        const logs: PomodoroLogEntry[] = [];
        for (const [y, m, d] of [[2026, 6, 15], [2026, 6, 14], [2026, 6, 13]]) {
            for (let i = 0; i < 4; i++) {
                logs.push(log(localNoon(y as number, m as number, d as number), { duration_minutes: 25 }));
            }
        }
        const m = computeMetrics(logs, settings, now);
        expect(m.streak).toBe(3);
    });

    it("computes break discipline", () => {
        const logs = [
            log("2026-07-15T09:00:00Z", { duration_minutes: 25 }),
            log("2026-07-15T09:30:00Z", { duration_minutes: 5, was_break: true }), // good short break
            log("2026-07-15T10:00:00Z", { duration_minutes: 25 }),
            log("2026-07-15T10:30:00Z", { duration_minutes: 45, was_break: true }), // bad break
        ];
        const m = computeMetrics(logs, settings, NOW);
        expect(m.breakDiscipline).toBeCloseTo(0.5, 5);
    });

    it("reports peak hour", () => {
        const logs = [
            log("2026-07-15T09:00:00Z"),
            log("2026-07-15T09:30:00Z"),
            log("2026-07-15T14:00:00Z"),
        ];
        const m = computeMetrics(logs, settings, NOW);
        // Multiple sessions share hour 9 (local); hour 14 has one
        expect(m.peakHour).not.toBe("-");
    });
});
