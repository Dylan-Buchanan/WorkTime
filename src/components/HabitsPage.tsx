import React, { useMemo, useState } from "react";
import { DndContext, type DragEndEvent, type DraggableAttributes, type DraggableSyntheticListeners, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    dateFromBucket,
    getBucketKey,
    getWindowBuckets,
    isHabitCellCheckable,
    isHabitCompleted,
    isHabitVisible,
} from "../lib/habits";
import type { Habit, HabitFrequency } from "../state/types";
import type { HabitPeriod } from "../state/HabitContext";
import { useHabits } from "../state/HabitContext";

const HABIT_COLORS = ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6"];
const PERIODS: Array<{ value: HabitPeriod; label: string }> = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
];

type HabitDraft = {
    name: string;
    description: string;
    color: string;
    frequency: HabitFrequency;
};

const blankDraft = (): HabitDraft => ({
    name: "",
    description: "",
    color: HABIT_COLORS[0],
    frequency: "daily",
});

export const HabitsPage: React.FC = () => {
    const {
        state,
        createHabit,
        updateHabit,
        archiveHabit,
        deleteHabit,
        checkCompletion,
        uncheckCompletion,
        reorderHabits,
        setPeriod,
        setSelectedHabit,
    } = useHabits();
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<HabitDraft>(blankDraft);
    const [formError, setFormError] = useState<string | null>(null);
    const [showArchived, setShowArchived] = useState(false);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    const now = new Date();

    const habits = useMemo(
        () => Object.values(state.habits).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
        [state.habits],
    );
    const activeHabits = useMemo(
        () => habits.filter((habit) => !habit.isArchived && isHabitVisible(habit, state.ui.period)),
        [habits, state.ui.period],
    );
    const archivedHabits = useMemo(
        () => habits.filter((habit) => habit.isArchived && isHabitVisible(habit, state.ui.period)),
        [habits, state.ui.period],
    );

    const openCreate = () => {
        setEditingId(null);
        setDraft(blankDraft());
        setFormError(null);
        setShowForm(true);
    };

    const openEdit = (habit: Habit) => {
        setEditingId(habit.id);
        setDraft({ name: habit.name, description: habit.description, color: habit.color, frequency: habit.frequency });
        setFormError(null);
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
        setFormError(null);
    };

    const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const name = draft.name.trim();
        if (!name) {
            setFormError("Give this habit a name first.");
            return;
        }
        const input = { ...draft, name };
        if (editingId) {
            updateHabit(editingId, input);
        } else {
            createHabit(input);
        }
        closeForm();
    };

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const oldIndex = activeHabits.findIndex((habit) => habit.id === active.id);
        const newIndex = activeHabits.findIndex((habit) => habit.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        reorderHabits(arrayMove(activeHabits.map((habit) => habit.id), oldIndex, newIndex));
    };

    const removeHabit = (habit: Habit) => {
        if (window.confirm(`Delete “${habit.name}”? This also deletes its completion history.`)) {
            deleteHabit(habit.id);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur">
                <div>
                    <h1 className="text-base font-semibold">Habits</h1>
                    <p className="text-[10px] text-neutral-500">Small, repeatable actions add up.</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <div className="inline-flex overflow-hidden rounded border border-neutral-800 bg-neutral-900" aria-label="Habit period">
                        {PERIODS.map((period) => (
                            <button
                                key={period.value}
                                type="button"
                                aria-pressed={state.ui.period === period.value}
                                onClick={() => setPeriod(period.value)}
                                className={`px-2.5 py-1 text-[10px] transition-colors ${state.ui.period === period.value ? "bg-indigo-600 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"}`}
                            >
                                {period.label}
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={() => setShowArchived((visible) => !visible)} className="rounded border border-neutral-800 px-2.5 py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
                        {showArchived ? "Hide archived" : "Show archived"}
                    </button>
                    <button type="button" onClick={openCreate} className="rounded bg-indigo-600 px-3 py-1 text-[10px] font-medium text-white hover:bg-indigo-500">
                        Add habit
                    </button>
                </div>
            </header>

            {showForm && (
                <HabitForm
                    draft={draft}
                    editing={Boolean(editingId)}
                    error={formError}
                    onChange={setDraft}
                    onSubmit={submitForm}
                    onCancel={closeForm}
                />
            )}

            <main className="min-h-0 flex-1 overflow-auto p-4">
                {activeHabits.length === 0 && (!showArchived || archivedHabits.length === 0) ? (
                    <EmptyState onAdd={openCreate} hasHabits={habits.length > 0} />
                ) : (
                    <div className="mx-auto max-w-6xl space-y-3">
                        {activeHabits.length > 0 && (
                            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                                <SortableContext items={activeHabits.map((habit) => habit.id)} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-3">
                                        {activeHabits.map((habit) => (
                                            <SortableHabitCard
                                                key={habit.id}
                                                habit={habit}
                                                period={state.ui.period}
                                                now={now}
                                                completions={Object.values(state.completions)}
                                                selected={state.ui.selected === habit.id}
                                                onSelect={() => setSelectedHabit(habit.id)}
                                                onCheck={(bucket, checked) => checked ? uncheckCompletion(habit.id, bucket) : checkCompletion(habit.id, bucket)}
                                                onEdit={() => openEdit(habit)}
                                                onArchive={() => archiveHabit(habit.id)}
                                                onDelete={() => removeHabit(habit)}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        )}
                        {showArchived && archivedHabits.length > 0 && (
                            <section className="space-y-2 pt-4" aria-label="Archived habits">
                                <h2 className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Archived</h2>
                                <div className="space-y-3">
                                    {archivedHabits.map((habit) => (
                                        <HabitCard
                                            key={habit.id}
                                            habit={habit}
                                            period={state.ui.period}
                                            now={now}
                                            completions={Object.values(state.completions)}
                                            selected={state.ui.selected === habit.id}
                                            archived
                                            onSelect={() => setSelectedHabit(habit.id)}
                                            onCheck={(bucket, checked) => checked ? uncheckCompletion(habit.id, bucket) : checkCompletion(habit.id, bucket)}
                                            onEdit={() => openEdit(habit)}
                                            onArchive={() => archiveHabit(habit.id, false)}
                                            onDelete={() => removeHabit(habit)}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

const EmptyState: React.FC<{ onAdd: () => void; hasHabits: boolean }> = ({ onAdd, hasHabits }) => (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-900/40 p-10 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/15 text-xl text-indigo-300">✓</div>
        <h2 className="text-sm font-semibold">{hasHabits ? "No habits in this period" : "Build your first habit"}</h2>
        <p className="mt-1 text-[11px] text-neutral-500">{hasHabits ? "Try another period or add a habit with a matching frequency." : "Track the small actions you want to make automatic."}</p>
        <button type="button" onClick={onAdd} className="mt-4 rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500">Add habit</button>
    </div>
);

const HabitForm: React.FC<{
    draft: HabitDraft;
    editing: boolean;
    error: string | null;
    onChange: React.Dispatch<React.SetStateAction<HabitDraft>>;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    onCancel: () => void;
}> = ({ draft, editing, error, onChange, onSubmit, onCancel }) => (
    <form onSubmit={onSubmit} className="border-b border-neutral-800 bg-neutral-900/70 px-4 py-4">
        <div className="mx-auto grid max-w-6xl gap-3 md:grid-cols-[1.2fr_1.5fr_auto]">
            <div className="space-y-2">
                <label className="block text-[10px] text-neutral-400" htmlFor="habit-name">Name</label>
                <input id="habit-name" autoFocus value={draft.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} placeholder="Read for 20 minutes" className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs" />
                <label className="block text-[10px] text-neutral-400" htmlFor="habit-description">Description</label>
                <input id="habit-description" value={draft.description} onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} placeholder="Optional details" className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs" />
            </div>
            <div className="space-y-2">
                <span className="block text-[10px] text-neutral-400">Color</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Habit color">
                    {HABIT_COLORS.map((color) => (
                        <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={`Choose ${color}`} onClick={() => onChange((current) => ({ ...current, color }))} className={`h-6 w-6 rounded-full border-2 ${draft.color === color ? "border-white" : "border-transparent"}`} style={{ backgroundColor: color }} />
                    ))}
                </div>
                <label className="block text-[10px] text-neutral-400" htmlFor="habit-frequency">Frequency</label>
                <select id="habit-frequency" value={draft.frequency} onChange={(event) => onChange((current) => ({ ...current, frequency: event.target.value as HabitFrequency }))} className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                </select>
            </div>
            <div className="flex items-end gap-2 md:flex-col md:items-stretch md:justify-end">
                <button type="submit" className="rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500">{editing ? "Save changes" : "Create habit"}</button>
                <button type="button" onClick={onCancel} className="rounded border border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </div>
        </div>
        {error && <p role="alert" className="mx-auto mt-2 max-w-6xl text-[11px] text-red-300">{error}</p>}
    </form>
);

const SortableHabitCard: React.FC<Omit<React.ComponentProps<typeof HabitCard>, "archived">> = (props) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.habit.id });
    return (
        <HabitCard
            {...props}
            setNodeRef={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            dragAttributes={attributes}
            dragListeners={listeners}
        />
    );
};

type HabitCardProps = {
    habit: Habit;
    period: HabitPeriod;
    now: Date;
    completions: ReadonlyArray<{ habitId: string; bucket: string }>;
    selected: boolean;
    archived?: boolean;
    onSelect: () => void;
    onCheck: (bucket: string, checked: boolean) => void;
    onEdit: () => void;
    onArchive: () => void;
    onDelete: () => void;
    setNodeRef?: (element: HTMLElement | null) => void;
    style?: React.CSSProperties;
    dragAttributes?: DraggableAttributes;
    dragListeners?: DraggableSyntheticListeners;
};

const HabitCard: React.FC<HabitCardProps> = ({ habit, period, now, completions, selected, archived = false, onSelect, onCheck, onEdit, onArchive, onDelete, setNodeRef, style, dragAttributes, dragListeners }) => {
    const buckets = getWindowBuckets(period, habit.frequency, now);
    const todayBucket = getBucketKey(now, habit.frequency);
    return (
        <article ref={setNodeRef} style={style} onClick={onSelect} className={`rounded-lg border bg-neutral-900/70 p-3 shadow-sm transition-colors ${selected ? "border-indigo-500/70 ring-1 ring-indigo-500/30" : "border-neutral-800 hover:border-neutral-700"} ${archived ? "opacity-70" : ""}`}>
            <div className="flex items-start gap-3">
                {!archived && (
                    <button type="button" {...dragAttributes} {...dragListeners} onClick={(event) => event.stopPropagation()} aria-label={`Drag ${habit.name} to reorder`} title="Drag to reorder" className="grid w-4 shrink-0 cursor-grab grid-cols-2 gap-0.5 pt-1 active:cursor-grabbing">
                        {Array.from({ length: 6 }, (_, index) => <span key={index} className="h-1 w-1 rounded-full bg-neutral-500" />)}
                    </button>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold" style={{ color: habit.color }}>{habit.name || "Untitled habit"}</h2>
                            {habit.description && <p className="mt-0.5 truncate text-[11px] text-neutral-400">{habit.description}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-[10px] text-neutral-500">
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5 capitalize">{habit.frequency}</span>
                            {archived && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Archived</span>}
                        </div>
                    </div>
                    <div className="mt-3 flex min-w-0 gap-1 overflow-x-auto pb-1" aria-label={`${habit.name} ${period} completion cells`}>
                        {buckets.map((bucket) => {
                            const checked = isHabitCompleted(completions, habit.id, bucket);
                            const checkable = isHabitCellCheckable(habit, bucket, now);
                            const isToday = bucket === todayBucket;
                            return (
                                <button
                                    key={bucket}
                                    type="button"
                                    disabled={!checkable}
                                    aria-pressed={checked}
                                    aria-label={`${formatBucket(bucket, habit.frequency)}${isToday ? " today" : ""}${checked ? ", completed" : ", not completed"}`}
                                    title={`${formatBucket(bucket, habit.frequency)}${!checkable ? " — future" : ""}`}
                                    onClick={(event) => { event.stopPropagation(); onCheck(bucket, checked); }}
                                    className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded border text-[11px] transition ${checked ? "text-white" : "border-neutral-700 bg-neutral-950/70 text-neutral-600 hover:border-neutral-500"} ${isToday ? "ring-2 ring-white/80 ring-offset-1 ring-offset-neutral-900" : ""} disabled:cursor-not-allowed disabled:opacity-35`}
                                    style={checked ? { backgroundColor: habit.color, borderColor: habit.color } : undefined}
                                >
                                    {checked ? "✓" : ""}
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] text-neutral-500">{buckets.length} {buckets.length === 1 ? "cell" : "cells"} · today highlighted</span>
                        <div className="flex items-center gap-1">
                            <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} className="rounded px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">Edit</button>
                            <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(); }} className="rounded px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">{archived ? "Restore" : "Archive"}</button>
                            <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} className="rounded px-2 py-1 text-[10px] text-red-300 hover:bg-red-950/50">Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
};

function formatBucket(bucket: string, frequency: HabitFrequency): string {
    const date = dateFromBucket(bucket);
    if (frequency === "daily") return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (frequency === "weekly") return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
