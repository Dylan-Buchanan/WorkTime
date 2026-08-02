# Requirements: Local-first staging with manual sync to replace per-interaction Supabase round trips

## Things To Implement

- **Local-first staging store as source of truth.** Engine commands execute against a localStorage-backed per-owner staging store with zero network. Supabase writes happen only through the single sync action. The staging store holds tasks, pomodoro_logs, settings, timer_state, and pm_state, plus tombstones, a full-wipe marker, and a lastSynced snapshot.
- **Sync action (pull → merge → push).** A single sync action pulls remote state, merges staged changes, pushes to Supabase, and advances the lastSynced snapshot. The merge rules are: field-level last-writer-wins on `updated_at` for tasks; whole-row LWW on `updated_at` for the settings/timer_state/pm_state JSONB rows; log union dedup by client-supplied id; tombstone DELETEs for deleted tasks/logs; a transactional full-wipe marker for `resetAppState`. The sync must be idempotent and retry-safe.
- **Bootstrap guard.** The staging store is considered uninitialized until at least one successful pull has completed for that owner. An uninitialized store must never push (the sync action auto-pulls first, or blocks push until a pull succeeds). This is a hard invariant preventing an empty local store from wiping server data.
- **Live-timer protection during background pulls.** During a sync pull, if the local timer is active (not paused, not expired), the remote timer_state is not merged into the local staging store — the local timer is authoritative until it completes or is paused. Remote task/log/settings merges still proceed. This prevents clobbering a running timer and double-completing a generation across devices.
- **Client-supplied pomodoro log IDs.** Add an `id` field to `PomodoroLogEntry`; generate UUIDs client-side; add a `unique (owner_id, id)` constraint to `pomodoro_logs` as the idempotent upsert conflict target; keep stable log ordering by `(finished_at, id)`. Both `persist_transition` and `complete_timer` RPC INSERT column lists must include the client-supplied id.
- **`updated_at` migration with backfill.** A migration adds `updated_at` to tasks, settings, timer_state, and pm_state. Backfill: `tasks.updated_at = tasks.created_at`; `settings`/`timer_state`/`pm_state.updated_at = now()` at migration time. New rows set `updated_at` on every insert and update.
- **Full-wipe marker preserves PM.** `resetAppState` propagates via a transactional full-wipe marker that deletes tasks, pomodoro_logs, settings, and timer_state and resets `timer_state.completed = false`, but does NOT delete pm_state — PM projects/estimates survive an app reset, matching current behavior.
- **"Sync data" UI.** A "Sync data" button with a pending-count indicator (number of staged changes) and status/error states (idle, syncing, success, error). The button triggers the single sync action and surfaces sync errors and auth errors to the user.
- **Tauri close-request dialog.** The Tauri shell handles `WindowEvent::CloseRequested`, calls `prevent_cancel` to keep the window open, and emits an event to the frontend via an existing or minimal plugin channel (no `#[tauri::command]`, no `invoke_handler`, no new Cargo deps). The frontend shows a dialog offering to sync before exit; after sync (or skip), the frontend calls `window.close()`. The platform gate (`verify-platform-cleanup.mjs`) must stay green and be extended if needed for the close-request handling.
- **Web best-effort pagehide sync + next-visit banner.** The web app performs a best-effort sync on `pagehide`. On the next visit, if staged-but-unsynced data exists, show an "unsynced changes" banner as a backstop. The banner and pagehide sync are best-effort, not a delivery guarantee.
- **Focus/visibility become sync triggers.** Window focus and visibility→visible trigger the sync action (pull → merge → push) instead of the current full `refresh()`/`refreshPM()` pulls.
- **StateSyncBridge collapse.** The per-task `setTaskTarget` loop with refresh-after-each collapses to local staging writes plus one sync call. The `pendingTargetsRef` coordination across effects 1 and 3 must be preserved.
- **PM writes stage locally.** ProjectManagerContext edits write to the local staging store immediately (no 750ms debounce — no network to debounce). The sync action pushes pm_state as one JSONB row via LWW on `updated_at`. Remove the 750ms debounced `savePMState` push, the immediate seed push when remote is null, and the unmount flush (or replace the unmount flush with the best-effort pagehide sync). `refreshPM` becomes a sync trigger. The suppress-once reload contract (`suppressServerSaveRef`) and the `serverSlice`/`applyServerState` merge semantics must be preserved.
- **Cross-tab view refresh (not auto-sync).** A `storage` event listener refreshes the local view when another tab syncs, but does NOT auto-sync the current tab. The explicit sync action remains the only write path.
- **Token-refresh handling on staged pushes.** The sync action must handle GoTrue session expiry/refresh and `DataAccessAuthError` — surface auth errors to the user and retry after a refreshed session rather than silently dropping staged data.
- **AGENTS.md guardrail amendment.** Amend the guardrail to permit the localStorage staging store, while keeping the prohibitions on Tauri invoke data paths, service-role credentials, invite codes, and push/background-sync behavior.

## Tests To Create Or Update

- For **Local-first staging store as source of truth**:
  - Unit test that an engine command writes to the staging store and performs zero network calls.
  - Unit test that the staging store is keyed per owner and tolerates `localStorage.clear()` between tests.
- For **Sync action (pull → merge → push)**:
  - Unit/integration test of pull → merge → push advancing the lastSynced snapshot, idempotent on retry.
  - Integration test of field-level LWW on tasks via `updated_at`.
  - Integration test of whole-row LWW on settings/timer_state/pm_state via `updated_at`.
  - Integration test of log union dedup by client-supplied id (retry does not duplicate logs).
  - Integration test of tombstone DELETE propagation.
  - Integration test of transactional full-wipe marker for `resetAppState`.
- For **Bootstrap guard**:
  - Unit/integration test that an uninitialized store never pushes (auto-pulls first or blocks push). This is the highest-coverage requirement.
  - Regression test mirroring the inverse PM seed-on-empty pattern to confirm it is not reintroduced.
- For **Live-timer protection during background pulls**:
  - Unit test that a running local timer is not overwritten by a remote timer_state during pull.
  - Unit test that remote task/log/settings merges still proceed while the local timer is protected.
- For **Client-supplied pomodoro log IDs**:
  - Unit test that `PomodoroLogEntry` carries an id and the client generates UUIDs.
  - Integration test that both RPCs insert with the client id and the `unique (owner_id, id)` conflict target dedups.
  - Test that log ordering by `(finished_at, id)` remains stable.
- For **`updated_at` migration with backfill**:
  - Integration test that the migration adds `updated_at` to all four tables and backfills tasks from `created_at` and JSONB rows to `now()`.
- For **Full-wipe marker preserves PM**:
  - Integration test that `resetAppState` deletes tasks/logs/settings/timer_state and resets `completed`, and that pm_state rows survive.
- For **"Sync data" UI**:
  - Component test that the button shows pending count and status/error states and triggers the sync action.
- For **Tauri close-request dialog**:
  - Static/platform-gate test that lib.rs keeps both plugin inits, has no `#[tauri::command]`/`invoke_handler`, and adds no new Cargo deps; extend `verify-platform-cleanup.mjs` to cover the close-request handling. (e2e cannot exercise the Tauri binary; the web banner path covers e2e.)
- For **Web best-effort pagehide sync + next-visit banner**:
  - Component test that `pagehide` triggers a best-effort sync.
  - Component test that the "unsynced changes" banner appears on next visit when staged-but-unsynced data exists, and does not appear when the store is clean.
- For **Focus/visibility become sync triggers**:
  - Unit test that focus and visibility→visible trigger the sync action, not a full refresh.
- For **StateSyncBridge collapse**:
  - Unit test that the estimate loop writes locally and triggers one sync, preserving `pendingTargetsRef` coordination.
- For **PM writes stage locally**:
  - Unit test that PM edits write to the staging store immediately with no 750ms debounce network push.
  - Unit test that the suppress-once reload contract and `serverSlice`/`applyServerState` merge semantics are preserved.
- For **Cross-tab view refresh**:
  - Unit test that a `storage` event from another tab refreshes the local view and does not auto-sync.
- For **Token-refresh handling on staged pushes**:
  - Unit/integration test that session expiry during sync surfaces an auth error and retries after refresh without dropping staged data.
- For **Existing RPCs and engine tests stay green**:
  - `src/lib/engine/engine.test.ts` must stay green.
  - `integration/SupabaseDataAccess.integration.test.ts` and `integration/timerCompletionGuard.integration.test.ts` must stay green or be adapted to the sync path while preserving the single-CAS-winner semantics.
- For **e2e/integration adaptation**:
  - e2e flows trigger sync before asserting server state (`e2e/timer.spec.ts:37-43,73-76`; `e2e/project-manager.spec.ts:29-41`).
  - PWA (`test:pwa`) and platform (`test:platform`) gates re-verified.

## Important Background Information

- Today every interaction runs `SupabaseDataAccess.transition()` = full `hydrate()` (paged tasks + logs + settings + timer_state) then a `persist_transition` RPC; `AppStateContext.wrapVoid` follows each command with another full `refresh()`. Focus/visibility trigger the same full pulls; PM debounces a whole-row push at 750ms; `StateSyncBridge` runs a per-task `setTaskTarget` loop with `refresh()` after each.
- No `updated_at` columns or triggers exist anywhere; `tasks.created_at` is insert-only. LWW merging has zero timestamp basis today.
- `pomodoro_logs.id` is `uuid PK default gen_random_uuid()`; the app never reads it and `PomodoroLogEntry` has no id field; both RPCs insert logs without an id column, so retries can duplicate logs.
- `timer_state.completed` is a boolean generation guard, not a version; `complete_timer` CAS is `completed = false AND data @> jsonb_build_object('timer', p_expected_timer)`. The sync engine must re-express the single-CAS-winner semantics.
- `resetAppState` today is non-atomic direct deletes on tasks/logs/settings/timer_state, resets `completed=false`, and skips pm_state.
- Auth: `ownerId()` calls `client.auth.getSession()` per operation; token refresh is delegated to GoTrue (`autoRefreshToken: true`); session persists in localStorage under `sb-<host>-auth-token`. No app-level refresh/queue logic exists.
- The Tauri shell is a slim 8-line `run()` with only opener+notification plugins; the platform gate bans `#[tauri::command]`/`invoke_handler` and extra Cargo deps. e2e runs against the vite dev server, not the Tauri binary.
- localStorage today holds only the GoTrue session and PM UI prefs under `pm_state_v1` (UI slice only). No `storage` event listeners exist.
- `api.max_rows = 1000` means sync pulls must keep pagination (current `PAGE_SIZE = 500`).
- RLS is plain `owner_id = auth.uid()` on authenticated; `service_role` has no DML grants — backfill SQL must run as table owner, not via service-role REST.
- `InMemoryDataAccess` is the established test seam for behavior changes; unit tests run in jsdom with `localStorage.clear()` after each test.
- The issue references `docs/brainstorming/Data-Architecture.md` as its outline, but that file does not exist in the repo — downstream agents should not depend on it.
- CI runs no test suites; only `supabase db push` on migration changes to main. Local validation is `npm run test:all`; `npm run tauri build` is the Windows packaging smoke gate.

## Things To Ensure Are Not Done

- Do not add Tauri `invoke` data paths, service-role credentials in the browser path, invite codes, or push/background-sync behavior.
- Do not implement `storage`-event-based automatic cross-tab syncing as a substitute for the explicit sync action — the storage listener only refreshes the local view.
- Do not make the pagehide sync or next-visit banner a delivery guarantee — they are best-effort backstops.
- Do not change timer/task semantics without keeping `src/lib/engine/engine.test.ts` green.
- Do not break the existing `persist_transition` and `complete_timer` RPC signatures — the sync path builds on or coexists with them.
- Do not wipe pm_state on `resetAppState` — PM survives app reset (current behavior preserved).
- Do not allow an uninitialized staging store to push — the bootstrap guard is a hard invariant.
- Do not clobber a running local timer during a background pull — the live-timer rule is mandatory.
- Do not add opportunistic refactors, unrelated cleanup, or scope creep beyond the local-first sync architecture.
- Do not regress the platform gate (`verify-platform-cleanup.mjs`) or the PWA gate (`verify-pwa-build.mjs`).
- Do not change the public auth pages to trigger authenticated data reads.

## User Decisions Made During Requirement Creation

| Decision Needed | Answer | Reason |
| --------------- | ------ | ------ |
| `updated_at` backfill policy for existing hosted rows | `tasks.updated_at = created_at`; `settings`/`timer_state`/`pm_state` `= now()` at migration time | Deterministic; gives tasks a real historical basis via the insert-only `created_at` column; JSONB rows have no `created_at` so `now()` is a neutral baseline. |
| `resetAppState` full-wipe marker scope | Wipe app state only (tasks/logs/settings/timer_state + reset `completed`); keep pm_state | Matches current behavior exactly — PM projects/estimates survive an app reset; avoids a breaking change. |
| Live-timer protection rule during background pulls | Local running timer wins; skip remote timer_state merge; remote task/log/settings merges still proceed | Prevents clobbering a freshly-started local timer and double-completing a generation across devices; avoids re-introducing server-side completion during sync. |
| Log identity/ordering contract | Client-supplied UUID `id` + `unique (owner_id, id)` conflict target; order by `(finished_at, id)` | Minimal change; gives idempotent retry-safe dedup a real per-owner key; preserves existing stable log order. |
| Bootstrap guard "initialized" definition | At least one successful pull completed for that owner | Guarantees the store has observed server state before it can overwrite it; directly prevents the empty-store-wipes-server disaster. |
| PM debounce collapse | PM edits stage locally immediately; sync pushes pm_state as one JSONB row via LWW; remove 750ms debounce, immediate seed push, and unmount flush | No network to debounce against; one sync action satisfies the issue; preserves suppress-once reload and serverSlice merge semantics. |
| Tauri close-request mechanism | `WindowEvent::CloseRequested` + `prevent_cancel` + frontend plugin event; no new commands or Cargo deps | Keeps the slim shell and platform gate green; e2e covers the web banner path instead. |
| Multi-tab sync coordination | `storage` event listener refreshes the local view when another tab syncs; no auto-sync | Improves cross-tab UX without violating the explicit-sync boundary or adding lock complexity. |