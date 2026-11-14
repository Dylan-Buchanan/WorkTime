import type { PMTask, Project, Task, TaskPriority } from "../state/types";
import { waitingOf } from "./pm/waiting";
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

/** Shared live eligibility for ranking and a pending sheet selection. */
export function isWhatsNextCandidate(task: PMTask | undefined, input: {
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    currentOccupantId: string | null;
    reference: Date;
}): boolean {
    if (!task || task.isArchived || task.status === "Done" || task.status === "Blocked" || waitingOf(task) !== null) return false;
    if (input.currentOccupantId !== null && task.id === input.currentOccupantId) return false;
    const backend = task.appTaskId ? input.backendTasks[task.appTaskId] : undefined;
    if (backend?.completed_at || backend?.archived) return false;
    const project = task.projectId ? input.projects[task.projectId] : undefined;
    return !project || isProjectWorkableOnDate(project, input.reference);
}

/**
 * Availability classification for the switch flow.
 *
 * The "anything" set is `pmTasks` minus the occupant (`id === currentOccupantId`),
 * minus `isArchived`, minus `status === "Done"`. Eligibility always comes from
 * `isWhatsNextCandidate`, so the classifier can never widen or narrow the
 * candidate set. Every task in that set either passes the predicate (workable,
 * never counted) or is counted in exactly ONE bucket: the first reason it matches
 * in `WHATS_NEXT_EXCLUSION_PRECEDENCE`:
 *
 * 1. "backend-closed"       linked backend task has `completed_at` or `archived`
 * 2. "blocked"              PM `status === "Blocked"`
 * 3. "waiting"              `waitingOf(task) !== null`
 * 4. "project-not-workable" project exists and `isProjectWorkableOnDate` rejects the reference date
 *
 * Dominant reason = the bucket with the highest count; ties are broken by that
 * same precedence order, so "blocked" beats "waiting". It stays null when
 * `hasWorkable` is true or when every count is zero.
 */
export type WhatsNextExclusionReason = "backend-closed" | "blocked" | "waiting" | "project-not-workable";

/** Per-task bucket precedence AND dominant-reason tie-break order. First match wins. */
export const WHATS_NEXT_EXCLUSION_PRECEDENCE: readonly WhatsNextExclusionReason[] = [
    "backend-closed",
    "blocked",
    "waiting",
    "project-not-workable",
];

export interface WhatsNextAvailability {
    /** Some non-occupant PM task that is !isArchived && status !== "Done". */
    hasAnything: boolean;
    /** Some non-occupant PM task passes `isWhatsNextCandidate`. */
    hasWorkable: boolean;
    /** Rejected "anything" tasks, exactly one bucket each. */
    counts: Readonly<Record<WhatsNextExclusionReason, number>>;
    /** Null when `hasWorkable` or when every count is 0. */
    dominantReason: WhatsNextExclusionReason | null;
}

/** True when the task matches that single exclusion reason, judged in isolation. */
function matchesExclusionReason(reason: WhatsNextExclusionReason, task: PMTask, input: {
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    reference: Date;
}): boolean {
    switch (reason) {
        case "backend-closed": {
            const backend = task.appTaskId ? input.backendTasks[task.appTaskId] : undefined;
            return Boolean(backend?.completed_at || backend?.archived);
        }
        case "blocked":
            return task.status === "Blocked";
        case "waiting":
            return waitingOf(task) !== null;
        case "project-not-workable": {
            const project = task.projectId ? input.projects[task.projectId] : undefined;
            return Boolean(project && !isProjectWorkableOnDate(project, input.reference));
        }
    }
}

/**
 * Separates "nothing workable right now" from "nothing else at all" for the
 * completion flow. Pure: the supplied reference is the only clock and array
 * order never changes the result.
 */
export function classifyWhatsNextAvailability(input: {
    pmTasks: readonly PMTask[];
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    currentOccupantId: string | null;
    reference: Date;
}): WhatsNextAvailability {
    const counts: Record<WhatsNextExclusionReason, number> = {
        "backend-closed": 0,
        "blocked": 0,
        "waiting": 0,
        "project-not-workable": 0,
    };
    let hasAnything = false;
    let hasWorkable = false;

    for (const pmTask of input.pmTasks) {
        if (input.currentOccupantId !== null && pmTask.id === input.currentOccupantId) continue;
        if (pmTask.isArchived || pmTask.status === "Done") continue;

        hasAnything = true;
        if (isWhatsNextCandidate(pmTask, input)) {
            hasWorkable = true;
            continue;
        }

        // The predicate only rejects the four reasons below, so a match exists.
        const reason = WHATS_NEXT_EXCLUSION_PRECEDENCE.find((candidate) => matchesExclusionReason(candidate, pmTask, input));
        if (reason !== undefined) counts[reason] += 1;
    }

    let dominantReason: WhatsNextExclusionReason | null = null;
    if (!hasWorkable) {
        let highest = 0;
        for (const reason of WHATS_NEXT_EXCLUSION_PRECEDENCE) {
            if (counts[reason] > highest) {
                highest = counts[reason];
                dominantReason = reason;
            }
        }
    }

    return { hasAnything, hasWorkable, counts, dominantReason };
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
        if (!isWhatsNextCandidate(pmTask, input)) continue;
        const backendTask = pmTask.appTaskId ? input.backendTasks[pmTask.appTaskId] : undefined;
        const project = pmTask.projectId ? input.projects[pmTask.projectId] : undefined;

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
