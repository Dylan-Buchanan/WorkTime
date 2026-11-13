import React, { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGoals, type NewGoalTrackerInput } from "../state/GoalContext";
import { useHabits } from "../state/HabitContext";
import { usePM } from "../state/ProjectManagerContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { Goal, GoalCadence, GoalMetric, GoalTracker, Habit, HabitFrequency, Weekday } from "../state/types";
import { normalizeGoalCadence } from "../lib/goals/cadence";
import { isGoalDateKey } from "../lib/goals/factories";
import { maxHabitMetricBuckets, readHabitMetric } from "../lib/goals/habitMetric";
import { daysUntil, dueState, firstPeriod, goalGrid, mostRecentCompletedPeriod, periodAt, periodLabel, periodRangeLabel, type GoalPeriod } from "../lib/goals/periods";
import { slipSummary } from "../lib/goals/slips";
import { buildDeckPlan } from "../lib/goals/deck/plan";
import type { DeckPlan } from "../lib/goals/deck/types";
import { initiateBlobDownload } from "../lib/goals/deck/delivery";
import { localDateKey } from "../lib/todos/calendar";
import type { LocalDateKey } from "../lib/todos/types";
import { CheckInEntry, type CheckInAvailability } from "./goals/CheckInEntry";
import { CheckInWizard } from "./goals/CheckInWizard";
import { DeckEntry, type DeckEntryAvailability } from "./goals/DeckEntry";
import { DeckPreview } from "./goals/DeckPreview";
import { GoalCountdownBadge } from "./goals/GoalCountdownBadge";
import { GoalDueNudge } from "./goals/GoalDueNudge";
import { GoalSetActions } from "./goals/GoalSetActions";
import { GoalSlipBadge } from "./goals/GoalSlipBadge";
import { GoalStatusBadge } from "./goals/GoalStatusBadge";
import { TrackerDueBadge } from "./goals/TrackerDueBadge";
import { TrackerRail } from "./goals/TrackerRail";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const control = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs";
const button = `${control} hover:bg-neutral-800 disabled:opacity-50`;
const primary = "rounded bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500";
const primaryLarge = "rounded bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50";
const achieveButton = "rounded border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-900/50";
const dropButton = "rounded border border-rose-800 bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-900/40";
const ordered = <T extends { sortOrder: number; id: string },>(rows: T[]) => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unable to save. Please try again.";
const habitsLoadingMessage = "Habits are still loading. Try again when they finish.";
/** Singular/plural words for a habit frequency; the count only ever affects the plural. */
const HABIT_UNIT_WORDS: Record<HabitFrequency, readonly [string, string]> = {
    daily: ["day", "days"],
    weekly: ["week", "weeks"],
    monthly: ["month", "months"],
};
const habitUnitWord = (count: number, frequency: HabitFrequency) => HABIT_UNIT_WORDS[frequency][count === 1 ? 0 : 1];
const habitUnitSuggestion = (frequency: HabitFrequency) => HABIT_UNIT_WORDS[frequency][1];
const cadenceHoldMessage = (max: number, frequency: HabitFrequency) => `This cadence can hold at most ${max} ${habitUnitWord(max, frequency)}.`;
const orderedHabits = (habits: Record<string, Habit>) => Object.values(habits)
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
/** One clock read per render; the optional prop is a test-only seam. */
const pageToday = (today?: LocalDateKey): LocalDateKey => {
    if (today !== undefined) return today;
    const key = localDateKey(new Date());
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
};

export const GoalsPage: React.FC<{ today?: LocalDateKey }> = ({ today: todayProp }) => {
    const goals = useGoals();
    const habits = useHabits();
    const { state, hydrated } = goals;
    const today = pageToday(todayProp);
    const [trackerForm, setTrackerForm] = useState<GoalTracker | "new" | null>(null);
    const [showArchived, setShowArchived] = useState(false);
    const [lifecycle, setLifecycle] = useState<Goal["lifecycle"] | "all">("active");
    const [editingGoal, setEditingGoal] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pinnedCheckIn, setPinnedCheckIn] = useState<{ trackerId: string; period: GoalPeriod } | null>(null);
    const [deckPreview, setDeckPreview] = useState<{ trackerId: string; plan: DeckPlan } | null>(null);
    const [trackerActionsOpen, setTrackerActionsOpen] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const isLg = useMediaQuery("(min-width: 1024px)");
    const mainRef = useRef<HTMLElement>(null);
    const drawerTriggerRef = useRef<HTMLButtonElement>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const allTrackers = ordered(Object.values(state.trackers));
    const activeTrackers = allTrackers.filter(row => !row.isArchived);
    const archivedTrackers = allTrackers.filter(row => row.isArchived);
    // The rail keeps archived rows in their own trailing group; the content
    // column keeps resolving its displayed tracker from the flat order.
    const trackers = showArchived ? allTrackers : activeTrackers;
    const railTrackers = showArchived ? [...activeTrackers, ...archivedTrackers] : activeTrackers;
    const hasTrackers = allTrackers.length > 0;
    const drawerVisible = hasTrackers && !isLg && drawerOpen;
    useEffect(() => {
        setDrawerOpen(false);
        setTrackerActionsOpen(null);
    }, [isLg, hasTrackers]);
    const tracker = trackers.find(row => row.id === state.ui.selectedTrackerId) ?? trackers[0];
    const trackerCounts = new Map<string, { active: number; achieved: number }>();
    const allGoals: Goal[] = [];
    for (const goal of Object.values(state.goals)) {
        if (goal.trackerId === tracker?.id) allGoals.push(goal);
        if (goal.lifecycle === "dropped") continue;
        const count = trackerCounts.get(goal.trackerId) ?? { active: 0, achieved: 0 };
        count[goal.lifecycle]++;
        trackerCounts.set(goal.trackerId, count);
    }
    ordered(allGoals);
    const hasHabitMetric = allGoals.some(goal => goal.metric?.source === "habit");
    const visible = allGoals.filter(row => lifecycle === "all" || row.lifecycle === lifecycle);
    const edit = editingGoal ? state.goals[editingGoal] : null;
    const due = tracker ? dueState(goalGrid(tracker), today) : null;
    const dueTracker = due !== null && due.kind === "due" ? due : null;
    const currentPeriodStart = due !== null && (due.kind === "due" || due.kind === "not-due") ? due.current.periodStart : null;
    const checkInGrid = tracker ? goalGrid(tracker) : null;
    const checkInCurrent = checkInGrid ? periodAt(checkInGrid, today) : null;
    const checkInFirst = checkInGrid ? firstPeriod(checkInGrid) : null;
    const daysUntilFirstPeriod = checkInFirst ? daysUntil(checkInFirst, today) : null;
    const checkInAvailability: CheckInAvailability = checkInCurrent !== null && tracker !== undefined && !tracker.isArchived
        ? { kind: "open", periodStart: checkInCurrent.periodStart, periodLabel: periodLabel(checkInCurrent) }
        : {
            kind: "not-started",
            message: tracker?.isArchived
                ? "This tracker is archived."
                : checkInFirst
                    ? `No open period. First period starts on ${checkInFirst.periodStart}.`
                    : "No open period.",
            firstPeriodLabel: checkInFirst ? periodLabel(checkInFirst) : null,
        };
    const deckCompleted = checkInGrid ? mostRecentCompletedPeriod(checkInGrid, today) : null;
    const deckAvailability: DeckEntryAvailability = hasHabitMetric && !habits.hydrated
        ? { kind: "not-ready", message: habitsLoadingMessage }
        : tracker === undefined
        ? { kind: "not-ready", message: "No tracker selected." }
        : tracker.isArchived
            ? { kind: "not-ready", message: "This tracker is archived. Reactivate it to build a deck." }
            : deckCompleted === null
                ? {
                    kind: "not-ready",
                    message: checkInCurrent
                        ? `No completed period yet. Build the deck after the ${periodLabel(checkInCurrent)} period completes.`
                        : checkInFirst
                            ? `No completed period yet. Build the deck after the first period completes; it starts on ${checkInFirst.periodStart}.`
                            : "No completed period yet.",
                }
                : {
                    kind: "ready",
                    period: deckCompleted,
                    built: tracker.lastBuiltPeriodStart === deckCompleted.periodStart,
                };
    const slipCount = (goalId: string) => {
        if (!tracker || tracker.isArchived || currentPeriodStart === null) return 0;
        return slipSummary(goalId, Object.values(state.checkIns), currentPeriodStart).consecutiveSlips;
    };
    const { active: activeCount, achieved: achievedCount } = trackerCounts.get(tracker?.id ?? "") ?? { active: 0, achieved: 0 };
    const slippedCount = allGoals.filter(row => slipCount(row.id) > 0).length;
    // Dropped goals leave the denominator so abandoning a goal never pulls the bar backwards.
    const progressTotal = activeCount + achievedCount;
    const progressPercent = progressTotal === 0 ? 0 : Math.round((achievedCount / progressTotal) * 100);
    const recordedGoalIds = checkInCurrent
        ? new Set(Object.values(state.checkIns)
            .filter(row => row.periodStart === checkInCurrent.periodStart)
            .map(row => row.goalId))
        : new Set<string>();
    const recordedCount = allGoals.filter(row => recordedGoalIds.has(row.id)).length;
    const checkInComplete = checkInCurrent !== null && allGoals.length > 0 && recordedCount === allGoals.length;

    function attempt(action: () => void) {
        try { action(); setError(null); } catch (error) { setError(errorMessage(error)); }
    }
    const closeDrawer = useCallback(() => {
        setDrawerOpen(false);
        setTrackerActionsOpen(null);
    }, []);
    function scrollToTop() {
        if (mainRef.current) mainRef.current.scrollTop = 0;
    }
    function selectTracker(id: string | null) {
        goals.selectTracker(id);
        setEditingGoal(null);
        setPinnedCheckIn(null);
        setDeckPreview(null);
        setTrackerForm(null);
        closeDrawer();
        scrollToTop();
    }
    function openTrackerForm(value: GoalTracker | "new") {
        closeDrawer();
        setTrackerForm(value);
        scrollToTop();
    }
    function archiveTracker(row: GoalTracker) {
        setTrackerActionsOpen(null);
        if (!window.confirm(`Archive “${row.name}”? Its goals and history will be kept.`)) return;
        attempt(() => {
            goals.archiveTracker(row.id);
            if (row.id === tracker?.id) {
                const index = activeTrackers.findIndex(active => active.id === row.id);
                selectTracker((activeTrackers[index + 1] ?? activeTrackers[index - 1])?.id ?? null);
            } else if (typeof trackerForm === "object" && trackerForm?.id === row.id) {
                setTrackerForm(null);
            }
        });
    }
    function reorder({ active, over }: DragEndEvent) {
        if (!tracker || !over || active.id === over.id) return;
        const from = visible.findIndex(row => row.id === active.id);
        const to = visible.findIndex(row => row.id === over.id);
        if (from < 0 || to < 0) return;
        // Keep hidden lifecycle rows in their positions while reordering visible rows.
        const moved = arrayMove(visible.map(row => row.id), from, to);
        let index = 0;
        const visibleIds = new Set(moved);
        const fullOrder = allGoals.map(row => visibleIds.has(row.id) ? moved[index++] : row.id);
        attempt(() => goals.reorderGoals(tracker.id, fullOrder));
    }
    function reorderTrackerRows(ids: readonly string[]) {
        attempt(() => {
            // Selection may be the implicit first-row fallback. Pin what the
            // content column is showing so a rail reorder never swaps it.
            if (tracker && state.ui.selectedTrackerId !== tracker.id) goals.selectTracker(tracker.id);
            goals.reorderTrackers(ids);
        });
    }
    function buildDeck(period: GoalPeriod) {
        if (hasHabitMetric && !habits.hydrated) {
            setError(habitsLoadingMessage);
            return;
        }
        if (!tracker) return;
        try {
            // Always regenerate in memory: no plan cache, persistence, or archive.
            const plan = buildDeckPlan({
                tracker,
                goals: Object.values(state.goals),
                checkIns: Object.values(state.checkIns),
                habits: Object.values(habits.state.habits),
                completions: Object.values(habits.state.completions),
                period,
                now: new Date(),
            });
            setDeckPreview({ trackerId: tracker.id, plan });
            setError(null);
        } catch (error) {
            setError(errorMessage(error));
        }
    }
    async function exportDeck(plan: DeckPlan): Promise<void> {
        setError(null);
        try {
            const { renderDeck } = await import("../lib/goals/deck/render");
            const { blob, fileName } = await renderDeck(plan);
            await initiateBlobDownload(blob, fileName);
            await goals.stampBuiltPeriod(plan.trackerId, plan.period.periodStart);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Export failed. Please try again.");
            throw caught;
        }
    }

    const showRail = hasTrackers && isLg;
    const rail = <TrackerRail
        trackers={railTrackers} selectedId={tracker?.id ?? null} today={today} counts={trackerCounts} hydrated={hydrated}
        showArchived={showArchived} archivedCount={allTrackers.length - activeTrackers.length}
        actionsOpen={trackerActionsOpen} onActionsChange={setTrackerActionsOpen}
        onSelect={selectTracker} onNew={() => openTrackerForm("new")} onEdit={openTrackerForm}
        onArchive={archiveTracker} onReactivate={row => {
            setTrackerActionsOpen(null);
            attempt(() => goals.archiveTracker(row.id, false));
        }}
        onToggleArchived={setShowArchived}
        onReorder={reorderTrackerRows}
    />;

    return <>
    <div inert={drawerVisible} className={`grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] ${showRail ? "grid-cols-[16rem_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}>
        {showRail && <aside className="row-span-2 flex min-h-0 w-64 flex-col border-r border-neutral-800 bg-neutral-900/30">{rail}</aside>}
        <header className="border-b border-neutral-800 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Goals</h1>
                    <p className="max-w-prose text-sm leading-relaxed text-neutral-400">Trackers group the goals you are working toward. Check in each period to record progress and plan what comes next.</p>
                </div>
                {hasTrackers && !isLg && <button ref={drawerTriggerRef} type="button" className={button} aria-haspopup="dialog" aria-expanded={drawerVisible}
                    aria-controls={drawerVisible ? "goal-trackers-drawer" : undefined} onClick={() => setDrawerOpen(true)}>Trackers</button>}
            </div>
        </header>
        <main ref={mainRef} className="min-h-0 overflow-auto p-4">
            <div className="mx-auto max-w-5xl space-y-4">
                {!hydrated && <p role="status">Loading goals…</p>}
                {error && <p role="alert" className="text-red-300">{error}</p>}
                {trackerForm && <TrackerForm key={typeof trackerForm === "string" ? trackerForm : trackerForm.id}
                    tracker={typeof trackerForm === "string" ? null : trackerForm}
                    onCancel={() => setTrackerForm(null)}
                    onSave={input => {
                        if (trackerForm === "new") {
                            const created = goals.createTracker(input);
                            selectTracker(created.id);
                            setShowArchived(false);
                        } else goals.updateTracker(trackerForm.id, input);
                        setTrackerForm(null);
                    }} />}
                {hydrated && !tracker && <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-6 sm:p-10">
                    <div className="mx-auto max-w-xl space-y-4 text-center">
                        <h2 className="text-lg font-semibold text-neutral-100">{hasTrackers ? "No active trackers" : "Start your first tracker"}</h2>
                        <p className="text-sm leading-relaxed text-neutral-400">
                            {hasTrackers
                                ? "Every tracker you have is archived. Show archived trackers to review them, or create a new tracker to keep moving."
                                : "A tracker holds the goals you are working toward. Each period, check in on what you did, what you are working on now, and what comes next."}
                        </p>
                        {!hasTrackers && <button className={primaryLarge} onClick={() => openTrackerForm("new")}>Add tracker</button>}
                    </div>
                </section>}
                {tracker && <>
                    <div data-goals-slot="goal-set-actions" data-tracker-id={tracker.id}>
                        <GoalSetActions key={tracker.id} trackerId={tracker.id} onImported={selectTracker} />
                    </div>
                    <section
                        aria-label={tracker.name}
                        className={`overflow-hidden rounded-xl border ${tracker.isArchived ? "border-neutral-800/70 bg-neutral-900/10" : "border-neutral-800 bg-neutral-900/20"}`}
                    >
                        <div className={`grid grid-cols-1 ${tracker.isArchived ? "" : "xl:grid-cols-[minmax(0,1fr)_19rem]"}`}>
                            {/* Identity */}
                            <div className={`order-1 min-w-0 space-y-4 p-4 sm:p-5 xl:col-start-1 xl:row-start-1 ${tracker.isArchived ? "opacity-80" : ""}`}>
                                <header className="flex items-start gap-3">
                                    <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tracker.color }} />
                                    <div className="min-w-0 flex-1" title={tracker.purpose || undefined}>
                                        <div className="flex min-w-0 items-center gap-2">
                                            <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight text-neutral-100">{tracker.name}</h2>
                                            {tracker.isArchived && <span className="rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Archived</span>}
                                        </div>
                                        {tracker.purpose && <p className="sr-only">{tracker.purpose}</p>}
                                    </div>
                                </header>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-neutral-700 bg-neutral-900/60 px-2.5 py-1 text-xs text-neutral-300">{tracker.cadence.kind === "monthly-weekday"
                                        ? `Monthly on ${weekdays[tracker.cadence.weekday]}`
                                        : `Every ${tracker.cadence.intervalWeeks} ${tracker.cadence.intervalWeeks === 1 ? "week" : "weeks"} on ${weekdays[tracker.cadence.weekday]}`}</span>
                                    <div data-goals-slot="tracker-due" data-tracker-id={tracker.id}>
                                        <TrackerDueBadge due={dueTracker !== null} periodLabel={dueTracker ? periodLabel(dueTracker.mostRecentCompleted) : null} />
                                    </div>
                                </div>
                            </div>
                            {/* Health */}
                            <div className="order-3 min-w-0 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 xl:col-start-1 xl:row-start-2 xl:pt-0">
                                {tracker.isArchived
                                    ? <p className="text-sm text-neutral-400">This tracker is archived. Its goals and history are kept.</p>
                                    : <div className="space-y-2" data-goals-slot="tracker-health">
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-300">
                                            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-400" />{activeCount} active</span>
                                            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{achievedCount} achieved</span>
                                            <span className={`inline-flex items-center gap-1.5 ${slippedCount > 0 ? "text-amber-200" : ""}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${slippedCount > 0 ? "bg-amber-400" : "bg-neutral-600"}`} />{slippedCount} slipped</span>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between text-xs text-neutral-400">
                                                <span>{progressTotal === 0 ? "No goals yet" : `${achievedCount} of ${progressTotal} achieved`}</span>
                                                {progressTotal > 0 && <span>{progressPercent}%</span>}
                                            </div>
                                            <div
                                                role="progressbar"
                                                aria-label="Goals achieved"
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                                aria-valuenow={progressPercent}
                                                className="h-1.5 overflow-hidden rounded-full bg-neutral-800"
                                            >
                                                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progressPercent}%` }} />
                                            </div>
                                        </div>
                                    </div>}
                            </div>
                            {/* Period spine: last period settled above, this period live below. */}
                            {!tracker.isArchived && <div className={`order-2 flex flex-col border-b border-neutral-800 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:border-b-0 xl:border-l ${dueTracker ? "bg-amber-950/10" : "bg-neutral-950/40"}`}>
                                <div data-goals-slot="deck-entry" data-tracker-id={tracker.id} className="order-3 space-y-3 p-4 sm:p-5 xl:order-1">
                                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/70">Last period</h3>
                                    <DeckEntry
                                        trackerId={tracker.id}
                                        trackerName={tracker.name}
                                        availability={deckAvailability}
                                        onBuild={buildDeck}
                                    />
                                </div>
                                <div aria-hidden="true" className="order-2 flex items-center gap-2 px-4">
                                    <span className="h-px flex-1 bg-neutral-800" />
                                    <span className="h-1 w-1 rounded-full bg-neutral-700" />
                                    <span className="h-px flex-1 bg-neutral-800" />
                                </div>
                                <div data-goals-slot="check-in-entry" data-tracker-id={tracker.id} className="order-1 space-y-3 p-4 sm:p-5 xl:order-3">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-200/80">This period</h3>
                                        {checkInCurrent && <time dateTime={checkInCurrent.periodStart} className="text-xs text-neutral-400">{periodRangeLabel(checkInCurrent)}</time>}
                                    </div>
                                    {checkInCurrent === null
                                        ? <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm text-neutral-400">No open period. First period starts on <time dateTime={checkInFirst!.periodStart}>{checkInFirst!.periodStart}</time>.</p>
                                            {daysUntilFirstPeriod !== null && <GoalCountdownBadge daysUntilOpen={daysUntilFirstPeriod} />}
                                        </div>
                                        : <>
                                            <p className="text-sm text-neutral-400">First period started on <time dateTime={tracker.cadenceAnchorAt}>{tracker.cadenceAnchorAt}</time>.</p>
                                            <div className="space-y-1">
                                                <p className={`text-xs ${checkInComplete ? "text-emerald-300" : "text-neutral-400"}`}>
                                                    {allGoals.length === 0
                                                        ? "No goals to record yet"
                                                        : `${recordedCount} of ${allGoals.length} ${allGoals.length === 1 ? "goal" : "goals"} recorded`}
                                                </p>
                                                {allGoals.length > 0 && <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-neutral-800">
                                                    <div
                                                        className={`h-full rounded-full ${checkInComplete ? "bg-emerald-500" : "bg-indigo-500"}`}
                                                        style={{ width: `${Math.round((recordedCount / allGoals.length) * 100)}%` }}
                                                    />
                                                </div>}
                                            </div>
                                        </>}
                                    <CheckInEntry trackerId={tracker.id} availability={checkInAvailability} complete={checkInComplete} onOpen={periodStart => {
                                        if (!checkInGrid) return;
                                        const pinned = periodAt(checkInGrid, periodStart);
                                        if (pinned) setPinnedCheckIn({ trackerId: tracker.id, period: pinned });
                                    }} />
                                </div>
                            </div>}
                        </div>
                        {/* Inline in the page flow, not an overlay: the only scroller on
                            this page is <main>, so a wizard mounted outside it is clipped
                            and its later goals are unreachable. */}
                        <div data-goals-slot="check-in-wizard" className="min-w-0 px-4 sm:px-5">
                            {pinnedCheckIn && pinnedCheckIn.trackerId === tracker.id && <CheckInWizard
                                key={`${pinnedCheckIn.trackerId}:${pinnedCheckIn.period.periodStart}`}
                                trackerId={pinnedCheckIn.trackerId}
                                period={pinnedCheckIn.period}
                                onClose={() => setPinnedCheckIn(null)}
                            />}
                        </div>
                    </section>
                    {!tracker.isArchived && <QuickAdd key={tracker.id} first={allGoals.length === 0} onAdd={(title, status, notes) => {
                        const row = goals.createGoal({ trackerId: tracker.id, title, notes });
                        if (status !== "active") goals.setGoalLifecycle(row.id, status);
                    }} />}
                    {allGoals.length === 0 && <p className="text-neutral-400">Review what you did, what you’re currently working on, and what you plan next.</p>}
                    <label className="flex items-center gap-2">Goal status
                        <select className={control} value={lifecycle} onChange={event => setLifecycle(event.target.value as typeof lifecycle)}>
                            <option value="active">Active</option><option value="achieved">Achieved</option><option value="dropped">Dropped</option><option value="all">All goals</option>
                        </select>
                    </label>
                    {allGoals.length > 0 && visible.length === 0 && <p>No {lifecycle} goals.</p>}
                    <DndContext id="goals-list" sensors={sensors} onDragEnd={reorder}>
                        <SortableContext items={visible.map(row => row.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2" aria-label="Goals list">
                                {visible.map(row => <GoalRow key={row.id} goal={row} consecutiveSlips={slipCount(row.id)} expanded={!!state.ui.expandedGoalIds[row.id]}
                                    cadence={tracker.cadence} period={checkInCurrent} today={today}
                                    onExpand={() => goals.setGoalExpanded(row.id, !state.ui.expandedGoalIds[row.id])}
                                    onEdit={() => setEditingGoal(row.id)} onLifecycle={value => attempt(() => goals.setGoalLifecycle(row.id, value))} />)}
                            </div>
                        </SortableContext>
                    </DndContext>
                    {edit && edit.trackerId === tracker.id && <GoalEditor key={edit.id} goal={edit} cadence={tracker.cadence} onCancel={() => setEditingGoal(null)} onSave={patch => {
                        goals.updateGoal(edit.id, patch);
                        setEditingGoal(null);
                    }} />}
                </>}
            </div>
        </main>
    </div>
        {drawerVisible && <TrackerDrawer triggerRef={drawerTriggerRef} onClose={closeDrawer}>{rail}</TrackerDrawer>}
        <div data-goals-slot="deck-preview">
            {deckPreview && deckPreview.trackerId === tracker?.id && <DeckPreview
                key={`${deckPreview.trackerId}:${deckPreview.plan.period.periodStart}:${deckPreview.plan.generatedAt}`}
                plan={deckPreview.plan}
                onClose={() => setDeckPreview(null)}
                onExport={exportDeck}
            />}
        </div>
        <div data-goals-slot="due-nudge"><GoalDueNudge today={today} /></div>
    </>;
};

function TrackerDrawer({ children, triggerRef, onClose }: React.PropsWithChildren<{
    triggerRef: React.RefObject<HTMLButtonElement | null>;
    onClose: () => void;
}>) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
            const dialog = dialogRef.current;
            if (event.key !== "Tab" || !dialog) return;
            const controls = dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
            const first = controls[0];
            const last = controls[controls.length - 1];
            const boundary = event.shiftKey ? first : last;
            if (document.activeElement === boundary || !dialog.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            triggerRef.current?.focus({ preventScroll: true });
        };
    }, [onClose, triggerRef]);

    return <div ref={dialogRef} id="goal-trackers-drawer" className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Trackers">
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-950 shadow-2xl">
            <div className="flex justify-end border-b border-neutral-800 px-3 py-2">
                <button ref={closeRef} type="button" className={button} onClick={onClose}>Close</button>
            </div>
            {children}
        </div>
    </div>;
}

function TrackerForm({ tracker, onSave, onCancel }: { tracker: GoalTracker | null; onSave: (input: NewGoalTrackerInput) => void; onCancel: () => void }) {
    const [name, setName] = useState(tracker?.name ?? "");
    const [purpose, setPurpose] = useState(tracker?.purpose ?? "");
    const [kind, setKind] = useState<GoalCadence["kind"]>(tracker?.cadence.kind ?? "every-n-weeks");
    const [weekday, setWeekday] = useState<Weekday>(tracker?.cadence.weekday ?? 0);
    const [interval, setInterval] = useState(String(tracker?.cadence.kind === "every-n-weeks" ? tracker.cadence.intervalWeeks : 1));
    const [color, setColor] = useState(tracker?.color || "#6366f1");
    const [error, setError] = useState<string | null>(null);
    return <form aria-label={tracker ? "Edit tracker" : "New tracker"} className="flex flex-wrap items-end gap-3 rounded border border-neutral-800 p-4" onSubmit={event => {
        event.preventDefault();
        try {
            if (!name.trim()) throw new RangeError("Give this tracker a name.");
            if (/[\r\n]/.test(purpose)) throw new RangeError("Purpose must be one line.");
            const cadence = normalizeGoalCadence(kind === "monthly-weekday" ? { kind, weekday } : { kind, weekday, intervalWeeks: Number(interval) });
            onSave({ name, purpose, cadence, color });
        } catch (error) { setError(errorMessage(error)); }
    }}>
        <label className="grid gap-1">Tracker name<input className={control} autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="grid gap-1">Purpose<input className={control} value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
        <label className="grid gap-1">Cadence<select className={control} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
            <option value="every-n-weeks">Every N weeks</option><option value="monthly-weekday">Monthly weekday</option>
        </select></label>
        {kind === "every-n-weeks" && <label className="grid gap-1">Every N weeks<input className={`${control} w-24`} type="number" min="1" step="1" value={interval} onChange={event => setInterval(event.target.value)} /></label>}
        <label className="grid gap-1">Weekday<select className={control} value={weekday} onChange={event => setWeekday(Number(event.target.value) as Weekday)}>
            {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
        </select></label>
        <label className="grid gap-1">Color<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
        {kind === "monthly-weekday" && <p className="w-full text-neutral-400">First selected weekday of each month; when the 1st is Monday or Tuesday, use the matching weekday on or before the 1st.</p>}
        {error && <p role="alert" className="w-full text-red-300">{error}</p>}
        <button className={primary} type="submit">{tracker ? "Save tracker" : "Create tracker"}</button>
        <button className={button} type="button" onClick={onCancel}>Cancel</button>
    </form>;
}

function QuickAdd({ first, onAdd }: { first: boolean; onAdd: (title: string, status: Goal["lifecycle"], notes: string) => void }) {
    const [title, setTitle] = useState("");
    const [status, setStatus] = useState<Goal["lifecycle"]>("active");
    const [notes, setNotes] = useState("");
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const submit = () => {
        try {
            if (!title.trim()) throw new RangeError("Give this goal a name.");
            onAdd(title, status, notes);
            setTitle(""); setStatus("active"); setNotes(""); setError(null); input.current?.focus();
        } catch (error) { setError(errorMessage(error)); }
    };
    return <form aria-label="Quick add goal" className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
    }}>
        <label className="grid flex-1 gap-1">Goal name<input ref={input} className={control} placeholder={first ? "Add your first goal" : "Add a goal"} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="grid gap-1">Status<select className={control} value={status} onChange={event => setStatus(event.target.value as typeof status)}>
            <option value="active">Active</option><option value="achieved">Achieved</option><option value="dropped">Dropped</option>
        </select></label>
        <label className="grid flex-1 gap-1">Note<input className={control} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <button className={primary} type="submit">Add goal</button>
        {error && <p className="w-full text-red-300" role="alert">{error}</p>}
    </form>;
}

function MetricBadge({ metric }: { metric: GoalMetric }) {
    const source = metric.source === "manual" ? "Manual" : metric.source === "habit" ? "Habit" : "Auto";
    return <span className="text-neutral-400">{source}{metric.source !== "habit" && metric.overridePinned ? " · Override" : ""}</span>;
}

function GoalProjectLink({ projectId }: { projectId: string }) {
    const pm = usePM();
    const project = pm.state.projects[projectId];
    return project
        ? <span className="text-xs text-neutral-400">{project.name}</span>
        : <span className="text-xs text-neutral-500">Linked project is missing</span>;
}

function GoalMetricLine({ metric, period, today, cadence }: {
    metric: GoalMetric;
    period: GoalPeriod | null;
    today: LocalDateKey;
    cadence: GoalCadence;
}) {
    if (metric.source !== "habit") {
        return <p className="mt-2" data-goals-slot="goal-metric">{metric.label}: {metric.current} / {metric.target} {metric.unit} <MetricBadge metric={metric} /></p>;
    }
    return <HabitMetricLine metric={metric} period={period} today={today} cadence={cadence} />;
}

/** The live reading is derived from habit completions; the stored `current` is never shown. */
function HabitMetricLine({ metric, period, today, cadence }: {
    metric: GoalMetric;
    period: GoalPeriod | null;
    today: LocalDateKey;
    cadence: GoalCadence;
}) {
    const habits = useHabits();
    const habit = metric.habitId ? habits.state.habits[metric.habitId] : undefined;
    const max = habit ? maxHabitMetricBuckets(cadence, habit.frequency) : null;
    const hint = habit && max !== null && Number.isFinite(metric.target) && metric.target > max
        ? cadenceHoldMessage(max, habit.frequency)
        : null;
    let body: React.ReactNode;
    if (!habits.hydrated) {
        body = <>{metric.label}: <span className="text-neutral-500">Loading habit progress…</span></>;
    } else if (!habit) {
        body = <>{metric.label}: <span className="text-neutral-500">Linked habit is missing</span></>;
    } else if (!period) {
        body = <>{metric.label}: <span className="text-neutral-500">No current period</span></>;
    } else {
        const reading = readHabitMetric(metric, [habit], Object.values(habits.state.completions), period, today);
        const unit = metric.unit ? ` ${metric.unit}` : "";
        const left = reading.partial ? ` · ${reading.daysRemaining} ${reading.daysRemaining === 1 ? "day" : "days"} left` : "";
        body = reading.unavailable
            ? <>{metric.label}: <span className="text-neutral-500">Linked habit is missing</span></>
            : <span>{metric.label}: {reading.completed} / {metric.target}{unit}{left}</span>;
    }
    return <>
        <p className="mt-2" data-goals-slot="goal-metric">{body} <MetricBadge metric={metric} /></p>
        {hint && <p className="text-xs text-amber-300" data-goals-slot="goal-metric-hint">{hint}</p>}
    </>;
}

function GoalRow({ goal, consecutiveSlips, expanded, cadence, period, today, onExpand, onEdit, onLifecycle }: {
    goal: Goal;
    consecutiveSlips: number;
    expanded: boolean;
    cadence: GoalCadence;
    period: GoalPeriod | null;
    today: LocalDateKey;
    onExpand: () => void;
    onEdit: () => void;
    onLifecycle: (value: Goal["lifecycle"]) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: goal.id });
    return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="rounded border border-neutral-800 bg-neutral-900/30 p-3" aria-label={goal.title}>
        <div className="flex flex-wrap items-center gap-3">
            <button className={button} {...attributes} {...listeners} aria-label={`Reorder ${goal.title}`}>⠿</button>
            <h3 className="flex-1 font-medium">{goal.title}</h3>
            {goal.projectId !== null && <GoalProjectLink projectId={goal.projectId} />}
            <GoalStatusBadge lifecycle={goal.lifecycle} />
            <span data-goals-slot="goal-slip" data-goal-id={goal.id}><GoalSlipBadge consecutiveSlips={consecutiveSlips} /></span>
            <button className={button} onClick={onExpand} aria-expanded={expanded}>{expanded ? "Hide details" : "Show details"}</button>
            <button className={button} onClick={onEdit}>Edit goal</button>
            {goal.lifecycle === "active" ? <>
                <button className={achieveButton} onClick={() => onLifecycle("achieved")}>Achieve</button>
                <button className={dropButton} onClick={() => onLifecycle("dropped")}>Drop</button>
            </> : <button className={button} onClick={() => onLifecycle("active")}>Reactivate</button>}
        </div>
        {goal.metric && <GoalMetricLine metric={goal.metric} period={period} today={today} cadence={cadence} />}
        {expanded && <p className="mt-2 whitespace-pre-wrap text-neutral-400">{goal.notes || "No note."}</p>}
    </article>;
}

function GoalEditor({ goal, cadence, onSave, onCancel }: { goal: Goal; cadence: GoalCadence; onSave: (patch: Partial<Goal>) => void; onCancel: () => void }) {
    const pm = usePM();
    const habits = useHabits();
    const projects = Object.values(pm.state.projects).sort((left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const [title, setTitle] = useState(goal.title);
    const [notes, setNotes] = useState(goal.notes);
    const [projectId, setProjectId] = useState(goal.projectId ?? "");
    const missingProject = goal.projectId !== null && !projects.some(project => project.id === goal.projectId);
    const [metric, setMetric] = useState(goal.metric !== null);
    const [label, setLabel] = useState(goal.metric?.label ?? "");
    const [current, setCurrent] = useState(String(goal.metric?.current ?? 0));
    const [target, setTarget] = useState(String(goal.metric?.target ?? 0));
    const [unit, setUnit] = useState(goal.metric?.unit ?? "");
    const [source, setSource] = useState<GoalMetric["source"]>(goal.metric?.source ?? "manual");
    const [sourceTouched, setSourceTouched] = useState(false);
    const [habitId, setHabitId] = useState(goal.metric?.source === "habit" ? goal.metric.habitId ?? "" : "");
    const [error, setError] = useState<string | null>(null);
    // A save attempt escalates the live cadence hint instead of stacking a second message.
    const [attemptedUnreachable, setAttemptedUnreachable] = useState(false);
    // Linked habits stay visible even after archiving; only fresh options are active.
    const habitOptions = orderedHabits(habits.state.habits).filter(habit => !habit.isArchived || habit.id === habitId);
    const selectedHabit = habitId ? habits.state.habits[habitId] : undefined;
    const targetValue = target.trim() === "" ? Number.NaN : Number(target);
    const maxBuckets = selectedHabit ? maxHabitMetricBuckets(cadence, selectedHabit.frequency) : null;
    const unreachable = selectedHabit && maxBuckets !== null && Number.isFinite(targetValue) && targetValue > maxBuckets
        ? cadenceHoldMessage(maxBuckets, selectedHabit.frequency)
        : null;
    function changeSource(next: GoalMetric["source"]) {
        if (next === source) return;
        // A source change never carries the other source's stored reading forward.
        setCurrent("0");
        setSourceTouched(true);
        setSource(next);
        if (next !== "habit") setHabitId("");
    }
    function chooseHabit(nextId: string) {
        const next = habits.state.habits[nextId];
        setHabitId(nextId);
        setAttemptedUnreachable(false);
        if (!next) return;
        const previous = habits.state.habits[habitId];
        // Only default the label while it is empty or untouched from the prior habit.
        if (!label.trim() || (previous !== undefined && label === previous.name)) setLabel(next.name);
        setUnit(habitUnitSuggestion(next.frequency));
    }
    return <form aria-label="Edit goal" className="space-y-3 rounded border border-neutral-800 p-4" onSubmit={event => {
        event.preventDefault();
        try {
            if (!title.trim()) throw new RangeError("Give this goal a name.");
            let nextMetric: GoalMetric | null = null;
            if (metric && source === "habit") {
                if (!label.trim() || !target.trim() || !Number.isFinite(Number(target))) throw new RangeError("Metric needs a label and a finite target value.");
                const habit = habits.state.habits[habitId];
                if (!habit) throw new RangeError("Choose a habit for this metric.");
                const max = maxHabitMetricBuckets(cadence, habit.frequency);
                if (Number(target) > max) {
                    // Reuse the visible hint as the error state; never duplicate the message.
                    setError(null);
                    setAttemptedUnreachable(true);
                    return;
                }
                nextMetric = { label: label.trim(), current: 0, target: Number(target), unit, source: "habit", habitId: habit.id, overridePinned: false };
            } else if (metric) {
                if (!label.trim() || !current.trim() || !target.trim() || !Number.isFinite(Number(current)) || !Number.isFinite(Number(target))) throw new RangeError("Metric needs a label and finite current and target values.");
                nextMetric = { label: label.trim(), current: Number(current), target: Number(target), unit, source, overridePinned: !sourceTouched && source === goal.metric?.source ? goal.metric.overridePinned : false };
            }
            onSave({ title, notes, projectId: projectId || null, metric: nextMetric });
        } catch (error) { setError(errorMessage(error)); }
    }}>
        <h3 className="font-medium">Edit goal</h3>
        <label className="grid gap-1">Name<input className={control} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="grid gap-1">Goal note<textarea className={control} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <label className="grid gap-1">Project<select className={control} aria-label="Project" value={projectId} onChange={event => setProjectId(event.target.value)}>
            <option value="">No project</option>
            {missingProject && <option value={goal.projectId!}>Missing project</option>}
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={metric} onChange={event => setMetric(event.target.checked)} />Track one metric</label>
        {metric && <fieldset className="flex flex-wrap gap-3"><legend className="mb-2">Metric {goal.metric && <MetricBadge metric={goal.metric} />}</legend>
            <label className="grid gap-1">Metric label<input className={control} value={label} onChange={event => setLabel(event.target.value)} /></label>
            {source !== "habit" && <label className="grid gap-1">Current<input className={`${control} w-28`} type="number" step="any" value={current} onChange={event => setCurrent(event.target.value)} /></label>}
            <label className="grid gap-1">Target<input className={`${control} w-28`} type="number" step="any" value={target} onChange={event => { setTarget(event.target.value); setAttemptedUnreachable(false); }} /></label>
            <label className="grid gap-1">Unit<input className={control} value={unit} onChange={event => setUnit(event.target.value)} /></label>
            <label className="grid gap-1">Source<select className={control} value={source} onChange={event => changeSource(event.target.value as typeof source)}>
                <option value="manual">Manual</option>
                <option value="habit">Habit</option>
                {goal.metric?.source === "liftingtracker" && <option value="liftingtracker" disabled>Auto</option>}
            </select></label>
            {source === "habit" && <>
                <label className="grid gap-1">Habit<select className={control} value={habitId} onChange={event => chooseHabit(event.target.value)}>
                    <option value="">Select a habit</option>
                    {habitOptions.map(habit => {
                        const habitMax = maxHabitMetricBuckets(cadence, habit.frequency);
                        const impossible = Number.isFinite(targetValue) && targetValue > habitMax;
                        return <option key={habit.id} value={habit.id} disabled={impossible}>
                            {habit.name}{habit.isArchived ? " (archived)" : ""}{impossible ? ` (max ${habitMax} ${habitUnitWord(habitMax, habit.frequency)} for this cadence)` : ""}
                        </option>;
                    })}
                </select></label>
                {unreachable && <p role={attemptedUnreachable ? "alert" : undefined} className={`w-full text-xs ${attemptedUnreachable ? "font-semibold text-red-300" : "text-amber-300"}`} data-goals-slot="goal-metric-hint">{unreachable}</p>}
                <p className="w-full text-xs text-neutral-500">Current progress is counted from this habit's completions in each goal period.</p>
            </>}
        </fieldset>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <div className="flex gap-2"><button className={primary} type="submit">Save goal</button><button className={button} type="button" onClick={onCancel}>Cancel</button></div>
    </form>;
}
