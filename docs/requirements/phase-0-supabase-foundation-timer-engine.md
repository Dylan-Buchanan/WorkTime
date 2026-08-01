# Requirements: Phase 0: Supabase foundation — schema, auth/RLS, and shared TypeScript timer engine

## Things To Implement

- Create a Supabase project with five tables, each carrying an `owner_id uuid` column referencing the authenticated user, with Row Level Security enabled and policies scoping all of `SELECT`/`INSERT`/`UPDATE`/`DELETE` to rows where `owner_id = auth.uid()`:
  - `tasks` — multi-row per owner; columns mirror the Rust `Task` model: `id uuid (PK)`, `owner_id uuid`, `name text`, `target_pomodoros int`, `completed_pomodoros real`, `created_at timestamptz`, `completed_at timestamptz null`, `break_skips int`, `archived bool`.
  - `pomodoro_logs` — multi-row per owner; columns mirror `PomodoroLogEntry`: `id uuid (PK)`, `owner_id uuid`, `task_id uuid`, `duration_minutes real`, `finished_at timestamptz`, `was_break bool`, `break_skipped bool`.
  - `settings` — one row per owner (`owner_id` PK) with a JSONB `data` payload holding the `Settings` object.
  - `timer_state` — one row per owner (`owner_id` PK) with a JSONB `data` payload holding `active_task`, `current_cycle_pomodoros`, and `timer` (the `ActiveTimer`).
  - `pm_state` — one row per owner (`owner_id` PK) with a JSONB `data` payload holding the arbitrary Project Manager state document.
- Configure Supabase Auth for email + password. New-account creation must be gated by a secret invite code validated by a Supabase Edge Function that sources the code from a server-side secret and creates the auth user server-side; returning users authenticate with email + password only (no invite code).
- Create a shared, pure TypeScript engine module that ports the 16 domain commands from `lib.rs` as pure functions operating on `AppStateData` with an explicit `now` parameter (no `Date.now()`/wall-clock reads inside the engine), importing no Supabase or network module, and importable by both the Windows client and a future mobile web client. The 16 commands: `get_state` (maintenance pass), `create_task`, `update_settings`, `set_active_task`, `start_work_timer`, `start_break_timer`, `complete_timer`, `stop_work_timer`, `pause_timer`, `resume_timer`, `skip_break`, `delete_task`, `archive_task`, `finalize_task`, `set_task_target`, `reset_app_state`.
- Preserve the following subtle behaviors exactly as implemented in `lib.rs`:
  - Fractional pomodoro accrual with clamping to `[0,1]` of `elapsed / work_secs` (in `complete_timer`, `stop_work_timer`, and mid-timer proration in `set_active_task`).
  - Auto-extend of `target_pomodoros` to `ceil(completed_pomodoros)` only when `completed_pomodoros > target_pomodoros` (strictly greater), and only while `completed_at` is `None` (in `complete_timer`); `stop_work_timer` and `set_active_task` extend without the `completed_at` guard.
  - Mid-timer proration when switching the active task during a running Work timer: accrue partial progress + log for the old task, then reassign the timer's remaining planned seconds to the new task with `accumulated_secs` reset to 0; switching to the same task does not prorate.
  - Cycle reset in `start_work_timer` via the `full_cycle_duration_secs` window: when `current_cycle_pomodoros > 0` and time since the last non-break log `>= full_cycle_duration_secs`, reset `current_cycle_pomodoros` to 0.
  - The `get_state` archival maintenance pass: auto-archive any task with a `completed_at` set but `archived` false, and clear `active_task` if it points to an archived task; return whether state mutated.
  - `pause_timer`/`resume_timer` `accumulated_secs` semantics: pause adds the current run-segment elapsed to `accumulated_secs` and freezes `paused_remaining_secs`; resume starts a new segment at `now`, preserves `accumulated_secs`, and sets `ends_at = now + paused_remaining_secs`.
  - `stop_work_timer` accrues partial progress and logs it but must not set `completed_at`.
  - `skip_break` increments `break_skips`, logs a zero-duration break entry with `break_skipped = true`, and errors on a Work timer or no timer.
  - `finalize_task` sets `completed_at`, sets `target_pomodoros = ceil(completed_pomodoros)`, archives the task, clears the active timer if it was a Work timer for that task, and clears `active_task` if it was the active selection.
  - `set_task_target` clamps the target to `max(1, target)` and, if `completed_pomodoros` exceeds it, raises it to `ceil(completed_pomodoros)`.
  - `create_task` clamps `target_pomodoros` to at least 1 and initializes `completed_pomodoros = 0`, `archived = false`, `completed_at = null`.
  - `reset_app_state` returns `AppStateData` to its defaults (empty tasks/logs, default settings, no active task, `current_cycle_pomodoros = 0`, no timer).
  - `start_break_timer` selects long break when `current_cycle_pomodoros >= segment_length` and resets the cycle counter to 0 in that case; otherwise short break.
- Inject the Supabase project URL and anon key exclusively via the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, read through `import.meta.env`; never hardcode them. Provide a Supabase client configuration module that reads these vars.
- Commit the schema, RLS policies, and Edge Function as Supabase CLI migration files under `supabase/migrations/` so the project is reproducible from source.

## Tests To Create Or Update

- For `the pure TS engine module (16 commands)`:
  - Add a vitest suite mirroring the Rust test scenarios in `lib.rs:828-1277`, one or more tests per command proving behavior parity with the Rust engine.
- For `fractional pomodoro accrual + auto-extend`:
  - Test that completing a full work session accrues exactly 1.0 pomodoro and does not extend the target while within estimate.
  - Test that exceeding the target (strictly greater) raises `target_pomodoros` to `ceil(completed_pomodoros)`.
  - Test that `stop_work_timer` accrues a partial fraction (e.g., 12.5/25 = 0.5) and does not set `completed_at`.
- For `mid-timer proration on active-task switch`:
  - Test switching tasks 12.5 minutes into a 25-minute Work timer accrues 0.5 to the old task, logs one entry, and reassigns the timer to the new task with `planned_secs = 25*60 - 12.5*60` and `accumulated_secs = 0`.
  - Test switching to the same task does not prorate or log.
- For `cycle reset via full_cycle_duration_secs`:
  - Test that starting a new work session after the full-cycle window has elapsed resets `current_cycle_pomodoros` to 0.
  - Test that restarting soon after finishing (within the window) does not reset the cycle.
- For `get_state maintenance pass`:
  - Test that a task with `completed_at` set but `archived` false gets archived and `active_task` is cleared when it pointed to that task.
  - Test the pass is a no-op (returns false) when nothing needs archiving.
- For `pause/resume accumulated_secs semantics`:
  - Test pause accumulates elapsed seconds and freezes `paused_remaining_secs`.
  - Test resume preserves `accumulated_secs`, starts a new segment at `now`, and sets `ends_at = now + paused_remaining_secs`.
  - Test a pause→resume→stop sequence preserves total active progress across the paused gap.
- For `start_break_timer long/short selection`:
  - Test long break is selected and cycle resets when `current_cycle_pomodoros >= segment_length`.
  - Test short break is selected otherwise.
- For `skip_break / finalize_task / set_task_target / create_task / reset_app_state`:
  - Test `skip_break` increments `break_skips`, logs a zero-duration skipped break, and errors on a Work timer or no timer.
  - Test `finalize_task` sets `completed_at`, archives, clamps target to ceil, clears active timer/active task.
  - Test `set_task_target` clamps to `max(1, target)` and never below `ceil(completed_pomodoros)`.
  - Test `create_task` clamps target to at least 1.
  - Test `reset_app_state` returns default state.
- For `error paths`:
  - Test each command's error conditions match Rust (`No active task`, `No active timer`, `Timer not finished yet`, `Not a work timer`, `Not on a break`, `No active break`, `Already paused`, `Timer not paused`, `Timer already finished`, `Task not found`).
- For `Supabase schema, RLS, and auth`:
  - No automated test required in Phase 0. Provide documented manual verification steps (local Supabase CLI boot, signup with valid/invalid invite code, cross-owner RLS denial, owner access) committed alongside the migrations.

## Important Background Information

- The issue's note that "no test framework exists in `package.json` today" is outdated: `vitest`, `vitest.config.ts`, `src/test/setup.ts`, and existing `src/lib/*.test.ts` suites are already present, and `npm run test:unit` works. Only the new engine unit tests are required; no test runner needs to be added.
- The Rust backend already separates pure domain logic (`*_internal` functions, `lib.rs:177-549`) from thin `#[tauri::command]` wrappers (`lib.rs:555-825`) that lock, call, persist, and return. The TS engine ports the pure layer; persistence is a separate adapter concern.
- `src/state/types.ts` already defines TS interfaces mirroring the Rust models (`Task`, `PomodoroLogEntry`, `Settings`, `ActiveTimer`, `TimerKind`, `AppStateData`). The engine should reuse these types rather than redefining them.
- `src/lib/timer.ts` already contains read-only display helpers (`computeRemainingMs`, `computeElapsedSecs`, `computePlannedSecs`, `computeActiveFractionComplete`, formatters). The engine is additive pure domain logic, not a replacement of these helpers.
- `load_pm_state`/`save_pm_state` (`lib.rs:556-580`) are pure file I/O with no domain logic and have no `*_internal` counterpart; they are excluded from the pure engine and belong to the persistence/adapter layer that talks to Supabase.
- `full_cycle_duration_secs` formula (`lib.rs:55-66`): `work_minutes*segment_length + short_break_minutes*(segment_length-1) + long_break_minutes` (in seconds), with `segment_length` clamped to at least 1.
- Current persistence is to local JSON files (`data.json`, `pm-state.json`) via `resolve_storage_path` with `WORK_TIME_DATA_PATH`/`WORK_TIME_PM_DATA_PATH` env overrides (`lib.rs:115-146`). Migration of existing local data into Supabase is a later phase, not Phase 0.
- Default `Settings`: `work_minutes=25`, `short_break_minutes=5`, `long_break_minutes=20`, `segment_length=4`.

## Things To Ensure Are Not Done

- Do not wire the existing Windows client to call the new TS engine in Phase 0 — client wiring is deferred to a later phase. The Rust commands in `lib.rs` must remain unchanged and unremoved.
- Do not migrate existing local JSON data into Supabase in this phase.
- Do not hardcode the Supabase URL or anon key anywhere in source; they must come only from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- The pure engine module must not import the Supabase client, `@supabase/supabase-js`, `fetch`, or any network/IO module; it must be testable in isolation with no mocks.
- The engine must not read the wall clock internally; all time-sensitive functions take an explicit `now` parameter so behavior is deterministic.
- Do not change timer/task engine semantics during the port — behavior must match `lib.rs` exactly (this is a faithful port, not a redesign).
- Do not regress the existing `src/lib/timer.ts` helpers or the existing vitest suites.
- Do not add automated RLS/auth tests in Phase 0; schema and RLS are verified manually via documented steps.
- Do not bundle the invite code into the client or ship it as a hardcoded constant; it must be validated server-side via the Edge Function using a secret.

## User Decisions Made During Requirement Creation

| Decision Needed | Answer | Reason |
| --------------- | ------ | ------ |
| Does Phase 0 include wiring the Windows client to the new TS engine? | Foundation-only; client wiring deferred | Matches the issue's "No existing code is modified" and keeps Phase 0 strictly infrastructure. |
| How should the invite code gate sign-ups? | Supabase Edge Function validates the code from a server-side secret and creates the auth user | Keeps the secret off the client and enforces validation server-side. |
| How should per-owner singleton state be modeled in Supabase? | Singleton rows with JSONB payloads for `settings`, `timer_state`, `pm_state`; multi-row for `tasks` and `pomodoro_logs` | Mirrors the in-memory single-user `AppStateData` model and enables a 1:1 engine port. |
| How should `load_pm_state`/`save_pm_state` be represented in the pure engine? | Excluded from the pure engine (16 domain commands ported); the two I/O commands live in the persistence/adapter layer | Mirrors Rust's own split between pure `*_internal` functions and `#[tauri::command]` I/O wrappers; keeps the engine 100% pure and mock-free. |
| What env var names/injection should be mandated? | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` via `import.meta.env` | Works for both the Tauri webview (Windows) and a future mobile web client since both run Vite. |
| How should schema, RLS, and auth be delivered and tested? | Supabase CLI migration files under `supabase/migrations/` plus documented manual verification; no automated RLS/auth tests in Phase 0 | RLS is hard to unit-test without a running Postgres instance; the engine gets full vitest parity tests while schema/auth are verified manually. |