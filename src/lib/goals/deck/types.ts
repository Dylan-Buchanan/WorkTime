import type { GoalCheckIn, GoalMetric } from "../../../state/types";
import type { LocalDateKey } from "../../todos/types";
import type { GoalPeriod } from "../periods";

export const DECK_SLIDE_KINDS = [
    "title", "recap", "misses", "next-plans", "progress", "closing", "appendix",
] as const;
export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number];
export const DECK_SLIDE_ORDER: readonly DeckSlideKind[] = DECK_SLIDE_KINDS;
export const DECK_WORDS_PER_MINUTE = 130;
export const DECK_SLIDE_BASE_SECONDS = 8;
export const DECK_TARGET_SECONDS = 300;

export interface DeckMetricView {
    label: string;
    current: number | null;
    target: number;
    unit: string;
    source: GoalMetric["source"];
    habitId?: string;
    overridePinned: boolean;
    met?: boolean;
    delta?: number;
    unavailable?: boolean;
}
export interface DeckSlideBase<K extends DeckSlideKind> {
    readonly id: string;
    readonly kind: K;
    title: string;
    notes: string;
    suggestedSeconds: number;
    isHidden: boolean;
}
export interface DeckTitleSlide extends DeckSlideBase<"title"> {
    trackerName: string;
    purpose: string;
    periodLabel: string;
    periodRangeLabel: string;
}
export interface DeckRecapItem {
    text: string;
    dueDate: LocalDateKey | null;
}
export interface DeckRecapSlide extends DeckSlideBase<"recap"> {
    goalId: string;
    goalTitle: string;
    placement: "body" | "appendix";
    statusPill: GoalCheckIn["statusPill"];
    did: string;
    current: string;
    planned: DeckRecapItem[];
    missReason: string;
    metric: DeckMetricView | null;
    habitStreak: number | null;
    slipCount: number;
    slipBadge: boolean;
    achievedInPeriod: boolean;
    evidenceTaskTitles: string[];
}
export interface DeckMissItem {
    goalId: string;
    goalTitle: string;
    text: string;
    dueDate: LocalDateKey | null;
    reason: string;
}
export interface DeckMissesSlide extends DeckSlideBase<"misses"> {
    items: DeckMissItem[];
}
export interface DeckPlanItem {
    goalId: string;
    goalTitle: string;
    text: string;
    dueDate: LocalDateKey | null;
}
export interface DeckNextPlansSlide extends DeckSlideBase<"next-plans"> {
    items: DeckPlanItem[];
}
export interface DeckSeriesPoint {
    periodStart: LocalDateKey;
    value: number;
}
export interface DeckSeries {
    goalId: string;
    goalTitle: string;
    kind: "status" | "metric";
    label: string;
    unit: string;
    current: number | null;
    target: number | null;
    points: DeckSeriesPoint[];
}
export interface DeckProgressSlide extends DeckSlideBase<"progress"> {
    series: DeckSeries[];
}
export interface DeckCommitment {
    goalId: string;
    goalTitle: string;
    text: string;
}
export interface DeckClosingSlide extends DeckSlideBase<"closing"> {
    commitments: DeckCommitment[];
}
export interface DeckAppendixEntry {
    goalId: string;
    goalTitle: string;
    recapSlideId: string;
    statusPill: GoalCheckIn["statusPill"];
    slipCount: number;
    metricText: string | null;
}
export interface DeckAppendixSlide extends DeckSlideBase<"appendix"> {
    entries: DeckAppendixEntry[];
}
export type DeckSlide =
    | DeckTitleSlide | DeckRecapSlide | DeckMissesSlide | DeckNextPlansSlide
    | DeckProgressSlide | DeckClosingSlide | DeckAppendixSlide;
export type DeckThinWarningKind =
    | "miss-without-reason" | "goal-without-plans" | "habit-link-missing" | "empty-period";
export interface DeckThinWarning {
    id: string;
    kind: DeckThinWarningKind;
    goalId: string | null;
    message: string;
}
export interface DeckEstimate {
    visibleSlides: number;
    totalSeconds: number;
    targetSeconds: number;
    overTarget: boolean;
    wordsPerMinute: number;
}
export interface DeckPlan {
    trackerId: string;
    trackerName: string;
    period: GoalPeriod;
    generatedAt: string;
    slides: DeckSlide[];
    /** In-memory copy retention keyed by stable goal ID, including body recaps. */
    appendixEntriesByGoal: Record<string, DeckAppendixEntry>;
    warnings: DeckThinWarning[];
    estimate: DeckEstimate;
}
