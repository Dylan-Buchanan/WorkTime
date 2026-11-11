import type { PMTask } from "../../state/types";

/** Stamp transitions into Done, preserving explicit stamps and unchanged tasks. */
export function withCompletionStamp(previous: PMTask | undefined, next: PMTask, at: string): PMTask {
    if (next.status !== "Done" || previous?.status === "Done") return next;
    if (typeof next.completedAt === "string" && next.completedAt.length > 0 && next.completedAt !== previous?.completedAt) return next;
    return { ...next, completedAt: at };
}
