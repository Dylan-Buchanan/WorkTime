## Title: Phase 3: One-time data migration — local JSON to Supabase

## Tags

Complexity Classification: T2
Severity: High
Reason: A standalone one-time tool that exports `data.json` + `pm-state.json` and seeds them into Supabase under the owner account with idempotency and cross-store link mapping. Blast Radius=2 (migration script + shared types + dev-data; existing app files untouched), Uncertainty=2, Behavior=3, Testing=2, Reversibility=2, Total=11. Severity is High because real user data is at stake if the seed duplicates or corrupts rows.
Needs research before implementation: Yes
Research needed: Inspect `dev-data/data.json` and `pm-state.json` for legacy shape variants (partial/in-flight timers, archived/finalized tasks, pre-existing `appTaskId` linkage between the two stores) and define idempotency keys plus the link-mapping strategy so re-runs do not duplicate tasks or logs.

## Summary

Provide a one-time migration tool that moves a user's existing local data from `data.json` and `pm-state.json` into Supabase under their account, preserving task ↔ PM-task links and being safe to re-run.

## Steps to Reproduce Context

1. All current data lives in two local JSON files: `data.json` (app state: tasks, logs, settings, active_task, cycle counter, optional active timer) and `pm-state.json` (project manager document).
2. `data.json` can contain a live/partial timer, archived and finalized tasks, and fractional `completed_pomodoros` values (see `dev-data/data.json`, 5719 lines of sample data).
3. PM tasks link to backend tasks via `appTaskId`; after migration both stores must live in Supabase with that linkage intact.
4. The filesystem path can be overridden with the `WORK_TIME_DATA_PATH` / `WORK_TIME_PM_DATA_PATH` env vars (`src-tauri/src/lib.rs:115-146`), useful for pointing the tool at an export.

## Expected Behavior

- Running the migration once seeds all of a user's tasks, logs, settings, cycle state, and PM document into Supabase under their `owner_id`, with the `appTaskId` linkage preserved.
- Re-running the migration does not create duplicate tasks or log entries.
- After migration, the app behaves exactly as before for that user (same tasks, same progress numbers, same analytics).

## Actual Behavior

- Data exists only in local JSON files and has no path into the cloud backend.

## Requirements for completed issue

1. A migration tool (script or in-app flow) reads `data.json` and `pm-state.json` and inserts their contents into the Phase 0 Supabase tables scoped to the authenticated user's `owner_id`.
2. Idempotent seeding: re-runs must not duplicate `tasks` or `pomodoro_logs` rows (e.g., deterministic IDs or an `insert ... on conflict` strategy).
3. Cross-store linkage preserved: each migrated PM task's `appTaskId` still resolves to the migrated backend task.
4. Legacy edge cases handled: archived/finalized tasks, fractional `completed_pomodoros`, and an in-flight timer at migration time (its state is preserved or safely dropped with explicit behavior).
5. Existing `dev-data/data.json` (and the sample PM state, if present) is used to validate the migration in a test/scratch Supabase environment before touching real data.

## Context

- Files:
  - `dev-data/data.json` — representative legacy app state (tasks with fractional progress, archived/finalized entries, logs).
  - `src-tauri/src/lib.rs:68-110` — `AppStateData` model the JSON encodes (`tasks`, `logs`, `settings`, `active_task`, `current_cycle_pomodoros`, `timer`).
  - `src-tauri/src/lib.rs:115-146` — `resolve_storage_path` env overrides (`WORK_TIME_DATA_PATH`, `WORK_TIME_PM_DATA_PATH`).
  - `src/state/types.ts` — `Task`, `PomodoroLogEntry`, `Settings`, `ActiveTimer`, `ProjectManagerState`, and `PMTask.appTaskId` link field.
- Code Snippets:
  - Migration source example — a completed task with fractional progress: `dev-data/data.json:1-12` (`"completed_pomodoros": 1.024`, `"archived": true`).
  - Storage path override: `resolve_storage_path(app, "WORK_TIME_DATA_PATH", "data.json")` in `lib.rs:115-146`.

## Notes

- This phase runs last because it depends on the Phase 0 schema, Phase 1 data layer, and Phase 2 auth being in place (the user must be able to sign in before their data can be seeded under their account).
- Consider running the migration against a scratch Supabase project first, then against the real one only after validation.
