import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import { withCompletionStamp } from "./completion";

function task(patch: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-1", title: "Task", projectId: null, status: "Backlog", priority: "Medium",
        timeSpentMinutes: 0, tags: [], links: [], checklist: [], sortOrder: 0, isArchived: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", relatedTo: [], ...patch,
    };
}

describe("withCompletionStamp", () => {
    it.each<{ name: string; previous: PMTask | undefined; patch: Partial<PMTask>; stamp: string | undefined; same: boolean }>([
        { name: "Backlog to Done without a stamp", previous: task(), patch: { status: "Done" }, stamp: "T", same: false },
        { name: "Backlog to Done with the stale stamp", previous: task({ completedAt: "OLD" }), patch: { status: "Done", completedAt: "OLD" }, stamp: "T", same: false },
        { name: "Done title edit", previous: task({ status: "Done", completedAt: "X" }), patch: { status: "Done", completedAt: "X", title: "Edited" }, stamp: "X", same: true },
        { name: "Done to Backlog keeps the stale stamp", previous: task({ status: "Done", completedAt: "X" }), patch: { status: "Backlog", completedAt: "X" }, stamp: "X", same: true },
        { name: "new Done task", previous: undefined, patch: { status: "Done" }, stamp: "T", same: false },
        { name: "explicit caller stamp", previous: task(), patch: { status: "Done", completedAt: "B" }, stamp: "B", same: true },
        { name: "In Progress to Blocked", previous: task({ status: "In Progress" }), patch: { status: "Blocked" }, stamp: undefined, same: true },
        { name: "empty caller stamp", previous: task(), patch: { status: "Done", completedAt: "" }, stamp: "T", same: false },
        { name: "legacy Done title edit is not backfilled", previous: task({ status: "Done" }), patch: { status: "Done", title: "Edited" }, stamp: undefined, same: true },
        { name: "new Done task with explicit stamp", previous: undefined, patch: { status: "Done", completedAt: "B" }, stamp: "B", same: true },
        { name: "explicit replacement for a stale stamp", previous: task({ completedAt: "OLD" }), patch: { status: "Done", completedAt: "B" }, stamp: "B", same: true },
    ])("$name", ({ previous, patch, stamp, same }) => {
        const before = previous && { ...previous };
        const next = task(patch);
        const result = withCompletionStamp(previous, next, "T");
        expect(result.completedAt).toBe(stamp);
        expect(result === next).toBe(same);
        expect(previous).toEqual(before);
        expect(next).toEqual(task(patch));
    });
});
