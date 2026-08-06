## Title: To-dos — recurrence schedule editor UI

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Multi-part form UI slice built on two not-yet-existing pieces — Issue A's recurrence engine (rule types, `isDueOn`, `nextOccurrence`) and Issue C's `TodosPage` add/edit form — plus new format helpers. Blast Radius=3 (new schedule-picker component, pure format helpers in `src/lib/todos/`, and mid-cycle due-date recompute logic, integrated cross-module into the C form and driven by the A engine), Uncertainty=2 (moderate unknowns: exact engine rule shapes, the todo draft state, and the intended mid-cycle recompute behavior), Behavior=3 (complex interactive state logic and a state-management recompute; not a data-model change), Testing=1 (pure format helpers are unit-testable; component tests for the picker; no critical user impact), Reversibility=1 (UI feature; simple revert, no data consequences). Total=10 → T2.
Needs research before implementation: Yes — confirm Issue A's engine API surface (recurrence rule type shapes, `isDueOn`/`nextOccurrence` signatures, monthly clamping and last-day−N semantics, yearly mm/dd Feb 29 behavior) and Issue C's todo draft/state model so the picker's output shape and the mid-cycle recompute hook correctly. See Notes.

## Summary

Add the recurrence schedule editor used when creating or editing a to-do: recurrence type tabs (weekly / monthly / yearly), a weekday multi-select, a monthly day grid with 1–31 clamping plus "last day" and "last day − N", a yearly mm/dd input with Feb 29 skipped in non-leap years, and a human-readable preview of the resulting rule. Editing a rule mid-cycle recomputes the to-do's pending due date from the current time.

## Steps to Reproduce Context

1. A user creates or edits a to-do and wants to give it a recurring schedule (e.g., every Mon/Wed, the 31st of the month, or Feb 29 yearly).
2. Today no schedule-picker component exists anywhere in the app; the only scheduling affordances are simple `dueDate`/estimate inputs on PM tasks and habit frequency options (`daily`/`weekly`/`monthly`), and no `src/lib/todos/` recurrence code exists yet.

## Expected Behavior

- Picker surfaces the three recurrence kinds as type tabs; weekly shows a weekday multi-select; monthly shows a day-of-month grid covering 1–31 (clamping to the last day of short months) plus "last day" and "last day − N"; yearly edits a mm/dd pair with Feb 29 skipped in non-leap years.
- A human-readable preview renders the composed rule (e.g., "Every Monday and Wednesday", "Monthly on the last day", "Every year on Feb 29").
- Editing a rule mid-cycle recomputes the pending due date via the Issue A engine's `nextOccurrence(rule, now)` instead of mutating the old occurrence's date.

## Actual Behavior

No recurrence editor exists. `src/components/HabitsPage.tsx` demonstrates the app's form patterns (draft state, color swatches, aria-labels, inline forms) and `src/lib/habits/` has grid/calendar rendering utilities that could inform a monthly day grid, but there is no schedule picker, no preview formatting, and no mid-cycle recompute behavior.

## Requirements for completed issue

1. Schedule picker with recurrence type tabs, weekday multi-select, monthly day grid (1–31 clamp, "last day", "last day − N"), and yearly mm/dd with Feb 29 skip — wired into the Issue C add/edit form.
2. Human-readable preview of the composed rule.
3. Mid-cycle rule edits recompute the pending due date from the current time using the Issue A engine, without auto-advancing or background processing.

## Context

- Files:
  - `src/lib/habits/` — precedent for pure formatting/calendar helpers and grid rendering utilities (e.g., `derive365Grid`, `getWindowBuckets`) the picker can follow; the rule preview helpers should live in `src/lib/todos/` alongside the Issue A engine.
  - `src/components/HabitsPage.tsx` — existing form/picker UI patterns (draft state, frequency selection, color swatches, a11y labels, sounds).
  - `src/state/HabitContext.tsx` — how form state flows into a context `updateHabit`/`createHabit`; `TodoContext` from Issue B will mirror this for the todos form.
  - `src/state/types.ts` — `Habit`, `PMTask.dueDate`, `PMTask.estimatePomos` — existing scheduling/estimate fields the editor interacts with conceptually.
- Code Snippets:

```
// src/lib/habits/calendar.ts — the noon-based local-date convention the picker/format helpers should reuse
function localDateAtNoon(year: number, month: number, day: number): Date {
    return new Date(year, month, day, 12, 0, 0, 0);
}
```

## Notes

- Dependency slice #4 of the to-do list feature (issue #51); lands with Issue C as part of the to-do add/edit form and depends on Issue A's engine types/functions.
- Research needed before implementation: Issue A's final rule type shapes and function signatures, Issue C's draft/todo state model, whether the monthly day grid reuses the habits grid utilities or is a new picker, and where the human-readable preview helpers live.
