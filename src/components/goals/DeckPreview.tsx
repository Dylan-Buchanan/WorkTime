import React, { useRef, useState } from "react";
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { runDeckPolishWorkflow } from "../../lib/agent/deckPolishWorkflow";
import { findDeckCopyChanges, type DeckSlideCopyChange } from "../../lib/goals/deck/copyChanges";
import { periodLabel, periodRangeLabel } from "../../lib/goals/periods";
import {
    estimateDeck,
    moveGoalToAppendix,
    moveGoalToBody,
    moveSlide,
    refreshDeckDerivations,
    setSlideHidden,
} from "../../lib/goals/deck/plan";
import type {
    DeckAppendixEntry,
    DeckCommitment,
    DeckMissItem,
    DeckPlan,
    DeckPlanItem,
    DeckRecapSlide,
    DeckSlide,
    DeckThinWarning,
} from "../../lib/goals/deck/types";

export interface DeckPreviewProps {
    plan: DeckPlan;
    onClose: () => void;
    onExport: (plan: DeckPlan) => void | Promise<void>;
}

const KIND_LABELS: Readonly<Record<DeckSlide["kind"], string>> = {
    title: "Title",
    recap: "Recap",
    misses: "Misses",
    "next-plans": "Next plans",
    progress: "Progress",
    closing: "Closing",
    appendix: "Appendix",
};

const STATUS_LABELS: Readonly<Record<DeckRecapSlide["statusPill"], string>> = {
    "on-track": "On track",
    "at-risk": "At risk",
    blocked: "Blocked",
};

const toolbarButton =
    "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40";
const editInput =
    "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40";
const editTextarea =
    "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40";

const IMPROVE_PRESENTATION_PROMPT = [
    "Improve the language and presentation of this PowerPoint so it is fun to read and engaging to hear presented aloud.",
    "Use concise, punchy headlines and clear, scannable slide copy with active verbs, varied phrasing, and a warm, conversational tone.",
    "Give the review a cohesive story: make progress, blockers, and next steps easy to follow, and reduce repetition and jargon.",
    "Write speaker notes as natural spoken narration with smooth transitions and a lively rhythm, rather than simply reading the slide text back.",
    "Use light, playful phrasing where appropriate, while keeping risks and setbacks candid and respectful.",
    "Preserve all facts, numbers, uncertainty, commitments, and missing information. Do not invent achievements, examples, or explanations.",
    "Keep the existing slide structure and order, and keep the presentation concise.",
].join(" ");

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "Unable to update the deck.";

const clock = (totalSeconds: number): string =>
    `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;

const isRecapSlide = (slide: DeckSlide): slide is DeckRecapSlide => slide.kind === "recap";

interface SlideCardProps {
    slide: DeckSlide;
    selected: boolean;
    polished?: boolean;
    registerRef: (node: HTMLElement | null) => void;
    style?: React.CSSProperties;
    dragHandle?: React.ReactNode;
    controls: React.ReactNode;
    onTitleChange: (value: string) => void;
    onNotesChange: (value: string) => void;
    children: React.ReactNode;
}

const SlideCard: React.FC<SlideCardProps> = ({
    slide,
    selected,
    polished,
    registerRef,
    style,
    dragHandle,
    controls,
    onTitleChange,
    onNotesChange,
    children,
}) => (
    <article
        ref={registerRef}
        style={style}
        aria-label={`Slide: ${slide.title}`}
        aria-current={selected ? "true" : undefined}
        data-deck-slide-id={slide.id}
        className={`rounded-xl border bg-neutral-900/40 p-3 transition-colors ${
            selected ? "border-indigo-400 ring-2 ring-indigo-400/40" : "border-neutral-800"
        }`}
    >
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
            <span className="rounded-full border border-neutral-700 px-2 py-0.5 uppercase tracking-wide text-neutral-400">
                {KIND_LABELS[slide.kind]}
            </span>
            {polished && <span className="rounded-full bg-indigo-950 px-2 py-0.5 text-indigo-200">Changed by latest polish</span>}
            {dragHandle}
            <div className="ml-auto flex flex-wrap items-center gap-1">{controls}</div>
        </div>
        <div className="theme-static aspect-video overflow-auto rounded-lg bg-stone-50 p-4 text-neutral-900 shadow-inner sm:p-6">
            <label className="block">
                <span className="sr-only">Slide title</span>
                <input
                    aria-label="Slide title"
                    className="w-full bg-transparent text-xl font-semibold leading-tight text-neutral-900 outline-none focus:bg-amber-50 sm:text-2xl"
                    value={slide.title}
                    onChange={event => onTitleChange(event.target.value)}
                />
            </label>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-800 sm:text-base">
                {children}
            </div>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex-1 text-[11px] text-neutral-300">
                Speaker notes
                <textarea
                    aria-label="Speaker notes"
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-xs leading-relaxed text-neutral-100"
                    rows={2}
                    value={slide.notes}
                    onChange={event => onNotesChange(event.target.value)}
                />
            </label>
            <p className="whitespace-nowrap text-[11px] text-neutral-400">
                Suggested time: <strong className="text-neutral-200">{slide.suggestedSeconds}s</strong>
            </p>
        </div>
    </article>
);

interface SortableRecapCardProps extends SlideCardProps {
    slide: DeckRecapSlide;
}

const SortableRecapCard: React.FC<SortableRecapCardProps> = props => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.slide.id,
    });
    return (
        <SlideCard
            {...props}
            registerRef={node => {
                setNodeRef(node);
                props.registerRef(node);
            }}
            style={{
                ...props.style,
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.7 : undefined,
            }}
            dragHandle={
                <button
                    type="button"
                    className={toolbarButton}
                    aria-label={`Reorder ${props.slide.title}`}
                    {...attributes}
                    {...listeners}
                >
                    ⠿
                </button>
            }
        />
    );
};

const StaticSlideCard: React.FC<SlideCardProps> = props => <SlideCard {...props} />;

/**
 * In-memory deck preview. The local plan copy starts from the supplied plan,
 * every edit uses the deterministic deck helpers, and nothing is persisted.
 */
export const DeckPreview: React.FC<DeckPreviewProps> = ({ plan, onClose, onExport }) => {
    const [currentPlan, setCurrentPlan] = useState<DeckPlan>(() => plan);
    const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
    const [skippedWarningIds, setSkippedWarningIds] = useState<ReadonlySet<string>>(() => new Set());
    const [exporting, setExporting] = useState(false);
    const [deckPrompt, setDeckPrompt] = useState("");
    const [polishing, setPolishing] = useState(false);
    const [polishChanges, setPolishChanges] = useState<DeckSlideCopyChange[] | null>(null);
    const [polishMessage, setPolishMessage] = useState<string | null>(null);
    const [polishFailure, setPolishFailure] = useState<string | null>(null);
    const [focusSuggestion, setFocusSuggestion] = useState<string[] | null>(null);
    const [adjustingFocus, setAdjustingFocus] = useState(false);
    const [adjustedFocus, setAdjustedFocus] = useState<string[]>([]);
    const polishActive = useRef(false);
    const polishRunId = useRef(0);
    const [error, setError] = useState<string | null>(null);
    const slideRefs = useRef<Record<string, HTMLElement | null>>({});
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const estimate = estimateDeck(currentPlan);
    const recapSlides = currentPlan.slides.filter(isRecapSlide);
    const visibleSlides = currentPlan.slides.filter(slide =>
        !slide.isHidden && !(isRecapSlide(slide) && slide.placement === "appendix"));
    const hiddenSlides = currentPlan.slides.filter(slide => slide.isHidden);
    const visibleRecapIds = visibleSlides.filter(isRecapSlide).map(slide => slide.id);
    const visibleWarnings = currentPlan.warnings.filter(warning => !skippedWarningIds.has(warning.id));
    const recapByGoalId = new Map(recapSlides.map(slide => [slide.goalId, slide]));
    const polishedSlideIds = new Set(polishChanges?.map(change => change.slideId));

    async function polishDeck(prompt = deckPrompt) {
        if (polishActive.current || exporting) return;
        polishActive.current = true;
        const runId = ++polishRunId.current;
        setPolishing(true);
        setPolishMessage("Polishing…");
        setPolishFailure(null);
        setFocusSuggestion(null);
        setAdjustingFocus(false);
        try {
            const result = await runDeckPolishWorkflow({
                plan: currentPlan,
                prompt,
                onProgress: event => {
                    if (runId === polishRunId.current && event.phase === "validating-copy") setPolishMessage("Checking polished copy…");
                },
            });
            if (runId !== polishRunId.current) return;
            setCurrentPlan(result.plan);
            if (result.outcome === "polished") {
                setPolishChanges(findDeckCopyChanges(currentPlan, result.plan));
                setSkippedWarningIds(new Set());
                setFocusSuggestion(result.suggestedFocusGoalIds.length ? result.suggestedFocusGoalIds : null);
                setAdjustedFocus(result.suggestedFocusGoalIds);
                setPolishMessage("Copy polished. Review and edit it below before exporting.");
            } else {
                setPolishFailure(result.failure
                    ? `${result.failure.provider} · ${result.failure.model}: ${result.failure.message}` : null);
                setPolishMessage(result.outcome === "no-key"
                    ? "No saved agent key. Your deck is ready to edit and export as usual."
                    : "Polish was unavailable. Your copy is unchanged and ready to edit and export.");
            }
        } finally {
            if (runId === polishRunId.current) {
                polishActive.current = false;
                setPolishing(false);
            }
        }
    }

    function applyFocus(goalIds: readonly string[]) {
        const selected = new Set(goalIds);
        setCurrentPlan(current => refreshDeckDerivations({
            ...current,
            slides: current.slides.map(slide => slide.kind === "recap"
                ? { ...slide, placement: selected.has(slide.goalId) ? "body" : "appendix" }
                : slide),
        }));
        setFocusSuggestion(null);
        setAdjustingFocus(false);
    }

    function registerSlideRef(slideId: string): (node: HTMLElement | null) => void {
        return node => {
            slideRefs.current[slideId] = node;
        };
    }

    function selectSlide(slideId: string) {
        setSelectedSlideId(slideId);
        const node = slideRefs.current[slideId];
        if (node && typeof node.scrollIntoView === "function") {
            node.scrollIntoView({ block: "start", behavior: "smooth" });
        }
    }

    function updateSlide(slideId: string, update: (slide: DeckSlide) => DeckSlide) {
        setCurrentPlan(current => refreshDeckDerivations({
            ...current,
            slides: current.slides.map(slide => slide.id === slideId ? update(slide) : slide),
        }));
        setError(null);
    }

    function setSlideTitle(slideId: string, title: string) {
        updateSlide(slideId, slide => ({ ...slide, title }));
    }

    function setSlideNotes(slideId: string, notes: string) {
        updateSlide(slideId, slide => ({ ...slide, notes }));
    }

    function setTitlePurpose(slideId: string, purpose: string) {
        updateSlide(slideId, slide => slide.kind === "title" ? { ...slide, purpose } : slide);
    }

    function setRecapField(
        slideId: string,
        patch: Partial<Pick<DeckRecapSlide, "did" | "current" | "missReason">>,
    ) {
        updateSlide(slideId, slide => slide.kind === "recap" ? { ...slide, ...patch } : slide);
    }

    function setRecapPlannedText(slideId: string, index: number, text: string) {
        updateSlide(slideId, slide => slide.kind !== "recap"
            ? slide
            : {
                ...slide,
                planned: slide.planned.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, text } : item),
            });
    }

    function setMissItem(slideId: string, index: number, patch: Partial<Pick<DeckMissItem, "text" | "reason">>) {
        updateSlide(slideId, slide => slide.kind !== "misses"
            ? slide
            : {
                ...slide,
                items: slide.items.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, ...patch } : item),
            });
    }

    function setNextPlanItem(slideId: string, index: number, patch: Partial<Pick<DeckPlanItem, "text">>) {
        updateSlide(slideId, slide => slide.kind !== "next-plans"
            ? slide
            : {
                ...slide,
                items: slide.items.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, ...patch } : item),
            });
    }

    function setCommitment(slideId: string, index: number, patch: Partial<Pick<DeckCommitment, "text">>) {
        updateSlide(slideId, slide => slide.kind !== "closing"
            ? slide
            : {
                ...slide,
                commitments: slide.commitments.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, ...patch } : item),
            });
    }

    function setAppendixEntry(
        goalId: string,
        patch: Partial<Pick<DeckAppendixEntry, "goalTitle" | "metricText">>,
    ) {
        setCurrentPlan(current => {
            const existing = current.appendixEntriesByGoal[goalId];
            if (!existing) return current;
            return refreshDeckDerivations({
                ...current,
                appendixEntriesByGoal: {
                    ...current.appendixEntriesByGoal,
                    [goalId]: { ...existing, ...patch },
                },
            });
        });
        setError(null);
    }

    function setHidden(slideId: string, hidden: boolean) {
        try {
            setCurrentPlan(setSlideHidden(currentPlan, slideId, hidden));
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    function moveRecap(slideId: string, direction: "up" | "down") {
        try {
            setCurrentPlan(moveSlide(currentPlan, slideId, direction));
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    function promote(goalId: string) {
        try {
            setCurrentPlan(moveGoalToAppendix(currentPlan, goalId));
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    function demote(goalId: string) {
        try {
            setCurrentPlan(moveGoalToBody(currentPlan, goalId));
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    function handleDragEnd(event: DragEndEvent) {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : null;
        if (!overId || activeId === overId) return;
        const from = currentPlan.slides.findIndex(slide => slide.id === activeId);
        const to = currentPlan.slides.findIndex(slide => slide.id === overId);
        if (from < 0 || to < 0 || from === to) return;
        if (currentPlan.slides[from].kind !== "recap" || currentPlan.slides[to].kind !== "recap") return;
        try {
            let next = currentPlan;
            for (let guard = 0; guard < currentPlan.slides.length; guard += 1) {
                const index = next.slides.findIndex(slide => slide.id === activeId);
                if (index === to) break;
                next = moveSlide(next, activeId, index < to ? "down" : "up");
            }
            setCurrentPlan(next);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    async function runExport() {
        if (exporting || polishing) return;
        setExporting(true);
        setError(null);
        try {
            await onExport(currentPlan);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Export failed. Please try again.");
        } finally {
            setExporting(false);
        }
    }

    function fixWarning(warning: DeckThinWarning) {
        let targetId = warning.goalId ? `recap:${warning.goalId}` : "title";
        if (warning.kind === "miss-without-reason") {
            targetId = "misses";
        } else if (warning.kind === "empty-period") {
            targetId = recapSlides.find(slide => slide.placement === "body")?.id ?? "title";
        } else if (warning.goalId) {
            const recap = recapByGoalId.get(warning.goalId);
            targetId = recap && recap.placement === "appendix" ? "appendix" : recap?.id ?? "appendix";
        }
        selectSlide(targetId);
    }

    function renderMoveButtons(slide: DeckRecapSlide) {
        const index = recapSlides.findIndex(row => row.id === slide.id);
        return <>
            <button
                type="button"
                className={toolbarButton}
                aria-label={`Move ${slide.title} up`}
                disabled={index <= 0}
                onClick={() => moveRecap(slide.id, "up")}
            >
                Move up
            </button>
            <button
                type="button"
                className={toolbarButton}
                aria-label={`Move ${slide.title} down`}
                disabled={index < 0 || index >= recapSlides.length - 1}
                onClick={() => moveRecap(slide.id, "down")}
            >
                Move down
            </button>
        </>;
    }

    function renderPlacementButton(slide: DeckRecapSlide, label = slide.title) {
        return slide.placement === "body"
            ? <button
                type="button"
                className={toolbarButton}
                aria-label={`Promote ${label} to appendix`}
                onClick={() => promote(slide.goalId)}
            >
                Promote to appendix
            </button>
            : <button
                type="button"
                className={toolbarButton}
                aria-label={`Demote ${label} to body`}
                onClick={() => demote(slide.goalId)}
            >
                Demote to body
            </button>;
    }

    function renderVisibleControls(slide: DeckSlide) {
        return <>
            {isRecapSlide(slide) && <>
                {renderMoveButtons(slide)}
                {renderPlacementButton(slide)}
            </>}
            <button
                type="button"
                className={toolbarButton}
                aria-label={`Hide slide: ${slide.title}`}
                onClick={() => setHidden(slide.id, true)}
            >
                Hide slide
            </button>
        </>;
    }

    function renderSlideBody(slide: DeckSlide) {
        switch (slide.kind) {
            case "title":
                return <div className="space-y-2">
                    <p className="text-sm font-medium text-neutral-700">{slide.trackerName}</p>
                    <p className="text-sm text-neutral-600">{slide.periodLabel} · {slide.periodRangeLabel}</p>
                    <label className="block text-xs font-medium text-neutral-600">
                        Purpose
                        <textarea
                            aria-label="Purpose"
                            className={`mt-1 ${editTextarea}`}
                            rows={2}
                            value={slide.purpose}
                            onChange={event => setTitlePurpose(slide.id, event.target.value)}
                        />
                    </label>
                </div>;
            case "recap":
                return <div className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-neutral-300 bg-white px-2 py-0.5">
                            {STATUS_LABELS[slide.statusPill]}
                        </span>
                        <span className="rounded-full border border-neutral-300 bg-white px-2 py-0.5">
                            {slide.placement === "appendix" ? "Appendix placement" : "Full recap"}
                        </span>
                        {slide.achievedInPeriod && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                            Achieved this period
                        </span>}
                        {slide.slipBadge && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800">
                            {slide.slipCount} consecutive slips
                        </span>}
                    </div>
                    {slide.metric && <p className="text-sm text-neutral-600">
                        Metric: {slide.metric.label} · {slide.metric.current} / {slide.metric.target} {slide.metric.unit}
                    </p>}
                    <label className="block text-xs font-medium text-neutral-600">
                        Did
                        <textarea
                            aria-label="Did"
                            className={`mt-1 ${editTextarea}`}
                            rows={2}
                            value={slide.did}
                            onChange={event => setRecapField(slide.id, { did: event.target.value })}
                        />
                    </label>
                    <label className="block text-xs font-medium text-neutral-600">
                        Current
                        <textarea
                            aria-label="Current"
                            className={`mt-1 ${editTextarea}`}
                            rows={2}
                            value={slide.current}
                            onChange={event => setRecapField(slide.id, { current: event.target.value })}
                        />
                    </label>
                    <fieldset>
                        <legend className="text-xs font-medium text-neutral-600">Planned next</legend>
                        {slide.planned.length === 0
                            ? <p className="text-sm text-neutral-500">No planned items.</p>
                            : <ul className="space-y-2">
                                {slide.planned.map((item, index) => <li key={`${slide.id}:plan:${index}`} className="flex flex-wrap items-end gap-2">
                                    <label className="min-w-0 flex-1 text-xs font-medium text-neutral-600">
                                        Planned item {index + 1}
                                        <input
                                            aria-label={`Planned item ${index + 1}`}
                                            className={`mt-1 ${editInput}`}
                                            value={item.text}
                                            onChange={event => setRecapPlannedText(slide.id, index, event.target.value)}
                                        />
                                    </label>
                                    {item.dueDate && <span className="pb-1 text-xs text-neutral-500">Due {item.dueDate}</span>}
                                </li>)}
                            </ul>}
                    </fieldset>
                    <label className="block text-xs font-medium text-neutral-600">
                        Miss reason
                        <textarea
                            aria-label="Miss reason"
                            className={`mt-1 ${editTextarea}`}
                            rows={2}
                            value={slide.missReason}
                            onChange={event => setRecapField(slide.id, { missReason: event.target.value })}
                        />
                    </label>
                    {slide.evidenceTaskTitles.length > 0 && <div>
                        <p className="text-xs font-medium text-neutral-600">Evidence</p>
                        <ul className="list-disc pl-5 text-sm text-neutral-700">
                            {slide.evidenceTaskTitles.map((title, index) =>
                                <li key={`${slide.id}:evidence:${index}`}>{title}</li>)}
                        </ul>
                    </div>}
                </div>;
            case "misses":
                return <fieldset>
                    <legend className="text-xs font-medium text-neutral-600">Missed plans</legend>
                    {slide.items.length === 0
                        ? <p className="text-sm text-neutral-500">No missed plans recorded.</p>
                        : <ul className="space-y-2">
                            {slide.items.map((item, index) => <li
                                key={`${slide.id}:miss:${index}`}
                                role="group"
                                aria-label={`Miss item ${index + 1}`}
                                className="rounded border border-neutral-200 bg-white/60 p-2"
                            >
                                <p className="text-xs font-medium text-neutral-500">{item.goalTitle}</p>
                                <label className="mt-1 block text-xs font-medium text-neutral-600">
                                    Miss text
                                    <input
                                        aria-label="Miss text"
                                        className={`mt-1 ${editInput}`}
                                        value={item.text}
                                        onChange={event => setMissItem(slide.id, index, { text: event.target.value })}
                                    />
                                </label>
                                {item.dueDate && <p className="mt-1 text-xs text-neutral-500">Due {item.dueDate}</p>}
                                <label className="mt-1 block text-xs font-medium text-neutral-600">
                                    Reason
                                    <textarea
                                        aria-label="Reason"
                                        className={`mt-1 ${editTextarea}`}
                                        rows={2}
                                        value={item.reason}
                                        onChange={event => setMissItem(slide.id, index, { reason: event.target.value })}
                                    />
                                </label>
                            </li>)}
                        </ul>}
                </fieldset>;
            case "next-plans":
                return <fieldset>
                    <legend className="text-xs font-medium text-neutral-600">Next plans</legend>
                    {slide.items.length === 0
                        ? <p className="text-sm text-neutral-500">No plans recorded.</p>
                        : <ul className="space-y-2">
                            {slide.items.map((item, index) => <li
                                key={`${slide.id}:plan:${index}`}
                                role="group"
                                aria-label={`Next plan ${index + 1}`}
                                className="rounded border border-neutral-200 bg-white/60 p-2"
                            >
                                <p className="text-xs font-medium text-neutral-500">{item.goalTitle}</p>
                                <label className="mt-1 block text-xs font-medium text-neutral-600">
                                    Plan text
                                    <input
                                        aria-label="Plan text"
                                        className={`mt-1 ${editInput}`}
                                        value={item.text}
                                        onChange={event => setNextPlanItem(slide.id, index, { text: event.target.value })}
                                    />
                                </label>
                                {item.dueDate && <p className="mt-1 text-xs text-neutral-500">Due {item.dueDate}</p>}
                            </li>)}
                        </ul>}
                </fieldset>;
            case "progress":
                return <div className="space-y-2">
                    <p className="text-xs font-medium text-neutral-600">Status history</p>
                    {slide.series.length === 0
                        ? <p className="text-sm text-neutral-500">No status history is available yet.</p>
                        : <ul className="space-y-2">
                            {slide.series.map(series => <li key={`${slide.id}:series:${series.goalId}`} className="rounded border border-neutral-200 bg-white/60 p-2">
                                <p className="text-sm font-medium">{series.goalTitle}</p>
                                <p className="text-xs text-neutral-500">{series.label}{series.unit ? ` (${series.unit})` : ""}</p>
                                <p className="text-xs text-neutral-600">
                                    {series.points.map(point => `${point.periodStart}: ${point.value}`).join(" · ")}
                                </p>
                            </li>)}
                        </ul>}
                </div>;
            case "closing":
                return <fieldset>
                    <legend className="text-xs font-medium text-neutral-600">Commitments</legend>
                    <ul className="space-y-2">
                        {slide.commitments.map((item, index) => <li
                            key={`${slide.id}:commitment:${index}`}
                            role="group"
                            aria-label={`Commitment ${index + 1}`}
                            className="rounded border border-neutral-200 bg-white/60 p-2"
                        >
                            {item.goalTitle && <p className="text-xs font-medium text-neutral-500">{item.goalTitle}</p>}
                            <label className="mt-1 block text-xs font-medium text-neutral-600">
                                Commitment text
                                <input
                                    aria-label="Commitment text"
                                    className={`mt-1 ${editInput}`}
                                    value={item.text}
                                    onChange={event => setCommitment(slide.id, index, { text: event.target.value })}
                                />
                            </label>
                        </li>)}
                    </ul>
                </fieldset>;
            case "appendix":
                return <fieldset>
                    <legend className="text-xs font-medium text-neutral-600">Appendix roster</legend>
                    {slide.entries.length === 0
                        ? <p className="text-sm text-neutral-500">No goals are in the appendix.</p>
                        : <ul className="space-y-2">
                            {slide.entries.map(entry => {
                                const recap = recapByGoalId.get(entry.goalId);
                                return <li
                                    key={`${slide.id}:appendix:${entry.goalId}`}
                                    role="group"
                                    aria-label={`Appendix entry ${entry.goalTitle}`}
                                    className="rounded border border-neutral-200 bg-white/60 p-2"
                                >
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                                        <span>{STATUS_LABELS[entry.statusPill]}</span>
                                        {entry.slipCount >= 2 && <span>{entry.slipCount} consecutive slips</span>}
                                    </div>
                                    <label className="mt-1 block text-xs font-medium text-neutral-600">
                                        Goal title
                                        <input
                                            aria-label="Appendix goal title"
                                            className={`mt-1 ${editInput}`}
                                            value={entry.goalTitle}
                                            onChange={event => setAppendixEntry(entry.goalId, { goalTitle: event.target.value })}
                                        />
                                    </label>
                                    <label className="mt-1 block text-xs font-medium text-neutral-600">
                                        Metric text
                                        <input
                                            aria-label="Appendix metric text"
                                            className={`mt-1 ${editInput}`}
                                            value={entry.metricText ?? ""}
                                            onChange={event => setAppendixEntry(entry.goalId, {
                                                metricText: event.target.value === "" ? null : event.target.value,
                                            })}
                                        />
                                    </label>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {recap && renderPlacementButton(recap, entry.goalTitle)}
                                        {recap && <button
                                            type="button"
                                            className={toolbarButton}
                                            aria-label={`Hide slide: ${entry.goalTitle}`}
                                            onClick={() => setHidden(entry.recapSlideId, true)}
                                        >
                                            Hide slide
                                        </button>}
                                    </div>
                                </li>;
                            })}
                        </ul>}
                </fieldset>;
        }
    }

    // The preview is a full-height surface with its own scroller. Mounting it in
    // normal flow would push it past the page box (the goals page is a
    // fixed-height flex column whose only scroller is <main>), so the deck would
    // be clipped instead of reachable.
    return <section
        aria-label="Deck preview"
        className="app-scrollbar fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-neutral-950 text-neutral-100"
    >
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-3 sm:p-6">
            <header className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">{currentPlan.trackerName} deck preview</h1>
                    <p className="text-sm text-neutral-400">
                        {periodLabel(currentPlan.period)} · {periodRangeLabel(currentPlan.period)}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={toolbarButton} onClick={onClose}>Close preview</button>
                    {polishing && <button type="button" className={toolbarButton} onClick={() => {
                        polishRunId.current += 1;
                        polishActive.current = false;
                        setPolishing(false);
                        setPolishMessage("Polish skipped. Your copy is unchanged and ready to edit and export.");
                    }}>Skip polish</button>}
                    <button
                        type="button"
                        className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                        disabled={exporting || polishing}
                        onClick={() => { void runExport(); }}
                    >
                        {exporting ? "Exporting…" : "Export deck"}
                    </button>
                </div>
            </header>

            <fieldset disabled={polishing || exporting} className="min-w-0 space-y-4">
            <section aria-label="Optional deck polish" className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <h2 className="text-sm font-semibold">Optional deck polish</h2>
                <p className="text-xs text-neutral-400">Uses your saved agent provider and key to polish copy and suggest focus goals. The deck is complete without it.</p>
                <section aria-label="Presentation preset" className="space-y-2 rounded-lg border border-indigo-800 bg-indigo-950/30 p-3">
                    <h3 className="text-sm font-semibold text-indigo-200">Presentation preset</h3>
                    <p id="presentation-preset-description" className="text-xs text-neutral-300">
                        Make slide wording more engaging and speaker notes sound natural aloud. Runs immediately using a preset brief, which appears in the prompt below.
                    </p>
                    <button type="button" className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50" aria-describedby="presentation-preset-description" onClick={() => {
                        setDeckPrompt(IMPROVE_PRESENTATION_PROMPT);
                        void polishDeck(IMPROVE_PRESENTATION_PROMPT);
                    }}>Improve my presentation</button>
                </section>
                <section aria-label="Custom deck polish" className="space-y-2 rounded-lg border border-neutral-700 p-3">
                    <h3 className="text-sm font-semibold">Use your own instructions</h3>
                    <p className="text-xs text-neutral-400">Enter or edit the deck-level prompt, then select Polish deck to apply it.</p>
                    <label className="block text-sm">Deck-level prompt
                        <textarea className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 p-2 text-sm" rows={2}
                            placeholder="For example: use a concise, candid tone and emphasize blockers."
                            value={deckPrompt} onChange={event => setDeckPrompt(event.target.value)} />
                    </label>
                    <button type="button" className={toolbarButton} onClick={() => { void polishDeck(); }}>
                        {polishing ? "Polishing…" : "Polish deck"}
                    </button>
                </section>
                {polishMessage && <p role="status" className="text-sm text-neutral-300">{polishMessage}</p>}
                {polishFailure && <details className="text-xs text-neutral-400">
                    <summary className="cursor-pointer">Polish details</summary>
                    <p className="mt-1">{polishFailure}</p>
                </details>}
                {polishChanges && <section aria-label="Latest polish changes" className="space-y-2 rounded border border-indigo-800 p-3">
                    <h3 className="text-sm font-semibold">Latest polish changes</h3>
                    <p className="text-xs text-neutral-400">Compared with the deck immediately before the most recent successful pass.</p>
                    {polishChanges.length === 0
                        ? <p className="text-sm">No copy changes in the latest polish.</p>
                        : <>
                            <p className="text-sm">Changed {polishChanges.length} {polishChanges.length === 1 ? "slide" : "slides"}. Expand a slide to compare its copy.</p>
                            {polishChanges.map(change => {
                                const slide = currentPlan.slides.find(row => row.id === change.slideId);
                                const inAppendix = slide?.kind === "recap" && slide.placement === "appendix" && !slide.isHidden;
                                return <details key={change.slideId} className="rounded border border-neutral-700 p-2">
                                    <summary className="cursor-pointer text-sm">{change.slideTitle} · {change.fields.length} {change.fields.length === 1 ? "field" : "fields"}{slide?.isHidden ? " · Hidden" : inAppendix ? " · In appendix" : ""}</summary>
                                    <button type="button" className={`mt-2 ${toolbarButton}`} onClick={() => selectSlide(inAppendix ? "appendix" : change.slideId)}>
                                        View slide: {change.slideTitle}
                                    </button>
                                    <dl className="mt-2 space-y-3 text-xs">{change.fields.map(field => <div key={field.label}>
                                        <dt className="font-semibold text-neutral-200">{field.label}</dt>
                                        <dd className="mt-1 grid gap-2 sm:grid-cols-2">
                                            <div className="rounded bg-neutral-950 p-2"><p className="mb-1 font-medium text-neutral-400">Before</p><p className="whitespace-pre-wrap break-words">{field.before || "(empty)"}</p></div>
                                            <div className="rounded bg-indigo-950/40 p-2"><p className="mb-1 font-medium text-indigo-300">After</p><p className="whitespace-pre-wrap break-words">{field.after || "(empty)"}</p></div>
                                        </dd>
                                    </div>)}</dl>
                                </details>;
                            })}
                        </>}
                </section>}
                {focusSuggestion && <section aria-label="Suggested focus" className="space-y-2 rounded border border-indigo-800 p-3">
                    <h3 className="text-sm font-semibold">Suggested focus</h3>
                    <p className="text-xs text-neutral-400">Selected goals receive full recaps; the others move to the appendix when you apply this choice.</p>
                    {adjustingFocus
                        ? <div className="space-y-1">{recapSlides.map(slide => <label key={slide.goalId} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={adjustedFocus.includes(slide.goalId)} onChange={event => {
                                setAdjustedFocus(current => event.target.checked ? [...current, slide.goalId] : current.filter(id => id !== slide.goalId));
                            }} />{slide.goalTitle}
                        </label>)}</div>
                        : <ul className="list-inside list-disc text-sm">{focusSuggestion.map(id => <li key={id}>{recapByGoalId.get(id)?.goalTitle}</li>)}</ul>}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={toolbarButton} onClick={() => applyFocus(adjustingFocus ? adjustedFocus : focusSuggestion)}>
                            {adjustingFocus ? "Apply adjusted focus" : "Accept suggested focus"}
                        </button>
                        {!adjustingFocus && <button type="button" className={toolbarButton} onClick={() => setAdjustingFocus(true)}>Adjust focus</button>}
                        <button type="button" className={toolbarButton} onClick={() => setFocusSuggestion(null)}>Keep current focus</button>
                    </div>
                </section>}
            </section>

            <div aria-label="Talk-length estimate" className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <p className="text-sm text-neutral-200" data-testid="deck-estimate-total">
                    Total talk time <strong>{clock(estimate.totalSeconds)}</strong> of {clock(estimate.targetSeconds)} target
                </p>
                <p className="mt-1 text-xs text-neutral-400" data-testid="deck-estimate-summary">
                    {estimate.visibleSlides} visible {estimate.visibleSlides === 1 ? "slide" : "slides"} ·{" "}
                    {estimate.wordsPerMinute} words per minute
                </p>
                {estimate.overTarget && <p className="mt-1 text-xs text-amber-300">
                    Over the target. Hide or trim slides if you want a shorter talk.
                </p>}
            </div>

            {error && <p role="alert" className="rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}

            {visibleWarnings.length > 0 && <section aria-label="Pre-export check" className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <h2 className="text-sm font-semibold text-neutral-100">Pre-export check</h2>
                <p className="mt-1 text-xs text-neutral-400">
                    These items are thin, not blocking. Fix them, skip them for this preview, or proceed.
                </p>
                <ul className="mt-3 space-y-2">
                    {visibleWarnings.map(warning => <li
                        key={warning.id}
                        className="flex flex-wrap items-center gap-2 rounded border border-neutral-800 bg-neutral-950/40 p-2"
                    >
                        <span className="min-w-0 flex-1 text-sm text-neutral-200">{warning.message}</span>
                        <button
                            type="button"
                            className={toolbarButton}
                            onClick={() => fixWarning(warning)}
                        >
                            Fix
                        </button>
                        <button
                            type="button"
                            className={toolbarButton}
                            onClick={() => setSkippedWarningIds(current => {
                                const next = new Set(current);
                                next.add(warning.id);
                                return next;
                            })}
                        >
                            Skip
                        </button>
                    </li>)}
                </ul>
                <button
                    type="button"
                    className="mt-3 rounded border border-indigo-500 bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-100 hover:bg-indigo-900/50 disabled:opacity-50"
                    disabled={exporting}
                    onClick={() => { void runExport(); }}
                >
                    Proceed with export
                </button>
            </section>}

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <SortableContext items={visibleRecapIds} strategy={verticalListSortingStrategy}>
                    <div className="space-y-4">
                        {visibleSlides.map(slide => {
                            const cardProps: SlideCardProps = {
                                slide,
                                selected: selectedSlideId === slide.id,
                                polished: polishedSlideIds.has(slide.id),
                                registerRef: registerSlideRef(slide.id),
                                controls: renderVisibleControls(slide),
                                onTitleChange: value => setSlideTitle(slide.id, value),
                                onNotesChange: value => setSlideNotes(slide.id, value),
                                children: renderSlideBody(slide),
                            };
                            return isRecapSlide(slide)
                                ? <SortableRecapCard key={slide.id} {...cardProps} slide={slide} />
                                : <StaticSlideCard key={slide.id} {...cardProps} />;
                        })}
                    </div>
                </SortableContext>
            </DndContext>

            {hiddenSlides.length > 0 && <section aria-label="Hidden slides" className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <h2 className="text-sm font-semibold text-neutral-100">Hidden slides</h2>
                <p className="mt-1 text-xs text-neutral-400">
                    Hidden slides stay in the plan and are excluded from the estimate.
                </p>
                <ul className="mt-3 space-y-2">
                    {hiddenSlides.map(slide => <li
                        key={slide.id}
                        ref={registerSlideRef(slide.id)}
                        aria-current={selectedSlideId === slide.id ? "true" : undefined}
                        className={`flex flex-wrap items-center gap-2 rounded border p-2 ${
                            selectedSlideId === slide.id
                                ? "border-indigo-400 ring-2 ring-indigo-400/40"
                                : "border-neutral-800"
                        }`}
                    >
                        <span className="min-w-0 flex-1 text-sm text-neutral-200">
                            {KIND_LABELS[slide.kind]} · {slide.title}
                            <span className="ml-2 text-xs text-neutral-500">{slide.suggestedSeconds}s</span>
                        </span>
                        {polishedSlideIds.has(slide.id) && <span className="text-xs text-indigo-300">Changed by latest polish</span>}
                        {isRecapSlide(slide) && <>
                            {renderMoveButtons(slide)}
                            {renderPlacementButton(slide)}
                        </>}
                        <button
                            type="button"
                            className={toolbarButton}
                            aria-label={`Show slide: ${slide.title}`}
                            onClick={() => setHidden(slide.id, false)}
                        >
                            Show slide
                        </button>
                    </li>)}
                </ul>
            </section>}
            </fieldset>
        </div>
    </section>;
};
