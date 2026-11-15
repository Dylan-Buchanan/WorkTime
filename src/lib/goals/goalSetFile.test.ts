import { describe, expect, it } from "vitest";
import type { Goal, GoalTracker } from "../../state/types";
import {
    GOAL_SET_FORMAT,
    GOAL_SET_VERSION,
    GoalSetError,
    goalSetFileName,
    materializeGoalSet,
    parseGoalSet,
    resolveGoalSetProjects,
    serializeGoalSet,
    type GoalSetFile,
} from "./goalSetFile";
import { goalGrid, periodAt } from "./periods";
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

const NOW = new Date(2026, 10, 2, 12);
const TODAY = "2026-11-02" as const;

function ids(prefix = "new"): () => string {
    let index = 0;
    return () => `${prefix}-${index += 1}`;
}

function definitionOf(goal: Goal) {
    return {
        title: goal.title,
        notes: goal.notes,
        projectMode: goal.projectLink.mode,
        project: null,
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
        project: null,
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

function thrownMessage(json: string): string {
    try {
        parseGoalSet(json);
    } catch (caught) {
        if (caught instanceof GoalSetError) return caught.message;
        throw caught;
    }
    throw new Error("Expected parseGoalSet to throw");
}

function validFile(): GoalSetFile {
    const tracker = buildEveryNWeeksTrackerFixture();
    return parseGoalSet(serializeGoalSet(tracker, [buildGoalFixture({ sortOrder: 0 })], {}));
}

function withChange(change: (file: Record<string, unknown>) => void): string {
    const file = JSON.parse(JSON.stringify(validFile())) as Record<string, unknown>;
    change(file);
    return JSON.stringify(file);
}

describe("goalSetFile serializeGoalSet", () => {
    it("writes canonical key order, two-space indentation, and a trailing newline", () => {
        const tracker = buildGoalTrackerFixture({ name: "Work" });
        const goal = buildGoalFixture({ id: "goal-one", title: "Ship the release", notes: "Two notes", projectLink: { mode: "project", projectId: "project-1" }, sortOrder: 0 });
        const json = serializeGoalSet(tracker, [goal], { "project-1": { name: "Release" } });
        const expected = [
            "{",
            '  "format": "worktime.goal-set",',
            '  "version": 2,',
            '  "tracker": {',
            '    "name": "Work",',
            '    "purpose": "Ship the release",',
            '    "cadence": {',
            '      "kind": "every-n-weeks",',
            '      "weekday": 0,',
            '      "intervalWeeks": 2',
            "    },",
            '    "color": "#6366F1",',
            '    "project": null',
            "  },",
            '  "goals": [',
            "    {",
            '      "title": "Ship the release",',
            '      "notes": "Two notes",',
            '      "projectMode": "project",',
            '      "project": "Release",',
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
        expect(GOAL_SET_VERSION).toBe(2);
    });

    it("orders goals by sortOrder, then title, then id and omits intervalWeeks for monthly", () => {
        const tracker = buildMonthlyWeekdayTrackerFixture();
        const goals = [
            buildGoalFixture({ id: "c", title: "Bravo", sortOrder: 1 }),
            buildGoalFixture({ id: "b", title: "Alpha", sortOrder: 1 }),
            buildGoalFixture({ id: "a", title: "Alpha", sortOrder: 1 }),
            buildGoalFixture({ id: "d", title: "First", sortOrder: 0 }),
        ];
        const raw = JSON.parse(serializeGoalSet(tracker, goals, {}));
        expect(raw.goals.map((goal: { title: string }) => goal.title)).toEqual(["First", "Alpha", "Alpha", "Bravo"]);
        expect(Object.keys(raw.goals[0])).toEqual(["title", "notes", "projectMode", "project", "metric", "lifecycle", "sortOrder"]);
        expect(Object.keys(raw.tracker)).toEqual(["name", "purpose", "cadence", "color", "project"]);
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
        const json = serializeGoalSet(tracker, goals, {});
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
        expect(json).not.toContain("waiting");
        const raw = JSON.parse(json);
        expect(Object.keys(raw.goals[1].metric)).toEqual(["label", "target", "unit"]);
        expect(raw.goals[1].metric).toEqual({ label: "Sessions", target: 8, unit: "" });
    });

    it("rejects an invalid tracker or goal instead of emitting a broken file", () => {
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        expect(() => serializeGoalSet({ ...tracker, name: "  " }, [goal], {})).toThrow(GoalSetError);
        expect(() => serializeGoalSet(tracker, [], {})).toThrow(GoalSetError);
        expect(() => serializeGoalSet(tracker, [{ ...goal, title: "" }], {})).toThrow(GoalSetError);
        expect(() => serializeGoalSet(tracker, [{
            ...goal,
            metric: { label: "Sessions", target: Number.POSITIVE_INFINITY, current: 0, unit: "", source: "manual", overridePinned: false },
        }], {})).toThrow(GoalSetError);
    });

    it("accepts the finite metric targets the app can store, including zero and negatives", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const zero = {
            ...buildMetricGoalFixture(tracker.id),
            id: "goal-zero",
            metric: { label: "Sessions", target: 0, current: 0, unit: "", source: "manual" as const, overridePinned: false },
            sortOrder: 0,
        };
        const negative = {
            ...buildMetricGoalFixture(tracker.id),
            id: "goal-negative",
            metric: { label: "Delta", target: -3, current: 2, unit: "kg", source: "manual" as const, overridePinned: false },
            sortOrder: 1,
        };

        const json = serializeGoalSet(tracker, [zero, negative], {});
        const file = parseGoalSet(json);
        expect(file.goals.map(goal => goal.metric?.target)).toEqual([0, -3]);

        const materialized = materializeGoalSet(file, NOW, ids(), {});
        expect(materialized.goals.map(goal => goal.metric?.target)).toEqual([0, -3]);
        expect(materialized.goals.map(goal => goal.metric?.current)).toEqual([0, 0]);
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
        const file = parseGoalSet(serializeGoalSet(tracker, goals, {}));
        expect(file.tracker).toEqual(trackerDefinitionOf(tracker));
        expect(file.tracker.cadence).toEqual(GOALS_FIXTURE_EVERY_N_WEEKS);
        expect(JSON.stringify(file)).not.toContain("waiting");

        const materialized = materializeGoalSet(file, NOW, ids(), {});
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
        const file = parseGoalSet(serializeGoalSet(tracker, [buildGoalFixture({ trackerId: tracker.id })], {}));
        expect(file.tracker.cadence).toEqual(GOALS_FIXTURE_MONTHLY);
        expect(file.tracker.cadence).not.toHaveProperty("intervalWeeks");
        const materialized = materializeGoalSet(file, NOW, ids("monthly"), {});
        expect(materialized.tracker.cadence).toEqual(GOALS_FIXTURE_MONTHLY);
        expect(materialized.tracker.cadenceAnchorAt).toBe("2026-11-29");
    });

    it("preserves array order rather than sorting on import", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const json = serializeGoalSet(tracker, [
            buildGoalFixture({ id: "a", title: "Zulu", sortOrder: 1 }),
            buildGoalFixture({ id: "b", title: "Alpha", sortOrder: 0 }),
        ], {});
        const raw = JSON.parse(json);
        raw.goals.reverse();
        const file = parseGoalSet(JSON.stringify(raw));
        expect(file.goals.map(goal => goal.title)).toEqual(["Zulu", "Alpha"]);
        const materialized = materializeGoalSet(file, NOW, ids(), {});
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
        expect(thrownCode('{"format":"worktime.goal-set","version":1,"tracker":{"name":"Work","purpose":"","cadence":{"kind":"monthly-weekday","weekday":0},"color":""},"goals":[{"title":"x","notes":"","projectId":null,"metric":null,"lifecycle":"active","sortOrder":0}]}')).toBe("unsupported-version");
        expect(thrownCode(withChange(file => { file.version = "2"; }))).toBe("unsupported-version");
        expect(thrownCode(withChange(file => { delete file.version; }))).toBe("unsupported-version");
        expect(thrownCode(withChange(file => { file.format = "other"; file.version = 1; }))).toBe("invalid-format");
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
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].sortOrder = "OVERFLOW";
        }).replace('"OVERFLOW"', "1e999"))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "Sessions", target: null, unit: "" };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "Sessions", target: "8", unit: "" };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "Sessions", target: 8 };
        }))).toBe("invalid-field");
        expect(thrownCode(withChange(file => {
            (file.goals as Record<string, unknown>[])[0].metric = { label: "m", target: "OVERFLOW", unit: "" };
        }).replace('"OVERFLOW"', "1e999"))).toBe("invalid-field");
    });

    it.each([
        ["tracker", "project", undefined],
        ["tracker", "projectId", "old-id"],
        ["tracker", "project", ""],
        ["tracker", "project", 12],
        ["goal", "project", undefined],
        ["goal", "projectMode", undefined],
        ["goal", "projectId", "old-id"],
    ])("validates the %s %s field", (section, key, value) => {
        expect(thrownCode(withChange(file => {
            const row = section === "tracker"
                ? file.tracker as Record<string, unknown>
                : (file.goals as Record<string, unknown>[])[0];
            row[key] = value;
        }))).toBe("invalid-field");
    });

    it.each([
        ["unknown", null],
        ["project", null],
        ["project", ""],
        ["project", "  "],
        ["project", 12],
        ["inherit", "Release"],
        ["none", "Release"],
    ])("rejects the invalid project pairing %s / %j", (projectMode, project) => {
        expect(thrownCode(withChange(file => {
            Object.assign((file.goals as Record<string, unknown>[])[0], { projectMode, project });
        }))).toBe("invalid-field");
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

    it("words container problems as tracker copy rather than a goal set", () => {
        const messages = [
            thrownMessage("null"),
            thrownMessage("[]"),
            thrownMessage(withChange(file => { file.extra = true; })),
            thrownMessage(withChange(file => { delete file.tracker; })),
            thrownMessage(withChange(file => { file.tracker = "Work"; })),
            thrownMessage(withChange(file => { delete (file.tracker as Record<string, unknown>).color; })),
            thrownMessage(withChange(file => { file.goals = {}; })),
            thrownMessage(withChange(file => { file.goals = []; })),
            thrownMessage(withChange(file => { file.version = 1; })),
        ];
        for (const message of messages) expect(message).not.toMatch(/goal[- ]set/i);
        expect(messages[0]).toBe("the tracker file must be a JSON object");
        expect(messages[2]).toBe('the tracker file has an unknown field "extra"');
        expect(messages[3]).toBe('the tracker file is missing the field "tracker"');
        expect(messages[4]).toBe("the tracker must be an object");
        expect(messages[5]).toBe('the tracker is missing the field "color"');
        expect(messages[6]).toBe("the tracker file goals must be an array");
        expect(messages[7]).toBe("the tracker has no goals");
        expect(messages[8]).toBe("unsupported tracker file version: 1");
    });
});

describe("goalSetFile materializeGoalSet", () => {
    it("round-trips project names and all three goal modes across accounts", () => {
        const tracker = buildGoalTrackerFixture({ projectId: "tracker-project" });
        const goals = [
            buildGoalFixture({ id: "linked", trackerId: tracker.id, projectLink: { mode: "project", projectId: "p1" }, sortOrder: 0 }),
            buildGoalFixture({ id: "none", trackerId: tracker.id, projectLink: { mode: "none" }, sortOrder: 1 }),
            buildGoalFixture({ id: "inherit", trackerId: tracker.id, sortOrder: 2 }),
        ];
        const file = parseGoalSet(serializeGoalSet(tracker, goals, {
            "tracker-project": { name: "Studio" },
            p1: { name: "Release" },
        }));
        expect(file.tracker.project).toBe("Studio");
        expect(file.goals.map(({ projectMode, project }) => [projectMode, project])).toEqual([
            ["project", "Release"], ["none", null], ["inherit", null],
        ]);
        const localProjects = { studio: { name: "Studio" }, release: { name: "Release" } };
        const imported = materializeGoalSet(file, NOW, ids(), localProjects);
        expect(imported.tracker.projectId).toBe("studio");
        expect(imported.goals.map(goal => goal.projectLink)).toEqual([
            { mode: "project", projectId: "release" }, { mode: "none" }, { mode: "inherit" },
        ]);
        const reExported = serializeGoalSet(imported.tracker, imported.goals, localProjects);
        expect(parseGoalSet(reExported)).toEqual(file);
    });

    it("exports dangling links as a cleared tracker project and an inherited goal link", () => {
        const tracker = buildGoalTrackerFixture({ projectId: "deleted-tracker-project" });
        const goal = buildGoalFixture({
            projectLink: { mode: "project", projectId: "deleted-goal-project" },
        });
        const file = parseGoalSet(serializeGoalSet(tracker, [goal], {}));
        expect(file.tracker.project).toBeNull();
        expect(file.goals[0]).toMatchObject({ projectMode: "inherit", project: null });
    });

    it.each<[string, Record<string, { name: string }>, string | null]>([
        ["STUDIO", { a: { name: "Studio" } }, "a"],
        [" Studio ", { a: { name: "Studio" } }, null],
        ["Deep  Work", { a: { name: "Deep Work" } }, null],
        ["STUDIO", { a: { name: "Studio" }, b: { name: "STUDIO" } }, null],
    ])("resolves %j only when its name has one local match", (name, projects, expectedId) => {
        const file = validFile();
        file.tracker.project = name;
        Object.assign(file.goals[0], { projectMode: "project", project: name });
        expect(resolveGoalSetProjects(file, projects)).toEqual({
            trackerProjectId: expectedId,
            goalProjectLinks: expectedId === null ? [{ mode: "inherit" }] : [{ mode: "project", projectId: expectedId }],
            unresolvedTrackerProject: expectedId === null,
            unresolvedGoalProjects: expectedId === null ? 1 : 0,
        });
    });

    it("exports habit definitions without the link and imports them as manual with zero progress", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: { label: "Practice", current: 17, target: 5, unit: "sessions", source: "habit", habitId: "private-habit", overridePinned: false } });
        const json = serializeGoalSet(tracker, [goal], {});
        expect(JSON.parse(json).goals[0].metric).toEqual({ label: "Practice", target: 5, unit: "sessions" });
        expect(json).not.toContain("habitId");
        expect(json).not.toContain("private-habit");
        const imported = materializeGoalSet(parseGoalSet(json), NOW, ids(), {});
        expect(imported.goals[0].metric).toEqual({ label: "Practice", target: 5, unit: "sessions", source: "manual", current: 0, overridePinned: false });
    });

    it("preserves lifecycle while stamping import time and resetting metric progress", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const active = { ...buildMetricGoalFixture(tracker.id), sortOrder: 0 };
        const achieved = { ...buildAchievedGoalFixture(tracker.id), sortOrder: 1 };
        const dropped = { ...buildDroppedGoalFixture(tracker.id), sortOrder: 2 };
        const file = parseGoalSet(serializeGoalSet(tracker, [active, achieved, dropped], {}));
        const materialized = materializeGoalSet(file, NOW, ids("fresh"), {});

        expect(materialized.tracker.id).toBe("fresh-1");
        expect(materialized.tracker.cadenceAnchorAt).toBe("2026-11-08");
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

    it("opens a period immediately when imported on a snapped monthly boundary", () => {
        const tracker = buildMonthlyWeekdayTrackerFixture();
        const file = parseGoalSet(serializeGoalSet(tracker, [buildGoalFixture({ trackerId: tracker.id })], {}));
        const materialized = materializeGoalSet(file, new Date(2026, 10, 29, 12), ids(), {});

        expect(materialized.tracker.cadenceAnchorAt).toBe("2026-11-29");
        expect(periodAt(goalGrid(materialized.tracker), "2026-11-29")).toMatchObject({
            periodStart: "2026-11-29", monthKey: "2026-12",
        });
    });

    it("clones cadence, metric, and the goal array instead of sharing the file", () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const file = parseGoalSet(serializeGoalSet(tracker, [buildMetricGoalFixture(tracker.id)], {}));
        const materialized = materializeGoalSet(file, NOW, ids(), {});
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
        expect(() => materializeGoalSet({ ...validFile(), goals: [] }, NOW, ids(), {})).toThrow(GoalSetError);
        expect(() => materializeGoalSet({ ...validFile(), version: 1 } as unknown as GoalSetFile, NOW, ids(), {})).toThrow(GoalSetError);
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
