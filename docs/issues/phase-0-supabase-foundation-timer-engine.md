## Title: Phase 0: Supabase foundation — schema, auth/RLS, and shared TypeScript timer engine

## Tags

Complexity Classification: T3
Severity: Medium
Reason: New external infrastructure (Supabase schema, RLS, auth) plus a faithful port of all domain-logic commands from `src-tauri/src/lib.rs` (~741 lines) into a pure, testable TypeScript module. Blast Radius=4, Uncertainty=2, Behavior=5, Testing=2, Reversibility=1, Total=14. No existing code is modified, but every downstream phase depends on this foundation.
Needs research before implementation: Yes
Research needed: Document the exact Rust engine behaviors to preserve during the port (active-task switch proration, cycle-length window reset in `start_work_timer`, fractional pomodoro accrual/clamping, auto-extend conditions, the `get_state` archival maintenance pass) and define the Supabase schema, RLS policy shape (owner_id scoping), and the invite-code sign-up mechanism (stored secret vs. RPC check).

## Summary

Set up the Supabase project (database schema, row-level security, and email+password auth gated by a secret invite code at sign-up) and port all timer domain logic from the Rust backend into a shared, pure-TypeScript engine. This is the foundation both the Windows client and the future mobile web client will build on.

## Steps to Reproduce Context

1. The app is currently Windows-only; every piece of domain logic lives in `src-tauri/src/lib.rs` as Tauri commands operating on an in-memory `AppStateData` behind a `Mutex`.
2. All state persists to two local JSON files (`data.json`, `pm-state.json`) on the PC via `resolve_storage_path`.
3. There is no database, no authentication, and no multi-user support — a single local user owns all data.

## Expected Behavior

- A Supabase project with tables for `tasks`, `pomodoro_logs`, `settings`, `timer_state`, and `pm_state` (as a per-owner JSONB document), each scoped by `owner_id = auth.uid()` row-level security.
- Auth configured for email + password. Signing up requires a secret invite code (to keep randoms out); existing family members log in with just their email and password.
- A shared TypeScript engine module that replicates every command behavior from `lib.rs` as pure functions, with no Supabase dependency, covered by unit tests.

## Actual Behavior

- Data lives only in local JSON files written by Rust commands; the app cannot be used from any other device and has no accounts.

## Requirements for completed issue

1. Supabase schema exists with all tables (`tasks`, `pomodoro_logs`, `settings`, `timer_state`, `pm_state` as JSONB) and RLS policies scoped to `owner_id = auth.uid()`.
2. Auth: new-account creation requires a secret invite code; returning users authenticate with email + password only.
3. All 18 commands from `lib.rs` (`get_state`, `create_task`, `update_settings`, `load_pm_state`, `save_pm_state`, `set_active_task`, `start_work_timer`, `start_break_timer`, `complete_timer`, `stop_work_timer`, `pause_timer`, `resume_timer`, `skip_break`, `delete_task`, `archive_task`, `finalize_task`, `set_task_target`, `reset_app_state`) are ported into the shared engine with behavior parity tests.
4. The port preserves subtle behaviors: fractional pomodoro accrual with clamping, auto-extend of `target_pomodoros`, mid-timer proration when switching the active task, cycle reset via the `full_cycle_duration_secs` window in `start_work_timer`, the `get_state` archival maintenance pass, and `pause_timer`/`resume_timer` `accumulated_secs` semantics.
5. Supabase URL and anon key are injected via environment variables only — never hardcoded.

## Context

- Files:
  - `src-tauri/src/lib.rs` — all Rust commands, data models (`Task`, `PomodoroLogEntry`, `Settings`, `AppStateData`, `ActiveTimer`, `TimerKind`), and persistence helpers (`resolve_storage_path`, `data_file_path`, `pm_data_file_path`).
  - `src/state/types.ts` — existing frontend type definitions that mirror the Rust models.
  - `src-tauri/Cargo.toml` — current backend dependencies (tauri 2, plugins, serde, chrono, uuid).
- Code Snippets:
  - Data model: `AppStateData { tasks, logs, settings, active_task, current_cycle_pomodoros, timer }` in `src-tauri/src/lib.rs:68-76`.
  - Persistence: `resolve_storage_path` supports `WORK_TIME_DATA_PATH` / `WORK_TIME_PM_DATA_PATH` env overrides (`lib.rs:115-146`) — relevant for the later migration phase.
  - Timer semantics example — completion accrues fractional pomodoros and auto-extends targets in `complete_timer` (`lib.rs:392-448`).

## Notes

- No test framework exists in `package.json` today; a test runner (e.g., vitest) must be added as part of this phase to test the engine.
- The engine must remain free of Supabase/network dependencies so it can be tested in isolation and shared verbatim by both clients.
