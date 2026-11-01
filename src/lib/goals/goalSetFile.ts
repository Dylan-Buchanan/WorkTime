import type { Goal, GoalCadence, GoalTracker, Weekday } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { localDateKey } from "../todos/calendar";
import { sanitizeDownloadFileName } from "./deck/delivery";
import { createGoal, createGoalTracker, isGoalDateKey } from "./factories";
import { resolveCadenceAnchorAt } from "./periods";

export const GOAL_SET_FORMAT = "worktime.goal-set" as const;
export const GOAL_SET_VERSION = 1 as const;

export interface GoalSetMetricDefinition {
    label: string;
    target: number;
    unit: string;
}

export interface GoalSetGoalDefinition {
    title: string;
    notes: string;
    projectId: string | null;
    metric: GoalSetMetricDefinition | null;
    lifecycle: Goal["lifecycle"];
    sortOrder: number;
}

export interface GoalSetTrackerDefinition {
    name: string;
    purpose: string;
    cadence: GoalCadence;
    color: string;
}

export interface GoalSetFile {
    format: typeof GOAL_SET_FORMAT;
    version: typeof GOAL_SET_VERSION;
    tracker: GoalSetTrackerDefinition;
    goals: GoalSetGoalDefinition[];
}

export type GoalSetErrorCode =
    | "invalid-json"
    | "unsupported-version"
    | "invalid-format"
    | "invalid-field"
    | "empty-goals";

export class GoalSetError extends Error {
    readonly code: GoalSetErrorCode;

    constructor(code: GoalSetErrorCode, message: string) {
        super(message);
        this.name = "GoalSetError";
        this.code = code;
    }
}

const ROOT_KEYS = ["format", "version", "tracker", "goals"] as const;
const TRACKER_KEYS = ["name", "purpose", "cadence", "color"] as const;
const GOAL_KEYS = ["title", "notes", "projectId", "metric", "lifecycle", "sortOrder"] as const;
const METRIC_KEYS = ["label", "target", "unit"] as const;
const EVERY_N_WEEKS_KEYS = ["kind", "weekday", "intervalWeeks"] as const;
const MONTHLY_KEYS = ["kind", "weekday"] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function invalid(message: string): never {
    throw new GoalSetError("invalid-field", message);
}

/** Exact own keys only: unknown keys and missing keys are both field errors. */
function requireKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
    const present = Object.keys(value);
    const unknown = present.find(key => !keys.includes(key));
    if (unknown !== undefined) invalid(`${what} has an unknown field "${unknown}"`);
    const missing = keys.find(key => !Object.prototype.hasOwnProperty.call(value, key));
    if (missing !== undefined) invalid(`${what} is missing the field "${missing}"`);
}

function requireString(value: unknown, what: string): string {
    if (typeof value !== "string") invalid(`${what} must be a string`);
    return value;
}

function requireText(value: unknown, what: string): string {
    const text = requireString(value, what);
    if (text.trim().length === 0) invalid(`${what} must not be empty`);
    return text;
}

function requireNumber(value: unknown, what: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${what} must be a finite number`);
    return value;
}

function readWeekday(value: unknown, what: string): Weekday {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 6) {
        invalid(`${what} must be an integer from 0 to 6`);
    }
    return value as Weekday;
}

/** Strict branch keys; the canonical `kind, weekday, intervalWeeks` order is rebuilt. */
function readCadence(value: unknown): GoalCadence {
    if (!isPlainObject(value)) invalid("tracker cadence must be an object");
    if (value.kind === "monthly-weekday") {
        requireKeys(value, MONTHLY_KEYS, "tracker cadence");
        return { kind: "monthly-weekday", weekday: readWeekday(value.weekday, "tracker cadence weekday") };
    }
    if (value.kind === "every-n-weeks") {
        requireKeys(value, EVERY_N_WEEKS_KEYS, "tracker cadence");
        const intervalWeeks = value.intervalWeeks;
        if (!Number.isSafeInteger(intervalWeeks) || (intervalWeeks as number) < 1) {
            invalid("tracker cadence intervalWeeks must be an integer of at least 1");
        }
        return {
            kind: "every-n-weeks",
            weekday: readWeekday(value.weekday, "tracker cadence weekday"),
            intervalWeeks: intervalWeeks as number,
        };
    }
    invalid('tracker cadence kind must be "every-n-weeks" or "monthly-weekday"');
}

function readMetric(value: unknown, what: string): GoalSetMetricDefinition | null {
    if (value === null) return null;
    if (!isPlainObject(value)) invalid(`${what} metric must be null or an object`);
    requireKeys(value, METRIC_KEYS, `${what} metric`);
    return {
        label: requireText(value.label, `${what} metric label`),
        // The app's own `isGoalMetric` only requires finite, so zero and negative
        // targets are legal stored data and must survive export/import.
        target: requireNumber(value.target, `${what} metric target`),
        unit: requireString(value.unit, `${what} metric unit`),
    };
}

function readTracker(value: unknown): GoalSetTrackerDefinition {
    if (!isPlainObject(value)) invalid("goal-set tracker must be an object");
    requireKeys(value, TRACKER_KEYS, "goal-set tracker");
    const purpose = requireString(value.purpose, "tracker purpose");
    if (/[\r\n]/.test(purpose)) invalid("tracker purpose must be a single line");
    return {
        name: requireText(value.name, "tracker name"),
        purpose,
        cadence: readCadence(value.cadence),
        color: requireString(value.color, "tracker color"),
    };
}

function readGoal(value: unknown, index: number): GoalSetGoalDefinition {
    const what = `goal ${index + 1}`;
    if (!isPlainObject(value)) invalid(`${what} must be an object`);
    requireKeys(value, GOAL_KEYS, what);
    let projectId: string | null = null;
    if (value.projectId !== null) projectId = requireText(value.projectId, `${what} projectId`);
    const lifecycle = value.lifecycle;
    if (lifecycle !== "active" && lifecycle !== "achieved" && lifecycle !== "dropped") {
        invalid(`${what} lifecycle must be active, achieved, or dropped`);
    }
    return {
        title: requireText(value.title, `${what} title`),
        notes: requireString(value.notes, `${what} notes`),
        projectId,
        metric: readMetric(value.metric, what),
        lifecycle,
        sortOrder: requireNumber(value.sortOrder, `${what} sortOrder`),
    };
}

/** Shared validator: canonicalizes any parsed or in-memory goal-set value. */
function readGoalSet(value: unknown): GoalSetFile {
    if (!isPlainObject(value)) invalid("the goal-set file must be a JSON object");
    if (value.format !== GOAL_SET_FORMAT) {
        throw new GoalSetError("invalid-format", `the file is not a "${GOAL_SET_FORMAT}" document`);
    }
    if (value.version !== GOAL_SET_VERSION) {
        throw new GoalSetError("unsupported-version", `unsupported goal-set version: ${String(value.version)}`);
    }
    requireKeys(value, ROOT_KEYS, "goal-set file");
    const tracker = readTracker(value.tracker);
    if (!Array.isArray(value.goals)) invalid("goal-set goals must be an array");
    if (value.goals.length === 0) {
        throw new GoalSetError("empty-goals", "the goal set has no goals");
    }
    return {
        format: GOAL_SET_FORMAT,
        version: GOAL_SET_VERSION,
        tracker,
        goals: value.goals.map(readGoal),
    };
}

function canonicalCadence(cadence: GoalCadence): GoalCadence {
    return cadence.kind === "monthly-weekday"
        ? { kind: "monthly-weekday", weekday: cadence.weekday }
        : { kind: "every-n-weeks", weekday: cadence.weekday, intervalWeeks: cadence.intervalWeeks };
}

function canonicalMetric(metric: GoalSetMetricDefinition | null): GoalSetMetricDefinition | null {
    return metric ? { label: metric.label, target: metric.target, unit: metric.unit } : null;
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Definitions only: canonical key order, two-space indent, trailing newline. */
export function serializeGoalSet(tracker: GoalTracker, goals: readonly Goal[]): string {
    const file: GoalSetFile = {
        format: GOAL_SET_FORMAT,
        version: GOAL_SET_VERSION,
        tracker: {
            name: tracker.name,
            purpose: tracker.purpose,
            cadence: canonicalCadence(tracker.cadence),
            color: tracker.color,
        },
        goals: [...goals]
            .sort((left, right) =>
                left.sortOrder - right.sortOrder
                || compareText(left.title, right.title)
                || compareText(left.id, right.id))
            .map(goal => ({
                title: goal.title,
                notes: goal.notes,
                projectId: goal.projectId,
                metric: canonicalMetric(goal.metric),
                lifecycle: goal.lifecycle,
                sortOrder: goal.sortOrder,
            })),
    };
    return `${JSON.stringify(readGoalSet(file), null, 2)}\n`;
}

/** Strict version gate before field reads; array order is preserved. */
export function parseGoalSet(json: string): GoalSetFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new GoalSetError("invalid-json", "the file is not valid JSON");
    }
    return readGoalSet(parsed);
}

function validatedLocalDateKey(now: Date): LocalDateKey {
    const key = localDateKey(now);
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
}

/** `goals-<slug>-<YYYY-MM-DD>.json`; slug is lowercase ASCII, at most 40 characters. */
export function goalSetFileName(trackerName: string, today: LocalDateKey): string {
    const slug = trackerName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
        .replace(/-+$/, "") || "tracker";
    return sanitizeDownloadFileName(`goals-${slug}-${today}.json`);
}

/**
 * New tracker plus goal definitions with fresh IDs. The provider assigns final
 * IDs on the import path; this function is also the pure creation contract.
 */
export function materializeGoalSet(
    file: GoalSetFile,
    now: Date,
    nextId: () => string,
): { tracker: GoalTracker; goals: Goal[] } {
    const definition = readGoalSet(file);
    const cadence = canonicalCadence(definition.tracker.cadence);
    const tracker = createGoalTracker({
        name: definition.tracker.name,
        purpose: definition.tracker.purpose,
        cadence,
        cadenceAnchorAt: resolveCadenceAnchorAt(cadence, validatedLocalDateKey(now)),
        color: definition.tracker.color,
    }, now, nextId());
    const stamp = now.toISOString();
    const goals = definition.goals.map((goal, index) => createGoal({
        trackerId: tracker.id,
        title: goal.title,
        notes: goal.notes,
        projectId: goal.projectId,
        metric: goal.metric
            ? { label: goal.metric.label, target: goal.metric.target, current: 0, unit: goal.metric.unit, source: "manual", overridePinned: false }
            : null,
        lifecycle: goal.lifecycle,
        achievedAt: goal.lifecycle === "achieved" ? stamp : null,
        droppedAt: goal.lifecycle === "dropped" ? stamp : null,
        sortOrder: index,
    }, now, nextId()));
    return { tracker, goals };
}
