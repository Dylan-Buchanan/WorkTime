import type { PMTask, PMTaskWaiting } from "../../state/types";

const WAITING_TYPES: readonly PMTaskWaiting["type"][] = ["agent", "person"];

/**
 * Coerce a persisted `waiting` value to the runtime shape. Missing, malformed,
 * unknown-type, and unparseable-`since` values all mean "not waiting", so a bad
 * blob can never break the task it belongs to.
 */
export function normalizeWaiting(value: unknown): PMTaskWaiting | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (typeof source.type !== "string" || !WAITING_TYPES.includes(source.type as PMTaskWaiting["type"])) return null;
    if (typeof source.since !== "string" || Number.isNaN(Date.parse(source.since))) return null;
    return { type: source.type as PMTaskWaiting["type"], since: source.since };
}

/** The normalized waiting fact for a task, or null when it is not waiting. */
export function waitingOf(task: PMTask): PMTaskWaiting | null {
    return normalizeWaiting(task.waiting);
}

/**
 * Normalize a task's waiting fact and enforce the Done/archived invariant.
 * Returns the same task reference when its waiting representation is already
 * canonical, so callers can skip redundant state updates.
 */
export function withWaitingInvariant(task: PMTask): PMTask {
    const normalized = normalizeWaiting(task.waiting);
    const waiting = task.status === "Done" || task.isArchived ? null : normalized;
    if (waiting === task.waiting) return task;
    if (
        task.waiting != null &&
        normalized != null &&
        waiting != null &&
        Object.keys(task.waiting).length === 2 &&
        normalized.type === task.waiting.type &&
        normalized.since === task.waiting.since
    ) {
        return task;
    }
    return { ...task, waiting };
}
