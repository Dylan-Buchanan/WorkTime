import type { PMTask, ProposedTask } from "../../state/types";

export const START_OF_DAY_MAX_TASK_POMOS = 4;

export type StartOfDayPlanIssueCode =
    | "invalid-budget"
    | "empty-plan"
    | "invalid-estimate"
    | "duplicate-task-id"
    | "unknown-task-id"
    | "missing-current-task"
    | "missing-split-source"
    | "split-with-worked-progress"
    | "small-task-must-use-checklist"
    | "split-piece-too-large"
    | "large-task-must-split"
    | "worked-task-must-rollover"
    | "estimate-decrease-needs-completed-evidence"
    | "invalid-estimate-decrease-evidence"
    | "done-transition";

export interface StartOfDayPlanIssue {
    code: StartOfDayPlanIssueCode;
    message: string;
    taskId?: string;
    taskIndex?: number;
}

export interface StartOfDayPlanValidationInput {
    currentTasks: readonly PMTask[];
    proposedTasks: readonly ProposedTask[];
    workBudgetPomos: number;
    /** Archived tasks available only for validating historical estimate evidence. */
    evidenceTasks?: readonly PMTask[];
}

export interface StartOfDayPlanValidation {
    valid: boolean;
    issues: StartOfDayPlanIssue[];
}

export interface StartOfDayPlanItem {
    taskId?: string;
    splitsFrom?: string;
    title: string;
    description?: string;
    estimatePomos?: number;
    plannedPomos: number;
    rollover: boolean;
    checklist: ProposedTask["checklist"];
}

function workedPomos(task: PMTask): number {
    return typeof task.workedPomos === "number" && Number.isFinite(task.workedPomos)
        ? Math.max(0, task.workedPomos)
        : 0;
}

/** Return the remaining estimate without changing the task; used by callers that display rollover capacity. */
export function remainingEstimatePomos(task: PMTask): number {
    const estimate = typeof task.estimatePomos === "number" && Number.isFinite(task.estimatePomos)
        ? task.estimatePomos
        : 1;
    return Math.max(1, Math.ceil(estimate - workedPomos(task)));
}

function titleWords(title: string): Set<string> {
    return new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
}

function isComparableCompletedEvidence(task: PMTask, target: PMTask): boolean {
    if (task.status !== "Done" || task.projectId !== target.projectId) return false;
    if (!Number.isFinite(task.estimatePomos) || !Number.isFinite(task.workedPomos) || (task.workedPomos as number) >= (task.estimatePomos as number)) return false;
    const sharedTag = task.tags.some((tag) => target.tags.includes(tag));
    const targetWords = titleWords(target.title);
    const sharedTitleWord = [...titleWords(task.title)].some((word) => targetWords.has(word));
    return task.priority === target.priority && (sharedTag || sharedTitleWord);
}

/**
 * Validate the structural rules that must hold before an SOD target reaches
 * the diff engine. The model still chooses wording and split estimates; this
 * function only enforces deterministic safety and rollover invariants.
 */
export function validateStartOfDayPlan(input: StartOfDayPlanValidationInput): StartOfDayPlanValidation {
    const issues: StartOfDayPlanIssue[] = [];
    const current = input.currentTasks.filter((task) => !task.isArchived);
    const currentById = new Map(current.map((task) => [task.id, task]));
    const evidenceById = new Map([
        ...current,
        ...(input.evidenceTasks ?? []).filter((task) => task.isArchived),
    ].map((task) => [task.id, task] as const));
    const proposedIds = new Set<string>();
    const splitCounts = new Map<string, number>();

    if (!Number.isInteger(input.workBudgetPomos) || input.workBudgetPomos <= 0) {
        issues.push({ code: "invalid-budget", message: "The work-until window must fit at least one whole pomodoro." });
    }
    if (input.proposedTasks.length === 0) {
        issues.push({ code: "empty-plan", message: "The planner must return the complete project target." });
    }

    input.proposedTasks.forEach((task, taskIndex) => {
        if (task.estimatePomos !== undefined && (!Number.isInteger(task.estimatePomos) || task.estimatePomos < 1)) {
            issues.push({ code: "invalid-estimate", message: "Task estimates must be positive whole pomodoros.", taskId: task.id, taskIndex });
        }
        if (task.id) {
            if (proposedIds.has(task.id)) {
                issues.push({ code: "duplicate-task-id", message: `Task ${task.id} appears more than once.`, taskId: task.id, taskIndex });
            }
            proposedIds.add(task.id);
            const existing = currentById.get(task.id);
            if (!existing) {
                issues.push({ code: "unknown-task-id", message: `Task ${task.id} is not in the current project.`, taskId: task.id, taskIndex });
            } else {
                if (existing.status !== "Done" && task.status === "Done") {
                    issues.push({ code: "done-transition", message: `Task ${task.id} can only be completed by the timer.`, taskId: task.id, taskIndex });
                }
                if (existing.status !== "Done" && task.estimatePomos !== undefined && existing.estimatePomos !== undefined && task.estimatePomos < existing.estimatePomos) {
                    const evidenceIds = task.estimateEvidenceTaskIds ?? [];
                    const evidence = evidenceIds
                        .map((id) => evidenceById.get(id))
                        .filter((candidate): candidate is PMTask => Boolean(candidate));
                    if (!task.rationale?.trim() || evidence.length === 0 || evidence.length !== evidenceIds.length) {
                        issues.push({ code: "estimate-decrease-needs-completed-evidence", message: `Estimate decrease for task ${task.id} needs a rationale and a comparable completed task that took less time than estimated.`, taskId: task.id, taskIndex });
                    } else if (evidence.some((candidate) => !isComparableCompletedEvidence(candidate, existing))) {
                        issues.push({ code: "invalid-estimate-decrease-evidence", message: `Estimate decrease for task ${task.id} cites completed work that is not a comparable under-estimated task.`, taskId: task.id, taskIndex });
                    }
                }
                if (existing.status !== "Done" && (existing.estimatePomos ?? 0) > START_OF_DAY_MAX_TASK_POMOS && workedPomos(existing) === 0) {
                    issues.push({ code: "large-task-must-split", message: `Unstarted task ${task.id} must be replaced by bounded split pieces.`, taskId: task.id, taskIndex });
                }
            }
        }

        if (task.splitsFrom) {
            splitCounts.set(task.splitsFrom, (splitCounts.get(task.splitsFrom) ?? 0) + 1);
            const source = currentById.get(task.splitsFrom);
            if (!source) {
                issues.push({ code: "missing-split-source", message: `Split source ${task.splitsFrom} does not exist.`, taskIndex });
            } else if (workedPomos(source) > 0) {
                issues.push({ code: "split-with-worked-progress", message: `Worked task ${source.id} must roll over and cannot be split.`, taskId: source.id, taskIndex });
            } else if ((source.estimatePomos ?? 0) <= START_OF_DAY_MAX_TASK_POMOS) {
                issues.push({ code: "small-task-must-use-checklist", message: `Task ${source.id} is at most four pomodoros; express its steps as checklist items instead of split tasks.`, taskId: source.id, taskIndex });
            }
            if (task.estimatePomos === undefined || task.estimatePomos > START_OF_DAY_MAX_TASK_POMOS) {
                issues.push({ code: "split-piece-too-large", message: "Every split piece needs an independently chosen estimate of one to four pomodoros.", taskIndex });
            }
        }
    });

    for (const task of current) {
        const represented = proposedIds.has(task.id);
        const pieces = splitCounts.get(task.id) ?? 0;
        if (!represented && pieces === 0) {
            issues.push({ code: "missing-current-task", message: `Task ${task.id} is missing; off-plan backlog tasks must remain in the target.`, taskId: task.id });
        }
        if (task.status !== "Done" && (task.estimatePomos ?? 0) > START_OF_DAY_MAX_TASK_POMOS && workedPomos(task) === 0 && pieces < 2) {
            issues.push({ code: "large-task-must-split", message: `Task ${task.id} needs at least two independently estimated split pieces.`, taskId: task.id });
        }
        if (task.status !== "Done" && (task.estimatePomos ?? 0) > START_OF_DAY_MAX_TASK_POMOS && workedPomos(task) > 0 && !represented) {
            issues.push({ code: "worked-task-must-rollover", message: `Worked task ${task.id} must stay intact for rollover.`, taskId: task.id });
        }
    }

    return { valid: issues.length === 0, issues };
}

/** Select the ordered, budget-bounded portion saved for end-of-day comparison. */
export function selectStartOfDayPlanItems(
    proposedTasks: readonly ProposedTask[],
    workBudgetPomos: number,
): StartOfDayPlanItem[] {
    let available = Math.max(0, Math.trunc(workBudgetPomos));
    const items: StartOfDayPlanItem[] = [];
    for (const task of proposedTasks) {
        if (available <= 0) break;
        if (task.status === "Done") continue;
        if (task.checklist.length > 0 && task.checklist.every((item) => item.done)) continue;
        const estimate = task.estimatePomos ?? Math.max(1, task.checklist.filter((item) => !item.done).length || 1);
        const plannedPomos = Math.min(available, estimate);
        items.push({
            ...(task.id ? { taskId: task.id } : {}),
            ...(task.splitsFrom ? { splitsFrom: task.splitsFrom } : {}),
            title: task.title,
            ...(task.description !== undefined ? { description: task.description } : {}),
            ...(task.estimatePomos !== undefined ? { estimatePomos: task.estimatePomos } : {}),
            plannedPomos,
            rollover: estimate > plannedPomos,
            checklist: task.checklist.map((item) => ({ ...item })),
        });
        available -= plannedPomos;
    }
    return items;
}
