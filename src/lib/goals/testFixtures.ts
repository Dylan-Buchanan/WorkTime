/**
 * Integrator-owned, test-only fixtures, materialized from the RESEARCH draft.
 * Lanes import these builders; production code must not import this module.
 * All dates/IDs are fixed and all nested objects are fresh factory clones.
 */
import type { Goal, GoalCadence, GoalCheckIn, GoalMetric, GoalTracker } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import { createGoal, createGoalCheckIn, createGoalTracker } from "./factories";

/** Use explicit local date inputs for period assertions, independent of timezone. */
export const GOALS_FIXTURE_CREATED_AT = "2026-09-20T12:00:00.000Z";
export const GOALS_FIXTURE_TODAY: LocalDateKey = "2026-11-02";
export const GOALS_FIXTURE_SNAPPED_TODAY: LocalDateKey = "2026-12-15";
export const GOALS_FIXTURE_EVERY_N_WEEKS: GoalCadence = {
    kind: "every-n-weeks", weekday: 0, intervalWeeks: 2,
};
export const GOALS_FIXTURE_MONTHLY: GoalCadence = { kind: "monthly-weekday", weekday: 0 };
export const GOALS_FIXTURE_ANCHOR: LocalDateKey = "2026-10-04";
/** Nominal December 2026: Tuesday the 1st snaps Sunday back to November 29. */
export const GOALS_FIXTURE_SNAPPED_ANCHOR: LocalDateKey = "2026-11-29";

export interface GoalTrackerFixtureOverrides {
    id?: string;
    name?: string;
    purpose?: string;
    cadence?: GoalCadence;
    cadenceAnchorAt?: LocalDateKey;
    color?: string;
    sortOrder?: number;
    isArchived?: boolean;
    lastBuiltPeriodStart?: LocalDateKey | null;
    /** Factory now; updatedAt defaults to this instant. */
    createdAt?: string;
    updatedAt?: string;
}

export interface GoalFixtureOverrides {
    id?: string;
    trackerId?: string;
    title?: string;
    notes?: string;
    projectId?: string | null;
    metric?: GoalMetric | null;
    lifecycle?: Goal["lifecycle"];
    achievedAt?: string | null;
    droppedAt?: string | null;
    sortOrder?: number;
    /** Factory now; updatedAt defaults to this instant. */
    createdAt?: string;
    updatedAt?: string;
}

export interface GoalCheckInFixtureOverrides {
    id?: string;
    goalId?: string;
    periodStart?: LocalDateKey;
    did?: string;
    current?: string;
    planned?: GoalCheckIn["planned"];
    statusPill?: GoalCheckIn["statusPill"];
    missReason?: string;
    isFocus?: boolean;
    evidenceTaskIds?: string[];
    /** Factory now; updatedAt defaults to this instant. */
    createdAt?: string;
    updatedAt?: string;
}

export interface GoalFixtureSet {
    tracker: GoalTracker;
    goals: Goal[];
    checkIns: GoalCheckIn[];
}

export interface GoalFixtureSetOverrides {
    tracker?: GoalTracker;
    goals?: Goal[];
    checkIns?: GoalCheckIn[];
}

export function buildGoalTrackerFixture(overrides: GoalTrackerFixtureOverrides = {}): GoalTracker {
    const createdAt = overrides.createdAt ?? GOALS_FIXTURE_CREATED_AT;
    const tracker = createGoalTracker({
        name: overrides.name ?? "Work",
        purpose: overrides.purpose ?? "Ship the release",
        cadence: overrides.cadence ?? GOALS_FIXTURE_EVERY_N_WEEKS,
        cadenceAnchorAt: overrides.cadenceAnchorAt ?? GOALS_FIXTURE_ANCHOR,
        color: overrides.color ?? "#6366F1",
        sortOrder: overrides.sortOrder ?? 0,
        isArchived: overrides.isArchived ?? false,
        lastBuiltPeriodStart: overrides.lastBuiltPeriodStart ?? null,
    }, new Date(createdAt), overrides.id ?? "tracker-work");
    return { ...tracker, updatedAt: new Date(overrides.updatedAt ?? createdAt).toISOString() };
}

export function buildGoalFixture(overrides: GoalFixtureOverrides = {}): Goal {
    const createdAt = overrides.createdAt ?? GOALS_FIXTURE_CREATED_AT;
    const goal = createGoal({
        trackerId: overrides.trackerId ?? "tracker-work",
        title: overrides.title ?? "Ship the release",
        notes: overrides.notes ?? "",
        projectId: overrides.projectId ?? null,
        metric: overrides.metric ?? null,
        lifecycle: overrides.lifecycle ?? "active",
        achievedAt: overrides.achievedAt ?? null,
        droppedAt: overrides.droppedAt ?? null,
        sortOrder: overrides.sortOrder ?? 0,
    }, new Date(createdAt), overrides.id ?? "goal-ship");
    return { ...goal, updatedAt: new Date(overrides.updatedAt ?? createdAt).toISOString() };
}

export function buildGoalCheckInFixture(overrides: GoalCheckInFixtureOverrides = {}): GoalCheckIn {
    const createdAt = overrides.createdAt ?? GOALS_FIXTURE_CREATED_AT;
    const checkIn = createGoalCheckIn({
        goalId: overrides.goalId ?? "goal-ship",
        periodStart: overrides.periodStart ?? GOALS_FIXTURE_ANCHOR,
        did: overrides.did ?? "",
        current: overrides.current ?? "",
        planned: overrides.planned ?? [],
        statusPill: overrides.statusPill ?? "on-track",
        missReason: overrides.missReason ?? "",
        isFocus: overrides.isFocus ?? false,
        evidenceTaskIds: overrides.evidenceTaskIds ?? [],
    }, new Date(createdAt), overrides.id ?? "check-in");
    return { ...checkIn, updatedAt: new Date(overrides.updatedAt ?? createdAt).toISOString() };
}

export function buildEveryNWeeksTrackerFixture(overrides: GoalTrackerFixtureOverrides = {}): GoalTracker {
    return buildGoalTrackerFixture({
        ...overrides,
        cadence: overrides.cadence ?? GOALS_FIXTURE_EVERY_N_WEEKS,
        cadenceAnchorAt: overrides.cadenceAnchorAt ?? GOALS_FIXTURE_ANCHOR,
    });
}

export function buildMonthlyWeekdayTrackerFixture(overrides: GoalTrackerFixtureOverrides = {}): GoalTracker {
    return buildGoalTrackerFixture({
        ...overrides,
        id: overrides.id ?? "tracker-life",
        name: overrides.name ?? "Life",
        cadence: overrides.cadence ?? GOALS_FIXTURE_MONTHLY,
        cadenceAnchorAt: overrides.cadenceAnchorAt ?? GOALS_FIXTURE_ANCHOR,
    });
}

export function buildSnappedMonthTrackerFixture(overrides: GoalTrackerFixtureOverrides = {}): GoalTracker {
    return buildGoalTrackerFixture({
        ...overrides,
        id: overrides.id ?? "tracker-snapped",
        name: overrides.name ?? "Life",
        cadence: overrides.cadence ?? GOALS_FIXTURE_MONTHLY,
        cadenceAnchorAt: overrides.cadenceAnchorAt ?? GOALS_FIXTURE_SNAPPED_ANCHOR,
        createdAt: overrides.createdAt ?? "2026-11-01T12:00:00.000Z",
    });
}

export function buildArchivedTrackerFixture(overrides: GoalTrackerFixtureOverrides = {}): GoalTracker {
    return buildGoalTrackerFixture({
        ...overrides,
        id: overrides.id ?? "tracker-archived",
        name: overrides.name ?? "Old work",
        isArchived: overrides.isArchived ?? true,
    });
}

export function buildMetricGoalFixture(trackerId = "tracker-work"): Goal {
    return buildGoalFixture({
        id: "goal-metric", trackerId, title: "Train four times",
        metric: { label: "Sessions", target: 8, current: 3, unit: "", source: "manual", overridePinned: false },
    });
}

export function buildAchievedGoalFixture(trackerId = "tracker-work"): Goal {
    return buildGoalFixture({
        id: "goal-achieved", trackerId, title: "Ship v1",
        lifecycle: "achieved", achievedAt: "2026-10-12T12:00:00.000Z",
    });
}

export function buildDroppedGoalFixture(trackerId = "tracker-work"): Goal {
    return buildGoalFixture({
        id: "goal-dropped", trackerId, title: "Revive the newsletter",
        lifecycle: "dropped", droppedAt: "2026-10-20T12:00:00.000Z",
    });
}

export function buildPlannedCheckInFixture(overrides: GoalCheckInFixtureOverrides = {}): GoalCheckIn {
    return buildGoalCheckInFixture({
        id: "check-planned", goalId: "goal-ship", periodStart: "2026-10-18",
        did: "Reviewed the spec", current: "Writing the migration",
        planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }], isFocus: true,
        ...overrides,
    });
}

/** Two consecutive slips: neither next did line exactly completes the previous plan. */
export function buildCheckInHistoryFixture(goalId = "goal-ship"): GoalCheckIn[] {
    return [
        buildGoalCheckInFixture({
            id: "check-1", goalId, periodStart: "2026-10-04", did: "Reviewed the outline",
            planned: [{ text: "Write the spec", dueDate: null }], isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-2", goalId, periodStart: "2026-10-18", did: "Reviewed the spec",
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }], isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-3", goalId, periodStart: "2026-11-01", did: "Reviewed the spec",
            planned: [{ text: "Run the retro", dueDate: null }], isFocus: true,
        }),
    ];
}

/** Exact normalized did lines complete both previous plans; no "Did <text>" heuristic. */
export function buildCleanCheckInHistoryFixture(goalId = "goal-ship"): GoalCheckIn[] {
    return [
        buildGoalCheckInFixture({
            id: "check-clean-1", goalId, periodStart: "2026-10-04", did: "Reviewed the outline",
            planned: [{ text: "Write the spec", dueDate: null }], isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-clean-2", goalId, periodStart: "2026-10-18", did: "Write the spec",
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }], isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-clean-3", goalId, periodStart: "2026-11-01", did: "- [x] Ship the migration",
            planned: [{ text: "Run the retro", dueDate: null }], isFocus: true,
        }),
    ];
}

/**
 * Same natural key, later local stamp: storage merge must still keep the server ID.
 * Pure history normalization has no server provenance and instead keeps latest updatedAt.
 */
export function buildNaturalKeyDuplicatesFixture(goalId = "goal-ship"): GoalCheckIn[] {
    return [
        buildGoalCheckInFixture({
            id: "check-local", goalId, periodStart: "2026-10-18", did: "Local copy",
            createdAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z", isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-server", goalId, periodStart: "2026-10-18", did: "Server copy",
            createdAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-19T12:00:00.000Z", isFocus: true,
        }),
    ];
}

/**
 * Default complete set, cloned even when callers supply overrides.
 * Default check-ins are restricted to the supplied goal IDs; explicit dangling
 * check-ins or goals belonging to another tracker throw instead of making an invalid set.
 */
export function buildGoalFixtureSet(overrides: GoalFixtureSetOverrides = {}): GoalFixtureSet {
    const tracker = buildGoalTrackerFixture(overrides.tracker);
    const goals = (overrides.goals ?? [
        buildGoalFixture({ trackerId: tracker.id }),
        buildMetricGoalFixture(tracker.id),
        buildAchievedGoalFixture(tracker.id),
    ]).map(goal => buildGoalFixture(goal));
    if (goals.some(goal => goal.trackerId !== tracker.id)) {
        throw new RangeError("Fixture goals must belong to the fixture tracker");
    }
    const goalIds = new Set(goals.map(goal => goal.id));
    const defaults = [
        ...buildCheckInHistoryFixture("goal-ship"),
        buildGoalCheckInFixture({
            id: "check-metric", goalId: "goal-metric", periodStart: "2026-10-18",
            did: "Two sessions", isFocus: true,
        }),
        buildGoalCheckInFixture({
            id: "check-achieved", goalId: "goal-achieved", periodStart: "2026-10-04",
            did: "Shipped v1", isFocus: true,
        }),
    ];
    const checkIns = (overrides.checkIns ?? defaults.filter(row => goalIds.has(row.goalId)))
        .map(row => buildGoalCheckInFixture(row));
    if (checkIns.some(row => !goalIds.has(row.goalId))) {
        throw new RangeError("Fixture check-ins must reference a fixture goal");
    }
    return { tracker, goals, checkIns };
}
