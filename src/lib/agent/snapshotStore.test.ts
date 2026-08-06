import { describe, expect, it } from "vitest";
import type { PMTask } from "../../state/types";
import {
    AGENT_PROJECT_SNAPSHOT_STORAGE_KEY,
    getAgentProjectSnapshot,
    planAgentSnapshotRevert,
    saveAgentProjectSnapshot,
} from "./snapshotStore";

function task(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "task-1",
        title: "Original",
        projectId: "project-1",
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        workedPomos: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T12:00:00.000Z",
        relatedTo: [],
        ...overrides,
    };
}

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
}

describe("agent project snapshot storage", () => {
    it("persists only current tasks from the selected project and returns defensive copies", () => {
        const storage = memoryStorage();
        const selected = task();
        const snapshot = saveAgentProjectSnapshot("project-1", [
            selected,
            task({ id: "archived", isArchived: true }),
            task({ id: "other", projectId: "project-2" }),
        ], "2026-08-06T13:00:00.000Z", storage);

        selected.title = "Mutated after capture";
        expect(snapshot.tasks.map((item) => item.id)).toEqual(["task-1"]);
        expect(getAgentProjectSnapshot(storage)?.tasks[0]?.title).toBe("Original");
        expect(storage.values.has(AGENT_PROJECT_SNAPSHOT_STORAGE_KEY)).toBe(true);
    });

    it("rejects malformed or cross-project snapshot data", () => {
        const storage = memoryStorage();
        storage.setItem(AGENT_PROJECT_SNAPSHOT_STORAGE_KEY, JSON.stringify({
            version: 1,
            projectId: "project-1",
            capturedAt: "2026-08-06T13:00:00.000Z",
            tasks: [task({ projectId: "project-2" })],
        }));
        expect(getAgentProjectSnapshot(storage)).toBeNull();
    });
});

describe("agent snapshot revert planning", () => {
    it("surfaces updated, missing, and newly created tasks before write-back", () => {
        const snapshot = {
            version: 1 as const,
            projectId: "project-1",
            capturedAt: "2026-08-06T13:00:00.000Z",
            tasks: [task(), task({ id: "missing", title: "Missing" })],
        };
        const current = {
            "task-1": task({ title: "Changed", updatedAt: "2026-08-06T14:00:00.000Z" }),
            created: task({ id: "created", title: "Created", updatedAt: "2026-08-06T14:01:00.000Z" }),
            other: task({ id: "other", projectId: "project-2" }),
        };

        const plan = planAgentSnapshotRevert(snapshot, current);

        expect(plan.conflicts.map((conflict) => [conflict.taskId, conflict.kind])).toEqual([
            ["created", "created"],
            ["missing", "missing"],
            ["task-1", "updated"],
        ]);
        expect(plan.restoreTasks.map((item) => item.id).sort()).toEqual(["missing", "task-1"]);
        expect(plan.archiveTaskIds).toEqual(["created"]);
    });

    it("invalidates confirmation when a bridge-style timestamp changes again", () => {
        const snapshot = {
            version: 1 as const,
            projectId: "project-1",
            capturedAt: "2026-08-06T13:00:00.000Z",
            tasks: [task()],
        };
        const first = planAgentSnapshotRevert(snapshot, {
            "task-1": task({ workedPomos: 1, updatedAt: "2026-08-06T14:00:00.000Z" }),
        });
        const second = planAgentSnapshotRevert(snapshot, {
            "task-1": task({ workedPomos: 2, updatedAt: "2026-08-06T14:01:00.000Z" }),
        });

        expect(second.conflicts[0]?.kind).toBe("updated");
        expect(second.confirmationToken).not.toBe(first.confirmationToken);
    });
});
