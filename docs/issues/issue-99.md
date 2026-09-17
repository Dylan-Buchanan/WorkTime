## Title: Pet quick activity logging (one-tap records, undo, today-only correction)

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Cross-cutting: engine command, record shapes, DataAccess/StagedDataAccess/InMemory method additions, edit-in-place correction, and — critically — building a minimal toast system that does not exist today (new shared UI surface plus undo timing). Blast Radius=3 (engine, types, data layer interface + implementations, toast system, page integration), Uncertainty=2 (toast placement/mounting, undo semantics, coordination with G's later staging fields), Behavior=3 (derived-state-from-log rule, append-only records, new toast subsystem), Testing=2 (toast/undo timing and derived state are fiddly; moderate impact), Reversibility=1. Total=11. Sits near the T2/T3 boundary; stays T2 because DataAccess changes are additive interface pairs following an established pattern, not a data-model change.
Needs research before implementation: No

## Summary

Implement the single one-tap write path for pet care activities: an engine `logActivity` command behind both the schedule card inline checks and the bottom potty bar, writing minimal append-only records; toast-with-undo for accidental taps; and edit-in-place timestamp correction for today's records only. All derived schedule state is computed from the log, never stored.

## Steps to Reproduce Context

1. Issue B's inline check buttons and potty bar have no command to call; there is no way to record that an activity happened.
2. Tapping a check cannot reset the potty interval, update the countdown, or appear in the "done today" strip.

## Expected Behavior

One tap (inline check or potty bar) records `{ activityType, timestamp, durationMinutes? }`; the potty interval anchor, countdown target, and done-today counts all recompute from the new record. An accidental tap can be undone within a toast window; a genuine mistake can be corrected by editing the timestamp for today's records.

## Actual Behavior

No logging path exists; schedule completion cannot be expressed.

## Requirements for completed issue

1. **One engine command** (e.g. `logActivity(state, activityType, timestamp, durationMinutes?, id)`) is the *only* write path — inline checks on schedule cards and the bottom potty bar both call it. No per-button divergent logic.
2. **Record model** (decided): minimal and append-only — `{ activityType, timestamp, durationMinutes? }` plus house-standard `id`/`createdAt`. No provenance (scheduled vs ad-hoc), no notes, no trigger attribution. `durationMinutes` is optional and only offered for training/playtime.
3. **Duration stepper (decided)**: on completing a training or playtime item, an optional minutes stepper appears inline; skipping it keeps the interaction one tap. **Potty never shows a duration** (nor do feeding items unless a case emerges).
4. **Undo (decided)**: every log produces a toast with an Undo action (~8s window). Undo deletes the record entirely (it never happened); the interval anchor, countdown, and counts recompute from the log. This requires building a **minimal toast subsystem** — none exists today (no toast/notistack/sonner dependency; the app only has native `alert()` stubs and inline banners). Keep it small and reusable; Issue F reuses it.
5. **Correction (decided)**: timestamps of **today's records only** are editable in place (small edit affordance on completed-strip entries and cards). Yesterday-and-older records are not editable through this UI. Corrections are out-of-order-safe because all derived state recomputes from the log.
6. **Derived state is computed, never stored**: interval anchor (latest potty record), next-due, overdue, and "done today" counts are pure functions over the activity log. No stored "next due = 3:10" state, no manual countdown offsets.
7. **Persistence boundary**: add `savePetActivityRecords(...)` / `loadPetActivityRecords()` (naming per house style) to the `DataAccess` interface and implement in `InMemoryDataAccess` and `StagedDataAccess` following `saveHabits` (full-set diff → LWW stamps → tombstones, one `store.update()`). The staging-store schema fields and Supabase tables themselves are Issue G; this issue defines and implements the interface pair.
8. **Nap records are a separate lane**: the nap toggle (Issue B) writes nap records via its own command; a potty logged right after waking is just a potty record — no special casing in v1.
9. Tests: engine tests for the command and derived-state recomputation (out-of-order entries, undo-then-relog, correction shifting the interval); context/data-access tests following `src/state/HabitContext.test.tsx`; toast/undo timing covered by component tests.

## Context

- Files:
  - `src/lib/engine/taskCommands.ts` — command shape precedent (`state, id, now, logId` parameters, clone-first, EngineResult).
  - `src/lib/data/DataAccess.ts` — `saveHabits/loadHabits`, `saveTodos/loadTodos` full-slice pairs to mirror.
  - `src/lib/data/StagedDataAccess.ts` — `saveHabits` (lines ~410–464) full-set diff → stamps → tombstones implementation to copy.
  - `src/lib/data/InMemoryDataAccess.ts` — the second DataAccess implementation to update.
  - `src/state/HabitContext.tsx` — idempotent completion creation pattern (skip if identical record exists).
  - `src/components/AnalyticsPage.tsx` (lines ~442) — the native `alert()` stubs that are the current, insufficient "message" pattern.
- Code Snippets:

  The interface pair to mirror (`src/lib/data/DataAccess.ts`):
  ```ts
  saveHabits(habits: Habit[], completions: HabitCompletion[]): Promise<void>;
  loadHabits(): Promise<{ habits: Habit[]; completions: HabitCompletion[] }>;
  ```

## Notes

- The single-write-path rule is what prevents the "why did the interval reset differently?" bug class.
- The toast system built here is shared infrastructure: Issue F's overdue toast must use it, not a second mechanism.
- Undo-deletion semantics are clean by design (append-only + recompute); indefinite deletion of old records was explicitly rejected.
