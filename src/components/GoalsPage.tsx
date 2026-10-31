import React, { useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGoals, type NewGoalTrackerInput } from "../state/GoalContext";
import type { Goal, GoalCadence, GoalMetric, GoalTracker, Weekday } from "../state/types";
import { normalizeGoalCadence } from "../lib/goals/cadence";
import { isGoalDateKey } from "../lib/goals/factories";
import { dueState, goalGrid, periodLabel } from "../lib/goals/periods";
import { slipSummary } from "../lib/goals/slips";
import { localDateKey } from "../lib/todos/calendar";
import type { LocalDateKey } from "../lib/todos/types";
import { GoalDueNudge } from "./goals/GoalDueNudge";
import { GoalSlipBadge } from "./goals/GoalSlipBadge";
import { TrackerDueBadge } from "./goals/TrackerDueBadge";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const control = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs";
const button = `${control} hover:bg-neutral-800 disabled:opacity-50`;
const primary = "rounded bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500";
const ordered = <T extends { sortOrder: number; id: string },>(rows: T[]) => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unable to save. Please try again.";
/** One clock read per render; the optional prop is a test-only seam. */
const pageToday = (today?: LocalDateKey): LocalDateKey => {
    if (today !== undefined) return today;
    const key = localDateKey(new Date());
    if (!isGoalDateKey(key)) throw new RangeError("Invalid goal date");
    return key;
};

export const GoalsPage: React.FC<{ today?: LocalDateKey }> = ({ today: todayProp }) => {
    const goals = useGoals();
    const { state, hydrated } = goals;
    const today = pageToday(todayProp);
    const [trackerForm, setTrackerForm] = useState<GoalTracker | "new" | null>(null);
    const [showArchived, setShowArchived] = useState(false);
    const [lifecycle, setLifecycle] = useState<Goal["lifecycle"] | "all">("active");
    const [editingGoal, setEditingGoal] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const trackers = ordered(Object.values(state.trackers)).filter(row => showArchived || !row.isArchived);
    const tracker = trackers.find(row => row.id === state.ui.selectedTrackerId) ?? trackers[0];
    const allGoals = tracker ? ordered(Object.values(state.goals).filter(row => row.trackerId === tracker.id)) : [];
    const visible = allGoals.filter(row => lifecycle === "all" || row.lifecycle === lifecycle);
    const edit = editingGoal ? state.goals[editingGoal] : null;
    const due = tracker ? dueState(goalGrid(tracker), today) : null;
    const dueTracker = due !== null && due.kind === "due" ? due : null;
    const currentPeriodStart = due !== null && (due.kind === "due" || due.kind === "not-due") ? due.current.periodStart : null;
    const slipCount = (goalId: string) => {
        if (!tracker || tracker.isArchived || currentPeriodStart === null) return 0;
        return slipSummary(goalId, Object.values(state.checkIns), currentPeriodStart).consecutiveSlips;
    };

    function attempt(action: () => void) {
        try { action(); setError(null); } catch (error) { setError(errorMessage(error)); }
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

    return <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3">
            <div><h1 className="text-base font-semibold">Goals</h1><p className="text-neutral-500">Keep your direction and review your progress.</p></div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived trackers</label>
                <button className={primary} disabled={!hydrated} onClick={() => setTrackerForm("new")}>Add tracker</button>
            </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
            <div className="mx-auto max-w-5xl space-y-4">
                {!hydrated && <p role="status">Loading goals…</p>}
                {error && <p role="alert" className="text-red-300">{error}</p>}
                {trackerForm && <TrackerForm key={typeof trackerForm === "string" ? trackerForm : trackerForm.id}
                    tracker={typeof trackerForm === "string" ? null : trackerForm}
                    onCancel={() => setTrackerForm(null)}
                    onSave={input => {
                        if (trackerForm === "new") {
                            const created = goals.createTracker(input);
                            goals.selectTracker(created.id);
                            setShowArchived(false);
                        } else goals.updateTracker(trackerForm.id, input);
                        setTrackerForm(null);
                    }} />}
                {hydrated && !tracker && <p>{Object.keys(state.trackers).length ? "No active trackers. Show archived trackers or add a tracker." : "No trackers yet. Add a tracker for the goals you want to work toward."}</p>}
                {tracker && <>
                    <label className="flex items-center gap-2">Tracker
                        <select className={control} value={tracker.id} onChange={event => { goals.selectTracker(event.target.value); setEditingGoal(null); }}>
                            {trackers.map(row => <option key={row.id} value={row.id}>{row.name}{row.isArchived ? " (archived)" : ""}</option>)}
                        </select>
                    </label>
                    <section className="space-y-3 rounded border border-neutral-800 p-4" aria-label={tracker.name}>
                        <header className="flex flex-wrap items-center gap-3">
                            <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: tracker.color }} />
                            <div><h2 className="text-sm font-semibold">{tracker.name}</h2><p className="text-neutral-400">{tracker.purpose}</p></div>
                            <div data-goals-slot="tracker-due" data-tracker-id={tracker.id}>
                                <TrackerDueBadge due={dueTracker !== null} periodLabel={dueTracker ? periodLabel(dueTracker.mostRecentCompleted) : null} />
                            </div>
                            <button className={`${button} ml-auto`} onClick={() => setTrackerForm(tracker)}>Edit tracker</button>
                            {tracker.isArchived
                                ? <button className={button} onClick={() => attempt(() => goals.archiveTracker(tracker.id, false))}>Reactivate tracker</button>
                                : <button className={button} onClick={() => {
                                    if (window.confirm(`Archive “${tracker.name}”? Its goals and history will be kept.`)) attempt(() => goals.archiveTracker(tracker.id));
                                }}>Archive tracker</button>}
                        </header>
                        <p className="text-neutral-400">{tracker.cadence.kind === "monthly-weekday"
                            ? `Monthly on ${weekdays[tracker.cadence.weekday]}`
                            : `Every ${tracker.cadence.intervalWeeks} ${tracker.cadence.intervalWeeks === 1 ? "week" : "weeks"} on ${weekdays[tracker.cadence.weekday]}`}</p>
                        <div data-goals-slot="check-in-entry" data-tracker-id={tracker.id}>
                            {tracker.cadenceAnchorAt > today
                                ? <p>No open period. First period starts on <time dateTime={tracker.cadenceAnchorAt}>{tracker.cadenceAnchorAt}</time>.</p>
                                : <p>First period started on <time dateTime={tracker.cadenceAnchorAt}>{tracker.cadenceAnchorAt}</time>.</p>}
                        </div>
                        <div data-goals-slot="deck-entry" data-tracker-id={tracker.id} />
                        <div data-goals-slot="goal-set-actions" data-tracker-id={tracker.id} />
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
                    <DndContext sensors={sensors} onDragEnd={reorder}>
                        <SortableContext items={visible.map(row => row.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2" aria-label="Goals list">
                                {visible.map(row => <GoalRow key={row.id} goal={row} consecutiveSlips={slipCount(row.id)} expanded={!!state.ui.expandedGoalIds[row.id]}
                                    onExpand={() => goals.setGoalExpanded(row.id, !state.ui.expandedGoalIds[row.id])}
                                    onEdit={() => setEditingGoal(row.id)} onLifecycle={value => attempt(() => goals.setGoalLifecycle(row.id, value))} />)}
                            </div>
                        </SortableContext>
                    </DndContext>
                    {edit && edit.trackerId === tracker.id && <GoalEditor key={edit.id} goal={edit} onCancel={() => setEditingGoal(null)} onSave={patch => {
                        goals.updateGoal(edit.id, patch);
                        setEditingGoal(null);
                    }} />}
                </>}
            </div>
        </main>
        <div data-goals-slot="check-in-wizard" />
        <div data-goals-slot="deck-preview" />
        <div data-goals-slot="due-nudge"><GoalDueNudge today={today} /></div>
    </div>;
};

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
    return <span className="text-neutral-400">{metric.source === "manual" ? "Manual" : "Auto"}{metric.overridePinned ? " · Override" : ""}</span>;
}

function GoalRow({ goal, consecutiveSlips, expanded, onExpand, onEdit, onLifecycle }: { goal: Goal; consecutiveSlips: number; expanded: boolean; onExpand: () => void; onEdit: () => void; onLifecycle: (value: Goal["lifecycle"]) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: goal.id });
    return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className="rounded border border-neutral-800 bg-neutral-900/30 p-3" aria-label={goal.title}>
        <div className="flex flex-wrap items-center gap-3">
            <button className={button} {...attributes} {...listeners} aria-label={`Reorder ${goal.title}`}>⠿</button>
            <h3 className="flex-1 font-medium">{goal.title}</h3>
            <span className="text-neutral-400">{goal.lifecycle}</span>
            <span data-goals-slot="goal-slip" data-goal-id={goal.id}><GoalSlipBadge consecutiveSlips={consecutiveSlips} /></span>
            <button className={button} onClick={onExpand} aria-expanded={expanded}>{expanded ? "Hide details" : "Show details"}</button>
            <button className={button} onClick={onEdit}>Edit goal</button>
            {goal.lifecycle === "active" ? <>
                <button className={button} onClick={() => onLifecycle("achieved")}>Achieve</button>
                <button className={button} onClick={() => onLifecycle("dropped")}>Drop</button>
            </> : <button className={button} onClick={() => onLifecycle("active")}>Reactivate</button>}
        </div>
        {goal.metric && <p className="mt-2">{goal.metric.label}: {goal.metric.current} / {goal.metric.target} {goal.metric.unit} <MetricBadge metric={goal.metric} /></p>}
        {expanded && <p className="mt-2 whitespace-pre-wrap text-neutral-400">{goal.notes || "No note."}</p>}
    </article>;
}

function GoalEditor({ goal, onSave, onCancel }: { goal: Goal; onSave: (patch: Partial<Goal>) => void; onCancel: () => void }) {
    const [title, setTitle] = useState(goal.title);
    const [notes, setNotes] = useState(goal.notes);
    const [metric, setMetric] = useState(goal.metric !== null);
    const [label, setLabel] = useState(goal.metric?.label ?? "");
    const [current, setCurrent] = useState(String(goal.metric?.current ?? 0));
    const [target, setTarget] = useState(String(goal.metric?.target ?? 0));
    const [unit, setUnit] = useState(goal.metric?.unit ?? "");
    const [source, setSource] = useState<GoalMetric["source"]>(goal.metric?.source ?? "manual");
    const [error, setError] = useState<string | null>(null);
    return <form aria-label="Edit goal" className="space-y-3 rounded border border-neutral-800 p-4" onSubmit={event => {
        event.preventDefault();
        try {
            if (!title.trim()) throw new RangeError("Give this goal a name.");
            if (metric && (!label.trim() || !current.trim() || !target.trim() || !Number.isFinite(Number(current)) || !Number.isFinite(Number(target)))) throw new RangeError("Metric needs a label and finite current and target values.");
            onSave({ title, notes, metric: metric ? { label: label.trim(), current: Number(current), target: Number(target), unit, source, overridePinned: source === goal.metric?.source ? goal.metric.overridePinned : false } : null });
        } catch (error) { setError(errorMessage(error)); }
    }}>
        <h3 className="font-medium">Edit goal</h3>
        <label className="grid gap-1">Name<input className={control} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="grid gap-1">Goal note<textarea className={control} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={metric} onChange={event => setMetric(event.target.checked)} />Track one metric</label>
        {metric && <fieldset className="flex flex-wrap gap-3"><legend className="mb-2">Metric {goal.metric && <MetricBadge metric={goal.metric} />}</legend>
            <label className="grid gap-1">Metric label<input className={control} value={label} onChange={event => setLabel(event.target.value)} /></label>
            <label className="grid gap-1">Current<input className={`${control} w-28`} type="number" step="any" value={current} onChange={event => setCurrent(event.target.value)} /></label>
            <label className="grid gap-1">Target<input className={`${control} w-28`} type="number" step="any" value={target} onChange={event => setTarget(event.target.value)} /></label>
            <label className="grid gap-1">Unit<input className={control} value={unit} onChange={event => setUnit(event.target.value)} /></label>
            <label className="grid gap-1">Source<select className={control} value={source} onChange={event => setSource(event.target.value as typeof source)}>
                <option value="manual">Manual</option>{goal.metric?.source === "liftingtracker" && <option value="liftingtracker" disabled>Auto</option>}
            </select></label>
        </fieldset>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <div className="flex gap-2"><button className={primary} type="submit">Save goal</button><button className={button} type="button" onClick={onCancel}>Cancel</button></div>
    </form>;
}
