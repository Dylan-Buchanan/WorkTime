import type { PMTask } from "../../state/types";
import type { AgentStartOfDayPlan } from "../agent/startOfDayPlanStore";

export type EndOfDayPlanOutcome = "completed" | "partial" | "not-started" | "missing";

export interface EndOfDayPlanComparison {
    title: string;
    taskId?: string;
    currentTaskId?: string;
    plannedPomos: number;
    workedPomos: number;
    outcome: EndOfDayPlanOutcome;
}

export interface EndOfDayComparison {
    plannedCount: number;
    completedCount: number;
    partialCount: number;
    notStartedCount: number;
    missingCount: number;
    items: EndOfDayPlanComparison[];
}

function normalizedTitle(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function fullyChecked(task: PMTask): boolean {
    return task.checklist.length > 0 && task.checklist.every((item) => item.done);
}

function hasProgress(task: PMTask): boolean {
    return (task.workedPomos ?? 0) > 0 || task.checklist.some((item) => item.done);
}

/**
 * Compares the persisted Start-of-Day handoff with the current PM snapshot.
 * Direct task IDs are authoritative. New split pieces use a unique normalized
 * title as the deterministic v1 fallback because the SOD store has no created ID.
 */
export function compareEndOfDayPlan(
    plan: Pick<AgentStartOfDayPlan, "orderedTasks">,
    currentTasks: readonly PMTask[],
): EndOfDayComparison {
    const activeTasks = currentTasks.filter((task) => !task.isArchived);
    const byId = new Map(activeTasks.map((task) => [task.id, task]));
    const byTitle = new Map<string, PMTask[]>();
    for (const task of activeTasks) {
        const title = normalizedTitle(task.title);
        byTitle.set(title, [...(byTitle.get(title) ?? []), task]);
    }

    const items = plan.orderedTasks.map<EndOfDayPlanComparison>((item) => {
        const titleMatches = byTitle.get(normalizedTitle(item.title)) ?? [];
        const task = item.taskId ? byId.get(item.taskId) : titleMatches.length === 1 ? titleMatches[0] : undefined;
        if (!task) {
            return { title: item.title, ...(item.taskId ? { taskId: item.taskId } : {}), plannedPomos: item.plannedPomos, workedPomos: 0, outcome: "missing" };
        }
        const outcome: EndOfDayPlanOutcome = task.status === "Done" || fullyChecked(task)
            ? "completed"
            : hasProgress(task) ? "partial" : "not-started";
        return {
            title: item.title,
            ...(item.taskId ? { taskId: item.taskId } : {}),
            currentTaskId: task.id,
            plannedPomos: item.plannedPomos,
            workedPomos: Math.max(0, task.workedPomos ?? 0),
            outcome,
        };
    });

    return {
        plannedCount: items.length,
        completedCount: items.filter((item) => item.outcome === "completed").length,
        partialCount: items.filter((item) => item.outcome === "partial").length,
        notStartedCount: items.filter((item) => item.outcome === "not-started").length,
        missingCount: items.filter((item) => item.outcome === "missing").length,
        items,
    };
}

/** Ensures an EOD ordering is a permutation of every remaining task exactly once. */
export function validateTomorrowTaskOrder(remainingTaskIds: readonly string[], orderedTaskIds: readonly string[]): void {
    const expected = new Set(remainingTaskIds);
    const actual = new Set(orderedTaskIds);
    if (actual.size !== orderedTaskIds.length) throw new Error("The End-of-Day plan contains duplicate task IDs.");
    if (expected.size !== remainingTaskIds.length || actual.size !== expected.size
        || remainingTaskIds.some((id) => !actual.has(id))) {
        throw new Error("The End-of-Day plan must prioritize every remaining task exactly once.");
    }
}
