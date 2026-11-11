import type { ActiveTimer, AppStateData, Task } from "../../state/types";
import { cloneAppState, type EngineResult } from "./core";
import { archiveTask, finalizeTask } from "./taskCommands";

export type DeferredFinalizeOutcome = "finalized" | "owner" | "skipped";

export function archiveDeferredTask(
    state: AppStateData, taskId: string,
): EngineResult<DeferredFinalizeOutcome> {
    const task = state.tasks[taskId];
    if (!task || task.archived || task.completed_at !== null) return { state: cloneAppState(state), value: "skipped" };
    if (ownsWorkWindow(state.timer, taskId)) return { state: cloneAppState(state), value: "owner" };
    return { state: archiveTask(state, taskId).state, value: "finalized" };
}

export function finalizeDeferredTask(
    state: AppStateData, taskId: string, now: Date, logId: string,
): EngineResult<DeferredFinalizeOutcome> {
    const task = state.tasks[taskId];
    if (!task || task.completed_at !== null) return { state: cloneAppState(state), value: "skipped" };
    if (ownsWorkWindow(state.timer, taskId)) return { state: cloneAppState(state), value: "owner" };
    return { state: finalizeTask(state, taskId, now, logId).state, value: "finalized" };
}

/** True when `taskId` owns the current Work window (running OR paused). */
export function ownsWorkWindow(timer: ActiveTimer | null | undefined, taskId: string): boolean {
    return timer?.kind === "Work" && timer.task_id === taskId;
}

export interface PendingFinalizePartition {
    flush: string[];   // finalize now
    keep: string[];    // still owns the Work window; stays queued
    drop: string[];    // nothing to do (task missing, or completed_at already set)
}

export function partitionPendingFinalizes(
    pending: readonly string[],
    timer: ActiveTimer | null | undefined,
    tasks: Readonly<Record<string, Task>>,
): PendingFinalizePartition {
    const result: PendingFinalizePartition = { flush: [], keep: [], drop: [] };
    for (const id of new Set(pending)) {
        const task = tasks[id];
        if (!task || task.completed_at !== null) result.drop.push(id);
        else if (ownsWorkWindow(timer, id)) result.keep.push(id);
        else result.flush.push(id);
    }
    return result;
}
