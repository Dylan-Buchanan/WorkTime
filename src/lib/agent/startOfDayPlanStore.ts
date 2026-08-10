import type { TaskChangeType } from "../engine/diffEngine";
import type { StartOfDayPlanItem } from "../engine/startOfDay";

/** Surface-local, unsynced handoff from Start-of-Day to End-of-Day. */
export const AGENT_START_OF_DAY_PLAN_STORAGE_KEY = "worktime:agent:startOfDayPlan:v1";

export interface AgentStartOfDayApprovedChange {
    type: TaskChangeType;
    taskId?: string;
    splitsFrom?: string;
    title?: string;
    estimatePomos?: number;
}

export interface AgentStartOfDayPlan {
    version: 1;
    projectId: string;
    createdAt: string;
    completedAt: string;
    workUntil: string;
    workBudgetPomos: number;
    summary: string;
    orderedTasks: StartOfDayPlanItem[];
    approvedChanges: AgentStartOfDayApprovedChange[];
}

export type AgentStartOfDayPlanInput = Omit<AgentStartOfDayPlan, "version">;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChecklist(value: unknown): boolean {
    return Array.isArray(value) && value.every((item) => isRecord(item)
        && typeof item.id === "string" && item.id.length > 0
        && typeof item.title === "string" && item.title.length > 0
        && typeof item.done === "boolean");
}

function isPlanItem(value: unknown): value is StartOfDayPlanItem {
    if (!isRecord(value)
        || typeof value.title !== "string" || !value.title
        || typeof value.plannedPomos !== "number" || !Number.isInteger(value.plannedPomos) || value.plannedPomos < 1
        || typeof value.rollover !== "boolean"
        || !isChecklist(value.checklist)) return false;
    if (value.taskId !== undefined && (typeof value.taskId !== "string" || !value.taskId)) return false;
    if (value.splitsFrom !== undefined && (typeof value.splitsFrom !== "string" || !value.splitsFrom)) return false;
    if (value.description !== undefined && typeof value.description !== "string") return false;
    if (value.estimatePomos !== undefined && (typeof value.estimatePomos !== "number" || !Number.isInteger(value.estimatePomos) || value.estimatePomos < 1)) return false;
    return true;
}

const changeTypes = new Set<TaskChangeType>(["create", "update", "split", "remove", "reorder"]);

function isApprovedChange(value: unknown): value is AgentStartOfDayApprovedChange {
    if (!isRecord(value) || typeof value.type !== "string" || !changeTypes.has(value.type as TaskChangeType)) return false;
    for (const field of ["taskId", "splitsFrom", "title"] as const) {
        if (value[field] !== undefined && typeof value[field] !== "string") return false;
    }
    return value.estimatePomos === undefined
        || (typeof value.estimatePomos === "number" && Number.isInteger(value.estimatePomos) && value.estimatePomos >= 1);
}

function clonePlan(plan: AgentStartOfDayPlan): AgentStartOfDayPlan {
    return JSON.parse(JSON.stringify(plan)) as AgentStartOfDayPlan;
}

function isDateString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && Number.isFinite(new Date(value).getTime());
}

function parsePlan(value: unknown): AgentStartOfDayPlan | null {
    if (!isRecord(value)
        || value.version !== 1
        || typeof value.projectId !== "string" || !value.projectId
        || !isDateString(value.createdAt)
        || !isDateString(value.completedAt)
        || !isDateString(value.workUntil)
        || typeof value.workBudgetPomos !== "number" || !Number.isInteger(value.workBudgetPomos) || value.workBudgetPomos < 1
        || typeof value.summary !== "string" || !value.summary
        || !Array.isArray(value.orderedTasks) || value.orderedTasks.length === 0 || !value.orderedTasks.every(isPlanItem)
        || !Array.isArray(value.approvedChanges) || !value.approvedChanges.every(isApprovedChange)) return null;
    const allocated = value.orderedTasks.reduce((sum, item) => sum + item.plannedPomos, 0);
    if (allocated > value.workBudgetPomos) return null;
    return clonePlan(value as unknown as AgentStartOfDayPlan);
}

export function saveAgentStartOfDayPlan(
    input: AgentStartOfDayPlanInput,
    storage: StorageLike | undefined = defaultStorage(),
): AgentStartOfDayPlan {
    const plan = parsePlan({ version: 1, ...input });
    if (!plan) throw new TypeError("Start-of-Day plan is invalid");
    storage?.setItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY, JSON.stringify(plan));
    return clonePlan(plan);
}

export function getAgentStartOfDayPlan(
    storage: StorageLike | undefined = defaultStorage(),
): AgentStartOfDayPlan | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY);
        return raw ? parsePlan(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

export function clearAgentStartOfDayPlan(storage: StorageLike | undefined = defaultStorage()): void {
    storage?.removeItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY);
}
