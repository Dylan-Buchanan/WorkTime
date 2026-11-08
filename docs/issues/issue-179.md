# Title: Per-window identity on pomodoro logs

## Tags

Complexity Classification: T3
Classification Reason: Cross-file, cross-system persistence change: a log field in shared types, every engine log write, a new column on `public.pomodoro_logs` plus redefinitions of the RPCs that insert logs, the staging `isLog` and `timer_state` validators, the completion RPC payload, snapshot/log merging, and several test fixtures.

Severity: High
Severity Reason: Touches the stored work-history record for every client. A defect would silently mis-attribute or drop pomodoro logs, corrupt the staging/snapshot/merge round-trip, or break log inserts for older clients, and recovery needs data repair rather than a simple revert. No security or auth surface, so not Critical.

Needs research before implementation: Yes

### Research Needed

- Confirm which function bodies are live at the head of the migration chain before redefining them. The log insert currently appears in `private.apply_staged_sync_without_goals` (`supabase/migrations/20260805000000_habit_completion_tombstone_guard.sql:138`), reached through `public.apply_staged_sync_without_todo_completions` (redefined in `20261105000000_todo_descriptions.sql`) and `private.apply_staged_sync` (`20261031000000_goal_staged_sync_rpc.sql`), while the `persist_transition` / `complete_timer` inserts are the `20260802010000_staged_sync_rpc.sql` versions (`:79`, `:163`).
- Confirm whether `p_log_upserts` already forwards unknown log fields, and whether any integration or e2e fixture pins the exact log row shape.
- Decide the staging schema question: whether `work_window_id` is optional in `isLog` (no version bump) or required (another version bump on top of issue 1's v10).

## Summary

Pomodoro logs record duration, task and finish time, but not which window they came from. Once a window can be shared by several tasks, the slices of that window cannot be reconstructed afterwards, so a stalled switch is indistinguishable from a deliberate stop.

This issue stamps each work log with the identity of the window it belongs to, using the `window_started_at` value introduced by issue 1. It is persistence only — no new report UI.

The field is also what makes `waiting.since` narratively useful after the fact: one window, several tenants.

## Steps to Reproduce Context

1. Work a few minutes on task A, switch to task B within the same window, then let the window complete.
2. Inspect `public.pomodoro_logs` (or the staged record) for both log rows.
3. Observe: nothing ties the two rows to the same window, so the shared window cannot be reconstructed.

## Requirements for completed issue

1. `PomodoroLogEntry` has `work_window_id`, and `public.pomodoro_logs` has a matching nullable `work_window_id` column.
2. Every log written for window work is stamped with the window identity from `window_started_at`.
3. Every RPC that inserts into `public.pomodoro_logs` writes the column.
4. The staging `isLog` validator accepts the field, and the staging schema chain stays consistent (bump again only if the field is made required).
5. The field round-trips through staging, the sync snapshot baseline and the pull merge without becoming a three-way-merge conflict axis.
6. The completion RPC payload (`CompletionRpcPayload.p_log`) carries the field.
7. The `timer_state` JSONB validation accepts the new `ActiveTimer` field.
8. The column and the type field are nullable on both sides, so historical rows and rows from un-upgraded clients remain valid.
9. A window that completes without any switch still stamps an id.
10. `skipBreak` and `stopWorkTimer` have a consistent, documented attribution story: break skips are not window work.
11. `buildTodayPomodoros`' `duration_minutes` summation is unaffected.
12. No new report UI is added.

## Expected Behavior

- A completed work log carries the identity of the window it was earned in.
- Two slices from one shared window carry the same `work_window_id`.
- Historical rows and rows written by older clients keep a null `work_window_id` and still load, sync and render.
- The Today pomodoro summary is unchanged in count and total minutes.

## Actual Behavior

- `PomodoroLogEntry` has `id`, `task_id`, `duration_minutes`, `finished_at`, `was_break`, `break_skipped` only (`src/state/types.ts:104-111`).
- `public.pomodoro_logs` has no window column (`supabase/migrations/20260801000000_foundation.sql:16-46`).
- The completion journal's log is copied verbatim, so nothing identifies the window.

### Testing

- `pnpm test:unit` — engine coverage that every work log path (`setActiveTask` switch log, `completeTimer`, `stopWorkTimer`) stamps the window id, and that a no-switch completion also stamps one.
- Staging round-trip: a record containing a log with `work_window_id` parses; a log without it still parses (null/absent tolerated).
- `src/lib/data/sync/timerCompletions.test.ts` — the completion payload carries the field.
- `src/lib/data/sync/merge.test.ts` — the field survives a pull merge and never appears as a merge conflict axis.
- `src/lib/today.test.ts` — `buildTodayPomodoros` count and `minutes` are unchanged by the new field.
- `pnpm test:integration` — the local Supabase stack accepts log inserts with and without `work_window_id` through the staged-sync and completion RPCs.
- `pnpm test:e2e` — a switch-then-complete flow produces two log rows sharing one window id.

## Issue Context

### New Files

- One new Supabase migration adding the nullable column and redefining the RPCs that insert logs.

### Remove Files

None.

### Change Files

#### Log type

Code Source: `src/state/types.ts:104-111`
Code Description: The log entry shape used by app state, staging and the sync snapshot.
Code Change Description: Add the nullable window identity field.

```ts
export interface PomodoroLogEntry {
    id: string;
    task_id: string;
    duration_minutes: number;
    finished_at: string;
    was_break: boolean;
    break_skipped: boolean;
    /** Identity of the pomodoro window this work belongs to; null for historical/break rows. */
    work_window_id?: string | null;
}
```

Files Using: `src/lib/engine/core.ts:88-105`, `src/lib/data/sync/timerCompletions.ts:23-28`, `src/lib/today.ts:160-189`

#### Engine log writes

Code Source: `src/lib/engine/core.ts:88-105`
Code Description: `appendLog(state, taskId, durationMinutes, finishedAt, wasBreak, logId, breakSkipped = false)` pushes a log entry.
Code Change Description: Carry the window identity through the writer.
Files Using: `src/lib/engine/taskCommands.ts:42` (switch log), `src/lib/engine/timerCommands.ts:94` (`completeTimer`), `src/lib/engine/timerCommands.ts:134` (`stopWorkTimer`)

#### Database schema and RPCs

Code Source: `supabase/migrations/20260801000000_foundation.sql:16-46`, `20260802000000_sync_metadata.sql:79-90`
Code Description: Table definition plus the `(owner_id, id)` uniqueness constraint; RLS policies in `foundation.sql:52-65` and `20260812060000_optimize_owner_rls_initplans.sql:15-22`.
Code Change Description: Add the nullable column; no RLS change needed.

Code Source: every migration that inserts into `public.pomodoro_logs`
Code Description: `20260801020000_transactional_writes.sql:59,129`; `20260802010000_staged_sync_rpc.sql:79,163,329`; `20260804000000_habit_staged_sync_rpc.sql:159`; `20260805000000_habit_completion_tombstone_guard.sql:138`.
Code Change Description: Include the column in every insert. Confirm the live function bodies at the head of the chain before redefining them (see Research Needed).

Files Using: `src/lib/data/SupabaseDataAccess.ts:554,574,613-614`

#### Staging validation

Code Source: `src/lib/data/staging/types.ts`
Code Description: `isLog` at `:259-269`, `isTimer` at `:271-280`, `isTimerSlice` at `:282-289`, `STAGING_SCHEMA_VERSION = 9` at `:215`, and the migration chain in `parseStagedOwnerRecord` at `:691-860`.
Code Change Description: Accept the new log field (optional), accept the new timer field, and advance the schema only if the log field is made required.

Files Using: `src/lib/data/staging/LocalStagingStore.ts`, `src/lib/data/StagedDataAccess.ts`

#### Sync payload and merge

Code Source: `src/lib/data/sync/timerCompletions.ts:23-28,110-117`
Code Description: `CompletionRpcPayload` with `p_log: PomodoroLogEntry | null`, and `completionRpcPayload` which clones the journaled log.
Code Change Description: The payload carries the field through unchanged.

Code Source: `src/lib/data/sync/merge.ts`
Code Description: `mergeLogs` is applied at `:1123`; logs are keyed by id in the snapshot (`src/lib/data/staging/types.ts:66`).
Code Change Description: Confirm the field is carried and is never treated as a merge conflict axis.

Files Using: `src/lib/data/sync/merge.test.ts`, `src/lib/data/SupabaseDataAccess.test.ts`

#### Today summary

Code Source: `src/lib/today.ts:160-189`
Code Description: `buildTodayPomodoros` filters non-break logs finished today and sums `duration_minutes`.
Code Change Description: No logic change; add a regression assertion that the total is unaffected.

Files Using: `src/lib/today.test.ts`

## Notes

- Depends on issue 1 in this series for `window_started_at`.
- Break skips are not window work: decide and document whether `skipBreak` writes a null window id or no id at all, and keep `stopWorkTimer` consistent with the switch path.
- Keep the column nullable. Do not backfill historical rows.
