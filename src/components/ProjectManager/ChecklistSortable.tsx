import { useLayoutEffect, useRef } from "react";
import {
    DndContext, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors,
    type CollisionDetection, type DragEndEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ChecklistItem, ChecklistZone } from "../../lib/pm/checklistOrder";
import { ChecklistRow, ChecklistZones } from "./ChecklistRows";

export default function ChecklistSortable({ zones, onToggle, onReorder }: {
    zones: Record<ChecklistZone, ChecklistItem[]>;
    onToggle: (id: string) => void;
    onReorder: (zone: ChecklistZone, activeId: string, overId: string) => void;
}) {
    const mounted = useRef(false);
    const keyboardDrag = useRef(false);
    useLayoutEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    // The keyboard sensor also supplies coordinates, but they aren't a pointer position.
    const detectCollision: CollisionDetection = (args) =>
        keyboardDrag.current ? closestCenter(args) : pointerWithin(args);

    const zoneOf = (id: UniqueIdentifier) => {
        if (zones.open.some((item) => item.id === id)) return "open";
        if (zones.done.some((item) => item.id === id)) return "done";
    };

    const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
        const zone = zoneOf(args.active);
        if (!zone) return;
        const droppableRects = new Map(args.context.droppableRects);
        for (const item of zones[zone === "open" ? "done" : "open"]) droppableRects.delete(item.id);
        return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableRects } });
    };

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: "auto" }),
    );

    function handleDragEnd({ active, over }: DragEndEvent) {
        if (!mounted.current || typeof active.id !== "string" || typeof over?.id !== "string") return;
        const zone = zoneOf(active.id);
        if (zone && zoneOf(over.id) === zone) onReorder(zone, active.id, over.id);
    }

    function titleOf(id: UniqueIdentifier) {
        const zone = zoneOf(id);
        return (zone && zones[zone].find((item) => item.id === id)?.title) || "checklist item";
    }

    function renderZone(zone: ChecklistZone) {
        const items = zones[zone];
        if (items.length === 0) return;
        if (items.length === 1) return <ChecklistRow item={items[0]} onToggle={onToggle} />;
        return (
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
                {items.map((item) => <SortableRow key={item.id} item={item} onToggle={onToggle} />)}
            </SortableContext>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={detectCollision}
            onDragStart={({ activatorEvent }) => { keyboardDrag.current = activatorEvent instanceof KeyboardEvent; }}
            onDragEnd={handleDragEnd}
            autoScroll
            accessibility={{
                announcements: {
                    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
                    onDragOver: ({ active, over }) => {
                        if (active.id === over?.id) return;
                        return over && zoneOf(over.id) === zoneOf(active.id)
                            ? `${titleOf(active.id)} is over ${titleOf(over.id)}.`
                            : `${titleOf(active.id)} is outside its checklist section.`;
                    },
                    onDragEnd: ({ active, over }) => over && active.id !== over.id && zoneOf(over.id) === zoneOf(active.id)
                        ? `Dropped ${titleOf(active.id)} at the position of ${titleOf(over.id)}.`
                        : `${titleOf(active.id)} stayed in its original position.`,
                    onDragCancel: ({ active }) => `Reordering ${titleOf(active.id)} was canceled.`,
                },
            }}
        >
            <ChecklistZones open={renderZone("open")} done={renderZone("done")} />
        </DndContext>
    );
}

function SortableRow({ item, onToggle }: { item: ChecklistItem; onToggle: (id: string) => void }) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    return (
        <ChecklistRow
            item={item}
            onToggle={onToggle}
            rowRef={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 1 : undefined }}
            handle={(
                <button
                    ref={setActivatorNodeRef}
                    type="button"
                    className="size-full touch-none cursor-grab rounded text-base text-neutral-400 hover:text-neutral-100 active:cursor-grabbing"
                    {...attributes}
                    {...listeners}
                    aria-label={`Reorder ${item.title}`}
                >
                    ⠿
                </button>
            )}
        />
    );
}
