## Title: Phase 1: Rewire clients to Supabase — data layer, state contexts, and timer reconciliation

## Tags

Complexity Classification: T4
Severity: High
Reason: Replaces the entire persistence layer: a new supabase-js data-access layer, a full rewire of `AppStateContext` (every `invoke` call, auto-progression loop), `ProjectManagerContext` (JSONB persistence, `ui` stays local), and `StateSyncBridge` estimate-pushing, plus exactly-once timer completion and "finished while device was closed" reconciliation. Blast Radius=4 (the two contexts feed every component — TimerPanel, TaskPanel, SettingsPanel, AnalyticsPage, all PM views), Uncertainty=3, Behavior=4, Testing=3, Reversibility=2, Total=16.
Needs research before implementation: Yes
Research needed: Define the exact idempotency contract (e.g., `completed` flag on the `timer_state` row + conditional update), the device-closed reconciliation flow (fetch on load/focus, single writer), and how the existing auto-progression loop must change to avoid double-complete/refresh races; determine the test strategy (mock supabase-js vs. a test project) since no test infrastructure exists.

## Summary

Swap the app's Tauri `invoke` persistence for a supabase-js data-access layer and rewire `AppStateContext`, `ProjectManagerContext`, and `StateSyncBridge` to it, adding an idempotency guard so a timer is never double-completed when the phone and PC both observe its end.

## Steps to Reproduce Context

1. `AppStateContext.tsx` calls `invoke(...)` for `get_state`, `create_task`, `set_active_task`, `start_work_timer`, `start_break_timer`, `complete_timer`, `stop_work_timer`, `skip_break`, `update_settings`, `finalize_task`, `pause_timer`, `resume_timer`, `reset_app_state`; its auto-progression effect watches `state.timer.ends_at` and chains `complete_timer` → `start_break_timer`/`start_work_timer` (lines 88-127).
2. `ProjectManagerContext.tsx` already detects `isTauri` and persists to `localStorage` in the browser (`save_pm_state` only runs when Tauri); `normalizeState()` shapes any loaded document.
3. `StateSyncBridge.tsx` pushes PM estimate changes to the backend via `invoke("set_task_target", ...)` (line 147).
4. Today there is exactly one writer (the local Rust backend); with two devices, both clients will independently observe `ends_at` passing.

## Expected Behavior

- Both the Windows client and the web client read and write the same per-user data in Supabase, driven by the shared engine from Phase 0.
- A running timer started on one device is correctly reconciled on the other (countdown from UTC `ends_at`; completed exactly once).
- Data refreshes when the app loads or gains focus; no WebSocket/realtime subscriptions.
- `ProjectManagerContext` syncs `projects`, `tasks`, and `meta` to a per-owner JSONB document while `ui` (view state, filters, selection) remains device-local in `localStorage`.

## Actual Behavior

- All state comes from a single local Rust backend through `invoke`; the browser build of the PM context falls back to `localStorage` (which is not shared across devices), and `AppStateContext` has no non-Tauri storage path at all.

## Requirements for completed issue

1. A data-access layer over supabase-js exposes the same async contract the contexts use today (fetch state, create task, start/pause/resume/stop/complete timer, update settings, finalize, set target, save/load PM state).
2. Timer completion is idempotent across devices: e.g., a `completed` flag on the `timer_state` row and a conditional update so the second client to finish the same timer becomes a safe no-op instead of writing a duplicate log.
3. `AppStateContext` runs on the shared engine + data layer, keeps the auto-progression loop, and re-fetches on load and on `focus`/`visibilitychange`.
4. `ProjectManagerContext` persists `projects`/`tasks`/`meta` as a per-owner JSONB document in Supabase; `ui` stays in `localStorage` and is not synced.
5. `StateSyncBridge` estimate propagation uses the data layer instead of `invoke`.
6. The "timer finished while this device was closed" case reconciles exactly once (no duplicate `pomodoro_logs` rows, no double cycle increments) and the auto-start chain (work → break → work) remains safe when two devices reconcile concurrently.
7. Existing LSP error in `ProjectManagerContext.tsx` (missing `relatedTo` on `PMTask` construction at line ~324) is resolved while this file is being rewired.

## Context

- Files:
  - `src/state/AppStateContext.tsx` — all `invoke` calls (lines 73, 102, 113, 116, 147, 158, 164, 179, 188, 222, 225, 226, 227, 231, 244, 248, 254), auto-progression loop (lines 88-127), `remainingMs()`, notification fallback (lines 7-35).
  - `src/state/ProjectManagerContext.tsx` — `isTauri`/`hasLocalStorage` branching (lines 96-98), `save_pm_state`/`load_pm_state` invokes (lines 114, 174), `normalizeState()` (lines 644-773).
  - `src/state/StateSyncBridge.tsx` — `invoke("set_task_target", ...)` (line 147), PM↔backend link propagation effects.
  - `src/state/types.ts` — shared data model types.
  - `src-tauri/src/lib.rs` — source-of-truth logic (referenced via the Phase 0 engine port, not called directly after this phase).
- Code Snippets:
  - Auto-progression loop: `AppStateContext.tsx:88-127` — currently calls `invoke("complete_timer")` directly on `ends_at` expiry; must become engine+data-layer calls with a `progressing` guard that still holds under concurrent clients.
  - PM persistence branch: `ProjectManagerContext.tsx:126-155` — `persistSnapshot` switches between Tauri `save_pm_state` and `localStorage`; becomes Supabase JSONB upsert (debounced) for the synced slices only.

## Notes

- Supabase URL/anon key come from environment variables configured in Phase 0; the data layer must be injectable/mockable for tests.
- Realtime subscriptions are explicitly out of scope — freshness comes from re-fetch on load/focus.
