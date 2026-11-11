# Title: Drag-to-reorder checklist sub-items in the task inspector

## Tags

Complexity Classification: T2
Classification Reason: Well-specified feature touching three layers — a new pure helper module in `src/lib/pm/` with its own unit test, a new `reorderChecklist` mutation on `ProjectManagerContext` that must bypass the unconditional `updatedAt: now()` stamp at `ProjectManagerContext.tsx:690`, and a restructure of the label-based `Checklist` rows at `TaskInspector.tsx:466-517` plus a lazy sortable wrapper that keeps `@dnd-kit` out of the entry chunk. No schema, field, migration, or backfill; concurrency stays single-LWW-blob.

Severity: Medium
Severity Reason: A correctness bug mangles or silently persists checklist ordering in the user's only copy of the array, and there is no undo. A bundle regression would also pull `@dnd-kit` into the entry chunk. The change is additive and localized, with no migration, auth, or concurrency exposure.

Needs research before implementation: No

## Summary

`PMTask.checklist` (`src/state/types.ts:57`) is an inline array with no reorder affordance anywhere, so item order is whatever happened to be created first. The checklist is where a user writes the concrete steps toward a task, and step order is exactly the kind of thing a user has an opinion about. Without reordering, correcting a badly-ordered list means deleting and re-typing every item.

This issue adds drag-and-drop reordering to a task's checklist so the user's chosen order persists until they drag again.

Array position in `PMTask.checklist` is the **only** storage for order — no new field, no `order` column, no migration, no backfill. Total order is derived from a single rule:

- **Zone derivation:** `done` decides which of two zones an item renders in (open, then done), separated by a divider with no header and no collapse. The persisted array is **never** rewritten by a completion toggle — ticking writes only that item's `done` flag, exactly as `TaskInspector.tsx:488-492` does today. Completion is pure presentation; the stored model has no way to express "done" as a position.
- **Canonicalization on drop:** a drop writes `[open items in visual order, done items in their existing relative order]`. Only a drag writes order.
- **Untick restores the array slot.** Before any drag, unchecking returns the item to its exact original position mid-list. After a drag, done items sit at the array end, so unchecking surfaces the item at the bottom of the open block — visually where it already appeared to be.

The design deliberately makes the "completed items sink to the bottom" convention **display-only** over a manually-ordered array. Almost every comparable app persists the sink — either by rewriting the array or by sorting on a `done`-then-`order` key — which silently discards the user's arrangement every time they make progress. Refusing to write at all means the stored order is a pure artifact of user intent.

Storing order as array position rather than an `order` field collapses four separate problems into none: no backfill for legacy tasks, no merge logic on rename, no identity tracking across sync, and an exactly-reversible uncheck.

## Steps to Reproduce Context

1. Open a task in the inspector (from `ProjectManagerPage` or from `TimerPanel`).
2. Add three or more checklist items via the "Add checklist item" input.
3. Observe that rows render in creation order with no handle, no drag affordance, and no way to move an item.
4. Note that the only correction path is deleting and re-typing every item.

## Requirements for completed issue

1. Every checklist row exposes an always-visible drag handle in a reserved left gutter; the handle is discoverable without hovering and touch-friendly.
2. Dragging a row within the open zone reorders it; dragging within the done zone reorders it among done items.
3. After a drop, the persisted `PMTask.checklist` array is canonical: open items in visual order followed by done items in their existing relative order.
4. Toggling an item's checkbox never reorders the persisted array — it changes only that item's `done` flag.
5. Unchecking a done item surfaces it at the bottom of the open block (or its original slot, if no drag has happened yet).
6. Adding a new item inserts it after the last open item, not at the array end, so the stored array stays canonical between drags.
7. Reordering does **not** change the task's `updatedAt`, so the "Updated {date}" footer line and any `updated` sort position are unaffected by a drag.
8. Pointer, touch, and keyboard drag all work, including dnd-kit screen-reader announcements and keyboard coordinate movement.
9. A cross-zone drop (open item onto the done zone, or vice versa) does nothing beyond the canonical reorder within its own zone; it must **not** set `done`.
10. `@dnd-kit` is not pulled into the entry chunk — it stays behind a lazy boundary inside the inspector.
11. Reordering works on Done and archived tasks (only the waiting control is gated on those states).
12. Unknown `activeId`/`overId` (or a task switch mid-drag) is a no-op that returns the input array unchanged rather than throwing.
13. Long checklists auto-scroll during a drag.
14. The sortable machinery is not rendered at all when every zone holds zero or one item.

## Expected Behavior

- Checklist rows can be dragged into any order the user wants, with the order persisting across remounts, refreshes, and surfaces.
- Completion still visually sinks items to a done zone, but the underlying array keeps the user's arrangement of open items.
- A drag does not rewrite metadata (no `updatedAt` bump, no reordering of the parent task in `updated`-sorted views).
- Ticking, unticking, and adding items leave the array in a canonical, drag-compatible shape.
- The app loads the same as today for users who never open a checklist.

## Actual Behavior

- `Checklist` (`TaskInspector.tsx:466-517`) maps `task.checklist` directly, so rows always render in raw array order.
- There is no handle, no drag library, and no pure ordering logic in `src/lib/pm/`.
- Adding an item appends with `crypto.randomUUID()` at `TaskInspector.tsx:475`, which after any future drag would land the new open item *after* the done block.

### Testing

- `pnpm test:unit`:
  - New pure-helper unit tests in `src/lib/pm/` covering zone extraction, visual-index to array-index mapping, canonical reassembly, the insert-after-last-open companion, unknown-id no-ops, and zero/one-item zones.
  - Component coverage following the established pattern for DnD tests: a mocked `@dnd-kit/core` plus a hand-fired `DragEndEvent` (as in `GoalsPage.test.tsx` and `DeckPreview.test.tsx`). Any new component test asserting rows must use `Suspense`-aware `findBy…` queries, not `getBy…`.
  - Existing `TaskInspector.test.tsx:28` and `ProjectManagerContext.test.tsx:87` render with `checklist: []`, so the `Suspense` boundary breaks nothing today.
- `pnpm run build` and manual inspection of the entry chunk to confirm `@dnd-kit` is still absent. No script asserts chunk contents, so this invariant is upheld by review only.
- Manual: drag with mouse, touch, and keyboard; tick/untick before and after a drag; add items before and after a drag; confirm the footer `Updated` line does not change on drag.

## Issue Context

### New Files

**Pure helper + test** — `src/lib/pm/checklistOrder.ts` and `src/lib/pm/checklistOrder.test.ts`, alongside the existing pure modules (`completion.ts`, `waiting.ts`, `waitingDuration.ts`, `workStart.ts`). No DOM, no `crypto`, no clock — callers supply ids, matching the existing pure-layer convention. This is where the hard logic lives: zone extraction, visual-index to array-index mapping, and canonical reassembly.

```ts
export type ChecklistZone = "open" | "done";
export type ChecklistItem = { id: string; title: string; done: boolean };

/** Move `activeId` to `overId` within `zone`, then canonicalize to
 *  [open in visual order, done in existing relative order].
 *  Returns the input array unchanged when any id is absent. */
export function reorderChecklistItems(
    items: ChecklistItem[],
    zone: ChecklistZone,
    activeId: string,
    overId: string,
): ChecklistItem[];

/** Insert a new open item after the last open item, keeping the array canonical. */
export function insertChecklistItem(items: ChecklistItem[], item: ChecklistItem): ChecklistItem[];
```

**Lazy sortable surface** — a new component (for example `src/components/ProjectManager/ChecklistSortable.tsx`) holding the `DndContext`, the two `SortableContext`s, the rows, and the handle. It is reached only through `React.lazy` from `TaskInspector` so `@dnd-kit` stays out of the entry chunk.

### Remove Files

None.

### Change Files

#### Checklist rendering and add path

Code Source: `src/components/ProjectManager/TaskInspector.tsx`, `Checklist` component (lines 466-517)
Code Description: Renders `task.checklist` as a flat list of `<label>` rows wrapping a checkbox and a title, plus an add input.
Code Change Description: Route rows through the lazy sortable surface behind `React.lazy` + `Suspense`; restructure each row as a `<div>` with an explicit `<label htmlFor>` (see edge case below); switch the add path to `insertChecklistItem` instead of a plain append; keep the checkbox `onChange` writing only `done`.
Files Using: `src/components/ProjectManager/ProjectManagerPage.tsx:5,199,230`, `src/components/TimerPanel.tsx:5,778`

```tsx
// TaskInspector.tsx:471-479 — add path today
const add = () => {
    const title = input.trim();
    if (title) {
        update({
            checklist: [...task.checklist, { id: crypto.randomUUID(), title, done: false }],
        });
    }
    setInput("");
};

// TaskInspector.tsx:484-495 — row structure today (whole row is a <label>)
<label key={item.id} className="flex items-center gap-2 text-[11px] bg-neutral-900 border border-neutral-800 px-2 py-1 rounded">
    <input
        type="checkbox"
        checked={item.done}
        onChange={() =>
            update({
                checklist: task.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
            })
        }
    />
    <span className={item.done ? "line-through opacity-60" : ""}>{item.title}</span>
</label>
```

#### Context mutation that does not bump `updatedAt`

Code Source: `src/state/ProjectManagerContext.tsx:685-693`
Code Description: `updateTask` merges the patch and unconditionally stamps `updatedAt: now()`.
Code Change Description: Add `reorderChecklist(taskId, items)` to the context value interface (declared near line 95, exposed near line 818) that writes checklist order **without** stamping `updatedAt`. Skipping the bump is safe for persistence and sync: `pmState` is a singleton blob, `savePMState` stamps `pmUpdatedAt` unconditionally (`src/lib/data/StagedDataAccess.ts:462-468`), and push is decided by whole-blob comparison (`src/lib/data/sync/merge.ts:1482`). Per-task `updatedAt` plays no part in PM change detection or conflict resolution.
Files Using: `src/components/ProjectManager/TaskInspector.tsx` (via `useProjectManager`), `src/state/ProjectManagerContext.test.tsx`

```ts
// src/state/ProjectManagerContext.tsx:685-693
const updateTask = (id: string, patch: Partial<PMTask>) => {
    const normalizedPatch = Object.prototype.hasOwnProperty.call(patch, "dueDate") ? { ...patch, dueDate: normalizeTaskDueDate(patch.dueDate) } : patch;
    persist((prev) => {
        const task = prev.tasks[id];
        if (!task) return prev;
        const merged = { ...task, ...normalizedPatch, updatedAt: now() };
        return { ...prev, tasks: { ...prev.tasks, [id]: withWaitingInvariant(withCompletionStamp(task, merged, merged.updatedAt)) } };
    });
};
```

#### Handle convention to follow

Code Source: `src/components/GoalsPage.tsx:589-592`
Code Description: Existing dnd-kit row in the Goals rail.
Code Change Description: Follow the same shape for the checklist handle — `useSortable`, `setNodeRef` on the row, `{...attributes} {...listeners}` on a `⠿` button with an `aria-label`, and `KeyboardSensor` with `sortableKeyboardCoordinates` (line 76).
Files Using: `src/components/GoalsPage.tsx:3,76,589-592`

```tsx
const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: goal.id });
<article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} ...>
    <button className={button} {...attributes} {...listeners} aria-label={`Reorder ${goal.title}`}>⠿</button>
```

#### Entry-chunk constraint

Code Source: `src/App.tsx:39-43`
Code Description: Route-level code splitting comment plus the lazy `ProjectManagerPage` import.
Code Change Description: No edit required, but the constraint governs where `DndContext` lives. `TaskInspector` renders in the lazy `ProjectManagerPage` **and** in `TimerPanel`, which `App.tsx:6` statically imports into the entry chunk, so the sortable surface must load lazily from *inside* `TaskInspector`. The full drag affordance must be present on both surfaces — the boundary is internal, not a prop that disables it.
Files Using: `src/components/TimerPanel.tsx:5`

```ts
// Route-level code splitting: heavy pages (recharts, @dnd-kit, date-fns) are
// only downloaded when their route is visited, keeping the entry chunk small.
```

#### Row label swallows the handle press

Code Source: `src/components/ProjectManager/TaskInspector.tsx:484`
Code Description: The row is a single `<label>`, so clicking *anywhere* in it toggles the checkbox via label activation.
Code Change Description: A drag handle placed inside that label will toggle `done` when pressed. Preventing default on `pointerdown` alone is not enough, because the `click` still reaches the label. Restructure the row (`<div>` plus an explicit `<label htmlFor>`, or `preventDefault` on `click` too). This failure mode looks exactly like a dnd-kit bug and will be debugged in the wrong place if it is not handled deliberately.

## Edge Cases

- **Stale `activeId`** — task selection can change mid-drag. `TimerPanel.tsx:778` renders the inspector with `key={inspectorTask.id}` (hard remount), but `ProjectManagerPage.tsx:199,230` does not. Owning the `DndContext` **inside** the lazily-loaded checklist component (not at inspector root) means an unmount discards drag state rather than firing `onDragEnd` against a different task's checklist. The helper must additionally treat an `activeId` or `overId` absent from the current items as a no-op returning the input array unchanged.
- **Zero or one item in each zone** — the sortable component is not rendered at all, so no dnd-kit chunk is fetched and no `Suspense` fallback appears. A checklist with one open and one done item has no drag anywhere.
- **Two inspector mounts are mutually exclusive** (`isXl` vs `!isXl` in `ProjectManagerPage`), so there is no duplicate-identifier concern from two live registries.
- **Done and archived tasks remain reorderable.** Only the waiting control is gated on `Done`/archived; the checklist stays editable there, so reordering must not be gated.
- **Auto-scroll** — the inspector body is `overflow-y-auto` (`TaskInspector.tsx:165`), so long checklists need drag auto-scroll.
- **No undo.** The app has no general undo beyond the agent's Start-of-Day snapshot, so a mis-drop is corrected by dragging back (or by keyboard). Deliberately not introducing a toast-undo — that would make this feature the app's first and only undo affordance.
- **No animation on tick.** An item jumping from the open zone into the done zone moves between two sortable contexts; animating that in a dense 11px panel is not worth the complexity.
- **Accepted cost:** after the first drag, array order stops being creation order. Any future code that reads checklist position as history would be reading user intent and calling it history. This is chosen, not overlooked — history isn't wanted; only current state matters.
- **Accepted asymmetry:** an approved agent `update` still replaces `checklist` wholesale from the proposal (`src/lib/agent/applyTaskChange.ts:23`), order and identity included. That freedom is deliberate and must not be tightened into a lockdown as part of this issue.
- **Concurrency is unchanged.** Because PM state is a single LWW blob, a reorder can still be swallowed by a concurrent edit from another surface landing later — true of every PM write today. This issue should not imply reorder is more durable than the rest of PM state.
- **Test mechanics:** `TaskInspector.test.tsx:28` and `ProjectManagerContext.test.tsx:87` both render with `checklist: []`, so the `Suspense` boundary breaks nothing today. Any new component test asserting rows must use `Suspense`-aware queries (`findBy…`), not `getBy…`. Pure helper correctness belongs in `src/lib/pm/` unit tests, so the index math isn't covered only by mocked events.

## Out of Scope

- Collapsing or truncating the done zone past some count (the panel just scrolls).
- A "restore creation order" affordance.
- Persisted `order` fields anywhere (no column, no migration, no backfill).
- Locking checklist order in `applyTaskChange` / approved agent updates.
- Any undo affordance for a mis-drop.

## Notes

Related follow-up (tracked separately): the Start-of-Day planner prompt must gain an `order` clause so an unattended daily plan cannot silently reshuffle a user-arranged checklist.
