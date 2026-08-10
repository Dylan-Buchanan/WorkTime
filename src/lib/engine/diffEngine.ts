import type { PMTask, ProposedTask } from "../../state/types";

export type { ProposedTask } from "../../state/types";

export type TaskChangeType = "create" | "update" | "split" | "remove" | "reorder";
export type TaskChangeAction = "createTask" | "updateTask" | "archiveTask" | "reorderTasks";

export type TaskSnapshot = readonly PMTask[] | Record<string, PMTask>;

export interface DiffPlannerTasksInput {
    currentTasks?: TaskSnapshot;
    proposedTasks?: readonly ProposedTask[];
    /** Alias accepted for callers that name the source a current snapshot. */
    currentSnapshot?: TaskSnapshot;
    /** Alias accepted for callers that name the target a target snapshot. */
    targetSnapshot?: readonly ProposedTask[];
    /** Alias accepted by workflow callers that use targetTasks terminology. */
    targetTasks?: readonly ProposedTask[];
}

export interface GuardrailFlags {
    blocked: boolean;
    splitWithWorkedProgress: boolean;
    splitBlocked: boolean;
    estimateIncreased: boolean;
    estimateIncrease: boolean;
    rationaleRequired: boolean;
    forwardDueDate: boolean;
    forwardDueDateChange: boolean;
    doneTransition: boolean;
    reasons: string[];
}

export interface TaskChange {
    type: TaskChangeType;
    action: TaskChangeAction;
    /** Existing-task ID; create and split cards have no task ID yet. */
    taskId?: string;
    before?: PMTask;
    after?: ProposedTask;
    /** The current task that a split is derived from. */
    splitsFrom?: string;
    rationale?: string;
    /** Order payload used by the approval layer for a reorder card. */
    beforeTaskIds?: string[];
    afterTaskIds?: string[];
    guardrails: GuardrailFlags;
    /** Convenience fields for card consumers that do not inspect guardrails. */
    blocked: boolean;
    blockReasons: string[];
}

export interface TaskDiffResult {
    changes: TaskChange[];
    hasChanges: boolean;
    noChangesNeeded: boolean;
    blocked: boolean;
    blockedChanges: TaskChange[];
}

const COMPARED_FIELDS = [
    "title",
    "projectId",
    "status",
    "priority",
    "dueDate",
    "estimatePomos",
    "description",
    "checklist",
    "relatedTo",
] as const;

const REASON_SPLIT_PROGRESS = "split-with-worked-progress";
const REASON_SPLIT_SOURCE = "split-source-not-found";
const REASON_ESTIMATE_RATIONALE = "estimate-increase-requires-rationale";
const REASON_DONE_TRANSITION = "done-transition-is-timer-owned";

function clonePMTask(task: PMTask): PMTask {
    return {
        ...task,
        tags: [...task.tags],
        links: [...task.links],
        checklist: task.checklist.map((item) => ({ ...item })),
        relatedTo: [...task.relatedTo],
    };
}

function cloneProposedTask(task: ProposedTask): ProposedTask {
    return {
        ...task,
        ...(task.checklist ? { checklist: task.checklist.map((item) => ({ ...item })) } : {}),
        relatedTo: [...task.relatedTo],
    };
}

function sameValue(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false;
        return left.every((item, index) => sameValue(item, right[index]));
    }
    if (left && right && typeof left === "object" && typeof right === "object") {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const leftKeys = Object.keys(leftRecord);
        const rightKeys = Object.keys(rightRecord);
        if (leftKeys.length !== rightKeys.length) return false;
        return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]));
    }
    return Object.is(left, right);
}

function taskNeedsUpdate(current: PMTask, proposed: ProposedTask): boolean {
    const currentRecord = current as unknown as Record<string, unknown>;
    const proposedRecord = proposed as unknown as Record<string, unknown>;
    return COMPARED_FIELDS.some((field) => !sameValue(currentRecord[field], proposedRecord[field]));
}

function finiteNumber(value: number | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isLaterDate(current: string | undefined, proposed: string | undefined): boolean {
    if (!current || !proposed) return false;
    const currentTime = new Date(current).getTime();
    const proposedTime = new Date(proposed).getTime();
    return Number.isFinite(currentTime) && Number.isFinite(proposedTime) && proposedTime > currentTime;
}

function guardrailsFor(
    current: PMTask | undefined,
    proposed: ProposedTask,
    splitSource: PMTask | undefined,
    splitSourceMissing: boolean,
): GuardrailFlags {
    const estimateIncreased = Boolean(
        current && finiteNumber(current.estimatePomos) && finiteNumber(proposed.estimatePomos)
            && proposed.estimatePomos > current.estimatePomos,
    );
    const rationaleRequired = estimateIncreased;
    const hasRationale = typeof proposed.rationale === "string" && proposed.rationale.trim().length > 0;
    const splitWithWorkedProgress = Boolean(splitSource && finiteNumber(splitSource.workedPomos) && splitSource.workedPomos > 0);
    const doneTransition = proposed.status === "Done" && current?.status !== "Done";
    const reasons: string[] = [];

    if (splitSourceMissing) reasons.push(REASON_SPLIT_SOURCE);
    if (splitWithWorkedProgress) reasons.push(REASON_SPLIT_PROGRESS);
    if (estimateIncreased && !hasRationale) reasons.push(REASON_ESTIMATE_RATIONALE);
    if (doneTransition) reasons.push(REASON_DONE_TRANSITION);

    const forwardDueDate = Boolean(current && isLaterDate(current.dueDate, proposed.dueDate));
    const blocked = reasons.length > 0;
    return {
        blocked,
        splitWithWorkedProgress,
        splitBlocked: splitWithWorkedProgress || splitSourceMissing,
        estimateIncreased,
        estimateIncrease: estimateIncreased,
        rationaleRequired,
        forwardDueDate,
        forwardDueDateChange: forwardDueDate,
        doneTransition,
        reasons,
    };
}

function emptyGuardrails(): GuardrailFlags {
    return {
        blocked: false,
        splitWithWorkedProgress: false,
        splitBlocked: false,
        estimateIncreased: false,
        estimateIncrease: false,
        rationaleRequired: false,
        forwardDueDate: false,
        forwardDueDateChange: false,
        doneTransition: false,
        reasons: [],
    };
}

function currentTaskList(snapshot: TaskSnapshot): PMTask[] {
    return Array.isArray(snapshot) ? [...snapshot] : Object.values(snapshot);
}

function getInput(
    inputOrCurrent: DiffPlannerTasksInput | TaskSnapshot,
    directProposedTasks?: readonly ProposedTask[],
): { currentTasks: PMTask[]; proposedTasks: ProposedTask[] } {
    if (directProposedTasks !== undefined) {
        return { currentTasks: currentTaskList(inputOrCurrent as TaskSnapshot), proposedTasks: [...directProposedTasks] };
    }

    const input = inputOrCurrent as DiffPlannerTasksInput;
    const current = input.currentTasks ?? input.currentSnapshot;
    const proposed = input.proposedTasks ?? input.targetSnapshot ?? input.targetTasks;
    if (!current) throw new TypeError("Diff requires currentTasks");
    if (!proposed) throw new TypeError("Diff requires proposedTasks");
    return { currentTasks: currentTaskList(current), proposedTasks: [...proposed] };
}

function assertUniqueIds(currentTasks: readonly PMTask[], proposedTasks: readonly ProposedTask[]): void {
    const currentIds = new Set<string>();
    for (const task of currentTasks) {
        if (currentIds.has(task.id)) throw new RangeError(`Duplicate current task id: ${task.id}`);
        currentIds.add(task.id);
    }

    const proposedIds = new Set<string>();
    for (const task of proposedTasks) {
        if (!task.id) continue;
        if (proposedIds.has(task.id)) throw new RangeError(`Duplicate proposed task id: ${task.id}`);
        proposedIds.add(task.id);
        if (!currentIds.has(task.id)) throw new RangeError(`Proposed task id is not in current state: ${task.id}`);
    }
}

function makeChange(
    type: TaskChangeType,
    action: TaskChangeAction,
    fields: Omit<TaskChange, "type" | "action" | "guardrails" | "blocked" | "blockReasons">,
    guardrails = emptyGuardrails(),
): TaskChange {
    return {
        type,
        action,
        ...fields,
        guardrails,
        blocked: guardrails.blocked,
        blockReasons: [...guardrails.reasons],
    };
}

function isOrderableStatus(status: PMTask["status"] | ProposedTask["status"]): boolean {
    return status !== "Done";
}

function orderChanged(currentTasks: readonly PMTask[], proposedTasks: readonly ProposedTask[]): { before: string[]; after: string[] } | null {
    const orderableCurrent = currentTasks.filter((task) => isOrderableStatus(task.status));
    const currentIds = new Set(orderableCurrent.map((task) => task.id));
    const before = orderableCurrent.filter((task) => currentIds.has(task.id)).map((task) => task.id);
    const after = proposedTasks.flatMap((task) => isOrderableStatus(task.status) && task.id && currentIds.has(task.id) ? [task.id] : []);
    if (before.length !== after.length || before.every((id, index) => id === after[index])) return null;
    return { before, after };
}

/**
 * Reconcile a current PM snapshot with an ordered agent target snapshot.
 *
 * The function only describes operations. It never creates IDs, reads the
 * clock, writes storage, or mutates either input snapshot.
 */
export function diffPlannerTasks(input: DiffPlannerTasksInput): TaskDiffResult;
export function diffPlannerTasks(currentTasks: TaskSnapshot, proposedTasks: readonly ProposedTask[]): TaskDiffResult;
export function diffPlannerTasks(
    inputOrCurrent: DiffPlannerTasksInput | TaskSnapshot,
    directProposedTasks?: readonly ProposedTask[],
): TaskDiffResult {
    const { currentTasks, proposedTasks } = getInput(inputOrCurrent, directProposedTasks);
    assertUniqueIds(currentTasks, proposedTasks);

    const activeCurrent = currentTasks
        .filter((task) => !task.isArchived)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
    const byId = new Map(activeCurrent.map((task) => [task.id, task]));
    const changes: TaskChange[] = [];
    const proposedExistingIds = new Set<string>();

    for (const rawProposed of proposedTasks) {
        const proposed = cloneProposedTask(rawProposed);
        const current = proposed.id ? byId.get(proposed.id) : undefined;
        const splitSource = proposed.splitsFrom ? byId.get(proposed.splitsFrom) : undefined;
        const splitSourceMissing = Boolean(proposed.splitsFrom && !splitSource);

        if (proposed.id) {
            proposedExistingIds.add(proposed.id);
            if (!current) {
                // assertUniqueIds already rejects this; keep this guard close to
                // the matching code if that validation changes later.
                throw new RangeError(`Proposed task id is not in current state: ${proposed.id}`);
            }
            if (proposed.splitsFrom) {
                throw new RangeError(`Only new tasks may use splitsFrom: ${proposed.id}`);
            }
            if (!taskNeedsUpdate(current, proposed)) continue;
            const guardrails = guardrailsFor(current, proposed, undefined, false);
            changes.push(makeChange("update", "updateTask", {
                taskId: current.id,
                before: clonePMTask(current),
                after: proposed,
                rationale: proposed.rationale?.trim(),
            }, guardrails));
            continue;
        }

        const guardrails = guardrailsFor(undefined, proposed, splitSource, splitSourceMissing);
        changes.push(makeChange(
            proposed.splitsFrom ? "split" : "create",
            "createTask",
            {
                after: proposed,
                splitsFrom: proposed.splitsFrom,
                rationale: proposed.rationale?.trim(),
            },
            guardrails,
        ));
    }

    for (const current of activeCurrent) {
        if (proposedExistingIds.has(current.id)) continue;
        changes.push(makeChange("remove", "archiveTask", {
            taskId: current.id,
            before: clonePMTask(current),
        }));
    }

    const order = orderChanged(activeCurrent.filter((task) => proposedExistingIds.has(task.id)), proposedTasks);
    if (order) {
        changes.push(makeChange("reorder", "reorderTasks", {
            beforeTaskIds: order.before,
            afterTaskIds: order.after,
        }));
    }

    const blockedChanges = changes.filter((change) => change.blocked);
    return {
        changes,
        hasChanges: changes.length > 0,
        noChangesNeeded: changes.length === 0,
        blocked: blockedChanges.length > 0,
        blockedChanges,
    };
}

/** Descriptive alias for callers that use the target snapshot terminology. */
export const diffProposedTasks = diffPlannerTasks;
