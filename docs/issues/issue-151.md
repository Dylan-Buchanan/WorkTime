# Title: Reorder active goal trackers from the rail

## Tags

Complexity Classification: T2
Classification Reason: Feature addition spanning the goals state layer and the Goals UI, plus two test suites, but no new persistence path or schema change. `reorderTrackers` mirrors the existing `reorderGoals` pattern in `src/state/GoalContext.tsx` L299–307 and rides the existing `mutate` + save effect, so the work is ordering invariants plus a second sortable context, not a data-model change. Complexity comes from the sortable-context split (active vs archived rows), the collision-free `sortOrder` append rule, and the absence of an existing keyboard-reorder UI test precedent.

Severity: Medium
Severity Reason: A usability enhancement with no data-loss or security surface. A wrong append rule can produce duplicate `sortOrder` values that fall through to `id.localeCompare` and look randomly ordered, but the user can reorder again to repair it and only known tracker rows are touched through the normal `mutate` + save path. Impact is contained to tracker navigation order, not timer/task semantics or persisted data integrity.

Needs research before implementation: Yes

### Research Needed

This issue depends on Issue 1 ("Goals tracker rail"), which is not in the tree yet, and the rail's component boundary determines where the second `DndContext` lives. The existing goals reorder test also works by intercepting a mocked `DndContext.onDragEnd`, which will not work cleanly with two sortable contexts.

- Confirm the rail component boundary from Issue 1 (single component vs a new file such as `src/components/goals/TrackerRail.tsx`) and whether the rail already owns a `DndContext`, so the new tracker `DndContext` does not collide with the goals list `DndContext` at `src/components/GoalsPage.tsx` L430–439.
- Confirm where the `[...activeBySortOrder, ...archivedBySortOrder]` split replaces the current `ordered(...).filter(...)` derivation at `GoalsPage.tsx` L94–96, and how the `trackers[0]` fallback (L96) behaves when the selected tracker is archived or hidden during a reorder.
- Confirm the append invariant against `createTracker`'s `Math.max(-1, ...sortOrder) + 1` rule (`GoalContext.tsx` L244). `isGoalTracker` (`src/lib/goals/factories.ts` L23–27) only checks `finite(v.sortOrder)`, so duplicates and gaps are accepted on load and nothing normalizes them — the append rule is the only thing preventing ties.
- Decide how to satisfy the keyboard-reorder UI test: drive the real dnd-kit `KeyboardSensor` under jsdom, or assert through the mocked `DndContext.onDragEnd` like the existing goals reorder test (`GoalsPage.test.tsx` L505–519). Note the mock at `GoalsPage.test.tsx` L43–49 stores a single `drag.end`, so two `DndContext` instances would overwrite each other.
- Likely files: `src/state/GoalContext.tsx`, `src/components/GoalsPage.tsx`, the Issue 1 rail component, `src/state/GoalContext.test.tsx`, `src/components/GoalsPage.test.tsx`, `src/lib/goals/testFixtures.ts`.

## Summary

`GoalTracker` has a `sortOrder` field (`src/state/types.ts` L323) but nothing ever changes it — the only writer is `createTracker`, which appends with `max + 1`. Once the tracker rail from Issue 1 becomes the primary navigation for trackers, the rail's order is what the user scans on every visit, and that order is currently frozen at creation time.

Let the user drag active trackers into a new order directly in the rail and persist that order through the existing goals save path.

## Steps to Reproduce Context

1. Open the Goals page with three or more trackers created in an order that no longer matches how often they are used.
2. Look at the tracker list — currently the card-title `<select>` in `src/components/GoalsPage.tsx` L263–277; after Issue 1, the rail.
3. There is no control anywhere that changes tracker order, and `reorderGoals` (`src/state/GoalContext.tsx` L299) only reorders goals within one tracker.
4. Observe the only `sortOrder` writer for trackers is `createTracker` at `src/state/GoalContext.tsx` L244.

## Requirements for completed issue

1. `GoalContextValue` in `src/state/GoalContext.tsx` exposes `reorderTrackers(idsInOrder: readonly string[]): void`.
2. `reorderTrackers` dedupes the input, rejects any id that is not a known tracker, assigns `sortOrder` `0..n-1` to the supplied ids with a fresh `updatedAt`, then appends every tracker not in the list with continuing indices in their current relative order so `sortOrder` values stay unique across active and archived rows.
3. The write flows through the existing `mutate` + save effect — no new persistence path, no direct `data.saveGoals` call, and no change to `GoalTracker` or any storage key.
4. Rail rows are rendered with `useSortable` using the sensor config already used for goals (`PointerSensor` with `activationConstraint.distance: 6`, `KeyboardSensor` with `sortableKeyboardCoordinates`) and a dedicated drag handle button labelled `Reorder <tracker name>`.
5. Only active trackers are draggable: `SortableContext` receives active ids only, and archived rows render in their own non-sortable group with no handle and no drop target.
6. The rail list renders as an explicit `[...activeBySortOrder, ...archivedBySortOrder]` rather than a single sorted-then-filtered array, so archived rows never interleave mid-list while "Show archived" is on.
7. `src/state/GoalContext.test.tsx` covers the order written, duplicate input deduped, unknown id rejected, and archived rows preserved at the end.
8. `src/components/GoalsPage.test.tsx` covers a keyboard reorder of two active trackers.

## Expected Behavior

- Dragging one active tracker row over another reorders the rail immediately and persists the new order, with the new order surviving a reload.
- A dedicated `Reorder <tracker name>` handle is the only drag affordance, so clicking a row still selects the tracker.
- Keyboard users can move focus to a handle, pick up a row, move it, and drop it, with focus following the row — matching the existing goals list behavior (`GoalRow` at `src/components/GoalsPage.tsx` L589–592).
- Archived rows stay grouped after all active rows, are not draggable, and do not accept a drop.
- Reordering never changes which tracker is displayed in the content column, and every tracker keeps a distinct `sortOrder` value.
- Rail scrolling during a drag uses the existing `app-scrollbar` rail — no new overlay scroller.

## Actual Behavior

- No reorder API exists for trackers; `GoalContextValue` (`src/state/GoalContext.tsx` L37–55) has `reorderGoals` but nothing for trackers.
- The tracker list is derived with a single `ordered(...).filter(...)` pass (`src/components/GoalsPage.tsx` L94–96), and archived rows interleave with active rows when "Show archived" is on.
- Tracker order is fixed at creation time by `createTracker`'s `max + 1` assignment.

### Testing

- `pnpm test:unit` — new `GoalContext.test.tsx` cases: `reorderTrackers` writes `0..n-1` and a fresh `updatedAt`; duplicate ids in the input are deduped; an unknown id throws `RangeError`; trackers omitted from the input (including archived ones) keep their relative order after the supplied ids with continuing indices; every `saveGoals` payload still contains all trackers (mirroring the payload assertions at `GoalContext.test.tsx` L138–164).
- `pnpm test:unit` — new `GoalsPage.test.tsx` case: keyboard reorder of two active trackers moves the rows and persists the new `sortOrder`; a second case asserting archived rows expose no `Reorder` handle and cannot be reordered.
- Re-check the existing goals reorder test (`GoalsPage.test.tsx` L505–519) still passes with a second `DndContext` on the page; the mock at L43–49 keeps only one `onDragEnd`, so it may need to key by context or the tracker drag may need its own seam.
- Manual check that a single active tracker exposes no usable drag affordance and that dropping outside a valid target leaves the order untouched.

## Issue Context

### New Files

None required. Rail row components live wherever Issue 1 placed the rail (optionally `src/components/goals/TrackerRail.tsx`).

### Remove Files

None.

### Change Files

#### Goals context API

Code Source: `src/state/GoalContext.tsx` L37–55
Code Description: `GoalContextValue` currently exposes `reorderGoals(trackerId: string, idsInOrder: readonly string[]): void` and no tracker reorder.
Code Change Description: Add `reorderTrackers(idsInOrder: readonly string[]): void` to the interface and its implementation.

```ts
export interface GoalContextValue {
    // ...
    reorderGoals(trackerId: string, idsInOrder: readonly string[]): void;
    reorderTrackers(idsInOrder: readonly string[]): void;
}
```

#### Reorder implementation to mirror

Code Source: `src/state/GoalContext.tsx` L299–307
Code Description: `reorderGoals` dedupes, validates ownership, and writes `sortOrder: index` with a fresh `updatedAt` through `mutate`.

```ts
reorderGoals: (trackerId, ids) => {
    const unique = [...new Set(ids)];
    if (unique.some(id => stateRef.current.goals[id]?.trackerId !== trackerId)) throw new RangeError("Invalid goal order");
    mutate(previous => {
        const goals = { ...previous.goals };
        unique.forEach((id, index) => { goals[id] = { ...goals[id], sortOrder: index, updatedAt: new Date().toISOString() }; });
        return { ...previous, goals };
    });
},
```

Code Change Description: `reorderTrackers` follows the same shape over `previous.trackers`, but after assigning `0..n-1` to the supplied ids it must append every remaining tracker with continuing indices in its current relative order. Validate against `stateRef.current.trackers[id]` and throw `RangeError` for unknown ids. `mutate` (L236–239) already routes through `publish` and the save effect (L197), so no new persistence path is needed.

#### Append invariant reference

Code Source: `src/state/GoalContext.tsx` L244
Code Description: `const sortOrder = Math.max(-1, ...Object.values(stateRef.current.trackers).map(row => row.sortOrder)) + 1;`
Code Change Description: None — reference only. The append rule must preserve this "new trackers land last" invariant and must not create ties; ties currently fall through to `id.localeCompare` in the `ordered` helper (`GoalsPage.tsx` L38).

#### Rail list derivation

Code Source: `src/components/GoalsPage.tsx` L38, L94–96
Code Description:

```tsx
const ordered = <T extends { sortOrder: number; id: string },>(rows: T[]) => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
const trackers = ordered(Object.values(state.trackers)).filter(row => showArchived || !row.isArchived);
const tracker = trackers.find(row => row.id === state.ui.selectedTrackerId) ?? trackers[0];
```

Code Change Description: Build the rail list as `[...activeBySortOrder, ...archivedBySortOrder]` so archived rows never interleave, and keep the content column's effective tracker derivation unchanged. Archived rows are omitted from the `SortableContext` items array entirely.

#### Sortable row precedent

Code Source: `src/components/GoalsPage.tsx` L74–77, L430–439, L589–592
Code Description: The goals list already has the required sensor config and handle markup.

```tsx
const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
);
// ...
<DndContext sensors={sensors} onDragEnd={reorder}>
    <SortableContext items={visible.map(row => row.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2" aria-label="Goals list"> ... </div>
    </SortableContext>
</DndContext>
// GoalRow
const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: goal.id });
<article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} ...>
    <button className={button} {...attributes} {...listeners} aria-label={`Reorder ${goal.title}`}>⠿</button>
```

Code Change Description: Reuse the same sensors and handle pattern for rail rows, with `aria-label={\`Reorder ${tracker.name}\`}`. The goals reorder handler (`GoalsPage.tsx` L161–172) shows the existing guard style: `if (!tracker || !over || active.id === over.id) return;` plus a map back to the full id order before writing.

#### Existing tests

Code Source: `src/state/GoalContext.test.tsx` L138–164
Code Description: A persistence test that spies on `data.saveGoals` and asserts every payload contains all trackers, goals, and check-ins; it already calls `api.reorderGoals(...)` at L149.
Code Change Description: Extend with tracker reorder assertions (order written, duplicates deduped, unknown id rejected, archived rows preserved at the end).

Code Source: `src/components/GoalsPage.test.tsx` L29, L43–49, L505–519
Code Description: `drag.end` holds a single captured `onDragEnd`; the `DndContext` mock replaces the component but renders the original, so a second `DndContext` on the page overwrites `drag.end`.
Code Change Description: Make the drag seam able to distinguish the tracker rail context from the goals list context, then add a keyboard reorder test for two active trackers.

### Files Using

`src/state/GoalContext.tsx` (`reorderGoals` shape), `src/components/GoalsPage.tsx` (goals list dnd wiring and `GoalRow` handle), the Issue 1 rail component.

## Notes

- This is Issue 2 of 2 and assumes Issue 1 ("Goals tracker rail") is merged. Do not re-implement rail selection, maintenance, or the mobile drawer here.
- Out of scope: reordering archived trackers, cross-group drag between active and archived rows, and any change to `GoalTracker` fields, storage keys, or schema.
- `updatedAt` must be refreshed by the reorder so the row flows through the same `mutate` + save path as every other tracker edit — never a direct write.
