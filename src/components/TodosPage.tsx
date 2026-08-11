import React, { useMemo, useState } from "react";
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    type DragEndEvent,
    type DraggableAttributes,
    type DraggableSyntheticListeners,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    compareLocalDates,
    isDueOn,
    localDateFromKey,
    localDateKey,
    nextOccurrence,
    normalizeRule,
    formatTodoRule,
} from "../lib/todos";
import type { LocalDateKey, MonthlyDay, Todo, TodoRule, YearlyDate } from "../lib/todos";
import { TodoSchedulePicker, type RecurrenceType, type SchedulePickerValue } from "./TodoSchedulePicker";
import { useSounds } from "../hooks/useSounds";
import { useTodos } from "../state/TodoContext";

type ScheduleType = "none" | TodoRule["type"];
type BucketKey = "overdue" | "today" | "upcoming" | "no-date";

type TodoDraft = {
    title: string;
    schedule: ScheduleType;
    date: string;
    weekdays: number[];
    monthlyDays: number[];
    monthlyLastDayOffset: number | null;
    yearlyDates: YearlyDate[];
};

const BUCKETS: Array<{ key: BucketKey; label: string }> = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Today" },
    { key: "upcoming", label: "Upcoming" },
    { key: "no-date", label: "No due date" },
];

function todayKey(): LocalDateKey { return localDateKey(new Date()) as LocalDateKey; }

function blankDraft(): TodoDraft {
    return { title: "", schedule: "none", date: "", weekdays: [], monthlyDays: [], monthlyLastDayOffset: null, yearlyDates: [{ month: 1, day: 1 }] };
}

function draftFromTodo(todo: Todo): TodoDraft {
    const rule = todo.rule;
    if (!rule) return { ...blankDraft(), title: todo.title };
    if (rule.type === "one-off") return { ...blankDraft(), title: todo.title, schedule: rule.type, date: rule.date };
    if (rule.type === "weekly") return { ...blankDraft(), title: todo.title, schedule: rule.type, date: todo.dueDate ?? "", weekdays: [...rule.weekdays] };
    if (rule.type === "monthly") {
        const numeric = rule.days.filter((day): day is number => typeof day === "number");
        const last = rule.days.find((day) => typeof day !== "number");
        const offset = last && typeof last === "object" ? last.lastDayOffset : last === "last-day" ? 0 : null;
        return { ...blankDraft(), title: todo.title, schedule: rule.type, date: todo.dueDate ?? "", monthlyDays: numeric, monthlyLastDayOffset: offset };
    }
    return { ...blankDraft(), title: todo.title, schedule: rule.type, date: todo.dueDate ?? "", yearlyDates: rule.dates.map((date) => ({ ...date })) };
}

function parseDate(value: string): LocalDateKey | null {
    if (!value) return null;
    try {
        const date = localDateFromKey(value);
        return localDateKey(date) === value ? value as LocalDateKey : null;
    } catch {
        return null;
    }
}

function buildRecurrenceRule(draft: TodoDraft): TodoRule {
    if (draft.schedule === "weekly") {
        if (draft.weekdays.length === 0) throw new Error("Choose at least one weekday.");
        return { type: "weekly", weekdays: draft.weekdays };
    }
    if (draft.schedule === "monthly") {
        if (draft.monthlyDays.length === 0 && draft.monthlyLastDayOffset === null) throw new Error("Choose at least one monthly day.");
        const days: MonthlyDay[] = [...draft.monthlyDays];
        if (draft.monthlyLastDayOffset !== null) days.push({ lastDayOffset: draft.monthlyLastDayOffset });
        return { type: "monthly", days };
    }
    if (draft.schedule === "yearly") {
        if (draft.yearlyDates.length === 0) throw new Error("Add at least one yearly date.");
        return { type: "yearly", dates: draft.yearlyDates };
    }
    throw new Error("Choose a recurrence schedule.");
}

function buildRule(draft: TodoDraft, requireMatchingDueDate = true): { rule: TodoRule | null; dueDate: LocalDateKey | null } {
    if (draft.schedule === "none") return { rule: null, dueDate: null };
    if (draft.schedule === "one-off") {
        const date = parseDate(draft.date);
        if (!date) throw new Error("Choose a valid date.");
        return { rule: { type: "one-off", date }, dueDate: date };
    }

    const dueDate = parseDate(draft.date);
    if (!dueDate && requireMatchingDueDate) throw new Error("Choose the first due date.");
    const rule = buildRecurrenceRule(draft);
    const normalized = normalizeRule(rule);
    if (requireMatchingDueDate && dueDate && !isDueOn(normalized, localDateFromKey(dueDate))) throw new Error("The first due date must match the recurrence schedule.");
    return { rule: normalized, dueDate };
}

function bucketFor(todo: Todo, today: LocalDateKey): BucketKey {
    if (!todo.dueDate) return "no-date";
    try {
        const comparison = compareLocalDates(localDateFromKey(todo.dueDate), localDateFromKey(today));
        return comparison < 0 ? "overdue" : comparison === 0 ? "today" : "upcoming";
    } catch {
        return "no-date";
    }
}

function sortTodos(todos: Todo[]): Todo[] {
    return [...todos].sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
}

function formatDueDate(todo: Todo, bucket: BucketKey): string {
    if (!todo.dueDate) return "No due date";
    try {
        const date = localDateFromKey(todo.dueDate);
        const formatted = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return bucket === "today" ? "Today" : bucket === "overdue" ? `Overdue · ${formatted}` : formatted;
    } catch {
        return "No due date";
    }
}

function scheduleLabel(rule: TodoRule | null): string {
    if (!rule) return "One-time";
    return rule.type === "one-off" ? "One-off" : rule.type[0].toUpperCase() + rule.type.slice(1);
}

function rulesEqual(left: TodoRule | null, right: TodoRule | null): boolean {
    if (!left || !right) return left === right;
    try {
        const normalizeForCompare = (rule: TodoRule): string => {
            const normalized = normalizeRule(rule);
            if (normalized.type === "weekly") return JSON.stringify({ ...normalized, weekdays: [...normalized.weekdays].sort((a, b) => a - b) });
            if (normalized.type === "monthly") return JSON.stringify({ ...normalized, days: [...normalized.days].sort((a, b) => String(a).localeCompare(String(b))) });
            if (normalized.type === "yearly") return JSON.stringify({ ...normalized, dates: [...normalized.dates].sort((a, b) => a.month - b.month || a.day - b.day) });
            return JSON.stringify(normalized);
        };
        return normalizeForCompare(left) === normalizeForCompare(right);
    } catch {
        return false;
    }
}

export const TodosPage: React.FC = () => {
    const { state, hydrated, createTodo, updateTodo, archiveTodo, deleteTodo, reorderTodos, setSelectedTodo } = useTodos();
    const { play } = useSounds();
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<TodoDraft>(blankDraft);
    const [formError, setFormError] = useState<string | null>(null);
    const [showArchived, setShowArchived] = useState(false);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const today = todayKey();
    const todos = useMemo(() => sortTodos(Object.values(state.todos)), [state.todos]);
    const activeTodos = useMemo(() => todos.filter((todo) => !todo.isArchived), [todos]);
    const archivedTodos = useMemo(() => todos.filter((todo) => todo.isArchived), [todos]);
    const grouped = useMemo(() => {
        const result: Record<BucketKey, Todo[]> = { overdue: [], today: [], upcoming: [], "no-date": [] };
        for (const todo of activeTodos) result[bucketFor(todo, today)].push(todo);
        return result;
    }, [activeTodos, today]);
    const orderedActiveTodos = useMemo(() => BUCKETS.flatMap(({ key }) => grouped[key]), [grouped]);

    const openCreate = () => { setEditingId(null); setDraft(blankDraft()); setFormError(null); setShowForm(true); };
    const openEdit = (todo: Todo) => { setEditingId(todo.id); setDraft(draftFromTodo(todo)); setFormError(null); setShowForm(true); };
    const closeForm = () => { setShowForm(false); setEditingId(null); setFormError(null); };
    const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const title = draft.title.trim();
        if (!title) { setFormError("Give this to-do a title first."); return; }
        try {
            const { rule, dueDate } = buildRule(draft, !editingId);
            if (editingId) {
                const existing = state.todos[editingId];
                const ruleChanged = existing ? !rulesEqual(existing.rule, rule) : true;
                const next = ruleChanged && rule && rule.type !== "one-off" ? nextOccurrence(rule, new Date()) : null;
                const recomputedDueDate = ruleChanged && rule && rule.type !== "one-off" && next
                    ? localDateKey(next) as LocalDateKey
                    : ruleChanged && rule && rule.type !== "one-off" ? null : dueDate;
                updateTodo(editingId, { title, rule, dueDate: recomputedDueDate });
            }
            else createTodo({ title, rule, dueDate });
            closeForm();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Check the recurrence details.");
        }
    };
    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const oldIndex = orderedActiveTodos.findIndex((todo) => todo.id === active.id);
        const newIndex = orderedActiveTodos.findIndex((todo) => todo.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        reorderTodos(arrayMove(orderedActiveTodos.map((todo) => todo.id), oldIndex, newIndex));
    };
    const completeTodo = (todo: Todo) => {
        play("completeTask");
        if (todo.rule) {
            const next = nextOccurrence(todo.rule, new Date());
            if (next) { updateTodo(todo.id, { dueDate: localDateKey(next) as LocalDateKey }); return; }
        }
        archiveTodo(todo.id);
    };
    const removeTodo = (todo: Todo) => {
        if (window.confirm(`Delete “${todo.title}”? This cannot be undone.`)) deleteTodo(todo.id);
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur">
                <div>
                    <h1 className="text-base font-semibold">To-dos</h1>
                    <p className="text-[10px] text-neutral-500">Keep the next useful thing in view.</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setShowArchived((visible) => !visible)} className="rounded border border-neutral-800 px-2.5 py-1.5 sm:py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
                        {showArchived ? "Hide archived" : `Show archived${archivedTodos.length ? ` (${archivedTodos.length})` : ""}`}
                    </button>
                    <button type="button" onClick={openCreate} className="rounded bg-indigo-600 px-3 py-1.5 sm:py-1 text-[10px] font-medium text-white hover:bg-indigo-500">Add to-do</button>
                </div>
            </header>

            {showForm && <TodoForm draft={draft} editing={Boolean(editingId)} error={formError} onChange={setDraft} onSubmit={submitForm} onCancel={closeForm} />}

            <main className="min-h-0 flex-1 overflow-auto p-4">
                {!hydrated ? <LoadingState /> : activeTodos.length === 0 && !showArchived ? <EmptyState hasArchived={archivedTodos.length > 0} onAdd={openCreate} /> : (
                    <div className="mx-auto max-w-4xl space-y-5">
                        {activeTodos.length > 0 && (
                            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                                <SortableContext items={orderedActiveTodos.map((todo) => todo.id)} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-5">
                                        {BUCKETS.map(({ key, label }) => grouped[key].length > 0 && (
                                            <section key={key} aria-labelledby={`todo-${key}-heading`} className="space-y-2">
                                                <h2 id={`todo-${key}-heading`} className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}<span className="ml-1 text-neutral-700">({grouped[key].length})</span></h2>
                                                <div className="space-y-2">{grouped[key].map((todo) => <SortableTodoCard key={todo.id} todo={todo} bucket={key} selected={state.ui.selected === todo.id} onSelect={() => setSelectedTodo(todo.id)} onComplete={() => completeTodo(todo)} onEdit={() => openEdit(todo)} onArchive={() => archiveTodo(todo.id)} onDelete={() => removeTodo(todo)} />)}</div>
                                            </section>
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        )}
                        {showArchived && archivedTodos.length > 0 && (
                            <section aria-label="Archived to-dos" className="space-y-2 pt-3">
                                <h2 className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Archived ({archivedTodos.length})</h2>
                                <div className="space-y-2">{archivedTodos.map((todo) => <TodoCard key={todo.id} todo={todo} bucket={bucketFor(todo, today)} archived selected={state.ui.selected === todo.id} onSelect={() => setSelectedTodo(todo.id)} onComplete={() => undefined} onEdit={() => openEdit(todo)} onArchive={() => archiveTodo(todo.id, false)} onDelete={() => removeTodo(todo)} />)}</div>
                            </section>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

const LoadingState: React.FC = () => <div role="status" className="mx-auto max-w-md rounded-lg border border-neutral-800 bg-neutral-900/40 p-10 text-center text-xs text-neutral-400">Loading to-dos…</div>;

const EmptyState: React.FC<{ hasArchived: boolean; onAdd: () => void }> = ({ hasArchived, onAdd }) => (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-900/40 p-10 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/15 text-xl text-indigo-300">✓</div>
        <h2 className="text-sm font-semibold">{hasArchived ? "No active to-dos" : "Nothing on your list yet"}</h2>
        <p className="mt-1 text-[11px] text-neutral-500">Add a one-time task or a recurring reminder to get started.</p>
        <button type="button" onClick={onAdd} className="mt-4 rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500">Add a to-do</button>
    </div>
);

const TodoForm: React.FC<{
    draft: TodoDraft;
    editing: boolean;
    error: string | null;
    onChange: React.Dispatch<React.SetStateAction<TodoDraft>>;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    onCancel: () => void;
}> = ({ draft, editing, error, onChange, onSubmit, onCancel }) => (
    <form onSubmit={onSubmit} className="border-b border-neutral-800 bg-neutral-900/70 px-4 py-4">
        <div className="mx-auto grid max-w-4xl gap-3 md:grid-cols-[1.2fr_1fr_auto]">
            <div className="space-y-2">
                <label className="block text-[10px] text-neutral-400" htmlFor="todo-title">Title</label>
                <input id="todo-title" autoFocus value={draft.title} onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))} placeholder="Send the project update" className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs" />
                <label className="block text-[10px] text-neutral-400" htmlFor="todo-schedule">Schedule</label>
                <select id="todo-schedule" value={draft.schedule} onChange={(event) => onChange((current) => ({ ...current, schedule: event.target.value as ScheduleType }))} className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs">
                    <option value="none">No due date</option><option value="one-off">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                </select>
            </div>
            <ScheduleFields draft={draft} editing={editing} onChange={onChange} />
            <div className="flex items-end gap-2 md:flex-col md:items-stretch md:justify-end">
                <button type="submit" className="rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500">{editing ? "Save changes" : "Create to-do"}</button>
                <button type="button" onClick={onCancel} className="rounded border border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800">Cancel</button>
            </div>
        </div>
        {error && <p role="alert" className="mx-auto mt-2 max-w-4xl text-[11px] text-red-300">{error}</p>}
    </form>
);

const ScheduleFields: React.FC<{ draft: TodoDraft; editing: boolean; onChange: React.Dispatch<React.SetStateAction<TodoDraft>> }> = ({ draft, editing, onChange }) => {
    if (draft.schedule === "none") return <p className="self-end text-[11px] text-neutral-500">This to-do will stay in the no-date list.</p>;
    if (draft.schedule === "one-off") return <DateField id="todo-date" label="Due date" value={draft.date} onChange={(date) => onChange((current) => ({ ...current, date }))} />;
    const pickerValue: SchedulePickerValue = {
        type: draft.schedule as RecurrenceType,
        weekdays: draft.weekdays,
        monthlyDays: draft.monthlyDays,
        monthlyLastDayOffset: draft.monthlyLastDayOffset,
        yearlyDates: draft.yearlyDates,
    };
    let preview: string | null = null;
    try { preview = formatTodoRule(buildRecurrenceRule(draft)); } catch { /* incomplete drafts have no preview */ }
    return <div className="space-y-2">
        <DateField id="todo-due-date" label={editing ? "Current due date" : "First due date"} value={draft.date} onChange={(date) => onChange((current) => ({ ...current, date }))} />
        <TodoSchedulePicker
            value={pickerValue}
            preview={preview}
            onChange={(value) => onChange((current) => ({ ...current, schedule: value.type, weekdays: value.weekdays, monthlyDays: value.monthlyDays, monthlyLastDayOffset: value.monthlyLastDayOffset, yearlyDates: value.yearlyDates }))}
        />
        {editing && <p className="text-[9px] text-neutral-500">Changing the recurrence recalculates the next pending date from now.</p>}
    </div>;
};

const DateField: React.FC<{ id: string; label: string; value: string; onChange: (value: string) => void }> = ({ id, label, value, onChange }) => <label className="block text-[10px] text-neutral-400" htmlFor={id}>{label}<input id={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200" /></label>;

const SortableTodoCard: React.FC<React.ComponentProps<typeof TodoCard>> = (props) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.todo.id });
    return <TodoCard {...props} setNodeRef={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} dragAttributes={attributes} dragListeners={listeners} />;
};

type TodoCardProps = {
    todo: Todo;
    bucket: BucketKey;
    selected: boolean;
    archived?: boolean;
    onSelect: () => void;
    onComplete: () => void;
    onEdit: () => void;
    onArchive: () => void;
    onDelete: () => void;
    setNodeRef?: (element: HTMLElement | null) => void;
    style?: React.CSSProperties;
    dragAttributes?: DraggableAttributes;
    dragListeners?: DraggableSyntheticListeners;
};

const TodoCard: React.FC<TodoCardProps> = ({ todo, bucket, selected, archived = false, onSelect, onComplete, onEdit, onArchive, onDelete, setNodeRef, style, dragAttributes, dragListeners }) => {
    const future = bucket === "upcoming";
    return <article ref={setNodeRef} style={style} onClick={onSelect} className={`rounded-lg border bg-neutral-900/70 p-3 shadow-sm transition-colors ${selected ? "border-indigo-500/70 ring-1 ring-indigo-500/30" : "border-neutral-800 hover:border-neutral-700"} ${archived ? "opacity-70" : ""}`}>
        <div className="flex items-start gap-3">
            {!archived && <button type="button" {...dragAttributes} {...dragListeners} onClick={(event) => event.stopPropagation()} aria-label={`Drag ${todo.title} to reorder`} title="Drag to reorder" className="grid w-4 shrink-0 cursor-grab grid-cols-2 gap-0.5 pt-1 active:cursor-grabbing">{Array.from({ length: 6 }, (_, index) => <span key={index} className="h-1 w-1 rounded-full bg-neutral-500" />)}</button>}
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><h3 className={`text-sm font-semibold ${bucket === "overdue" ? "text-red-200" : "text-neutral-100"}`}>{todo.title || "Untitled to-do"}</h3><p className="mt-0.5 text-[10px] text-neutral-500">{formatDueDate(todo, bucket)} · {scheduleLabel(todo.rule)}{archived ? " · Archived" : ""}</p></div>
                    {!archived && <button type="button" disabled={future} aria-label={`Complete ${todo.title}`} title={future ? "This to-do is not due yet" : "Mark complete"} onClick={(event) => { event.stopPropagation(); onComplete(); }} className="rounded border border-emerald-700/70 px-2.5 py-1.5 text-[10px] text-emerald-300 hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-40">Complete</button>}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }} className="rounded px-2.5 py-1.5 sm:px-2 sm:py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">Edit</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(); }} className="rounded px-2.5 py-1.5 sm:px-2 sm:py-1 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">{archived ? "Restore" : "Archive"}</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} className="rounded px-2.5 py-1.5 sm:px-2 sm:py-1 text-[10px] text-red-300 hover:bg-red-950/50">Delete</button>
                </div>
            </div>
        </div>
    </article>;
};
