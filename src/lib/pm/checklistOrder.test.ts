import { describe, expect, it } from "vitest";
import { getChecklistZones, insertChecklistItem, reorderChecklistItems, type ChecklistZone } from "./checklistOrder";

const openA = { id: "a", title: "Open A", done: false };
const openB = { id: "b", title: "Open B", done: false };
const doneA = { id: "c", title: "Done A", done: true };
const doneB = { id: "d", title: "Done B", done: true };
const items = [doneA, openA, doneB, openB];

describe("checklist order", () => {
    it("extracts both zones in stored relative order", () => {
        expect(getChecklistZones(items)).toEqual({ open: [openA, openB], done: [doneA, doneB] });
        expect(getChecklistZones([])).toEqual({ open: [], done: [] });
    });

    it("moves an open item by visual position and appends the done items in their existing order", () => {
        const reordered = reorderChecklistItems(items, "open", "a", "b");
        expect(reordered).toEqual([openB, openA, doneA, doneB]);
        expect(items).toEqual([doneA, openA, doneB, openB]);
        expect(reordered[1]).toBe(openA);
    });

    it("moves a done item upward and preserves the relative order of open items", () => {
        expect(reorderChecklistItems(items, "done", "d", "c")).toEqual([openA, openB, doneB, doneA]);
    });

    it.each<[ChecklistZone, string, string]>([
        ["open", "missing", "a"],
        ["done", "c", "missing"],
        ["open", "a", "c"],
        ["done", "c", "a"],
        ["open", "a", "a"],
    ])("keeps the original array for a %s drop from %s to %s without a valid move", (zone, active, over) => {
        expect(reorderChecklistItems(items, zone, active, over)).toBe(items);
    });

    it("keeps the original array when a zone is empty or has a single item", () => {
        const empty: typeof items = [];
        const singletonZones = [doneA, openA];
        expect(reorderChecklistItems(empty, "open", "a", "b")).toBe(empty);
        expect(reorderChecklistItems(singletonZones, "open", "a", "b")).toBe(singletonZones);
    });
});

describe("insertChecklistItem", () => {
    const added = { id: "new", title: "New", done: false };

    it("inserts after the last open item and preserves existing positions", () => {
        expect(insertChecklistItem([openA, doneA, openB, doneB], added)).toEqual([openA, doneA, openB, added, doneB]);
        expect(insertChecklistItem([openA, openB, doneA, doneB], added)).toEqual([openA, openB, added, doneA, doneB]);
    });

    it("inserts at the start when there are no open items", () => {
        expect(insertChecklistItem([doneA, doneB], added)).toEqual([added, doneA, doneB]);
        expect(insertChecklistItem([], added)).toEqual([added]);
    });
});
