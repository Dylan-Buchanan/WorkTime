## Title: To-dos — completion history + analytics (optional follow-up)

## Tags

Complexity Classification: T3
Severity: Low
Reason: Optional follow-up slice with a wide, well-precedented but multi-layer change surface. Blast Radius=4 (either a new `todo_completions` table or a schema field ripples through a Supabase migration, the `apply_staged_sync` RPC boundary, `DataAccess` + all implementations, `staging/` types, `LocalStagingStore`, `merge.ts`, `SyncCoordinator`, and `AnalyticsPage` — 10+ files, cross-system), Uncertainty=3 (the table-vs-`lastCompletedAt` design choice is unresolved, the to-do feature it depends on is not yet landed, and the analytics integration requirements are unspecified), Behavior=4 (data model change plus DB queries and staged-sync merge logic), Testing=2 (the habit precedent — migration checks on local Supabase, merge/transport tests, analytics UI tests — must be mirrored; a broken sync merge has high user impact), Reversibility=2 (reverting requires schema/RPC cleanup and coordination, following the habits migration precedent). Total=15 → T3.
Needs research before implementation: Yes — decide table vs `lastCompletedAt` based on idempotency (the habit precedent uses a `(habit_id, bucket)` unique key), whether recurring-rollover history is needed for analytics (history implies a table), the shape of the landed to-do domain from Issues A/B/C/E, and which analytics metrics/widgets to add to `AnalyticsPage`. See Notes.

## Summary

(Optional follow-up.) Record completion history for to-dos and surface it on the Analytics page. Decide between a `lastCompletedAt` timestamp on the todo row and a dedicated `todo_completions` table mirroring `habit_completions`, then persist the choice through the staged-sync domain and integrate completion counts/streaks/heatmap data into `src/components/AnalyticsPage.tsx`.

## Steps to Reproduce Context

1. The to-do feature (Issues A–C and E) is landed and users are checking to-dos off.
2. Today `src/components/AnalyticsPage.tsx` shows stats cards, a weekly heatmap, and habit metrics (streaks, completion rate) derived from pomodoro logs and habit completions, but has no to-do completion data.

## Expected Behavior

- Every to-do check-off records completion history (a `todo_completions` row mirroring `habit_completions`, or a `lastCompletedAt` field if single-timestamp history is deemed sufficient).
- The chosen representation persists through the staged-sync domain (migration + RLS, `DataAccess`, staging record/validators, merge/deltas, transport) with idempotent replay.
- `AnalyticsPage` integrates to-do completion metrics (e.g., completions per period, streaks, heatmap) consistent with its existing habit/pomodoro widgets.

## Actual Behavior

No to-do completion history exists. The habit domain already persists completions as rows with an idempotency key: `supabase/migrations/20260803000000_habits.sql` (`habit_completions` with `unique (habit_id, bucket)`), the `HabitCompletion` type in `src/state/types.ts`, and `HabitContext` check/uncheck flows — the model to mirror or deliberately diverge from.

## Requirements for completed issue

1. Completion history is recorded for every check-off (either a `todo_completions` table or a `lastCompletedAt` field, chosen with idempotency and analytics-history needs in mind) and persists through the staged-sync domain with idempotent replay.
2. `AnalyticsPage` integrates to-do completion data (metrics/widgets defined during research).

## Context

- Files:
  - `src/components/AnalyticsPage.tsx` — existing stats cards, weekly heatmap, and habit metrics (streaks, completion rate) to extend with to-do completions.
  - `supabase/migrations/20260803000000_habits.sql` — the `habit_completions` table + `(habit_id, bucket)` unique idempotency key template for a `todo_completions` table.
  - `src/state/types.ts` — `HabitCompletion` (lines 135–141) and `Habit` (lines 123–133); the to-do equivalents would mirror these.
  - `src/lib/data/` — the staged-sync plumbing (DataAccess interface, StagedDataAccess, staging/types.ts, LocalStagingStore, sync/types.ts, sync/merge.ts, SupabaseDataAccess) that any new table or field must thread through.
  - `src/state/HabitContext.tsx` — how completions are created/checked/unchecked and persisted.
- Code Snippets:

```
// supabase/migrations/20260803000000_habits.sql — the idempotency-key template for a todo_completions table
constraint habit_completions_habit_bucket_unique unique (habit_id, bucket),
```

## Notes

- Optional follow-up to the to-do list feature (issue #51); depends on Issues A+B+C and likely E (two-way pomodoro) landing first.
- Research needed before implementation: the landed to-do domain shape (where recurring to-dos live, how check-off/roll works, and its staging/sync integration), the table-vs-`lastCompletedAt` decision given recurrence buckets and analytics needs, which `apply_staged_sync` signature would change, and the specific analytics metrics/widgets to add.
- If this issue is not picked up, to-do completion history remains available only in the pomodoro log/analytics data already captured.
