# Requirements: Phase 1: Rewire clients to Supabase — data layer, state contexts, and timer reconciliation

## Things To Implement

- Create a data-access layer that exposes the same async contract the state contexts use today, backed by the shared TypeScript engine (`src/lib/engine/`) for state transitions and Supabase for persistence. The contract covers: fetch state, create task, set active task, start work timer, start break timer, complete timer, stop work timer, pause timer, resume timer, skip break, update settings, finalize task, set task target, reset app state, save PM state, and load PM state.
- Define the data-access layer as a TypeScript interface (e.g., `DataAccess`) with two implementations: a real Supabase implementation that reads/writes the Phase 0 tables, and an in-memory fake implementation for unit tests. The interface must be injectable so tests can substitute the fake without mocking `@supabase/supabase-js` at the module level.
- Provide the `DataAccess` implementation to the React tree via a context provider (e.g., `DataProvider` / `useData()`) so `AppStateContext`, `ProjectManagerContext`, and `StateSyncBridge` consume it through the context rather than importing a concrete module or calling `invoke`.
- The Supabase `DataAccess` implementation must obtain the authenticated session via `supabase.auth.getSession()` before any query and surface a clear, identifiable error if no session exists. Authentication UI, sign-in flow, sign-out flow, and session refresh are out of scope for this phase; a valid Supabase session is a precondition.
- Add a new Supabase migration that adds a `completed boolean not null default false` column to the `public.timer_state` table. This column is the idempotency guard for cross-device timer completion.
- Implement `completeTimer` in the data layer as an idempotent conditional update: run the shared engine's `completeTimer` to compute the next state, then issue `UPDATE timer_state SET data = <next>, completed = true WHERE owner_id = <uid> AND completed = false`. Insert the `pomodoro_logs` row and update the affected `tasks` row only if the conditional update affects exactly one row. If zero rows are affected, the timer was already completed by the other device; the call is a safe no-op that returns the current server state without inserting a duplicate log or incrementing the cycle.
- Reset `completed` to `false` whenever a new timer is started (`startWorkTimer`, `startBreakTimer`) by including `completed = false` in the `timer_state` upsert payload.
- Rewire `AppStateContext` so every `invoke(...)` call is replaced by a call to the injected `DataAccess`. The context must no longer import `invoke` from `@tauri-apps/api/core` for state persistence. The notification fallback logic may remain unchanged.
- Preserve the auto-progression loop in `AppStateContext` (work → break → work chaining) but route it through the data layer's `completeTimer` → `startBreakTimer` / `startWorkTimer` calls. The existing `progressing` ref guard must be retained so a single device does not double-complete, and the idempotency conditional update must protect against the second device double-completing.
- Add re-fetch on app load and on window `focus` / `visibilitychange` events to `AppStateContext` so state reconciles when the user returns to the app. No WebSocket or Supabase realtime subscriptions.
- Implement "timer finished while this device was closed" reconciliation: on load and on focus, after fetching `timer_state`, if `timer` is non-null, `ends_at` has passed, and `completed` is `false`, the data layer runs the engine's `completeTimer` with the conditional update. If the conditional update succeeds (one row affected), the log is inserted and the cycle increments exactly once. If zero rows are affected (the other device already completed), the device re-fetches and continues from the completed state. No duplicate `pomodoro_logs` rows and no double cycle increments may occur.
- Ensure the auto-start chain (work → break → work) remains safe when two devices reconcile concurrently: the idempotency guard prevents double completion, and starting the next timer follows last-write-wins semantics (acceptable because the user typically interacts on one device at a time and re-fetch-on-focus reconciles drift).
- Rewire `ProjectManagerContext` so `projects`, `tasks`, and `meta` are persisted as a per-owner JSONB document in the `pm_state` table via the data layer, replacing the current `invoke("save_pm_state")` / `invoke("load_pm_state")` calls. The `ui` slice (view state, filters, selection, sort, search, board options) must remain device-local in `localStorage` and must not be synced to Supabase.
- The PM persistence must remain debounced (as today) for the synced slices. On app load and on window `focus` / `visibilitychange`, the PM context must re-fetch the `pm_state` document from Supabase and replace local `projects` / `tasks` / `meta` with the server version while preserving the local `ui` slice. Last-write-wins semantics apply; field-level merge is out of scope for this phase.
- Rewire `StateSyncBridge` so the estimate-propagation effect (`invoke("set_task_target", ...)`) uses the data layer's `setTaskTarget` instead of `invoke`. All other PM ↔ backend link-propagation effects must continue to function through the data layer.
- For `timer_state` and `settings` mutations other than completion (start, pause, resume, stop, skip, update settings, set active task, set target, finalize), the data layer uses plain upserts with last-write-wins semantics. No optimistic concurrency / version columns are required for this phase; correctness relies on re-fetch-on-focus reconciling drift.
- Resolve the existing LSP error in `ProjectManagerContext.tsx` (missing `relatedTo` on `PMTask` construction) while the file is being rewired, so the file compiles cleanly with no type errors.

## Tests To Create Or Update

- For `the injectable DataAccess interface + DataProvider`:
  - Add a unit test proving the `DataProvider` supplies the injected `DataAccess` instance to consumers via `useData()`.
  - Add a unit test proving a test can wrap the tree with a `DataProvider` carrying the in-memory fake and that contexts call the fake instead of `invoke`.
- For `the in-memory fake DataAccess implementation`:
  - Add a unit-test suite exercising every method of the fake (fetch state, create task, set active task, start/pause/resume/stop/complete timer, skip break, update settings, finalize, set target, reset, save/load PM state) to verify it satisfies the `DataAccess` contract and returns the same `{ state, value }` shapes the engine produces.
- For `AppStateContext rewired to the data layer`:
  - Update the existing `AppStateContext.test.tsx` suite to inject the in-memory fake via `DataProvider` instead of `vi.mock("@tauri-apps/api/core")`. Existing scenarios (loads state on mount, computes `remainingMs`, auto-progresses an expired work timer into a break, `createTask` calls through the data layer and refreshes) must still pass.
  - Add a unit test proving `AppStateContext` re-fetches state on window `focus` and `visibilitychange` events.
  - Add a unit test proving the auto-progression loop does not double-complete when the same device's tick fires multiple times while `progressing` is true.
  - Add a unit test proving the auto-progression loop handles the "already completed by the other device" no-op result (zero rows affected) gracefully: it re-fetches and continues to start the next break/work without error.
- For `idempotent completeTimer (conditional update on completed flag)`:
  - Add a unit test using the in-memory fake simulating two devices: both call `completeTimer` for the same expired timer; the first succeeds (log inserted, cycle incremented), the second is a no-op (no duplicate log, no double cycle increment).
  - Add an integration test against the real local Supabase stack proving the conditional update prevents a duplicate `pomodoro_logs` row when two `completeTimer` calls race the same timer. Assert exactly one log row exists afterward and `current_cycle_pomodoros` incremented by exactly one.
- For `device-closed reconciliation`:
  - Add a unit test using the in-memory fake: seed `timer_state` with an expired timer and `completed = false`; on the next fetch, the data layer reconciles by completing it exactly once (one log row, cycle incremented, `timer` nulled, `completed = true`).
  - Add a unit test for the case where the other device already completed (`completed = true` on fetch): the device re-fetches, sees no active timer, and does not insert a log or increment the cycle.
  - Add an integration test against real Supabase proving the reconciliation flow inserts exactly one `pomodoro_logs` row and sets `completed = true` when the device was closed during timer expiry.
- For `ProjectManagerContext rewired to Supabase JSONB`:
  - Update the existing `ProjectManagerContext.test.tsx` / `ProjectManagerContext.test.ts` suites to inject the in-memory fake via `DataProvider` instead of mocking `invoke`. Existing scenarios (create project, create task, normalize state, persistence) must still pass.
  - Add a unit test proving `ui` state is persisted to `localStorage` and not sent to the data layer.
  - Add a unit test proving `projects` / `tasks` / `meta` are sent to the data layer's `savePMState` and loaded from `loadPMState`, and that `ui` is preserved across a load.
  - Add a unit test proving the PM context re-fetches `pm_state` on window `focus` / `visibilitychange` and replaces local `projects` / `tasks` / `meta` while preserving local `ui`.
- For `StateSyncBridge estimate propagation via the data layer`:
  - Add a unit test proving estimate changes propagate through `DataAccess.setTaskTarget` instead of `invoke`, and that the `pendingTargetsRef` guard still prevents feedback loops.
- For `the new Supabase migration (completed column)`:
  - Add an integration test against real Supabase proving the `completed` column exists, defaults to `false`, and that a conditional update `WHERE completed = false` affects exactly one row on the first call and zero rows on the second.
- For `e2e tests against real Supabase`:
  - Update the e2e test suite to run against the real local Supabase stack with per-test isolation (each test provisions a fresh test user and session, and cleans up afterward). The existing `e2e/mock-ipc.js` Tauri IPC bridge is replaced by real Supabase backend setup.
  - Add an e2e scenario proving a full timer cycle (start work → wait for expiry → auto-progress to break → start work) works end-to-end against real Supabase.
  - Add an e2e scenario proving PM task creation and estimate editing persist to real Supabase and survive a page reload.
- For `the LSP error resolution in ProjectManagerContext.tsx`:
  - Add a unit test (or extend an existing one) proving `PMTask` construction includes `relatedTo` so the file compiles with no type errors.

## Important Background Information

- Phase 0 delivered the Supabase schema (`supabase/migrations/20260801000000_phase_0_foundation.sql`), the shared TypeScript engine (`src/lib/engine/`), and the Supabase client module (`src/lib/supabase.ts`). The five tables (`tasks`, `pomodoro_logs`, `settings`, `timer_state`, `pm_state`) are owner-scoped with RLS policies requiring `auth.uid()` match.
- `timer_state` and `pm_state` are single-row-per-owner JSONB tables keyed by `owner_id`. `tasks` and `pomodoro_logs` are multi-row per owner. `settings` is single-row per owner.
- The shared engine (`src/lib/engine/`) exposes 16 pure functions that clone input state, take explicit `Date` and task-ID inputs, perform no I/O, and return `{ state, value }`. The data layer must call these functions to compute state transitions, then persist the resulting `state` to Supabase.
- `AppStateContext.tsx` currently calls `invoke` for 15 commands and contains an auto-progression effect (lines 88-127) that watches `state.timer.ends_at` and chains `complete_timer` → `start_break_timer` / `start_work_timer`. The `progressing` ref prevents the same device from re-entering the completion block.
- `ProjectManagerContext.tsx` already branches on `isTauri` / `hasLocalStorage`. In Tauri it calls `invoke("save_pm_state")` / `invoke("load_pm_state")`; in the browser it falls back to `localStorage`. After this phase, both paths are replaced by the data layer (Supabase), with `ui` remaining in `localStorage` on all platforms.
- `StateSyncBridge.tsx` pushes PM estimate changes to the backend via `invoke("set_task_target", ...)` (line 147) and has a `pendingTargetsRef` guard that prevents estimate-update feedback loops. This guard must be preserved when rewiring to the data layer.
- There is no auth context, sign-in UI, or session management in the app today. `src/lib/supabase.ts` creates a client but is imported by nothing. This phase assumes a valid Supabase session exists as a precondition; auth wiring is a separate phase.
- The existing e2e mock (`e2e/mock-ipc.js`) is a faithful JS port of the Rust commands backed by an in-memory store, injected via `window.__TAURI_INTERNALS__.invoke`. After this phase, the app no longer calls `invoke` for persistence, so the e2e mock must be replaced by real Supabase backend setup.
- Current unit tests mock `@tauri-apps/api/core`'s `invoke` with `vi.mock` and a `vi.fn()`. After this phase, contexts no longer import `invoke`, so these mocks are replaced by injecting the in-memory fake `DataAccess` via `DataProvider`.
- The `pomodoro_logs` table deliberately has no foreign key to `tasks` (so deleting a task keeps historical logs). The data layer's `completeTimer` must insert into `pomodoro_logs` independently of the `tasks` row.
- `normalizeState()` in `ProjectManagerContext.tsx` (lines 649-778) shapes any loaded PM document, validating statuses, priorities, tags, links, checklist, and UI fields. It must continue to run on any document loaded from Supabase.
- The `PMTask` type requires a `relatedTo: string[]` field (types.ts line 47). The existing LSP error in `ProjectManagerContext.tsx` is a missing `relatedTo` on a `PMTask` construction.

## Things To Ensure Are Not Done

- Do not build authentication UI, sign-in flow, sign-out flow, or session refresh in this phase. A valid Supabase session is a precondition; the data layer surfaces a clear error if absent.
- Do not add Supabase realtime / WebSocket subscriptions. Freshness comes exclusively from re-fetch on app load and on `focus` / `visibilitychange`.
- Do not add optimistic concurrency / version columns to `timer_state` or `settings` for non-completion mutations. Last-write-wins with re-fetch-on-focus is the agreed model for this phase.
- Do not implement field-level or CRDT-style merge for `pm_state`. Last-write-wins with debounced upsert and re-fetch-on-focus is the agreed model for this phase.
- Do not sync the `ui` slice of `ProjectManagerState` to Supabase. It must remain device-local in `localStorage`.
- Do not change the shared engine's pure functions or their semantics. The engine remains a faithful port of `lib.rs`; the data layer calls it but does not modify it.
- Do not remove or modify the Rust backend (`src-tauri/src/lib.rs`) or the existing `e2e/mock-ipc.js` Tauri command implementations beyond what is needed to replace the e2e mock with real Supabase. The Rust commands remain as a fallback and are not called by the rewired contexts.
- Do not migrate existing local JSON data (`dev-data/`) into Supabase in this phase.
- Do not regress the existing engine parity test suite (`src/lib/engine/engine.test.ts`), the timer/analytics unit tests, or the Rust test suite.
- Do not couple unit tests to `@supabase/supabase-js` query syntax. Unit tests must use the in-memory fake `DataAccess` so `npm run test:unit` runs without Docker.
- Do not change timer/task accrual semantics, fractional pomodoro clamping, cycle reset logic, or auto-extend behavior. These are owned by the engine and must remain unchanged.
- Do not add unrelated cleanup, refactors, or opportunistic improvements beyond what the issue requires.

## User Decisions Made During Requirement Creation

| Decision Needed | Answer | Reason |
| --------------- | ------ | ------ |
| Should authentication/session wiring be included in this phase? | Auth is a separate prerequisite phase; the data layer reads `supabase.auth.getSession()` and surfaces a clear error if absent | Keeps this phase focused on the data-layer rewire and timer reconciliation. Auth UI is a substantial addition that belongs in its own phase. |
| Which idempotency mechanism should prevent double timer completion across devices? | Add a `completed boolean` column to `timer_state` and use a conditional update (`WHERE completed = false`); zero rows affected means the other device already completed | Provides a single, SQL-level guard that ties the `pomodoro_logs` insert to the conditional update, preventing duplicate logs and double cycle increments. |
| What write-contention model should apply to `timer_state` and `settings` mutations other than completion? | Last-write-wins with re-fetch on focus/load | The user typically interacts on one device at a time; re-fetch-on-focus reconciles drift. Optimistic concurrency adds complexity not needed for this phase. |
| What merge strategy should apply to `pm_state`? | Last-write-wins with debounced upsert and re-fetch on focus; `ui` stays in `localStorage` | Field-level merge is complex and out of scope. Last-write-wins is acceptable for this phase given the re-fetch-on-focus model. |
| How should the test suites be split between the in-memory fake and real Supabase? | Unit tests use the in-memory fake (no Docker); integration tests and e2e tests both run against the real local Supabase stack with per-test isolation | The user has the local Supabase stack set up and wants bigger tests on live data. Unit tests stay Docker-free for CI; integration and e2e get full SQL/RLS fidelity. |
| What should integration tests against real Supabase cover? | Data-layer Supabase queries and the idempotency contract (fetch state, create task, start/complete timer, save/load PM state, set target, conditional update behavior) | The riskiest behaviors are the idempotency contract and device-closed reconciliation; these must be verified against real SQL, not just the in-memory fake. |
| What shape should the data-access layer take? | Injectable `DataAccess` interface with a React context provider (`DataProvider` / `useData()`); in-memory fake and Supabase implementations | Matches the existing context-based architecture, makes tests swap implementations cleanly, and avoids coupling tests to `@supabase/supabase-js` query syntax. |