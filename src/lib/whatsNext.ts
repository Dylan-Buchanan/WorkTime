import type { PMTask, Project, Task, TaskPriority } from "../state/types";
import { isProjectWorkableOnDate } from "./projectSchedule";
import { EPSILON, classifyDueScope, parseDueDateKey } from "./timer";

export type PromotionTier = "top-pick" | "quick-win" | "next-up";

export interface RankedCandidate {
    task: PMTask;
    projectId: string | null;
    dueDate: string | null;
    dueKey: string | null;
    remainingPomodoros: number;
    tier: PromotionTier | null;
}

export interface WhatsNextResult {
    top: RankedCandidate[];
    continuation: RankedCandidate[];
}

/** Matches the task panel's importance ordering so both surfaces agree. */
export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
    High: 0,
    Medium: 1,
    Low: 2,
};

const MISSING_PRIORITY_RANK = 3;

function priorityRank(task: PMTask): number {
    return PRIORITY_RANK[task.priority] ?? MISSING_PRIORITY_RANK;
}

/** PM estimate when numeric, else the linked backend target, else un-estimated. */
function effectiveEstimate(pmTask: PMTask, backendTask: Task | undefined): number {
    if (typeof pmTask.estimatePomos === "number" && Number.isFinite(pmTask.estimatePomos)) {
        return pmTask.estimatePomos;
    }
    const target = backendTask?.target_pomodoros;
    if (typeof target === "number" && Number.isFinite(target)) return target;
    return 0;
}

function workedPomodoros(pmTask: PMTask, backendTask: Task | undefined): number {
    let worked = backendTask?.completed_pomodoros ?? 0;
    if (pmTask.workedPomos !== undefined) {
        worked = Math.max(worked, pmTask.workedPomos);
    }
    return worked;
}

/**
 * The collector's floor from `collectEligibleProjectionTasks` in
 * `src/lib/timer.ts`: only a non-positive remainder becomes 1, so a fractional
 * remainder such as 0.5 is kept.
 */
function floorRemaining(estimatedRemaining: number): number {
    return estimatedRemaining > EPSILON ? estimatedRemaining : 1;
}

/**
 * Own candidate collector: the shared projection collector stays the scope
 * definition for Today and the projected-finish card, and this one adds
 * ranking-only exclusions and an un-estimated tail.
 */
function collectCandidates(input: {
    pmTasks: readonly PMTask[];
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    currentOccupantId: string | null;
    reference: Date;
}): RankedCandidate[] {
    const candidates: RankedCandidate[] = [];

    for (const pmTask of input.pmTasks) {
        if (pmTask.isArchived) continue;
        if (pmTask.status === "Done") continue;
        if (pmTask.status === "Blocked") continue;
        if (pmTask.waiting != null) continue;
        if (input.currentOccupantId != null && pmTask.id === input.currentOccupantId) continue;

        const backendTask = pmTask.appTaskId ? input.backendTasks[pmTask.appTaskId] : undefined;
        if (backendTask?.completed_at) continue;
        if (backendTask?.archived) continue;

        const project = pmTask.projectId ? input.projects[pmTask.projectId] : undefined;
        if (project && !isProjectWorkableOnDate(project, input.reference)) continue;

        const estimate = effectiveEstimate(pmTask, backendTask);
        const remainingPomodoros = Number.isFinite(estimate) && estimate > EPSILON
            ? floorRemaining(estimate - workedPomodoros(pmTask, backendTask))
            : 0;

        candidates.push({
            task: pmTask,
            projectId: project ? pmTask.projectId : null,
            dueDate: pmTask.dueDate ?? null,
            dueKey: parseDueDateKey(pmTask.dueDate),
            remainingPomodoros,
            tier: null,
        });
    }

    return candidates;
}

/** Priority, then due date with nulls last, then remaining, sort order, title, id. */
function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
    const priorityDelta = priorityRank(a.task) - priorityRank(b.task);
    if (priorityDelta !== 0) return priorityDelta;

    if (a.dueKey !== b.dueKey) {
        if (a.dueKey === null) return 1;
        if (b.dueKey === null) return -1;
        return a.dueKey < b.dueKey ? -1 : 1;
    }

    if (a.remainingPomodoros !== b.remainingPomodoros) {
        return a.remainingPomodoros - b.remainingPomodoros;
    }

    if (a.task.sortOrder !== b.task.sortOrder) {
        return a.task.sortOrder - b.task.sortOrder;
    }

    const titleDelta = a.task.title.localeCompare(b.task.title, "en");
    if (titleDelta !== 0) return titleDelta;

    if (a.task.id === b.task.id) return 0;
    return a.task.id < b.task.id ? -1 : 1;
}

/** Smallest remaining pomodoros, ties broken by the base comparator. */
function pickQuickWin(pool: readonly RankedCandidate[]): RankedCandidate | null {
    let best: RankedCandidate | null = null;
    for (const candidate of pool) {
        if (!best) {
            best = candidate;
            continue;
        }
        if (candidate.remainingPomodoros < best.remainingPomodoros) {
            best = candidate;
            continue;
        }
        if (candidate.remainingPomodoros === best.remainingPomodoros && compareCandidates(candidate, best) < 0) {
            best = candidate;
        }
    }
    return best;
}

/**
 * Ranks eligible PM tasks into one candidate per promotion tier plus a
 * continuation list. The reference date is the only clock; the result depends
 * on input values only, never on array order.
 */
export function rankWhatsNext(input: {
    pmTasks: readonly PMTask[];
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    currentOccupantId: string | null;
    reference: Date;
}): WhatsNextResult {
    const candidates = collectCandidates(input);
    const estimated = candidates
        .filter((candidate) => candidate.remainingPomodoros > 0)
        .sort(compareCandidates);
    const unestimated = candidates
        .filter((candidate) => candidate.remainingPomodoros <= 0)
        .sort(compareCandidates);

    const top: RankedCandidate[] = [];
    const promoted = new Set<string>();
    const promote = (candidate: RankedCandidate | null, tier: PromotionTier) => {
        if (!candidate) return;
        promoted.add(candidate.task.id);
        top.push({ ...candidate, tier });
    };

    const topPick = estimated[0] ?? null;
    promote(topPick, "top-pick");

    const quickWinPool = estimated.filter((candidate) => !promoted.has(candidate.task.id));
    promote(pickQuickWin(quickWinPool), "quick-win");

    const nextUpPool = estimated.filter((candidate) => {
        if (promoted.has(candidate.task.id)) return false;
        if (candidate.task.priority === "High") return true;
        const scope = classifyDueScope(candidate.dueDate, input.reference);
        return scope === "due" || scope === "thisWeek";
    });
    promote(nextUpPool[0] ?? null, "next-up");

    const continuation: RankedCandidate[] = [
        ...estimated.filter((candidate) => !promoted.has(candidate.task.id)),
        ...unestimated,
    ];

    return { top, continuation };
}
