import type { PMTask } from "../../state/types";

/**
 * Intentional surface-local localStorage exception. This is kept outside the
 * staged application store so an unfinished workflow is never synced while its
 * last pre-workflow snapshot remains available after an app restart.
 */
export const AGENT_PROJECT_SNAPSHOT_STORAGE_KEY = "worktime:agent:projectSnapshot:v1";

export interface AgentProjectSnapshot {
    version: 1;
    projectId: string;
    capturedAt: string;
    tasks: PMTask[];
}

export type AgentSnapshotConflictKind = "updated" | "created" | "missing";

export interface AgentSnapshotConflict {
    taskId: string;
    title: string;
    kind: AgentSnapshotConflictKind;
    snapshotUpdatedAt?: string;
    currentUpdatedAt?: string;
}

export interface AgentSnapshotRevertPlan {
    conflicts: AgentSnapshotConflict[];
    confirmationToken: string;
    restoreTasks: PMTask[];
    archiveTaskIds: string[];
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function cloneTask(task: PMTask): PMTask {
    return JSON.parse(JSON.stringify(task)) as PMTask;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotTask(value: unknown): value is PMTask {
    if (!isRecord(value)) return false;
    return typeof value.id === "string"
        && typeof value.title === "string"
        && (typeof value.projectId === "string" || value.projectId === null)
        && typeof value.updatedAt === "string"
        && typeof value.createdAt === "string"
        && typeof value.isArchived === "boolean"
        && Array.isArray(value.tags)
        && Array.isArray(value.links)
        && Array.isArray(value.checklist)
        && Array.isArray(value.relatedTo);
}

function parseSnapshot(value: unknown): AgentProjectSnapshot | null {
    if (!isRecord(value)
        || value.version !== 1
        || typeof value.projectId !== "string"
        || !value.projectId
        || typeof value.capturedAt !== "string"
        || !Array.isArray(value.tasks)
        || !value.tasks.every(isSnapshotTask)) {
        return null;
    }
    if (value.tasks.some((task) => task.projectId !== value.projectId || task.isArchived)) return null;
    if (new Set(value.tasks.map((task) => task.id)).size !== value.tasks.length) return null;
    return {
        version: 1,
        projectId: value.projectId,
        capturedAt: value.capturedAt,
        tasks: value.tasks.map(cloneTask),
    };
}

/** Captures the current, non-archived tasks for one selected project. */
export function saveAgentProjectSnapshot(
    projectId: string,
    tasks: Iterable<PMTask>,
    capturedAt = new Date().toISOString(),
    storage: StorageLike | undefined = defaultStorage(),
): AgentProjectSnapshot {
    const snapshot: AgentProjectSnapshot = {
        version: 1,
        projectId,
        capturedAt,
        tasks: [...tasks]
            .filter((task) => task.projectId === projectId && !task.isArchived)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
            .map(cloneTask),
    };
    storage?.setItem(AGENT_PROJECT_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
}

export function getAgentProjectSnapshot(
    storage: StorageLike | undefined = defaultStorage(),
): AgentProjectSnapshot | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(AGENT_PROJECT_SNAPSHOT_STORAGE_KEY);
        return raw ? parseSnapshot(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

export function clearAgentProjectSnapshot(storage: StorageLike | undefined = defaultStorage()): void {
    storage?.removeItem(AGENT_PROJECT_SNAPSHOT_STORAGE_KEY);
}

function conflictToken(snapshot: AgentProjectSnapshot, conflicts: readonly AgentSnapshotConflict[]): string {
    return JSON.stringify({
        capturedAt: snapshot.capturedAt,
        projectId: snapshot.projectId,
        conflicts: conflicts.map((conflict) => [
            conflict.kind,
            conflict.taskId,
            conflict.snapshotUpdatedAt ?? null,
            conflict.currentUpdatedAt ?? null,
        ]),
    });
}

/**
 * Computes a dirty-checked revert without writing. The token identifies the
 * exact conflict set, including current timestamps, so a later edit invalidates
 * an earlier confirmation.
 */
export function planAgentSnapshotRevert(
    snapshot: AgentProjectSnapshot,
    currentTasks: Readonly<Record<string, PMTask>>,
): AgentSnapshotRevertPlan {
    const snapshotById = new Map(snapshot.tasks.map((task) => [task.id, task]));
    const conflicts: AgentSnapshotConflict[] = [];
    const restoreTasks: PMTask[] = [];

    for (const snapshotTask of snapshot.tasks) {
        const current = currentTasks[snapshotTask.id];
        if (!current) {
            conflicts.push({
                taskId: snapshotTask.id,
                title: snapshotTask.title,
                kind: "missing",
                snapshotUpdatedAt: snapshotTask.updatedAt,
            });
            restoreTasks.push(cloneTask(snapshotTask));
            continue;
        }
        if (current.updatedAt !== snapshotTask.updatedAt) {
            conflicts.push({
                taskId: current.id,
                title: current.title,
                kind: "updated",
                snapshotUpdatedAt: snapshotTask.updatedAt,
                currentUpdatedAt: current.updatedAt,
            });
        }
        if (JSON.stringify(current) !== JSON.stringify(snapshotTask)) {
            restoreTasks.push(cloneTask(snapshotTask));
        }
    }

    const createdTasks = Object.values(currentTasks)
        .filter((task) => task.projectId === snapshot.projectId && !task.isArchived && !snapshotById.has(task.id))
        .sort((a, b) => a.id.localeCompare(b.id));
    for (const task of createdTasks) {
        conflicts.push({
            taskId: task.id,
            title: task.title,
            kind: "created",
            currentUpdatedAt: task.updatedAt,
        });
    }

    conflicts.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.kind.localeCompare(b.kind));
    return {
        conflicts,
        confirmationToken: conflictToken(snapshot, conflicts),
        restoreTasks,
        archiveTaskIds: createdTasks.map((task) => task.id),
    };
}
