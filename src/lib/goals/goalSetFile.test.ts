import { describe, expect, it } from "vitest";
import type { Goal, GoalTracker } from "../../state/types";
import {
    GOAL_SET_FORMAT,
    GOAL_SET_VERSION,
    GoalSetError,
    goalSetFileName,
    materializeGoalSet,
    parseGoalSet,
    serializeGoalSet,
    type GoalSetFile,
} from "./goalSetFile";
import { resolveCadenceAnchorAt } from "./periods";
import {
    GOALS_FIXTURE_EVERY_N_WEEKS,
    GOALS_FIXTURE_MONTHLY,
    buildAchievedGoalFixture,
    buildDroppedGoalFixture,
    buildEveryNWeeksTrackerFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
    buildMetricGoalFixture,
    buildMonthlyWeekdayTrackerFixture,
} from "./testFixtures";

const NOW = new Date("2026-11-02T09:30:00.000Z");
const TODAY = "2026-11-02" as const;

function ids(prefix = "new"): () => string {
    let index = 0;
    return () => `${prefix}-${index += 1}`;
}

function definitionOf(goal: Goal) {
    return {
        title: goal.title,
        notes: goal.notes,
        projectId: goal.projectId,
        metric: goal.metric
            ? { label: goal.metric.label, target: goal.metric.target, unit: goal.metric.unit }
            : null,
        lifecycle: goal.lifecycle,
        sortOrder: goal.sortOrder,
    };
}

function definitionsOf(goals: readonly Goal[]) {
    return goals.map(definitionOf);
}

function trackerDefinitionOf(tracker: GoalTracker) {
    return {
        name: tracker.name,
        purpose: tracker.purpose,
        cadence: tracker.cadence,
        color: tracker.color,
    };
}

function thrownCode(json: string): string {
    try {
        parseGoalSet(json);
    } catch (caught) {
        if (caught instanceof GoalSetError) return caught.code;
        throw caught;
    }
    throw new Error("Expected parseGoalSet to throw");
}

function validFile(): GoalSetFile {
    const tracker = buildEveryNWeeksTrackerFixture();
    return parseGoalSet(serializeGoalSet(tracker, [buildGoalFixture({ sortOrder: 0 })]));
}

function withChange(change: (file: Record<string, unknown>) => void): string {
    const file = JSON.parse(JSON.stringify(validFile())) as Record<string, unknown>;
    change(file);
    return JSON.stringify(file);
}

describe("goalSetFile serializeGoalSet", () => {
    it("writes canonical key order, two-space indentation, and a trailing newline", () => {
        const tracker = buildGoalTrackerFixture({ name: "Work" });
        const goal = buildGoalFixture({ id: "goal-one", title: "Ship the release", notes: "Two notes", projectId: "project-1", sortOrder: 0 });
        const json = serializeGoalSet(tracker, [goal]);
        const expected = [
            "{",
            '  "format": "worktime.goal-set",',
            '  "version": 1,',
            '  "tracker": {',
            '    "name": "Work",',
            '    "purpose": "Ship the release",',
            '    "cadence": {',
            '      "kind": "every-n-weeks",',
            '      "weekday": 0,',
            '      "intervalWeeks": 2',
            "    },",
            '    "color": "#6366F1"',
            "  },",
            '  "goals": [',
            "    {",
            '      "title": "Ship the release",',
            '      "notes": "Two notes",',
            '      "projectId": "project-1",',
            '      "metric": null,',
            '      "lifecycle": "active",',
            '      "sortOrder": 0',
            "    }",
            "  ]",
            "}",
            "",
        ].join("\n");
        expect(json).toBe(expected);
        expect(GOAL_SET_FORMAT).toBe("worktime.goal-set");
        expect(GOAL_SET_VERSION).toBe(1);
    });

    it("orders goals by sortOrder, then title, then id and omits intervalWeeks for monthly", () => {
        const tracker = buildMonthlyWeekdayTrackerFixture();
        const goals = [
            buildGoalFixture({ id: "c", title: "Bravo", sortOrder: 1 }),
            buildGoalFixture({ id: "b", title: "Alpha", sortOrder: 1 }),
            buildGoalFixture({ id: "a", title: "Alpha", sortOrder: 1 }),
            buildGoalFixture({ id: "d", title: "First", sortOrder: 0 }),
        ];
        const raw = JSON.parse(serializeGoalSet(tracker, goals));
        expect(raw.goals.map((goal: { title: string }) => goal.title)).toEqual(["First", "Alpha", "Alpha", "Bravo"]);
        expect(Object.keys(raw.goals[0])).toEqual(["title", "notes", "projectId", "metric", "lifecycle", "sortOrder"]);
        expect(Object.keys(raw.tracker)).toEqual(["name", "purpose", "cadence", "color"]);
        expect(Object.keys(raw.tracker.cadence)).toEqual(["kind", "weekday"]);
        expect(raw.tracker.cadence).toEqual({ kind: "monthly-weekday", weekday: 0 });
        expect(Object.keys(raw)).toEqual(["format", "version", "tracker", "goals"]);
        expect(raw.format).toBe(GOAL_SET_FORMAT);
        expect(raw.version).toBe(GOAL_SET_VERSION);
    });

    it("emits definitions only: no ids, progress, history, anchors, or timestamps", () => {
        const tracker = buildGoalTrackerFixture({ lastBuiltPeriodStart: "2026-10-18" });
        const goals = [
            buildGoalFixture({ id: "goal-plain", trackerId: tracker.id, sortOrder: 0 }),
            { ...buildMetricGoalFixture(tracker.id), sortOrder: 1 },
            { ...buildAchievedGoalFixture(tracker.id), sortOrder: 2 },
            { ...buildDroppedGoalFixture(tracker.id), sortOrder: 3 },
        ];
        const json = serializeGoalSet(tracker, goals);
        for (const banned of [
            tracker.id,
            "goal-plain",
            "goal-metric",
            "current",
            "overridePinned",
            "source",
            "evidenceTaskIds",
            "lastBuiltPeriodStart",
            "cadenceAnchorAt",
            "createdAt",
            "updatedAt",
            "achievedAt",
            "droppedAt",
            "isArchived",
            "deck",
            "checkIn",
        ]) {
            expect(json).not.toContain(banned);
        }
        expect(json).not.toMatch(/"id"/);
        const raw = JSON.parse(json);
        expect(Object.keys(raw.goals[1].metric)).toEqual(["label", "target", "unit"]);
        expect(raw.goals[1].metric).toEqual({ label: "Sessions", target: 8, unit: "" });
    });

    it("rejects an invalid tracker or goal instead of emitting a broken file", () => {
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        expect(() => serializeGoalSet({ ...tracker, name: "  " }, [goal])).toThrow(GoalSetError);
        expect(() => serializeGoalSet(tracker, [])).toThrow(GoalSetError);
        expect(() => serializeGoalSet(tracker, [{ ...goal, title: "" }])).toThrow(GoalSetError);
        expect(() => serializeGoalSet(tracker, [{
            ...goal,
            metric: { label: "Sessions", target: 0, current: 0, unit: "", source: "manual", overridePinned: false },
        }])).toThrow(GoalSetError);
    });
});

describe("goalSetFile parseGoalSet", () => {
    it("round-trips definitions for every-n-weeks with fresh materialized ids", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [
            { ...buildMetricGoalFixture(tracker.id), sortOrder: 0 },
            buildGoalFixture({ id: "goal-plain", trackerId: tracker.id, sortOrder: 1 }),
            { ...buildAchievedGoalFixture(tracker.id), sortOrder: 2 },
            { ...buildDroppedGoalFixture(tracker.id), sortOrder: 3 },
        ];
        const file = parseGoalSet(serializeGoalSet(tracker, goals));
        expect(file.tracker).toEqual(trackerDefinitionOf(tracker));
        expect(file.tracker.cadence).toEqual(GOALS_FIXTURE_EVERY_N_WEEKS);

        const materialized = materializeGoalSet(file, NOW, ids());
        expect(materialized.tracker).not.toBe(tracker);
        expect(materialized.tracker.id).not.toBe(tracker.id);
        expect(materialized.goals.map(goal => goal.id)).toEqual(["new-2", "new-3", "new-4", "new-5"]);
        expect(materialized.goals.every(goal => goal.trackerId === "new-1")).toBe(true);
        expect(definitionsOf(materialized.goals)).toEqual(file.goals);
        expect(trackerDefinitionOf(materialized.tracker)).toEqual(file.tracker);
        expect(materialized.tracker.isArchived).toBe(false);
        expect(materialized.tracker.lastBuiltPeriodStart).toBeNull();
    });

    it("round-trips the monthly cadence branch without intervalWeeks", () => {
        const tracker = buildMonthlyWeekdayTrackerFixture();
        const file = parseGoalSet(serializeGoalSet(tracker, [buildGoalFixture({ trackerId: tracker.id })]));
        expect(file.tracker.cadence).toEqual(GOALS_FIXTURE_MONTHLY);
        expect(file.tracker.cadence).not.toHaveProperty("intervalWeeks");
        const materialized = materializeGoalSet(file, NOW, ids("monthly"));
        expect(materialized.tracker.cadence).toEqual(GOALS_FIXTURE_MONTHLY);
        expect(materialized.tracker.cadenceAnchorAt).toBe(resolveCadenceAnchorAt(GOALS_FIXTURE_MONTHLY, TODAY));
    });

    it("preserves array order rather than sorting on import", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const json = serializeGoalSet(tracker, [
            buildGoalFixture({ id: "a", title: "Zulu", sortOrder: 1 }),
            buildGoalFixture({ id: "b", title: "Alpha", sortOrder: 0 }),
        ]);
        const raw = JSON.parse(json);
        raw.goals.reverse();
        const file = parseGoalSet(JSON.stringify(raw));
        expect(file.goals.map(goal => goal.title)).toEqual(["Zulu", "Alpha"]);
        const materialized = materializeGoalSet(file, NOW, ids());
        expect(materialized.goals.map(goal => goal.title)).toEqual(["Zulu", "Alpha"]);
        expect(materialized.goals.map(goal => goal.sortOrder)).toEqual([0, 1]);
    });

    it("maps each malformed document to its exact error code", () => {
        expect(thrownCode("")).toBe("invalid-json");
        expect(thrownCode("{")).toBe("invalid-json");
        expect(thrownCode("null")).toBe("invalid-field");
        expect(thrownCode("[]")).toBe("invalid-field");
        expect(thrownCode('"worktime.goal-set"')).toBe("invalid-field");
        expect(thrownCode(withChange(file => { delete file.format; }))).toBe("invalid-format");
        expect(thrownCode(withChange(file => { file.format = "other"; }))).toBe("invalid-format");
        expect(thrownCode(withChange(file => { file.version = 2; }))).toBe("unsupported-version");
        expect(thrownCode(withChange(file => { file.version = "1"; }))).toBe("unsupported-version");
        expect(thrownCode(withChange(file => { delete file.version; }))).toBe("unsupported-version");
        expect(thrownCode(withChange(file => { file.format = "other"; file.version = 2; }))).toBe("invalid-format");
        expect(thrownCode(withChange(file => { file.goals = []; }))).toBe("empty-goals");
        expect(thrownCode(withChange(file => { file.goals = {}; }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => { file.extra = true; }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.tracker as Record<string, unknown>).name = "   ";
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            delete (file.tracker as Record<string, unknown>).color;
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.tracker as Record<string, unknown>).purpose = "Two\nlines";
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.tracker as Record<string, unknown>).cadence = { kind: "every-day", weekday: 0 };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.tracker as Record<string, unknown>).cadence = { kind: "monthly-weekday", weekday: 0, intervalWeeks: 2 };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.tracker as Record<string, unknown>).cadence = { kind: "every-n-weeks", weekday: 7, intervalWeeks: 2 };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.tracker as Record<string, unknown>).cadence = { kind: "every-n-weeks", weekday: 0, intervalWeeks: 0 };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].lifecycle = "archived";
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].title = " ";
        }))).toBe("invalid-field");
        expect(thrownCode('{"format":"worktime.goal-set","version":1,"tracker":{"name":"Work","purpose":"","cadence":{"kind":"monthly-weekday","weekday":0},"color":""},"goals":[{"title":"x","notes":"","projectId":null,"metric":null,"lifecycle":"active","sortOrder":1e999}]}')).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "Sessions", target: 0, unit: "" };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "Sessions", target: "8", unit: "" };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "Sessions", target: 8 };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            delete (file.goals as Record<string, unknown>[])[0].projectId;
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].projectId = "";
        }))).toBe("invalid-field");
        expect(thrownCode('{"format":"worktime.goal-set","version":1,"tracker":{},"goals":[{"title":"x"}]}')).toBe("invalid-field");
        expect(thrownCode('{"format":"worktime.goal-set","version":1,"tracker":{"name":"Work","purpose":"","cadence":{"kind":"monthly-weekday","weekday":0},"color":""},"goals":[{"title":"x","notes":"","projectId":null,"metric":{"label":"m","target":1e999,"unit":""},"lifecycle":"active","sortOrder":0}]}')).toBe("invalid-field");
    });

    it("carries a code and a short message on GoalSetError", () => {
        try {
            parseGoalSet("{}");
            throw new Error("Expected parseGoalSet to throw");
        } catch (caught) {
            expect(caught).toBeInstanceOf(GoalSetError);
            const error = caught as GoalSetError;
            expect(error.code).toBe("invalid-format");
            expect(error.message.length).toBeGreaterThan(0);
            expect(error.name).toBe("GoalSetError");
        }
    });
});

describe("goalSetFile materializeGoalSet", () => {
    it("preserves lifecycle while stamping import time and resetting metric progress", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const active = { ...buildMetricGoalFixture(tracker.id), sortOrder: 0 };
        const achieved = { ...buildAchievedGoalFixture(tracker.id), sortOrder: 1 };
        const dropped = { ...buildDroppedGoalFixture(tracker.id), sortOrder: 2 };
        const file = parseGoalSet(serializeGoalSet(tracker, [active, achieved, dropped]));
        const materialized = materializeGoalSet(file, NOW, ids("fresh"));

        expect(materialized.tracker.id).toBe("fresh-1");
        expect(materialized.tracker.cadenceAnchorAt).toBe(resolveCadenceAnchorAt(GOALS_FIXTURE_EVERY_N_WEEKS, TODAY));
        expect(materialized.tracker.createdAt).toBe(NOW.toISOString());

        const [activeGoal, achievedGoal, droppedGoal] = materialized.goals;
        expect(materialized.goals.map(goal => goal.lifecycle)).toEqual(["active", "achieved", "dropped"]);
        expect(activeGoal.metric).toEqual({ label: "Sessions", target: 8, current: 0, unit: "", source: "manual", overridePinned: false });
        expect([activeGoal.achievedAt, activeGoal.droppedAt]).toEqual([null, null]);
        expect([achievedGoal.achievedAt, achievedGoal.droppedAt]).toEqual([NOW.toISOString(), null]);
        expect([droppedGoal.achievedAt, droppedGoal.droppedAt]).toEqual([null, NOW.toISOString()]);
        expect(materialized.goals.map(goal => goal.sortOrder)).toEqual([0, 1, 2]);
        expect(materialized.goals.map(goal => goal.id)).toEqual(["fresh-2", "fresh-3", "fresh-4"]);
        expect(materialized.goals.every(goal => goal.trackerId === "fresh-1")).toBe(true);
    });

    it("clones cadence, metric, and the goal array instead of sharing the file", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const file = parseGoalSet(serializeGoalSet(tracker, [buildMetricGoalFixture(tracker.id)]));
        const materialized = materializeGoalSet(file, NOW, ids());
        expect(materialized.tracker.cadence).not.toBe(file.tracker.cadence);
        expect(materialized.goals).not.toBe(file.goals);
        expect(materialized.goals[0].metric).not.toBe(file.goals[0].metric);
        expect(materialized.goals[0].metric).toMatchObject({ current: 0, source: "manual", overridePinned: false });
        file.tracker.cadence.weekday = 3;
        if (file.goals[0].metric) file.goals[0].metric.target = 99;
        expect(materialized.tracker.cadence.weekday).toBe(0);
        expect(materialized.goals[0].metric?.target).toBe(8);
    });

    it("rejects an invalid file instead of creating rows", () => {
        expect(() => materializeGoalSet({ ...validFile(), goals: [] }, NOW, ids())).toThrow(GoalSetError);
        expect(() => materializeGoalSet({ ...validFile(), version: 2 } as unknown as GoalSetFile, NOW, ids())).toThrow(GoalSetError);
    });
});

describe("goalSetFile goalSetFileName", () => {
    it("builds a readable, safe filename from the tracker name and supplied date", () => {
        expect(goalSetFileName("Work", TODAY)).toBe("goals-work-2026-11-02.json");
        expect(goalSetFileName("  Work & Life  ", TODAY)).toBe("goals-work-life-2026-11-02.json");
        expect(goalSetFileName("Ship  the   release", TODAY)).toBe("goals-ship-the-release-2026-11-02.json");
        expect(goalSetFileName("Café/Notes: 2026?", TODAY)).toBe("goals-caf-notes-2026-2026-11-02.json");
        expect(goalSetFileName("", TODAY)).toBe("goals-tracker-2026-11-02.json");
        expect(goalSetFileName("...", TODAY)).toBe("goals-tracker-2026-11-02.json");
        expect(goalSetFileName("CON", TODAY)).toBe("goals-con-2026-11-02.json");
    });

    it("caps the slug at 40 characters and trims a trailing hyphen after the cap", () => {
        expect(goalSetFileName("A".repeat(39) + " tail", TODAY)).toBe(`goals-${"a".repeat(39)}-2026-11-02.json`);
        expect(goalSetFileName("A".repeat(40) + "b", TODAY)).toBe(`goals-${"a".repeat(40)}-2026-11-02.json`);
    });
});
