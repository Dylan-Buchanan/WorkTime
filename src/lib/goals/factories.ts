import type { Goal, GoalCheckIn, GoalMetric, GoalProjectLink, GoalTracker } from "../../state/types";
import { localDateFromKey, localDateKey } from "../todos/calendar";
import { isValidGoalCadence, normalizeGoalCadence } from "./cadence";

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nonempty = (v: unknown): v is string => text(v) && v.trim().length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const timestamp = (v: unknown): v is string => text(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const nullableTimestamp = (v: unknown) => v === null || timestamp(v);
export function isGoalDateKey(v: unknown): v is GoalTracker["cadenceAnchorAt"] {
    if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    try { return localDateKey(localDateFromKey(v)) === v; } catch { return false; }
}
const base = (v: Record<string, unknown>) => nonempty(v.id) && timestamp(v.createdAt) && timestamp(v.updatedAt);
export function isGoalMetric(v: unknown): v is GoalMetric {
    return object(v) && nonempty(v.label) && finite(v.target) && finite(v.current) && text(v.unit) &&
        typeof v.overridePinned === "boolean" &&
        (v.source === "habit"
            ? nonempty(v.habitId) && v.overridePinned === false
            : (v.source === "manual" || v.source === "liftingtracker") && !("habitId" in v));
}
export function isGoalTracker(v: unknown): v is GoalTracker {
    return object(v) && base(v) && nonempty(v.name) && text(v.purpose) && !/[\r\n]/.test(v.purpose) &&
        (v.projectId === null || nonempty(v.projectId)) &&
        isValidGoalCadence(v.cadence) && isGoalDateKey(v.cadenceAnchorAt) && text(v.color) && finite(v.sortOrder) &&
        typeof v.isArchived === "boolean" && (v.lastBuiltPeriodStart === null || isGoalDateKey(v.lastBuiltPeriodStart));
}
function isGoalProjectLink(v: unknown): v is GoalProjectLink {
    if (!object(v)) return false;
    const keys = Reflect.ownKeys(v);
    if (!keys.includes("mode")) return false;
    if (v.mode === "project") {
        return keys.length === 2 && keys.includes("projectId") && nonempty(v.projectId);
    }
    return (v.mode === "inherit" || v.mode === "none") && keys.length === 1 && !("projectId" in v);
}
export function isGoal(v: unknown): v is Goal {
    return object(v) && base(v) && nonempty(v.trackerId) && nonempty(v.title) && text(v.notes) &&
        !("projectId" in v) && isGoalProjectLink(v.projectLink) && (v.metric === null || isGoalMetric(v.metric)) &&
        (v.lifecycle === "active" || v.lifecycle === "achieved" || v.lifecycle === "dropped") && nullableTimestamp(v.achievedAt) &&
        nullableTimestamp(v.droppedAt) && finite(v.sortOrder);
}
export function isGoalCheckIn(v: unknown): v is GoalCheckIn {
    return object(v) && base(v) && nonempty(v.goalId) && isGoalDateKey(v.periodStart) && text(v.did) && text(v.current) &&
        Array.isArray(v.planned) && v.planned.every(p => object(p) && text(p.text) && (p.dueDate === null || isGoalDateKey(p.dueDate))) &&
        (v.statusPill === "on-track" || v.statusPill === "at-risk" || v.statusPill === "blocked") && text(v.missReason) && typeof v.isFocus === "boolean" &&
        Array.isArray(v.evidenceTaskIds) && v.evidenceTaskIds.every(nonempty) && !("periodEnd" in v);
}

export function createGoalTracker(input: Pick<GoalTracker, "name" | "cadence" | "cadenceAnchorAt"> & Partial<Omit<GoalTracker, "id" | "createdAt" | "updatedAt">>, now: Date, id: string): GoalTracker {
    const value: GoalTracker = { purpose: "", color: "", sortOrder: 0, isArchived: false, lastBuiltPeriodStart: null,
        ...input, id, name: input.name.trim(), projectId: input.projectId ?? null, cadence: normalizeGoalCadence(input.cadence), createdAt: now.toISOString(), updatedAt: now.toISOString() };
    if (!isGoalTracker(value)) throw new RangeError("Invalid goal tracker");
    return value;
}
export function createGoal(input: Pick<Goal, "trackerId" | "title"> & Partial<Omit<Goal, "id" | "createdAt" | "updatedAt">>, now: Date, id: string): Goal {
    const value: Goal = { notes: "", lifecycle: "active", achievedAt: null, droppedAt: null, sortOrder: 0,
        ...input, id, title: input.title.trim(), projectLink: input.projectLink === undefined ? { mode: "inherit" } : input.projectLink,
        metric: input.metric ? { ...input.metric } : null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    if (!isGoal(value)) throw new RangeError("Invalid goal");
    return { ...value, projectLink: { ...value.projectLink } };
}
export function createGoalCheckIn(input: Pick<GoalCheckIn, "goalId" | "periodStart"> & Partial<Omit<GoalCheckIn, "id" | "createdAt" | "updatedAt">>, now: Date, id: string): GoalCheckIn {
    const value: GoalCheckIn = { did: "", current: "", statusPill: "on-track", missReason: "", isFocus: false,
        ...input, id, planned: input.planned?.map(p => ({ ...p })) ?? [], evidenceTaskIds: [...(input.evidenceTaskIds ?? [])], createdAt: now.toISOString(), updatedAt: now.toISOString() };
    if (!isGoalCheckIn(value)) throw new RangeError("Invalid goal check-in");
    return value;
}
