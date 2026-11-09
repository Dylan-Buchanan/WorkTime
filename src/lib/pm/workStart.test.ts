import { describe, expect, it } from "vitest";
import type { PMTask, TaskStatus } from "../../state/types";
import { makeActiveTimer } from "../../test/mockTauri";
import { windowStartedAt } from "../engine";
import { applyWorkStart, findPMTaskByAppTaskId, workOccupantKey } from "./workStart";

const before = "2026-01-01T00:00:00.000Z";
const now = "2026-11-08T12:00:00.000Z";
function task(patch: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-1", title: "Task", projectId: null, status: "Backlog", priority: "Medium",
        timeSpentMinutes: 0, tags: [], links: [], checklist: [], sortOrder: 0,
        isArchived: false, createdAt: before, updatedAt: before, relatedTo: [], ...patch,
    };
}

describe("applyWorkStart", () => {
    it.each<TaskStatus>(["Backlog", "Next", "In Progress", "Blocked", "Done"])("applies the work-start rule to %s", (status) => {
        const original = task({ status });
        const next = applyWorkStart(original, now);
        const advances = status === "Backlog" || status === "Next";
        expect(next.status).toBe(advances ? "In Progress" : status);
        expect(next.updatedAt).toBe(advances ? now : before);
        if (advances) expect(next).toEqual({ ...original, status: "In Progress", waiting: null, updatedAt: now });
        else expect(next).toBe(original);
        expect(original.status).toBe(status);
        expect(original.updatedAt).toBe(before);
    });

    it.each<TaskStatus>(["Backlog", "Next", "In Progress", "Blocked", "Done"])("clears waiting and stamps %s", (status) => {
        const original = task({ status, waiting: { type: "agent", since: before } });
        const next = applyWorkStart(original, now);
        expect(next.waiting).toBeNull();
        expect(next.updatedAt).toBe(now);
        expect(next.status).toBe(status === "Backlog" || status === "Next" ? "In Progress" : status);
        expect(original.waiting).toEqual({ type: "agent", since: before });
    });

    it.each([undefined, null])("returns the same reference for unchanged status and waiting %s", (waiting) => {
        const original = task({ status: "Blocked", waiting });
        expect(applyWorkStart(original, now)).toBe(original);
        expect(original.updatedAt).toBe(before);
    });
});

describe("findPMTaskByAppTaskId", () => {
    it("returns null for a missing link", () => {
        expect(findPMTaskByAppTaskId({}, "backend")).toBeNull();
        expect(findPMTaskByAppTaskId({ other: task({ appTaskId: "other" }) }, "backend")).toBeNull();
    });

    it("selects duplicates by sortOrder, then createdAt, then id regardless of insertion order", () => {
        const candidates = [
            task({ id: "low-order", appTaskId: "backend", sortOrder: 1, createdAt: now }),
            task({ id: "early", appTaskId: "backend", sortOrder: 1 }),
            task({ id: "a", appTaskId: "backend", sortOrder: 1 }),
            task({ id: "higher-order", appTaskId: "backend", sortOrder: 2, createdAt: "2020-01-01" }),
        ];
        for (const rows of [candidates, [...candidates].reverse()]) {
            const records = Object.fromEntries(rows.map((row) => [row.id, row]));
            expect(findPMTaskByAppTaskId(records, "backend")).toBe(candidates[2]);
            delete records.a;
            expect(findPMTaskByAppTaskId(records, "backend")).toBe(candidates[1]);
            delete records.early;
            expect(findPMTaskByAppTaskId(records, "backend")).toBe(candidates[0]);
        }
    });
});

describe("workOccupantKey", () => {
    it("ignores null and both kinds of break", () => {
        expect(workOccupantKey(null)).toBeNull();
        expect(workOccupantKey(makeActiveTimer({ kind: "ShortBreak" }))).toBeNull();
        expect(workOccupantKey(makeActiveTimer({ kind: "LongBreak" }))).toBeNull();
    });

    it.each([undefined, before])("identifies Work with window_started_at %s", (window_started_at) => {
        const timer = makeActiveTimer({ task_id: "backend", window_started_at });
        expect(workOccupantKey(timer)).toBe(`backend|${windowStartedAt(timer)}`);
        expect(workOccupantKey({ ...timer, window_started_at: windowStartedAt(timer), paused: true, started_at: now, ends_at: now })).toBe(workOccupantKey(timer));
        expect(workOccupantKey({ ...timer, task_id: "other" })).not.toBe(workOccupantKey(timer));
        expect(workOccupantKey({ ...timer, window_started_at: now })).not.toBe(workOccupantKey(timer));
    });
});


it("matches a discarded legacy baseline to its backfilled occupant", () => {
    const legacy = makeActiveTimer({ accumulated_secs: 600, window_started_at: undefined });
    expect(workOccupantKey(legacy)).toBe(workOccupantKey({ ...legacy, window_started_at: windowStartedAt(legacy) }));
});
