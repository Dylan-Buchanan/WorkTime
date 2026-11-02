import { describe, expect, it } from "vitest";
import {
    STATUS_SERIES_VALUES,
    buildSparkline,
    isGoalIncludedInPeriod,
    isSlipTransition,
    metricSnapshot,
    normalizeCheckInHistory,
    normalizeSlipText,
    slipSummary,
    unmetPlannedItems,
} from "./slips";
import type { LifecycleDateProjection } from "./slips";
import type { LocalDateKey } from "../todos/types";
import {
    buildAchievedGoalFixture,
    buildCheckInHistoryFixture,
    buildCleanCheckInHistoryFixture,
    buildDroppedGoalFixture,
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildMetricGoalFixture,
    buildNaturalKeyDuplicatesFixture,
} from "./testFixtures";

describe("normalizeSlipText", () => {
    it("trims, collapses whitespace, and lower-cases only", () => {
        expect(normalizeSlipText("  Ship   The\tMIGRATION \n")).toBe("ship the migration");
        expect(normalizeSlipText("Ship v1!")).toBe("ship v1!");
        expect(normalizeSlipText("   ")).toBe("");
    });
});

describe("exact did-line completion", () => {
    const accepted = [
        "Ship the migration",
        "- Ship the migration",
        "* Ship the migration",
        "+ Ship the migration",
        "1. Ship the migration",
        "2) Ship the migration",
        "[x] Ship the migration",
        "[X] Ship the migration",
        "- [x] Ship the migration",
        "1. [X] Ship the migration",
        "Reviewed the spec\n- [x] Ship the migration",
    ];

    it.each(accepted)("accepts %j as an entire did line", did => {
        const previous = buildGoalCheckInFixture({
            periodStart: "2026-10-04",
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }],
        });
        const current = buildGoalCheckInFixture({ periodStart: "2026-10-18", did });
        expect(unmetPlannedItems(previous, current)).toEqual([]);
        expect(isSlipTransition(previous, current)).toBe(false);
    });

    const rejected = [
        "did not Ship the migration",
        "Did Ship the migration",
        "Ship the migration tomorrow",
        "Please Ship the migration",
        "before ship the migration",
        "- [ ] Ship the migration",
        "[ ] Ship the migration",
    ];

    it.each(rejected)("rejects %j", did => {
        const previous = buildGoalCheckInFixture({
            periodStart: "2026-10-04",
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }],
        });
        const current = buildGoalCheckInFixture({ periodStart: "2026-10-18", did });
        expect(unmetPlannedItems(previous, current)).toEqual([
            { text: "Ship the migration", dueDate: "2026-10-30" },
        ]);
        expect(isSlipTransition(previous, current)).toBe(true);
    });

    it("ignores blank planned rows and treats an all-blank plan as zero planned", () => {
        const previous = buildGoalCheckInFixture({
            planned: [{ text: "   ", dueDate: null }, { text: "", dueDate: null }],
        });
        const current = buildGoalCheckInFixture({ periodStart: "2026-10-18", did: "" });
        expect(unmetPlannedItems(previous, current)).toEqual([]);
        expect(isSlipTransition(previous, current)).toBe(false);
    });

    it("does not compare successive rows from different goals", () => {
        const previous = buildGoalCheckInFixture({
            goalId: "goal-a",
            planned: [{ text: "Ship the migration", dueDate: null }],
        });
        const current = buildGoalCheckInFixture({ goalId: "goal-b", periodStart: "2026-10-18" });
        expect(unmetPlannedItems(previous, current)).toEqual([]);
        expect(isSlipTransition(previous, current)).toBe(false);
    });

    it("returns fresh unmet items without mutating the previous check-in", () => {
        const previous = buildGoalCheckInFixture({
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }],
        });
        const current = buildGoalCheckInFixture({ periodStart: "2026-10-18" });
        const unmet = unmetPlannedItems(previous, current);
        expect(unmet).toEqual([{ text: "Ship the migration", dueDate: "2026-10-30" }]);
        unmet[0].text = "changed";
        expect(previous.planned[0].text).toBe("Ship the migration");
    });
});

describe("slipSummary", () => {
    it("accrues consecutive slips across three periods without resetting on partial completion", () => {
        const rows = [
            buildGoalCheckInFixture({
                id: "c1",
                periodStart: "2026-10-04",
                planned: [
                    { text: "Write the spec", dueDate: null },
                    { text: "Ship the migration", dueDate: null },
                ],
            }),
            buildGoalCheckInFixture({
                id: "c2",
                periodStart: "2026-10-18",
                did: "Write the spec",
                planned: [{ text: "Run the retro", dueDate: null }],
            }),
            buildGoalCheckInFixture({ id: "c3", periodStart: "2026-11-01", did: "", planned: [] }),
        ];
        expect(slipSummary("goal-ship", rows)).toEqual({
            goalId: "goal-ship",
            consecutiveSlips: 2,
            escalated: true,
            slippedPeriods: ["2026-10-18", "2026-11-01"],
            lastCleanPeriod: null,
            latestPeriod: "2026-11-01",
        });
    });

    it("resets on a clean period", () => {
        expect(slipSummary("goal-ship", buildCleanCheckInHistoryFixture())).toEqual({
            goalId: "goal-ship",
            consecutiveSlips: 0,
            escalated: false,
            slippedPeriods: [],
            lastCleanPeriod: "2026-11-01",
            latestPeriod: "2026-11-01",
        });
    });

    it("accrues the shared slip history to exactly two slips and escalates", () => {
        const summary = slipSummary("goal-ship", buildCheckInHistoryFixture());
        expect(summary.consecutiveSlips).toBe(2);
        expect(summary.escalated).toBe(true);
        expect(summary.slippedPeriods).toEqual(["2026-10-18", "2026-11-01"]);
        expect(summary.lastCleanPeriod).toBeNull();
    });

    it("does not escalate a single slip", () => {
        const rows = [
            buildGoalCheckInFixture({ id: "a", periodStart: "2026-10-04", planned: [{ text: "A", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "b", periodStart: "2026-10-18", did: "" }),
        ];
        const summary = slipSummary("goal-ship", rows);
        expect(summary.consecutiveSlips).toBe(1);
        expect(summary.escalated).toBe(false);
        expect(summary.slippedPeriods).toEqual(["2026-10-18"]);
    });

    it("resets after a clean period even when an earlier transition slipped", () => {
        const rows = [
            buildGoalCheckInFixture({ id: "a", periodStart: "2026-10-04", planned: [{ text: "A", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "b", periodStart: "2026-10-18", did: "", planned: [{ text: "B", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "c", periodStart: "2026-11-01", did: "B", planned: [] }),
        ];
        expect(slipSummary("goal-ship", rows)).toEqual({
            goalId: "goal-ship",
            consecutiveSlips: 0,
            escalated: false,
            slippedPeriods: [],
            lastCleanPeriod: "2026-11-01",
            latestPeriod: "2026-11-01",
        });
    });

    it("does not suppress a slip for a blocked status", () => {
        const rows = [
            buildGoalCheckInFixture({ id: "a", periodStart: "2026-10-04", planned: [{ text: "A", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "b", periodStart: "2026-10-18", did: "", statusPill: "blocked" }),
        ];
        expect(isSlipTransition(rows[0], rows[1])).toBe(true);
        expect(slipSummary("goal-ship", rows).consecutiveSlips).toBe(1);
    });

    it("walks non-grid historical keys without synthesizing slips or resets", () => {
        const clean = [
            buildGoalCheckInFixture({ id: "c1", periodStart: "2026-10-07", planned: [{ text: "A", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "c2", periodStart: "2026-10-21", did: "A", planned: [{ text: "B", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "c3", periodStart: "2026-11-04", did: "B" }),
        ];
        expect(slipSummary("goal-ship", clean)).toEqual({
            goalId: "goal-ship",
            consecutiveSlips: 0,
            escalated: false,
            slippedPeriods: [],
            lastCleanPeriod: "2026-11-04",
            latestPeriod: "2026-11-04",
        });
        const slipping = [
            buildGoalCheckInFixture({ id: "d1", periodStart: "2026-10-07", planned: [{ text: "A", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "d2", periodStart: "2026-10-21", did: "", planned: [] }),
        ];
        expect(slipSummary("goal-ship", slipping).slippedPeriods).toEqual(["2026-10-21"]);
    });

    it("returns zero slips for no rows", () => {
        expect(slipSummary("goal-ship", [])).toEqual({
            goalId: "goal-ship",
            consecutiveSlips: 0,
            escalated: false,
            slippedPeriods: [],
            lastCleanPeriod: null,
            latestPeriod: null,
        });
    });

    it("returns the latest period but no clean key for a single row", () => {
        const row = buildGoalCheckInFixture({ periodStart: "2026-10-04", planned: [{ text: "A", dueDate: null }] });
        expect(slipSummary("goal-ship", [row])).toEqual({
            goalId: "goal-ship",
            consecutiveSlips: 0,
            escalated: false,
            slippedPeriods: [],
            lastCleanPeriod: null,
            latestPeriod: "2026-10-04",
        });
    });

    it("leaves lastCleanPeriod null when every transition slips", () => {
        expect(slipSummary("goal-ship", buildCheckInHistoryFixture()).lastCleanPeriod).toBeNull();
    });

    it("filters inclusively through the requested period start", () => {
        const rows = buildCheckInHistoryFixture();
        const through = slipSummary("goal-ship", rows, "2026-10-18");
        expect(through.latestPeriod).toBe("2026-10-18");
        expect(through.consecutiveSlips).toBe(1);
        expect(through.slippedPeriods).toEqual(["2026-10-18"]);
        expect(through.lastCleanPeriod).toBeNull();
        const earlier = slipSummary("goal-ship", rows, "2026-10-04");
        expect(earlier.latestPeriod).toBe("2026-10-04");
        expect(earlier.consecutiveSlips).toBe(0);
        expect(earlier.slippedPeriods).toEqual([]);
    });

    it("filters other goals out of the summary", () => {
        const rows = [
            ...buildCheckInHistoryFixture("goal-ship"),
            buildGoalCheckInFixture({ id: "other", goalId: "goal-other", periodStart: "2026-11-15", did: "" }),
        ];
        expect(slipSummary("goal-ship", rows).latestPeriod).toBe("2026-11-01");
    });
});

describe("normalizeCheckInHistory", () => {
    it("retains the greatest updatedAt for a natural key", () => {
        const normalized = normalizeCheckInHistory(buildNaturalKeyDuplicatesFixture());
        expect(normalized).toHaveLength(1);
        expect(normalized[0].id).toBe("check-local");
        expect(normalized[0].did).toBe("Local copy");
    });

    it("breaks an updatedAt tie with the lexicographically smallest id", () => {
        const rows = [
            buildGoalCheckInFixture({
                id: "check-z",
                periodStart: "2026-10-18",
                updatedAt: "2026-10-20T12:00:00.000Z",
                did: "Z",
            }),
            buildGoalCheckInFixture({
                id: "check-a",
                periodStart: "2026-10-18",
                updatedAt: "2026-10-20T12:00:00.000Z",
                did: "A",
            }),
        ];
        const normalized = normalizeCheckInHistory(rows);
        expect(normalized).toHaveLength(1);
        expect(normalized[0].id).toBe("check-a");
    });

    it("sorts by periodStart then goalId deterministically", () => {
        const rows = [
            buildGoalCheckInFixture({ id: "b2", goalId: "goal-b", periodStart: "2026-10-18" }),
            buildGoalCheckInFixture({ id: "a2", goalId: "goal-a", periodStart: "2026-10-18" }),
            buildGoalCheckInFixture({ id: "a1", goalId: "goal-a", periodStart: "2026-10-04" }),
        ];
        expect(normalizeCheckInHistory(rows).map(row => `${row.periodStart}:${row.goalId}`)).toEqual([
            "2026-10-04:goal-a",
            "2026-10-18:goal-a",
            "2026-10-18:goal-b",
        ]);
    });

    it("clones rows and never mutates the input", () => {
        const rows = [
            buildGoalCheckInFixture({
                id: "c1",
                periodStart: "2026-10-04",
                planned: [{ text: "A", dueDate: "2026-10-10" }],
                evidenceTaskIds: ["task-1"],
            }),
        ];
        const snapshot = JSON.stringify(rows);
        const normalized = normalizeCheckInHistory(rows);
        expect(JSON.stringify(rows)).toBe(snapshot);
        normalized[0].planned[0].text = "changed";
        normalized[0].evidenceTaskIds.push("task-2");
        expect(rows[0].planned[0].text).toBe("A");
        expect(rows[0].evidenceTaskIds).toEqual(["task-1"]);
    });
});

describe("buildSparkline", () => {
    it("returns null for zero or one deduped points", () => {
        expect(buildSparkline("goal-ship", [])).toBeNull();
        expect(buildSparkline("goal-ship", [buildGoalCheckInFixture({ periodStart: "2026-10-04" })])).toBeNull();
        const duplicates = [
            buildGoalCheckInFixture({ id: "a", periodStart: "2026-10-04", updatedAt: "2026-10-20T12:00:00.000Z" }),
            buildGoalCheckInFixture({ id: "b", periodStart: "2026-10-04", updatedAt: "2026-10-19T12:00:00.000Z" }),
        ];
        expect(buildSparkline("goal-ship", duplicates)).toBeNull();
    });

    it("maps status values in ascending period order", () => {
        const rows = [
            buildGoalCheckInFixture({ id: "c3", periodStart: "2026-11-01", statusPill: "on-track" }),
            buildGoalCheckInFixture({ id: "c1", periodStart: "2026-10-04", statusPill: "blocked" }),
            buildGoalCheckInFixture({ id: "c2", periodStart: "2026-10-18", statusPill: "at-risk" }),
        ];
        expect(buildSparkline("goal-ship", rows)).toEqual({
            goalId: "goal-ship",
            kind: "status",
            points: [
                { periodStart: "2026-10-04", value: 0 },
                { periodStart: "2026-10-18", value: 1 },
                { periodStart: "2026-11-01", value: 2 },
            ],
        });
        expect(STATUS_SERIES_VALUES).toEqual({ blocked: 0, "at-risk": 1, "on-track": 2 });
    });

    it("filters by goal and inclusive throughPeriodStart", () => {
        const rows = [
            ...buildCheckInHistoryFixture("goal-ship"),
            buildGoalCheckInFixture({ id: "other", goalId: "goal-other", periodStart: "2026-10-18", statusPill: "blocked" }),
        ];
        const sparkline = buildSparkline("goal-ship", rows, "2026-10-18");
        expect(sparkline?.points.map(point => point.periodStart)).toEqual(["2026-10-04", "2026-10-18"]);
    });
});

describe("isGoalIncludedInPeriod", () => {
    const period = { periodStart: "2026-10-04", periodEnd: "2026-11-01" } as const;
    const dates: Record<string, LocalDateKey> = {
        "2026-09-20T12:00:00.000Z": "2026-09-20",
        "2026-09-12T12:00:00.000Z": "2026-09-12",
        "2026-10-12T12:00:00.000Z": "2026-10-12",
        "2026-11-01T12:00:00.000Z": "2026-11-01",
        "2026-11-15T12:00:00.000Z": "2026-11-15",
        "2026-12-01T12:00:00.000Z": "2026-12-01",
    };
    const localDateOf: LifecycleDateProjection = iso => {
        const key = dates[iso];
        if (!key) throw new Error(`Unexpected ISO instant: ${iso}`);
        return key;
    };

    it("includes an active goal created before the period ends", () => {
        const goal = buildGoalFixture({ createdAt: "2026-09-20T12:00:00.000Z" });
        expect(isGoalIncludedInPeriod(goal, period, localDateOf)).toBe(true);
    });

    it("excludes a dropped goal and any goal created at or after periodEnd", () => {
        expect(isGoalIncludedInPeriod(buildDroppedGoalFixture(), period, localDateOf)).toBe(false);
        expect(isGoalIncludedInPeriod(
            buildGoalFixture({ createdAt: "2026-11-01T12:00:00.000Z" }),
            period,
            localDateOf,
        )).toBe(false);
        expect(isGoalIncludedInPeriod(
            buildGoalFixture({ createdAt: "2026-11-15T12:00:00.000Z" }),
            period,
            localDateOf,
        )).toBe(false);
    });

    it("includes an achieved goal only from its achievement window onward", () => {
        const achieved = buildAchievedGoalFixture();
        expect(isGoalIncludedInPeriod(achieved, period, localDateOf)).toBe(true);
        expect(isGoalIncludedInPeriod(
            { ...achieved, achievedAt: "2026-09-12T12:00:00.000Z" },
            period,
            localDateOf,
        )).toBe(false);
    });

    it("projects an achievement at or after periodEnd as still active for an earlier deck", () => {
        const achieved = buildAchievedGoalFixture();
        expect(isGoalIncludedInPeriod(
            { ...achieved, achievedAt: "2026-11-01T12:00:00.000Z" },
            period,
            localDateOf,
        )).toBe(true);
        expect(isGoalIncludedInPeriod(
            { ...achieved, achievedAt: "2026-12-01T12:00:00.000Z" },
            period,
            localDateOf,
        )).toBe(true);
    });

    it("cannot establish inclusion for an achieved goal without achievedAt", () => {
        expect(isGoalIncludedInPeriod({ ...buildAchievedGoalFixture(), achievedAt: null }, period, localDateOf))
            .toBe(false);
    });
});

describe("metricSnapshot", () => {
    it("retains the habit link in an isolated snapshot", () => {
        const goal = buildGoalFixture({ metric: { label: "Practice", current: 0, target: 3, unit: "", source: "habit", habitId: "h", overridePinned: false } });
        expect(metricSnapshot(goal)).toEqual(goal.metric);
        expect(metricSnapshot(goal)).not.toBe(goal.metric);
    });

    it("returns null when the goal has no metric", () => {
        expect(metricSnapshot(buildGoalFixture())).toBeNull();
    });

    it("returns an isolated clone of the current metric", () => {
        const goal = buildMetricGoalFixture();
        const snapshot = metricSnapshot(goal);
        expect(snapshot).toEqual({
            label: "Sessions",
            current: 3,
            target: 8,
            unit: "",
            source: "manual",
            overridePinned: false,
        });
        if (!snapshot) throw new Error("Expected a metric snapshot");
        const mutable = snapshot as { label: string; current: number };
        mutable.label = "changed";
        mutable.current = 99;
        expect(goal.metric?.label).toBe("Sessions");
        expect(goal.metric?.current).toBe(3);
    });
});
