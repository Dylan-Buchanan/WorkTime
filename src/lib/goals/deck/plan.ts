import type { Goal, GoalCheckIn, GoalTracker } from "../../../state/types";
import type { LocalDateKey } from "../../todos/types";
import { isGoalDateKey } from "../factories";
import type { GoalPeriod } from "../periods";
import { periodLabel, periodRangeLabel } from "../periods";
import type { LifecycleDateProjection } from "../slips";
import {
    buildSparkline,
    isGoalIncludedInPeriod,
    metricSnapshot,
    normalizeCheckInHistory,
    slipSummary,
    unmetPlannedItems,
} from "../slips";
import { localDateKey } from "../../todos/calendar";
import {
    DECK_SLIDE_BASE_SECONDS,
    DECK_SLIDE_ORDER,
    DECK_TARGET_SECONDS,
    DECK_WORDS_PER_MINUTE,
} from "./types";
import type {
    DeckAppendixEntry,
    DeckAppendixSlide,
    DeckClosingSlide,
    DeckCommitment,
    DeckEstimate,
    DeckMetricView,
    DeckMissesSlide,
    DeckMissItem,
    DeckNextPlansSlide,
    DeckPlan,
    DeckPlanItem,
    DeckProgressSlide,
    DeckRecapSlide,
    DeckSeries,
    DeckSlide,
    DeckThinWarning,
    DeckTitleSlide,
} from "./types";

export interface DeckPlanInput {
    tracker: GoalTracker;
    goals: readonly Goal[];
    checkIns: readonly GoalCheckIn[];
    period: GoalPeriod;
    now: Date;
    evidenceTitlesByGoal?: Readonly<Record<string, readonly string[]>>;
    localDateOf?: LifecycleDateProjection;
}

export const MISSING_PROGRESS_DID = "No progress recorded this period";
const MISSING_COMMITMENT_TEXT = "No commitments set for the next period.";
const STATUS_LABELS: Readonly<Record<GoalCheckIn["statusPill"], string>> = {
    "on-track": "on track",
    "at-risk": "at risk",
    blocked: "blocked",
};

function compareText(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function sortGoals(goals: readonly Goal[]): Goal[] {
    return [...goals].sort((left, right) =>
        left.sortOrder - right.sortOrder ||
        compareText(left.title, right.title) ||
        compareText(left.id, right.id));
}

function defaultLocalDateOf(iso: string): LocalDateKey {
    const key = localDateKey(new Date(iso));
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal lifecycle date");
    return key;
}

function isAchievedInPeriod(
    goal: Goal,
    period: GoalPeriod,
    localDateOf: LifecycleDateProjection,
): boolean {
    if (goal.lifecycle !== "achieved" || !goal.achievedAt) return false;
    const achievedOn = localDateOf(goal.achievedAt);
    if (!isGoalDateKey(achievedOn)) throw new RangeError("Invalid goal lifecycle date");
    return achievedOn >= period.periodStart && achievedOn < period.periodEnd;
}

function evidenceTitlesFor(
    goalId: string,
    evidenceTitlesByGoal: Readonly<Record<string, readonly string[]>> | undefined,
): string[] {
    return (evidenceTitlesByGoal?.[goalId] ?? []).filter(title => title.trim() !== "");
}

function previousStoredRow(rows: readonly GoalCheckIn[], current: GoalCheckIn): GoalCheckIn | null {
    let previous: GoalCheckIn | null = null;
    for (const row of rows) {
        if (row.periodStart >= current.periodStart) break;
        previous = row;
    }
    return previous;
}

function metricTextOf(metric: DeckMetricView | null): string | null {
    if (!metric) return null;
    const label = metric.label.trim();
    const unit = metric.unit.trim();
    const values = `${metric.current} / ${metric.target}`;
    const withUnit = unit ? `${values} ${unit}` : values;
    return label ? `${label}: ${withUnit}` : withUnit;
}

function appendixEntryFromRecap(recap: DeckRecapSlide): DeckAppendixEntry {
    return {
        goalId: recap.goalId,
        goalTitle: recap.goalTitle,
        recapSlideId: recap.id,
        statusPill: recap.statusPill,
        slipCount: recap.slipCount,
        metricText: metricTextOf(recap.metric),
    };
}

function buildTitleSlide(tracker: GoalTracker, period: GoalPeriod): DeckTitleSlide {
    const label = periodLabel(period);
    const range = periodRangeLabel(period);
    return {
        id: "title",
        kind: "title",
        title: tracker.name,
        notes: tracker.purpose
            ? `Introduce ${tracker.name} and the ${label} review. Purpose: ${tracker.purpose}.`
            : `Introduce ${tracker.name} and the ${label} review.`,
        suggestedSeconds: 0,
        isHidden: false,
        trackerName: tracker.name,
        purpose: tracker.purpose,
        periodLabel: label,
        periodRangeLabel: range,
    };
}

function buildRecapSlide(
    goal: Goal,
    current: GoalCheckIn | null,
    rows: readonly GoalCheckIn[],
    period: GoalPeriod,
    achievedInPeriod: boolean,
    evidenceTaskTitles: string[],
): DeckRecapSlide {
    const summary = slipSummary(goal.id, rows, period.periodStart);
    const statusPill = current?.statusPill ?? "on-track";
    const placement = current ? (current.isFocus ? "body" : "appendix") : "body";
    return {
        id: `recap:${goal.id}`,
        kind: "recap",
        title: goal.title,
        notes: current
            ? `Recap for ${goal.title}. Current status: ${STATUS_LABELS[statusPill]}.`
            : `No check-in was recorded for ${goal.title} this period.`,
        suggestedSeconds: 0,
        isHidden: false,
        goalId: goal.id,
        goalTitle: goal.title,
        placement,
        statusPill,
        did: current ? current.did : MISSING_PROGRESS_DID,
        current: current ? current.current : "",
        planned: current ? current.planned.map(item => ({ text: item.text, dueDate: item.dueDate })) : [],
        missReason: current ? current.missReason : "",
        metric: metricSnapshot(goal),
        slipCount: summary.consecutiveSlips,
        slipBadge: summary.escalated,
        achievedInPeriod,
        evidenceTaskTitles,
    };
}

function buildMissesSlide(items: DeckMissItem[]): DeckMissesSlide {
    return {
        id: "misses",
        kind: "misses",
        title: "Misses",
        notes: items.length > 0
            ? "Review the plans that were not completed and the reasons recorded for them."
            : "No missed plans were recorded this period.",
        suggestedSeconds: 0,
        isHidden: false,
        items,
    };
}

function buildNextPlansSlide(items: DeckPlanItem[]): DeckNextPlansSlide {
    return {
        id: "next-plans",
        kind: "next-plans",
        title: "Next plans",
        notes: items.length > 0
            ? "Walk through the plans recorded for the next period."
            : "No plans were recorded for the next period.",
        suggestedSeconds: 0,
        isHidden: false,
        items,
    };
}

function buildProgressSlide(series: DeckSeries[]): DeckProgressSlide {
    return {
        id: "progress",
        kind: "progress",
        title: "Progress",
        notes: series.length > 0
            ? "Walk through the status trend for each goal with recorded history."
            : "No status history is available yet.",
        suggestedSeconds: 0,
        isHidden: false,
        series,
    };
}

function buildClosingSlide(commitments: DeckCommitment[]): DeckClosingSlide {
    const visibleCommitments = commitments.length > 0
        ? commitments
        : [{ goalId: "", goalTitle: "", text: MISSING_COMMITMENT_TEXT }];
    return {
        id: "closing",
        kind: "closing",
        title: "Closing",
        notes: commitments.length > 0
            ? "Close by restating the commitments for the next period."
            : "No commitments were set for the next period.",
        suggestedSeconds: 0,
        isHidden: false,
        commitments: visibleCommitments,
    };
}

function buildAppendixSlide(entries: DeckAppendixEntry[]): DeckAppendixSlide {
    return {
        id: "appendix",
        kind: "appendix",
        title: "Appendix",
        notes: "Reference roster for goals kept outside the main recap flow.",
        suggestedSeconds: 0,
        isHidden: false,
        entries,
    };
}

function buildSeries(goal: Goal, rows: readonly GoalCheckIn[], period: GoalPeriod): DeckSeries | null {
    const sparkline = buildSparkline(goal.id, rows, period.periodStart);
    if (!sparkline) return null;
    return {
        goalId: goal.id,
        goalTitle: goal.title,
        kind: "status",
        label: "Status",
        unit: "",
        current: null,
        target: null,
        points: sparkline.points.map(point => ({ periodStart: point.periodStart, value: point.value })),
    };
}

/**
 * Build the deterministic in-memory deck plan for one anchored period.
 * The caller supplies the clock and the lifecycle date projection.
 */
export function buildDeckPlan(input: DeckPlanInput): DeckPlan {
    if (input.tracker.isArchived) {
        throw new RangeError("Cannot build a deck for an archived tracker");
    }

    const localDateOf = input.localDateOf ?? defaultLocalDateOf;
    const goals = sortGoals(input.goals.filter(goal =>
        goal.trackerId === input.tracker.id &&
        isGoalIncludedInPeriod(goal, input.period, localDateOf)));
    const history = normalizeCheckInHistory(input.checkIns);

    const recaps: DeckRecapSlide[] = [];
    const missItems: DeckMissItem[] = [];
    const nextPlanItems: DeckPlanItem[] = [];
    const commitments: DeckCommitment[] = [];
    const series: DeckSeries[] = [];

    for (const goal of goals) {
        const rows = history.filter(row =>
            row.goalId === goal.id && row.periodStart <= input.period.periodStart);
        const current = rows.find(row => row.periodStart === input.period.periodStart) ?? null;
        const previous = current ? previousStoredRow(rows, current) : null;

        recaps.push(buildRecapSlide(
            goal,
            current,
            rows,
            input.period,
            isAchievedInPeriod(goal, input.period, localDateOf),
            evidenceTitlesFor(goal.id, input.evidenceTitlesByGoal),
        ));

        if (current && previous) {
            for (const item of unmetPlannedItems(previous, current)) {
                missItems.push({
                    goalId: goal.id,
                    goalTitle: goal.title,
                    text: item.text,
                    dueDate: item.dueDate,
                    reason: current.missReason,
                });
            }
        }

        if (current) {
            for (const item of current.planned) {
                if (item.text.trim() === "") continue;
                nextPlanItems.push({
                    goalId: goal.id,
                    goalTitle: goal.title,
                    text: item.text,
                    dueDate: item.dueDate,
                });
                commitments.push({ goalId: goal.id, goalTitle: goal.title, text: item.text });
            }
        }

        const goalSeries = buildSeries(goal, rows, input.period);
        if (goalSeries) series.push(goalSeries);
    }

    const slides: DeckSlide[] = [
        buildTitleSlide(input.tracker, input.period),
        ...recaps,
        buildMissesSlide(missItems),
        buildNextPlansSlide(nextPlanItems),
        buildProgressSlide(series),
        buildClosingSlide(commitments),
    ];
    if (recaps.some(recap => recap.placement === "appendix")) {
        slides.push(buildAppendixSlide(recaps
            .filter(recap => recap.placement === "appendix")
            .map(appendixEntryFromRecap)));
    }

    const appendixEntriesByGoal: Record<string, DeckAppendixEntry> = {};
    for (const recap of recaps) {
        appendixEntriesByGoal[recap.goalId] = appendixEntryFromRecap(recap);
    }

    return refreshDeckDerivations({
        trackerId: input.tracker.id,
        trackerName: input.tracker.name,
        period: input.period,
        generatedAt: input.now.toISOString(),
        slides,
        appendixEntriesByGoal,
        warnings: [],
        estimate: {
            visibleSlides: 0,
            totalSeconds: 0,
            targetSeconds: DECK_TARGET_SECONDS,
            overTarget: false,
            wordsPerMinute: DECK_WORDS_PER_MINUTE,
        },
    });
}

function wordCount(value: string | null | undefined): number {
    if (!value) return 0;
    const trimmed = value.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

function words(...values: Array<string | null | undefined>): number {
    return values.reduce((total, value) => total + wordCount(value), 0);
}

export function countDeckWords(slide: DeckSlide): number {
    let total = words(slide.title, slide.notes);
    switch (slide.kind) {
        case "title":
            return total;
        case "recap":
            total += words(slide.did, slide.current, slide.missReason, slide.metric?.label, slide.metric?.unit);
            for (const item of slide.planned) total += words(item.text);
            for (const title of slide.evidenceTaskTitles) total += words(title);
            return total;
        case "misses":
            for (const item of slide.items) total += words(item.goalTitle, item.text, item.reason);
            return total;
        case "next-plans":
            for (const item of slide.items) total += words(item.goalTitle, item.text);
            return total;
        case "progress":
            for (const item of slide.series) total += words(item.goalTitle, item.label, item.unit);
            return total;
        case "closing":
            for (const item of slide.commitments) total += words(item.goalTitle, item.text);
            return total;
        case "appendix":
            for (const item of slide.entries) total += words(item.goalTitle, item.metricText);
            return total;
    }
}

export function suggestedSecondsForSlide(slide: DeckSlide): number {
    return DECK_SLIDE_BASE_SECONDS +
        Math.ceil(countDeckWords(slide) / DECK_WORDS_PER_MINUTE * 60);
}

export function estimateDeck(plan: DeckPlan): DeckEstimate {
    const rendered = plan.slides.filter(slide =>
        !slide.isHidden && !(slide.kind === "recap" && slide.placement === "appendix"));
    const totalSeconds = rendered.reduce((total, slide) => total + slide.suggestedSeconds, 0);
    return {
        visibleSlides: rendered.length,
        totalSeconds,
        targetSeconds: DECK_TARGET_SECONDS,
        overTarget: totalSeconds > DECK_TARGET_SECONDS,
        wordsPerMinute: DECK_WORDS_PER_MINUTE,
    };
}

function recapSlides(slides: readonly DeckSlide[]): DeckRecapSlide[] {
    return slides.filter((slide): slide is DeckRecapSlide => slide.kind === "recap");
}

function recapHasProgress(recap: DeckRecapSlide): boolean {
    const hasDid = recap.did.trim() !== "" && recap.did !== MISSING_PROGRESS_DID;
    const hasCurrent = recap.current.trim() !== "";
    const hasEvidence = recap.evidenceTaskTitles.some(title => title.trim() !== "");
    return hasDid || hasCurrent || hasEvidence;
}

export function findThinWarnings(plan: DeckPlan): DeckThinWarning[] {
    const recaps = recapSlides(plan.slides);
    const recapOrder = new Map(recaps.map((recap, index) => [recap.goalId, index]));
    const warnings: DeckThinWarning[] = [];

    const misses = plan.slides.find((slide): slide is DeckMissesSlide => slide.kind === "misses");
    const missGoals = new Map<string, DeckMissItem[]>();
    for (const item of misses?.items ?? []) {
        const items = missGoals.get(item.goalId) ?? [];
        items.push(item);
        missGoals.set(item.goalId, items);
    }
    const orderedMissGoals = [...missGoals.entries()].sort((left, right) =>
        (recapOrder.get(left[0]) ?? Number.MAX_SAFE_INTEGER) -
        (recapOrder.get(right[0]) ?? Number.MAX_SAFE_INTEGER));
    for (const [goalId, items] of orderedMissGoals) {
        const missingReason = items.some(item => item.text.trim() !== "" && item.reason.trim() === "");
        if (!missingReason) continue;
        const goalTitle = items.find(item => item.text.trim() !== "")?.goalTitle ?? goalId;
        warnings.push({
            id: `thin:miss-without-reason:${goalId}`,
            kind: "miss-without-reason",
            goalId,
            message: `Misses for ${goalTitle} have no reason.`,
        });
    }

    for (const recap of recaps) {
        if (recap.planned.some(item => item.text.trim() !== "")) continue;
        warnings.push({
            id: `thin:goal-without-plans:${recap.goalId}`,
            kind: "goal-without-plans",
            goalId: recap.goalId,
            message: `${recap.goalTitle} has no plans for the next period.`,
        });
    }

    if (recaps.every(recap => !recapHasProgress(recap))) {
        warnings.push({
            id: "thin:empty-period",
            kind: "empty-period",
            goalId: null,
            message: "No progress was recorded for any goal this period.",
        });
    }

    return warnings;
}

function cloneAppendixEntry(entry: DeckAppendixEntry): DeckAppendixEntry {
    return { ...entry };
}

function cloneSlide(slide: DeckSlide): DeckSlide {
    switch (slide.kind) {
        case "title":
            return { ...slide };
        case "recap":
            return {
                ...slide,
                planned: slide.planned.map(item => ({ text: item.text, dueDate: item.dueDate })),
                metric: slide.metric ? { ...slide.metric } : null,
                evidenceTaskTitles: [...slide.evidenceTaskTitles],
            };
        case "misses":
            return { ...slide, items: slide.items.map(item => ({ ...item })) };
        case "next-plans":
            return { ...slide, items: slide.items.map(item => ({ ...item })) };
        case "progress":
            return {
                ...slide,
                series: slide.series.map(series => ({
                    ...series,
                    points: series.points.map(point => ({ ...point })),
                })),
            };
        case "closing":
            return { ...slide, commitments: slide.commitments.map(item => ({ ...item })) };
        case "appendix":
            return { ...slide, entries: slide.entries.map(cloneAppendixEntry) };
    }
}

function withSuggestedSeconds(slide: DeckSlide): DeckSlide {
    return { ...slide, suggestedSeconds: suggestedSecondsForSlide(slide) } as DeckSlide;
}

/**
 * Recompute seconds, thin warnings, estimate, and appendix roster membership.
 * Retained appendix copy is keyed by stable goal ID and is never replaced by
 * newly derived recap values.
 */
export function refreshDeckDerivations(plan: DeckPlan): DeckPlan {
    const slides = plan.slides.map(cloneSlide);
    const recaps = recapSlides(slides);
    const recapGoalIds = new Set(recaps.map(recap => recap.goalId));

    const retained: Record<string, DeckAppendixEntry> = {};
    for (const [goalId, entry] of Object.entries(plan.appendixEntriesByGoal)) {
        if (recapGoalIds.has(goalId)) retained[goalId] = cloneAppendixEntry(entry);
    }

    const appendixIndex = slides.findIndex(slide => slide.kind === "appendix");
    if (appendixIndex >= 0) {
        const appendix = slides[appendixIndex] as DeckAppendixSlide;
        for (const entry of appendix.entries) {
            if (recapGoalIds.has(entry.goalId) && !retained[entry.goalId]) {
                retained[entry.goalId] = cloneAppendixEntry(entry);
            }
        }
    }

    for (const recap of recaps) {
        if (!retained[recap.goalId]) retained[recap.goalId] = appendixEntryFromRecap(recap);
    }

    const rosterRecaps = recaps.filter(recap => recap.placement === "appendix");
    let orderedSlides = slides;
    if (rosterRecaps.length > 0) {
        const entries = rosterRecaps.map(recap => ({
            ...cloneAppendixEntry(retained[recap.goalId]),
            goalId: recap.goalId,
            recapSlideId: recap.id,
        }));
        if (appendixIndex >= 0) {
            const appendix = slides[appendixIndex] as DeckAppendixSlide;
            slides[appendixIndex] = { ...appendix, entries };
        } else {
            orderedSlides = [...slides, buildAppendixSlide(entries)];
        }
    } else if (appendixIndex >= 0) {
        orderedSlides = slides.filter((_, index) => index !== appendixIndex);
    }

    const draft: DeckPlan = {
        ...plan,
        slides: orderedSlides.map(withSuggestedSeconds),
        appendixEntriesByGoal: retained,
        warnings: [],
        estimate: {
            visibleSlides: 0,
            totalSeconds: 0,
            targetSeconds: DECK_TARGET_SECONDS,
            overTarget: false,
            wordsPerMinute: DECK_WORDS_PER_MINUTE,
        },
    };
    const warnings = findThinWarnings(draft);
    const withWarnings: DeckPlan = { ...draft, warnings };
    return { ...withWarnings, estimate: estimateDeck(withWarnings) };
}

function slideIndexById(plan: DeckPlan, slideId: string): number {
    const matches = plan.slides
        .map((slide, index) => slide.id === slideId ? index : -1)
        .filter(index => index >= 0);
    if (matches.length === 0) throw new RangeError(`Unknown deck slide: ${slideId}`);
    if (matches.length > 1) throw new RangeError(`Duplicate deck slide: ${slideId}`);
    return matches[0];
}

function blockIndex(slide: DeckSlide): number {
    return DECK_SLIDE_ORDER.indexOf(slide.kind);
}

function validateBlockOrder(slides: readonly DeckSlide[]): void {
    if (slides.length === 0 || slides[0].kind !== "title") {
        throw new RangeError("Invalid deck slide block order");
    }
    const ids = new Set<string>();
    const nonRecapKinds = new Set<string>();
    let previousBlock = blockIndex(slides[0]);
    for (const [index, slide] of slides.entries()) {
        if (ids.has(slide.id)) throw new RangeError(`Duplicate deck slide: ${slide.id}`);
        ids.add(slide.id);
        const block = blockIndex(slide);
        if (block < previousBlock) throw new RangeError("Invalid deck slide block order");
        previousBlock = block;
        if (slide.kind !== "recap") {
            if (nonRecapKinds.has(slide.kind)) throw new RangeError("Invalid deck slide block order");
            nonRecapKinds.add(slide.kind);
        }
        if (index === 0 && slide.kind !== "title") {
            throw new RangeError("Invalid deck slide block order");
        }
    }
}

export function setSlideHidden(plan: DeckPlan, slideId: string, hidden: boolean): DeckPlan {
    const index = slideIndexById(plan, slideId);
    const slides = plan.slides.map((slide, slideIndex) => {
        const clone = cloneSlide(slide);
        if (slideIndex === index) clone.isHidden = hidden;
        return clone;
    });
    return refreshDeckDerivations({ ...plan, slides });
}

export function moveSlide(plan: DeckPlan, slideId: string, direction: "up" | "down"): DeckPlan {
    validateBlockOrder(plan.slides);
    const index = slideIndexById(plan, slideId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= plan.slides.length ||
        blockIndex(plan.slides[target]) !== blockIndex(plan.slides[index])) {
        throw new RangeError("Cannot move a deck slide across blocks");
    }
    const slides = plan.slides.map(cloneSlide);
    [slides[index], slides[target]] = [slides[target], slides[index]];
    return refreshDeckDerivations({ ...plan, slides });
}

function setGoalPlacement(plan: DeckPlan, goalId: string, placement: "body" | "appendix"): DeckPlan {
    const matches = plan.slides
        .map((slide, index) => slide.kind === "recap" && slide.goalId === goalId ? index : -1)
        .filter(index => index >= 0);
    if (matches.length === 0) throw new RangeError(`Unknown deck goal: ${goalId}`);
    if (matches.length > 1) throw new RangeError(`Duplicate deck goal: ${goalId}`);
    const slides = plan.slides.map(cloneSlide);
    const recap = slides[matches[0]] as DeckRecapSlide;
    recap.placement = placement;
    return refreshDeckDerivations({ ...plan, slides });
}

export function moveGoalToAppendix(plan: DeckPlan, goalId: string): DeckPlan {
    return setGoalPlacement(plan, goalId, "appendix");
}

export function moveGoalToBody(plan: DeckPlan, goalId: string): DeckPlan {
    return setGoalPlacement(plan, goalId, "body");
}
