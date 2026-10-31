import { describe, expect, it } from "vitest";
import type { GoalCheckIn } from "../../../state/types";
import type { LocalDateKey } from "../../todos/types";
import type { GoalPeriod } from "../periods";
import { goalGrid, periodAt } from "../periods";
import type { GoalCheckInFixtureOverrides, GoalFixtureOverrides } from "../testFixtures";
import {
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
    buildMetricGoalFixture,
    buildSnappedMonthTrackerFixture,
} from "../testFixtures";
import {
    buildDeckPlan,
    countDeckWords,
    estimateDeck,
    findThinWarnings,
    moveGoalToAppendix,
    moveGoalToBody,
    moveSlide,
    refreshDeckDerivations,
    setSlideHidden,
    suggestedSecondsForSlide,
} from "./plan";
import type { DeckPlanInput } from "./plan";
import {
    DECK_SLIDE_BASE_SECONDS,
    DECK_TARGET_SECONDS,
    DECK_WORDS_PER_MINUTE,
} from "./types";
import type {
    DeckAppendixSlide,
    DeckMissesSlide,
    DeckPlan,
    DeckRecapSlide,
    DeckSlide,
    DeckTitleSlide,
} from "./types";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const TRACKER = buildGoalTrackerFixture();
const PERIOD: GoalPeriod = {
    periodStart: "2026-10-18",
    periodEnd: "2026-11-01",
    monthKey: "2026-10",
};
const project = (iso: string): LocalDateKey => iso.slice(0, 10) as LocalDateKey;

function buildInput(overrides: Partial<DeckPlanInput> = {}): DeckPlanInput {
    return {
        tracker: TRACKER,
        goals: [],
        checkIns: [],
        period: PERIOD,
        now: NOW,
        localDateOf: project,
        ...overrides,
    };
}

function buildPlan(overrides: Partial<DeckPlanInput> = {}): DeckPlan {
    return buildDeckPlan(buildInput(overrides));
}

function goal(id: string, overrides: GoalFixtureOverrides = {}) {
    return buildGoalFixture({ id, trackerId: TRACKER.id, ...overrides });
}

function checkIn(
    goalId: string,
    periodStart: LocalDateKey,
    overrides: GoalCheckInFixtureOverrides = {},
): GoalCheckIn {
    return buildGoalCheckInFixture({ goalId, periodStart, ...overrides });
}

function slide(plan: DeckPlan, id: string): DeckSlide {
    const found = plan.slides.find(candidate => candidate.id === id);
    if (!found) throw new Error(`Missing slide ${id}`);
    return found;
}

function recap(plan: DeckPlan, goalId: string): DeckRecapSlide {
    const found = plan.slides.find(
        (candidate): candidate is DeckRecapSlide =>
            candidate.kind === "recap" && candidate.goalId === goalId,
    );
    if (!found) throw new Error(`Missing recap ${goalId}`);
    return found;
}

function recaps(plan: DeckPlan): DeckRecapSlide[] {
    return plan.slides.filter((candidate): candidate is DeckRecapSlide => candidate.kind === "recap");
}

function ids(plan: DeckPlan): string[] {
    return plan.slides.map(candidate => candidate.id);
}

function snapshot<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function focusGoals(count: number) {
    return Array.from({ length: count }, (_, index) =>
        goal(`g${index + 1}`, { title: `Goal ${index + 1}`, sortOrder: index }));
}

function focusCheckIns(goals: ReturnType<typeof focusGoals>): GoalCheckIn[] {
    return goals.map(created => checkIn(created.id, PERIOD.periodStart, {
        did: `Did ${created.id}`,
        isFocus: true,
    }));
}

describe("buildDeckPlan slide inventory", () => {
    it("keeps the fixed block order and one recap per included goal across goal counts", () => {
        for (const count of [0, 1, 2, 4]) {
            const goals = focusGoals(count);
            const plan = buildPlan({ goals, checkIns: focusCheckIns(goals) });

            expect(recaps(plan).map(item => item.goalId)).toEqual(goals.map(created => created.id));
            expect(plan.slides.map(candidate => candidate.kind)).toEqual([
                "title",
                ...Array.from({ length: count }, () => "recap"),
                "misses",
                "next-plans",
                "progress",
                "closing",
            ]);
            expect(ids(plan)).toEqual([
                "title",
                ...goals.map(created => `recap:${created.id}`),
                "misses",
                "next-plans",
                "progress",
                "closing",
            ]);
            expect(plan.slides.some(candidate => candidate.kind === "appendix")).toBe(false);
        }
    });

    it("creates an appendix iff a goal is non-focus and places each goal once across body recaps and appendix", () => {
        const goals = [
            goal("g1", { title: "Alpha", sortOrder: 0 }),
            goal("g2", { title: "Beta", sortOrder: 1 }),
            goal("g3", { title: "Gamma", sortOrder: 2 }),
            goal("g4", { title: "Delta", sortOrder: 3 }),
        ];
        const checkIns = [
            checkIn("g1", PERIOD.periodStart, { did: "A", isFocus: true }),
            checkIn("g2", PERIOD.periodStart, { did: "B", isFocus: true }),
            checkIn("g3", PERIOD.periodStart, { did: "C", isFocus: false }),
            checkIn("g4", PERIOD.periodStart, { did: "D", isFocus: false }),
        ];
        const plan = buildPlan({ goals, checkIns });

        expect(plan.slides.map(candidate => candidate.kind)).toEqual([
            "title", "recap", "recap", "recap", "recap",
            "misses", "next-plans", "progress", "closing", "appendix",
        ]);
        const appendix = slide(plan, "appendix") as DeckAppendixSlide;
        expect(appendix.entries.map(entry => entry.goalId)).toEqual(["g3", "g4"]);
        expect(recaps(plan).map(item => item.goalId)).toEqual(["g1", "g2", "g3", "g4"]);

        const renderedGoalIds = [
            ...recaps(plan).filter(item => item.placement === "body").map(item => item.goalId),
            ...appendix.entries.map(entry => entry.goalId),
        ];
        expect(renderedGoalIds.sort()).toEqual(goals.map(created => created.id).sort());
        expect(recaps(plan).filter(item => item.goalId === "g3")).toHaveLength(1);
    });
});

describe("buildDeckPlan lifecycle inclusion", () => {
    it("uses the injected local-date projection for creation and achievement boundaries", () => {
        const goals = [
            goal("active", { title: "Active", sortOrder: 0 }),
            goal("achieved-in", {
                title: "Achieved in period",
                lifecycle: "achieved",
                achievedAt: "2026-10-20T12:00:00.000Z",
                sortOrder: 1,
            }),
            goal("achieved-before", {
                title: "Achieved before",
                lifecycle: "achieved",
                achievedAt: "2026-10-10T12:00:00.000Z",
                sortOrder: 2,
            }),
            goal("achieved-at-end", {
                title: "Achieved at end",
                lifecycle: "achieved",
                achievedAt: "2026-11-01T12:00:00.000Z",
                sortOrder: 3,
            }),
            goal("achieved-after", {
                title: "Achieved after",
                lifecycle: "achieved",
                achievedAt: "2026-11-10T12:00:00.000Z",
                sortOrder: 4,
            }),
            goal("dropped", {
                title: "Dropped",
                lifecycle: "dropped",
                droppedAt: "2026-10-20T12:00:00.000Z",
                sortOrder: 5,
            }),
            goal("created-at-end", {
                title: "Created at end",
                createdAt: "2026-11-01T12:00:00.000Z",
                sortOrder: 6,
            }),
        ];

        const plan = buildPlan({ goals });
        expect(recaps(plan).map(item => item.goalId)).toEqual([
            "active", "achieved-in", "achieved-at-end", "achieved-after",
        ]);
        expect(recap(plan, "achieved-in").achievedInPeriod).toBe(true);
        expect(recap(plan, "achieved-at-end").achievedInPeriod).toBe(false);
        expect(recap(plan, "achieved-after").achievedInPeriod).toBe(false);
        expect(recap(plan, "active").achievedInPeriod).toBe(false);
    });
});

describe("buildDeckPlan period content", () => {
    it("aggregates unstruck prior plans, current reasons, next plans, and closing commitments", () => {
        const target = goal("goal-ship", { title: "Ship the release" });
        const previous = checkIn("goal-ship", "2026-10-04", {
            planned: [{ text: "Write the spec", dueDate: null }],
            isFocus: true,
        });
        const current = checkIn("goal-ship", PERIOD.periodStart, {
            did: "Reviewed the spec",
            current: "Writing the migration",
            planned: [{ text: "Ship the migration", dueDate: "2026-10-30" }],
            missReason: "Blocked by review",
            isFocus: true,
        });
        const plan = buildPlan({ goals: [target], checkIns: [previous, current] });

        const misses = slide(plan, "misses") as DeckMissesSlide;
        expect(misses.items).toEqual([{
            goalId: "goal-ship",
            goalTitle: "Ship the release",
            text: "Write the spec",
            dueDate: null,
            reason: "Blocked by review",
        }]);
        const nextPlans = slide(plan, "next-plans");
        expect(nextPlans.kind).toBe("next-plans");
        if (nextPlans.kind === "next-plans") {
            expect(nextPlans.items).toEqual([{
                goalId: "goal-ship",
                goalTitle: "Ship the release",
                text: "Ship the migration",
                dueDate: "2026-10-30",
            }]);
        }
        const closing = slide(plan, "closing");
        expect(closing.kind).toBe("closing");
        if (closing.kind === "closing") {
            expect(closing.commitments).toEqual([{
                goalId: "goal-ship",
                goalTitle: "Ship the release",
                text: "Ship the migration",
            }]);
        }
    });

    it("uses the exact missing-progress placeholder and empty planned items when a current row is absent", () => {
        const plan = buildPlan({
            goals: [
                goal("check-in", { title: "Has a check-in", sortOrder: 0 }),
                goal("no-check-in", { title: "No check-in", sortOrder: 1 }),
            ],
            checkIns: [checkIn("check-in", PERIOD.periodStart, { did: "Made progress", isFocus: true })],
        });

        const missing = recap(plan, "no-check-in");
        expect(missing.did).toBe("No progress recorded this period");
        expect(missing.planned).toEqual([]);
        expect(missing.placement).toBe("body");
    });

    it("writes an honest closing placeholder when no planned text exists", () => {
        const plan = buildPlan({ goals: [goal("g1", { title: "Nothing planned" })] });
        const closing = slide(plan, "closing");
        expect(closing.kind).toBe("closing");
        if (closing.kind === "closing") {
            expect(closing.commitments).toEqual([{
                goalId: "",
                goalTitle: "",
                text: "No commitments set for the next period.",
            }]);
        }
    });
});

describe("buildDeckPlan recap badges and attachments", () => {
    const SLIP_STARTS: LocalDateKey[] = ["2026-10-18", "2026-11-01", "2026-11-15"];
    const SLIP_PERIODS: GoalPeriod[] = [
        { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" },
        { periodStart: "2026-11-01", periodEnd: "2026-11-15", monthKey: "2026-11" },
        { periodStart: "2026-11-15", periodEnd: "2026-11-29", monthKey: "2026-11" },
    ];

    function slipHistory(count: number): GoalCheckIn[] {
        const rows = [checkIn("goal-slip", "2026-10-04", {
            id: "slip-1",
            planned: [{ text: "Plan one", dueDate: null }],
            isFocus: true,
        })];
        for (let index = 0; index < count; index += 1) {
            rows.push(checkIn("goal-slip", SLIP_STARTS[index], {
                id: `slip-${index + 2}`,
                did: "Something else",
                planned: index + 1 < count ? [{ text: `Plan ${index + 2}`, dueDate: null }] : [],
                isFocus: true,
            }));
        }
        return rows;
    }

    it.each([
        [1, 1, false],
        [2, 2, true],
        [3, 3, true],
    ])("reports %i consecutive slips with badge=%s", (slips, expectedCount, expectedBadge) => {
        const target = goal("goal-slip", { title: "Slip goal" });
        const plan = buildPlan({
            goals: [target],
            checkIns: slipHistory(slips),
            period: SLIP_PERIODS[slips - 1],
        });
        const item = recap(plan, "goal-slip");
        expect(item.slipCount).toBe(expectedCount);
        expect(item.slipBadge).toBe(expectedBadge);
    });

    it("keeps metric text current on recaps and the appendix, and uses only injected evidence titles", () => {
        const target = buildMetricGoalFixture(TRACKER.id);
        const current = checkIn(target.id, PERIOD.periodStart, {
            did: "Two sessions",
            isFocus: false,
        });
        const withEvidence = buildPlan({
            goals: [target],
            checkIns: [current],
            evidenceTitlesByGoal: { [target.id]: ["Fix login", "   ", "Ship API"] },
        });
        const item = recap(withEvidence, target.id);

        expect(item.metric).toEqual({
            label: "Sessions",
            current: 3,
            target: 8,
            unit: "",
            source: "manual",
            overridePinned: false,
        });
        expect(item.evidenceTaskTitles).toEqual(["Fix login", "Ship API"]);
        expect(item.placement).toBe("appendix");
        const appendix = slide(withEvidence, "appendix") as DeckAppendixSlide;
        expect(appendix.entries[0].metricText).toBe("Sessions: 3 / 8");

        const withoutEvidence = buildPlan({ goals: [target], checkIns: [current] });
        expect(recap(withoutEvidence, target.id).evidenceTaskTitles).toEqual([]);
    });
});

describe("buildDeckPlan empty periods and labels", () => {
    it("still returns a complete plan with honest copy and an empty-period warning", () => {
        const goals = focusGoals(2);
        const plan = buildPlan({ goals });

        expect(plan.slides.map(candidate => candidate.kind)).toEqual([
            "title", "recap", "recap", "misses", "next-plans", "progress", "closing",
        ]);
        for (const created of goals) {
            expect(recap(plan, created.id).did).toBe("No progress recorded this period");
            expect(recap(plan, created.id).planned).toEqual([]);
        }
        expect(slide(plan, "misses").notes.trim().length).toBeGreaterThan(0);
        expect(slide(plan, "next-plans").notes.trim().length).toBeGreaterThan(0);
        expect(plan.warnings.map(warning => warning.id)).toEqual([
            "thin:goal-without-plans:g1",
            "thin:goal-without-plans:g2",
            "thin:empty-period",
        ]);
    });

    it("uses #135 labels for a snapped-backward monthly period", () => {
        const tracker = buildSnappedMonthTrackerFixture();
        const period = periodAt(goalGrid(tracker), "2026-12-15");
        if (!period) throw new Error("Expected a snapped monthly period");

        const plan = buildDeckPlan({
            tracker,
            goals: [],
            checkIns: [],
            period,
            now: NOW,
            localDateOf: project,
        });
        const title = plan.slides[0] as DeckTitleSlide;
        expect(title.kind).toBe("title");
        expect(title.periodLabel).toBe("December 2026");
        expect(title.periodRangeLabel).toBe("Nov 29, 2026 \u2013 Jan 2, 2027");
    });
});

describe("deck talk-length estimate", () => {
    it("names the constants and applies per-slide base plus ceil(words / WPM * 60)", () => {
        expect(DECK_WORDS_PER_MINUTE).toBe(130);
        expect(DECK_SLIDE_BASE_SECONDS).toBe(8);
        expect(DECK_TARGET_SECONDS).toBe(300);

        const titleSlide: DeckTitleSlide = {
            id: "title",
            kind: "title",
            title: "one two three",
            notes: "four five",
            suggestedSeconds: 0,
            isHidden: false,
            trackerName: "",
            purpose: "",
            periodLabel: "",
            periodRangeLabel: "",
        };
        expect(countDeckWords(titleSlide)).toBe(5);
        expect(suggestedSecondsForSlide(titleSlide)).toBe(
            DECK_SLIDE_BASE_SECONDS + Math.ceil(5 / DECK_WORDS_PER_MINUTE * 60),
        );

        const plan = buildPlan({
            goals: focusGoals(2),
            checkIns: focusCheckIns(focusGoals(2)),
        });
        for (const item of plan.slides) {
            expect(item.suggestedSeconds).toBe(suggestedSecondsForSlide(item));
        }
        expect(plan.estimate.wordsPerMinute).toBe(DECK_WORDS_PER_MINUTE);
    });

    it("excludes hidden slides and appendix-placement recaps from the rendered estimate", () => {
        const goals = focusGoals(2);
        const plan = buildPlan({ goals, checkIns: focusCheckIns(goals) });
        const hiddenRecap = recap(plan, "g1");
        const hidden = setSlideHidden(plan, hiddenRecap.id, true);
        expect(hidden.estimate.visibleSlides).toBe(plan.estimate.visibleSlides - 1);
        expect(hidden.estimate.totalSeconds).toBe(plan.estimate.totalSeconds - hiddenRecap.suggestedSeconds);

        const appendixPlan = buildPlan({
            goals: [goal("g1", { title: "Appendix goal" })],
            checkIns: [checkIn("g1", PERIOD.periodStart, { did: "Progress", isFocus: false })],
        });
        const rendered = appendixPlan.slides.filter(candidate =>
            !candidate.isHidden &&
            !(candidate.kind === "recap" && candidate.placement === "appendix"));
        expect(recap(appendixPlan, "g1").placement).toBe("appendix");
        expect(appendixPlan.estimate.visibleSlides).toBe(rendered.length);
        expect(appendixPlan.estimate.totalSeconds).toBe(
            rendered.reduce((total, candidate) => total + candidate.suggestedSeconds, 0),
        );
    });

    it("flags over target only when the visible total is greater than 300", () => {
        function planWithTotal(totalSeconds: number): DeckPlan {
            const titleSlide: DeckTitleSlide = {
                id: "title",
                kind: "title",
                title: "Title",
                notes: "",
                suggestedSeconds: totalSeconds - 150,
                isHidden: false,
                trackerName: "Tracker",
                purpose: "",
                periodLabel: "October 2026",
                periodRangeLabel: "Oct 18 - Oct 31, 2026",
            };
            const missesSlide: DeckMissesSlide = {
                id: "misses",
                kind: "misses",
                title: "Misses",
                notes: "",
                suggestedSeconds: 150,
                isHidden: false,
                items: [],
            };
            return {
                trackerId: "tracker",
                trackerName: "Tracker",
                period: PERIOD,
                generatedAt: NOW.toISOString(),
                slides: [titleSlide, missesSlide],
                appendixEntriesByGoal: {},
                warnings: [],
                estimate: {
                    visibleSlides: 0,
                    totalSeconds: 0,
                    targetSeconds: DECK_TARGET_SECONDS,
                    overTarget: false,
                    wordsPerMinute: DECK_WORDS_PER_MINUTE,
                },
            };
        }

        const atTarget = estimateDeck(planWithTotal(300));
        expect(atTarget).toEqual({
            visibleSlides: 2,
            totalSeconds: 300,
            targetSeconds: 300,
            overTarget: false,
            wordsPerMinute: 130,
        });
        expect(estimateDeck(planWithTotal(301)).overTarget).toBe(true);
    });
});

describe("thin warnings", () => {
    it("reports misses without reasons and goals without plans in recap order, including hidden and appendix recaps", () => {
        const goals = [
            goal("g1", { title: "Alpha", sortOrder: 0 }),
            goal("g2", { title: "Beta", sortOrder: 1 }),
            goal("g3", { title: "Gamma", sortOrder: 2 }),
            goal("g4", { title: "Delta", sortOrder: 3 }),
        ];
        const checkIns = [
            checkIn("g1", "2026-10-04", {
                id: "g1-prior",
                planned: [{ text: "Write the spec", dueDate: null }],
                isFocus: true,
            }),
            checkIn("g1", PERIOD.periodStart, {
                id: "g1-current",
                did: "Reviewed the spec",
                planned: [{ text: "Ship the migration", dueDate: null }],
                missReason: "   ",
                isFocus: true,
            }),
            checkIn("g3", PERIOD.periodStart, { did: "Made progress", isFocus: false }),
            checkIn("g4", PERIOD.periodStart, { did: "Still moving", isFocus: false }),
        ];
        const built = buildPlan({ goals, checkIns });
        const plan = setSlideHidden(built, "recap:g3", true);

        expect(plan.warnings.map(warning => warning.id)).toEqual([
            "thin:miss-without-reason:g1",
            "thin:goal-without-plans:g2",
            "thin:goal-without-plans:g3",
            "thin:goal-without-plans:g4",
        ]);
        expect(recap(plan, "g3").isHidden).toBe(true);
        expect(recap(plan, "g4").placement).toBe("appendix");
        expect(findThinWarnings(plan)).toEqual(plan.warnings);
        expect(plan.warnings.some(warning => warning.kind === "empty-period")).toBe(false);
    });

    it("treats the generated placeholder as no progress and puts the empty warning last", () => {
        const plan = buildPlan({ goals: focusGoals(2) });
        expect(plan.warnings.map(warning => warning.kind)).toEqual([
            "goal-without-plans",
            "goal-without-plans",
            "empty-period",
        ]);
        expect(plan.warnings[plan.warnings.length - 1]).toMatchObject({
            id: "thin:empty-period",
            kind: "empty-period",
            goalId: null,
        });
    });
});

describe("determinism", () => {
    it("returns a deep-equal plan for the same input and changes only generatedAt with a different clock", () => {
        const goals = focusGoals(3);
        const input = buildInput({ goals, checkIns: focusCheckIns(goals) });
        const first = buildDeckPlan(input);
        const second = buildDeckPlan(input);
        expect(second).toEqual(first);

        const later = buildDeckPlan({ ...input, now: new Date("2026-11-01T00:00:00.000Z") });
        expect(later.generatedAt).not.toBe(first.generatedAt);
        expect({ ...later, generatedAt: first.generatedAt }).toEqual(first);
    });
});

describe("deck editing helpers", () => {
    it("round-trips hidden state and rejects unknown slides", () => {
        const goals = focusGoals(1);
        const plan = buildPlan({ goals, checkIns: focusCheckIns(goals) });
        const hidden = setSlideHidden(plan, "recap:g1", true);
        expect(recap(hidden, "g1").isHidden).toBe(true);
        expect(recap(plan, "g1").isHidden).toBe(false);
        expect(setSlideHidden(hidden, "recap:g1", false)).toEqual(plan);
        expect(() => setSlideHidden(plan, "missing", true)).toThrow(RangeError);
    });

    it("reorders within the recap block only and rejects cross-block or duplicate-slide moves", () => {
        const goals = [
            goal("g1", { title: "Alpha", sortOrder: 0 }),
            goal("g2", { title: "Beta", sortOrder: 1 }),
            goal("g3", { title: "Gamma", sortOrder: 2 }),
        ];
        const plan = buildPlan({ goals, checkIns: focusCheckIns(goals) });

        expect(ids(moveSlide(plan, "recap:g2", "up")).slice(0, 4)).toEqual([
            "title", "recap:g2", "recap:g1", "recap:g3",
        ]);
        expect(ids(moveSlide(plan, "recap:g1", "down")).slice(0, 4)).toEqual([
            "title", "recap:g2", "recap:g1", "recap:g3",
        ]);

        expect(() => moveSlide(plan, "recap:g1", "up")).toThrow(RangeError);
        expect(() => moveSlide(plan, "recap:g3", "down")).toThrow(RangeError);
        expect(() => moveSlide(plan, "title", "down")).toThrow(RangeError);
        expect(() => moveSlide(plan, "misses", "up")).toThrow(RangeError);
        expect(() => moveSlide(plan, "missing", "up")).toThrow(RangeError);

        const duplicate: DeckPlan = { ...plan, slides: [...plan.slides, plan.slides[0]] };
        expect(() => moveSlide(duplicate, "recap:g1", "up")).toThrow(RangeError);

        const misses = slide(plan, "misses");
        const invalidOrder: DeckPlan = {
            ...plan,
            slides: [
                plan.slides[0],
                misses,
                ...plan.slides.filter(candidate => candidate.kind === "recap"),
                ...plan.slides.filter(candidate =>
                    candidate.kind === "next-plans" ||
                    candidate.kind === "progress" ||
                    candidate.kind === "closing"),
            ],
        };
        expect(() => moveSlide(invalidOrder, "recap:g1", "up")).toThrow(RangeError);
    });

    it("retains edited appendix copy and recap copy through promotion, demotion, and appendix disappearance", () => {
        const metricGoal = buildMetricGoalFixture(TRACKER.id);
        const goals = [metricGoal, goal("g2", { title: "Second", sortOrder: 1 })];
        const checkIns = [
            checkIn(metricGoal.id, PERIOD.periodStart, {
                did: "Two sessions",
                planned: [{ text: "Train again", dueDate: null }],
                isFocus: true,
            }),
            checkIn("g2", PERIOD.periodStart, { did: "Progress", isFocus: true }),
        ];
        const plan = buildPlan({ goals, checkIns });

        const promoted = moveGoalToAppendix(plan, metricGoal.id);
        expect(recap(promoted, metricGoal.id).placement).toBe("appendix");
        expect((slide(promoted, "appendix") as DeckAppendixSlide).entries.map(entry => entry.goalId))
            .toEqual([metricGoal.id]);

        const editedEntry = {
            ...promoted.appendixEntriesByGoal[metricGoal.id],
            goalTitle: "Edited appendix metric",
            metricText: "Edited appendix metric text",
        };
        const edited: DeckPlan = {
            ...promoted,
            appendixEntriesByGoal: {
                ...promoted.appendixEntriesByGoal,
                [metricGoal.id]: editedEntry,
            },
            slides: promoted.slides.map(candidate => candidate.kind === "appendix"
                ? {
                    ...candidate,
                    entries: candidate.entries.map(entry =>
                        entry.goalId === metricGoal.id ? { ...entry, ...editedEntry } : entry),
                }
                : candidate),
        };
        const recapEdited: DeckPlan = {
            ...edited,
            slides: edited.slides.map(candidate =>
                candidate.kind === "recap" && candidate.goalId === metricGoal.id
                    ? {
                        ...candidate,
                        title: "Edited recap title",
                        goalTitle: "Edited recap title",
                        did: "Edited recap did",
                        statusPill: "blocked" as const,
                        metric: { ...candidate.metric!, current: 7 },
                        isHidden: true,
                    }
                    : candidate),
        };
        const refreshed = refreshDeckDerivations(recapEdited);
        expect(refreshed.appendixEntriesByGoal[metricGoal.id].goalTitle).toBe("Edited appendix metric");
        expect(refreshed.appendixEntriesByGoal[metricGoal.id].metricText).toBe("Edited appendix metric text");
        expect((slide(refreshed, "appendix") as DeckAppendixSlide).entries[0].goalTitle)
            .toBe("Edited appendix metric");
        expect(recap(refreshed, metricGoal.id).suggestedSeconds)
            .toBe(suggestedSecondsForSlide(recap(refreshed, metricGoal.id)));

        const body = moveGoalToBody(refreshed, metricGoal.id);
        expect(recap(body, metricGoal.id).placement).toBe("body");
        expect(recap(body, metricGoal.id).title).toBe("Edited recap title");
        expect(recap(body, metricGoal.id).did).toBe("Edited recap did");
        expect(recap(body, metricGoal.id).isHidden).toBe(true);
        expect(body.appendixEntriesByGoal[metricGoal.id].goalTitle).toBe("Edited appendix metric");
        expect(body.slides.some(candidate => candidate.kind === "appendix")).toBe(false);

        const promotedAgain = moveGoalToAppendix(body, metricGoal.id);
        expect((slide(promotedAgain, "appendix") as DeckAppendixSlide).entries[0].goalTitle)
            .toBe("Edited appendix metric");
        expect(recap(promotedAgain, metricGoal.id).title).toBe("Edited recap title");
        expect(recap(promotedAgain, metricGoal.id).isHidden).toBe(true);
        expect(() => moveGoalToAppendix(plan, "missing")).toThrow(RangeError);
        expect(() => moveGoalToBody(plan, "missing")).toThrow(RangeError);
    });

    it("folds edited appendix slide entries into retention only when a retained copy is missing", () => {
        const metricGoal = buildMetricGoalFixture(TRACKER.id);
        const plan = buildPlan({
            goals: [metricGoal],
            checkIns: [checkIn(metricGoal.id, PERIOD.periodStart, {
                did: "Two sessions",
                isFocus: false,
            })],
        });
        expect(plan.appendixEntriesByGoal[metricGoal.id]).toBeDefined();

        const withoutRetained: DeckPlan = { ...plan, appendixEntriesByGoal: {} };
        const slideEdited: DeckPlan = {
            ...withoutRetained,
            slides: withoutRetained.slides.map(candidate => candidate.kind === "appendix"
                ? {
                    ...candidate,
                    entries: candidate.entries.map(entry => ({
                        ...entry,
                        goalTitle: "Fold title",
                        metricText: "Fold metric",
                    })),
                }
                : candidate),
        };
        const folded = refreshDeckDerivations(slideEdited);
        expect(folded.appendixEntriesByGoal[metricGoal.id].goalTitle).toBe("Fold title");
        expect(folded.appendixEntriesByGoal[metricGoal.id].metricText).toBe("Fold metric");
        expect((slide(folded, "appendix") as DeckAppendixSlide).entries[0].goalTitle)
            .toBe("Fold title");
    });

    it("never mutates the input plan or the check-ins", () => {
        const metricGoal = buildMetricGoalFixture(TRACKER.id);
        const goals = [metricGoal, goal("g2", { title: "Second", sortOrder: 1 })];
        const checkIns = [
            checkIn(metricGoal.id, PERIOD.periodStart, {
                did: "Two sessions",
                planned: [{ text: "Train again", dueDate: null }],
                isFocus: true,
            }),
            checkIn("g2", PERIOD.periodStart, { did: "Progress", isFocus: true }),
        ];
        const plan = buildPlan({ goals, checkIns });
        const planBefore = snapshot(plan);
        const checkInsBefore = snapshot(checkIns);

        const promoted = moveGoalToAppendix(plan, metricGoal.id);
        moveGoalToBody(promoted, metricGoal.id);
        setSlideHidden(plan, "recap:g2", true);
        moveSlide(plan, "recap:g2", "up");
        refreshDeckDerivations(plan);

        expect(snapshot(plan)).toEqual(planBefore);
        expect(snapshot(checkIns)).toEqual(checkInsBefore);
    });
});
