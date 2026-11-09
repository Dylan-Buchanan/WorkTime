import { describe, expect, it } from "vitest";
import type { PMTask, PMTaskWaiting, TaskStatus } from "../../state/types";
import { normalizeWaiting, waitingOf, withWaitingInvariant } from "./waiting";

const SINCE = "2026-11-08T09:00:00.000Z";

function task(patch: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-1",
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
        ...patch,
    };
}

describe("normalizeWaiting", () => {
    it.each([
        ["missing", undefined],
        ["null", null],
        ["non-object", "agent"],
        ["array", [{ type: "agent", since: SINCE }]],
        ["unknown type", { type: "robot", since: SINCE }],
        ["missing since", { type: "agent" }],
        ["non-string since", { type: "agent", since: 42 }],
        ["unparseable since", { type: "agent", since: "not-a-date" }],
    ])("collapses %s to null", (_label, value) => {
        expect(normalizeWaiting(value)).toBeNull();
    });

    it("keeps valid agent and person values in a fresh two-key object", () => {
        const agent = normalizeWaiting({ type: "agent", since: SINCE });
        const person = normalizeWaiting({ type: "person", since: SINCE });
        expect(agent).toEqual({ type: "agent", since: SINCE });
        expect(person).toEqual({ type: "person", since: SINCE });
        expect(Object.keys(agent!)).toEqual(["type", "since"]);
    });

    it("strips extra keys from a valid value", () => {
        expect(normalizeWaiting({ type: "agent", since: SINCE, reason: "blocked" })).toEqual({ type: "agent", since: SINCE });
    });

    it("accepts every timestamp Date.parse understands", () => {
        expect(normalizeWaiting({ type: "person", since: "2026-11-08" })).toEqual({ type: "person", since: "2026-11-08" });
    });
});

describe("waitingOf", () => {
    it("reads the normalized fact from a task", () => {
        expect(waitingOf(task({ waiting: { type: "person", since: SINCE } }))).toEqual({ type: "person", since: SINCE });
        expect(waitingOf(task({ waiting: { type: "robot", since: SINCE } as unknown as PMTaskWaiting }))).toBeNull();
        expect(waitingOf(task())).toBeNull();
    });
});

describe("withWaitingInvariant", () => {
    it.each<TaskStatus>(["Backlog", "Next", "In Progress", "Blocked"])("keeps a valid flag on %s", (status) => {
        const original = task({ status, waiting: { type: "agent", since: SINCE } });
        expect(withWaitingInvariant(original)).toBe(original);
        expect(original.waiting).toEqual({ type: "agent", since: SINCE });
    });

    it("normalizes a missing flag to null and keeps an explicit null reference", () => {
        const withoutWaiting = task({ status: "Next" });
        const normalized = withWaitingInvariant(withoutWaiting);
        expect(normalized).not.toBe(withoutWaiting);
        expect(normalized.waiting).toBeNull();
        expect(withoutWaiting).not.toHaveProperty("waiting");
        const explicitNull = task({ status: "Next", waiting: null });
        expect(withWaitingInvariant(explicitNull)).toBe(explicitNull);
    });

    it("clears waiting on Done and preserves the same reference when already clear", () => {
        const done = task({ status: "Done", waiting: { type: "agent", since: SINCE } });
        const cleared = withWaitingInvariant(done);
        expect(cleared.waiting).toBeNull();
        expect(cleared.status).toBe("Done");
        expect(done.waiting).toEqual({ type: "agent", since: SINCE });
        expect(withWaitingInvariant(cleared)).toBe(cleared);
    });

    it("clears waiting on archived tasks", () => {
        const archived = task({ status: "Blocked", isArchived: true, waiting: { type: "person", since: SINCE } });
        expect(withWaitingInvariant(archived).waiting).toBeNull();
    });

    it("strips extra keys from an otherwise unchanged flag", () => {
        const dirty = task({ waiting: { type: "agent", since: SINCE, note: "x" } as PMTaskWaiting });
        const normalized = withWaitingInvariant(dirty);
        expect(normalized).not.toBe(dirty);
        expect(normalized.waiting).toEqual({ type: "agent", since: SINCE });
    });
});

describe("pm_state serialization", () => {
    it("round-trips a waiting task through JSON", () => {
        const blob = {
            projects: {},
            tasks: {
                pt1: task({ id: "pt1", status: "Blocked", waiting: { type: "person", since: SINCE } }),
            },
            meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
        };
        const parsed = JSON.parse(JSON.stringify(blob)) as typeof blob;
        expect(waitingOf(parsed.tasks.pt1)).toEqual({ type: "person", since: SINCE });
        // mergeSingletonValue is intentionally not exported from
        // src/lib/data/sync/merge.ts, so the whole-blob LWW merge cannot be
        // exercised directly without touching a forbidden data-layer file.
    });
});
