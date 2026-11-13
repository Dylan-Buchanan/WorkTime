import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dueState, goalGrid, periodLabel } from "../../lib/goals/periods";
import type { LocalDateKey } from "../../lib/todos/types";
import type { GoalTracker } from "../../state/types";
import { TrackerDueBadge } from "./TrackerDueBadge";

interface TrackerRailProps {
    trackers: readonly GoalTracker[];
    selectedId: string | null;
    today: LocalDateKey;
    counts: ReadonlyMap<string, { active: number; achieved: number }>;
    hydrated: boolean;
    showArchived: boolean;
    archivedCount: number;
    actionsOpen: string | null;
    onActionsChange: (id: string | null) => void;
    onSelect: (id: string) => void;
    onNew: () => void;
    onEdit: (tracker: GoalTracker) => void;
    onArchive: (tracker: GoalTracker) => void;
    onReactivate: (tracker: GoalTracker) => void;
    onToggleArchived: (show: boolean) => void;
    onReorder: (idsInOrder: readonly string[]) => void;
}

interface RailRowProps {
    tracker: GoalTracker;
    selected: boolean;
    today: LocalDateKey;
    count: { active: number; achieved: number } | undefined;
    actionsOpen: boolean;
    actionsRef?: RefObject<HTMLDivElement | null>;
    onSelect: (id: string) => void;
    onActionsChange: (id: string | null) => void;
    onEdit: (tracker: GoalTracker) => void;
    onArchive: (tracker: GoalTracker) => void;
    onReactivate: (tracker: GoalTracker) => void;
    rowRef?: (node: HTMLLIElement | null) => void;
    style?: CSSProperties;
    className?: string;
    handle?: ReactNode;
}

const action = "block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800";
const handleClass = "mt-1.5 shrink-0 touch-none rounded px-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export function TrackerRail({
    trackers, selectedId, today, counts, hydrated, showArchived, archivedCount, actionsOpen,
    onActionsChange, onSelect, onNew, onEdit, onArchive, onReactivate, onToggleArchived, onReorder,
}: TrackerRailProps) {
    const selectedRow = useRef<HTMLLIElement>(null);
    const actionsRef = useRef<HTMLDivElement>(null);
    // Archived rows never join the sortable group, so the two groups stay
    // contiguous: active rows first, then archived rows regardless of sortOrder.
    const activeTrackers = trackers.filter(row => !row.isArchived);
    const archivedTrackers = trackers.filter(row => row.isArchived);
    const sortable = activeTrackers.length > 1;
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    useEffect(() => {
        selectedRow.current?.scrollIntoView?.({ block: "nearest" });
    }, [selectedId]);

    useEffect(() => {
        if (actionsOpen === null) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!actionsRef.current?.contains(event.target as Node)) onActionsChange(null);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                actionsRef.current?.querySelector("button")?.focus();
                onActionsChange(null);
            }
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [actionsOpen, onActionsChange]);

    function reorder({ active, over }: DragEndEvent) {
        if (!over || active.id === over.id) return;
        const ids = activeTrackers.map(row => row.id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        onReorder(arrayMove(ids, from, to));
    }

    const rowProps = (tracker: GoalTracker): RailRowProps => ({
        tracker,
        selected: tracker.id === selectedId,
        today,
        count: counts.get(tracker.id),
        actionsOpen: tracker.id === actionsOpen,
        actionsRef,
        onSelect,
        onActionsChange,
        onEdit,
        onArchive,
        onReactivate,
        rowRef: tracker.id === selectedId ? node => { selectedRow.current = node; } : undefined,
    });

    return <nav aria-label="Goal trackers" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
            <span className="text-xs font-medium text-neutral-300">Trackers</span>
            <button type="button" disabled={!hydrated} onClick={onNew}
                className="rounded bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >New tracker</button>
        </div>
        <div className="app-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
            {activeTrackers.length > 0 && <DndContext id="tracker-rail" sensors={sensors} onDragEnd={reorder}>
                <SortableContext items={activeTrackers.map(row => row.id)} strategy={verticalListSortingStrategy}>
                    <ul aria-label="Active goal trackers" className="space-y-1">
                        {activeTrackers.map(tracker => <SortableRailRow key={tracker.id} {...rowProps(tracker)} sortable={sortable} />)}
                    </ul>
                </SortableContext>
            </DndContext>}
            {archivedTrackers.length > 0 && <ul aria-label="Archived goal trackers" className="space-y-1">
                {archivedTrackers.map(tracker => <RailRow key={tracker.id} {...rowProps(tracker)} />)}
            </ul>}
        </div>
        <label className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2 text-xs text-neutral-300">
            <input type="checkbox" checked={showArchived} onChange={event => onToggleArchived(event.target.checked)} />
            Show archived ({archivedCount})
        </label>
    </nav>;
}

function SortableRailRow({ sortable, ...props }: RailRowProps & { sortable: boolean }) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.tracker.id, disabled: !sortable });
    return <RailRow
        {...props}
        rowRef={node => {
            setNodeRef(node);
            props.rowRef?.(node);
        }}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={isDragging ? "z-10 shadow-lg" : undefined}
        handle={<button type="button" ref={setActivatorNodeRef} disabled={!sortable} className={handleClass}
            {...attributes} {...listeners} aria-label={`Reorder ${props.tracker.name}`}>⠿</button>}
    />;
}

function RailRow({
    tracker, selected, today, count, actionsOpen, actionsRef, onSelect, onActionsChange,
    onEdit, onArchive, onReactivate, rowRef, style, className = "", handle,
}: RailRowProps) {
    const due = dueState(goalGrid(tracker), today);
    const nameId = `tracker-rail-name-${tracker.id}`;
    const statusId = `tracker-rail-status-${tracker.id}`;
    const archivedId = `tracker-rail-archived-${tracker.id}`;
    const dueId = `tracker-rail-due-${tracker.id}`;
    const actionsId = `tracker-rail-actions-${tracker.id}`;
    const descriptionIds = [statusId, tracker.isArchived ? archivedId : null, due.kind === "due" ? dueId : null].filter(Boolean).join(" ");
    return <li ref={rowRef} style={style}
        className={`relative rounded-md border ${selected ? "border-indigo-500/50 bg-indigo-500/15" : "border-transparent hover:bg-neutral-800/60"} ${tracker.isArchived ? "opacity-75" : ""} ${className}`}>
        <div className="flex items-start gap-1">
            {handle}
            <button type="button" aria-current={selected ? "true" : undefined} aria-labelledby={nameId} aria-describedby={descriptionIds}
                className={`flex min-w-0 flex-1 items-start gap-2 rounded-md py-2 ${handle ? "pl-1" : "pl-2"} pr-10 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300`}
                onClick={() => onSelect(tracker.id)}>
                <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tracker.color }} />
                <span className="min-w-0 space-y-1">
                    <span id={nameId} title={tracker.name} className="block truncate text-sm font-medium text-neutral-100">{tracker.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
                        <span id={statusId}>{count?.active ?? 0} active · {count?.achieved ?? 0} achieved</span>
                        {tracker.isArchived && <span id={archivedId} className="rounded-full border border-neutral-700 bg-neutral-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Archived</span>}
                        {due.kind === "due" && <span id={dueId} data-goals-slot={dueId}>
                            <TrackerDueBadge due periodLabel={periodLabel(due.mostRecentCompleted)} />
                        </span>}
                    </span>
                </span>
            </button>
        </div>
        <div ref={actionsOpen ? actionsRef : undefined}>
            <button type="button" aria-label={`Actions for ${tracker.name}`} aria-expanded={actionsOpen} aria-controls={actionsOpen ? actionsId : undefined}
                className="absolute right-1 top-1 rounded px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300"
                onClick={() => onActionsChange(actionsOpen ? null : tracker.id)}>···</button>
            {actionsOpen && <div id={actionsId} className="mx-1 mb-1 space-y-1 rounded border border-neutral-800 bg-neutral-950 p-1">
                <button type="button" className={action} onClick={() => onEdit(tracker)}>Edit tracker</button>
                {tracker.isArchived
                    ? <button type="button" className={action} onClick={() => onReactivate(tracker)}>Reactivate tracker</button>
                    : <button type="button" className={action} onClick={() => onArchive(tracker)}>Archive tracker</button>}
            </div>}
        </div>
    </li>;
}
