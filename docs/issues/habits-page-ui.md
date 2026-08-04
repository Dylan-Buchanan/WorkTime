## Title: Habit Tracker: Habits page UI

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New frontend feature module (page, card, cell strip, period selector, add/edit form, empty state, archive/delete) plus route/nav wiring, reusing the established @dnd-kit reorder and color palette patterns. Depends on issues 1–4 for contracts; the exact engine/context API surface needs research before implementation.
Needs research before implementation: Yes — the engine's window/bucket outputs and `HabitContext`'s exposed actions from issues 1 and 4, and whether the 365 expanded grid is deferred to the detail/expand issue.

## Summary

Build the `/habits` page with reorderable, color-coded habit cards, a period selector, click-to-check grain cells, an add/edit form, an empty state, and archive/delete affordances.

## Steps to Reproduce Context

1. User navigates to the new "Habits" link in `TopNav`.
2. User adds a habit, checks cells in the current window, switches periods, and reorders cards by dragging 6-dot handles.
3. Cells render per the selected period's window, with today highlighted and a check glyph in addition to color fill.

## Expected Behavior

A working `/habits` route rendering the spec's card/cell-strip UI: colorized habit name and description, click-to-check grain cells gated by the current window, today highlight, checked fill + check glyph for non-color accessibility, @dnd-kit reorder with 6-dot handles, a Day/Week/Month/Year period selector, add/edit form, empty state, and archive/delete affordances.

## Actual Behavior

No `/habits` route exists; `App.tsx` routes only `/`, `/projects`, `/analytics`, and auth pages.

## Requirements for completed issue

1. The `/habits` route is added inside `AuthenticatedShell` and linked from `TopNav`.
2. Habit cards render colorized name, description, cell strip, today highlight, and checked fill + check glyph for non-color accessibility.
3. The period selector switches Day/Week/Month/Year windows using the engine's visibility/checkability rules (future-starting cells disabled, current-period cells checkable).
4. Add/edit form, empty state, and archive/delete affordances are present.
5. Reorder uses @dnd-kit and rewrites `position` like `reorderTasks` (position int + `updatedAt` stamp).

## Context

- Files: `src/App.tsx` (routes at lines 31–45, `TopNav` links at lines 78–108), `src/components/ProjectManager/TasksBoardView.tsx` (@dnd-kit `DndContext`/`useSortable` reorder pattern), `src/state/ProjectManagerContext.tsx` (`randomColor()` palette), `docs/brainstorming/Habit-Tracker.md` (locked decisions; "30 days" label should be renamed to Month).
- Code Snippets:

```ts
// src/state/ProjectManagerContext.tsx — palette to reuse so the color picker stays consistent
const randomColor = () => ["#6366F1", "#EC4899", "#10B981", "#F59E0B", "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6"];
```

```tsx
// src/components/ProjectManager/TasksBoardView.tsx — dnd-kit reorder pattern to reuse
// DndContext + PointerSensor; on drag end: arrayMove(...) then reorderTasks(ordered, status)
```

## Notes

None.
