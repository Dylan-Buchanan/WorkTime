## Title: To-dos — page UI, CRUD, and recurrence rollover

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New page component plus route/nav wiring, bounded by established app patterns. Blast Radius=3 (new `TodosPage.tsx` modeled on the ~462-line `HabitsPage.tsx`, a `TodosPage.test.tsx`, `src/App.tsx` route + `TopNav` link, and use of the Issue B `TodoContext` API — cross-module but bounded), Uncertainty=2 (moderate unknowns: the exact `TodoContext` API surface, the todo data model, and the bucket/rollover helpers come from dependent Issues A+B, whose shapes aren't finalized here), Behavior=3 (complex UI state management: CRUD, check-off, drag reorder, overdue/today/upcoming/no-date bucketing, sounds, a11y — but no data-model or infra change), Testing=2 (large interactive page, though `HabitsPage.test.tsx` provides a strong precedent), Reversibility=1 (additive route/page; no destructive data consequences). Total=11 → T2.
Needs research before implementation: Yes — the exact `TodoContext` API surface (state shape, method names/signatures), the todo type (recurrence rules, due-date/occurrence fields), and the engine helpers for rollover/bucket classification must be confirmed from Issues A+B before the page UI can be built. See Notes.

## Summary

Add the `/todos` route and page for one-off and recurring to-dos. The page provides add/edit/delete/check-off, drag reorder, and a list grouped into overdue / today / upcoming / no-date buckets, with empty and loading states, sounds, and accessible controls. Recurring to-dos keep one active instance that stays overdue until checked, then roll to the next matching occurrence.

## Steps to Reproduce Context

1. The authenticated user navigates the main app; `TopNav` currently links Timer, Projects, Analytics, and Habits.
2. Today there is no `/todos` route, no `TodosPage`, and no way to create, edit, check off, reorder, or roll a to-do.

## Expected Behavior

- `/todos` route behind the authenticated shell with a `TopNav` link matching the existing nav-item pattern (`play("pressSide")` on click, active-path styling).
- List treats each to-do by due date: overdue / today / upcoming / no-date buckets.
- Add/edit/delete/check-off work through the Issue B `TodoContext`; checking a recurring to-do rolls it to its next occurrence via the Issue A engine (stays overdue until checked, never auto-advances).
- Drag reorder (dnd-kit, as in `HabitsPage`), empty and loading states, sounds, and a11y (labels, focus, keyboard-accessible controls).

## Actual Behavior

No to-do surface exists. `src/App.tsx` has no `/todos` route and no `Todos` nav link; the only list/CRUD pages are `HabitsPage` and the Project Manager views.

## Requirements for completed issue

1. `/todos` route behind `RequireAuth`/`AuthenticatedShell` plus a `TopNav` link.
2. Full to-do CRUD with check-off, drag reorder, overdue/today/upcoming/no-date bucketing, empty and loading states, sounds, and a11y.
3. Recurring rollover: a recurring to-do keeps one active instance that stays overdue until checked and then rolls to the next matching occurrence (no auto-advance).

## Context

- Files:
  - `src/App.tsx` — route table (`<Route path="/habits" element={<HabitsPage />} />` at line 44, inside `AuthenticatedShell` at line 40) and `TopNav` (`<Link to="/habits" ...>` at line 106 with `play("pressSide")` on click); the todos route/nav mirror these.
  - `src/components/HabitsPage.tsx` — the closest UI pattern: dnd-kit `SortableContext` reorder via `reorderHabits`, add/edit draft form with validation, archive/delete, empty states, sounds via `useSounds`, aria-labels, color swatches.
  - `src/state/HabitContext.tsx` — the context CRUD API shape (create/update/archive/delete/reorder/persist) that `TodoContext` from Issue B mirrors.
  - `src/hooks/useSounds.ts` — `SoundKey` set (`completeTask`, `pressSide`, `hover`, `startPomodoro`, ...) available for page interactions.
  - `src/lib/habits/` — engine helper pattern for bucketing/visibility logic that the todos engine (Issue A) will provide (e.g., `isHabitVisible`, `getWindowBuckets`).
- Code Snippets:

```
// src/App.tsx — pattern for adding the /todos route and nav link
<Route path="/habits" element={<HabitsPage />} />
...
<Link to="/habits" onClick={() => handleClick("/habits")} onMouseEnter={() => play("hover")} className={linkClass(loc.pathname.startsWith("/habits"))}>Habits</Link>
```

## Notes

- Dependency slice #3 of the to-do list feature (issue #51); depends on Issues A (engine) and B (TodoContext + persistence).
- The recurrence schedule editor (Issue D) lands with this page as part of the add/edit form.
- Research needed before implementation: the finalized `TodoContext` API, the todo type shape (recurrence rule fields, due date, position), and the engine's rollover/bucket helper signatures.
