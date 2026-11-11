import type { PMTask } from "../../state/types";

export type ChecklistZone = "open" | "done";
export type ChecklistItem = PMTask["checklist"][number];

export function getChecklistZones(items: ChecklistItem[]): Record<ChecklistZone, ChecklistItem[]> {
    const zones: Record<ChecklistZone, ChecklistItem[]> = { open: [], done: [] };
    for (const item of items) {
        zones[item.done ? "done" : "open"].push(item);
    }
    return zones;
}

export function reorderChecklistItems(
    items: ChecklistItem[],
    zone: ChecklistZone,
    activeId: string,
    overId: string,
): ChecklistItem[] {
    if (activeId === overId) return items;

    const zones = getChecklistZones(items);
    const rows = zones[zone];
    const from = rows.findIndex((item) => item.id === activeId);
    const to = rows.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0) return items;

    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    return [...zones.open, ...zones.done];
}

/** Keep existing slots intact, including those of items that have been ticked. */
export function insertChecklistItem(items: ChecklistItem[], item: ChecklistItem): ChecklistItem[] {
    let index = items.length;
    while (index > 0 && items[index - 1].done) index--;
    return [...items.slice(0, index), item, ...items.slice(index)];
}
