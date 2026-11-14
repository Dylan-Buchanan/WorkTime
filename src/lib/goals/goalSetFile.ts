import type { Goal, GoalCadence, GoalProjectLink, GoalTracker, Project, Weekday } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { localDateKey } from "../todos/calendar";
import { sanitizeDownloadFileName } from "./deck/delivery";
import { createGoal, createGoalTracker, isGoalDateKey } from "./factories";
import { resolveCadenceAnchorAt } from "./periods";

export const GOAL_SET_FORMAT = "worktime.goal-set" as const;
export const GOAL_SET_VERSION = 2 as const;

type ProjectNames = Readonly<Record<string, Pick<Project, "name">>>;

export interface GoalSetMetricDefinition {
    label: string;
    target: number;
    unit: string;
}

export interface GoalSetGoalDefinition {
    title: string;
    notes: string;
    projectMode: GoalProjectLink["mode"];
    project: string | null;
    metric: GoalSetMetricDefinition | null;
    lifecycle: Goal["lifecycle"];
    sortOrder: number;
}

export interface GoalSetTrackerDefinition {
    name: string;
    purpose: string;
    cadence: GoalCadence;
    color: string;
    project: string | null;
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
const TRACKER_KEYS = ["name", "purpose", "cadence", "color", "project"] as const;
const GOAL_KEYS = ["title", "notes", "projectMode", "project", "metric", "lifecycle", "sortOrder"] as const;
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
        project: value.project === null ? null : requireText(value.project, "tracker project"),
    };
}

function readGoal(value: unknown, index: number): GoalSetGoalDefinition {
    const what = `goal ${index + 1}`;
    if (!isPlainObject(value)) invalid(`${what} must be an object`);
    requireKeys(value, GOAL_KEYS, what);
    const projectMode = value.projectMode;
    if (projectMode !== "project" && projectMode !== "inherit" && projectMode !== "none") {
        invalid(`${what} projectMode must be inherit, none, or project`);
    }
    let project: string | null = null;
    if (projectMode === "project") {
        project = requireText(value.project, `${what} project`);
    } else if (value.project !== null) {
        invalid(`${what} project must be null in ${projectMode} mode`);
    }
    const lifecycle = value.lifecycle;
    if (lifecycle !== "active" && lifecycle !== "achieved" && lifecycle !== "dropped") {
        invalid(`${what} lifecycle must be active, achieved, or dropped`);
    }
    return {
        title: requireText(value.title, `${what} title`),
        notes: requireString(value.notes, `${what} notes`),
        projectMode,
        project,
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
export function serializeGoalSet(tracker: GoalTracker, goals: readonly Goal[], projects: ProjectNames): string {
    const projectName = (id: string | null): string | null => {
        const name = id === null ? undefined : projects[id]?.name;
        return name?.trim() ? name : null;
    };
    const file: GoalSetFile = {
        format: GOAL_SET_FORMAT,
        version: GOAL_SET_VERSION,
        tracker: {
            name: tracker.name,
            purpose: tracker.purpose,
            cadence: canonicalCadence(tracker.cadence),
            color: tracker.color,
            project: projectName(tracker.projectId),
        },
        goals: [...goals]
            .sort((left, right) =>
                left.sortOrder - right.sortOrder
                || compareText(left.title, right.title)
                || compareText(left.id, right.id))
            .map(goal => {
                const link = goal.projectLink;
                const project = link.mode === "project" ? projectName(link.projectId) : null;
                return {
                    title: goal.title,
                    notes: goal.notes,
                    projectMode: link.mode === "project" && project === null ? "inherit" : link.mode,
                    project,
                    metric: canonicalMetric(goal.metric),
                    lifecycle: goal.lifecycle,
                    sortOrder: goal.sortOrder,
                };
            }),
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

/** Resolve name links for both the review and the import. Duplicate names are ambiguous. */
export function resolveGoalSetProjects(file: GoalSetFile, projects: ProjectNames) {
    const idsByName = new Map<string, string | null>();
    for (const [id, project] of Object.entries(projects)) {
        const name = project.name.toLowerCase();
        idsByName.set(name, idsByName.has(name) ? null : id);
    }
    const resolve = (name: string | null): string | null =>
        name === null ? null : idsByName.get(name.toLowerCase()) ?? null;

    const trackerProjectId = resolve(file.tracker.project);
    let unresolvedGoalProjects = 0;
    const goalProjectLinks = file.goals.map((goal): GoalProjectLink => {
        if (goal.projectMode !== "project") return { mode: goal.projectMode };
        const projectId = resolve(goal.project);
        if (projectId !== null) return { mode: "project", projectId };
        unresolvedGoalProjects += 1;
        return { mode: "inherit" };
    });
    return {
        trackerProjectId,
        goalProjectLinks,
        unresolvedTrackerProject: file.tracker.project !== null && trackerProjectId === null,
        unresolvedGoalProjects,
    };
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
    projects: ProjectNames,
): { tracker: GoalTracker; goals: Goal[] } {
    const definition = readGoalSet(file);
    const { trackerProjectId, goalProjectLinks } = resolveGoalSetProjects(definition, projects);
    const cadence = canonicalCadence(definition.tracker.cadence);
    const tracker = createGoalTracker({
        name: definition.tracker.name,
        purpose: definition.tracker.purpose,
        cadence,
        cadenceAnchorAt: resolveCadenceAnchorAt(cadence, validatedLocalDateKey(now)),
        color: definition.tracker.color,
        projectId: trackerProjectId,
    }, now, nextId());
    const stamp = now.toISOString();
    const goals = definition.goals.map((goal, index) => createGoal({
        trackerId: tracker.id,
        title: goal.title,
        notes: goal.notes,
        projectLink: goalProjectLinks[index],
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
