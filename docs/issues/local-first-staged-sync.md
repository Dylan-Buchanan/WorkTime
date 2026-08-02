## Title: Local-first staging with manual sync to replace per-interaction Supabase round trips

## Tags

Complexity Classification: T4
Severity: High
Reason: Full architectural rewrite of the data layer — local-first staging store becomes the source of truth, new pull→merge→push sync engine, schema/migration changes (updated_at on four tables, client-supplied log IDs), rework of every DataAccess caller (AppStateContext wrapVoid + focus/visibility refreshes, ProjectManagerContext debounced pushes, StateSyncBridge per-task loops), new UI (Sync button, Tauri close-request dialog, web unsynced banner), a Tauri shell change, and adaptation of every e2e/integration/PWA/platform gate. Data-loss risk (e.g., an empty local store wiping the server) makes it high severity.
Needs research before implementation: Yes — confirm client-supplied pomodoro_logs IDs (PomodoroLogEntry has no id field today and the schema defaults to gen_random_uuid()); migration/backfill path for existing hosted data when adding updated_at; how live/in-flight timers are protected during a background pull; feasibility of Tauri close-request handling in the current slim shell; pagehide reliability and next-visit banner behavior; interaction between the ProjectManagerContext 750ms debounce-push and the new single-sync model.

## Summary

Every interaction in the app currently triggers Supabase round trips: each engine transition fully hydrates server state and writes it back, and window focus/visibility changes force full refreshes. Replace this with a localStorage-backed staging store that is the source of truth, run engine commands locally with zero network, and push all staged data to Supabase at once through a single "Sync data" action (pull → merge → push, advancing a lastSynced snapshot). Deletes sync via tombstones and resetAppState via a full-wipe marker; the Tauri app prompts on close, and the web does best-effort pagehide sync with a next-visit "unsynced changes" banner as backstop.

## Steps to Reproduce Context

1. Perform any interaction (create task, start/stop timer, change settings, edit PM task) — `SupabaseDataAccess.transition()` runs a full `hydrate()` (paged tasks + logs fetch, settings, timer_state) followed by a `persist_transition` RPC write-back, so every interaction pulls then pushes.
2. Switch to another window or tab and back — `AppStateContext` focus/visibilitychange listeners trigger a full `refresh()` (`fetchState`), and `ProjectManagerContext` does the same via `refreshPM()` (`flushPendingSnapshot` + `loadPMState`).
3. Edit a PM estimate — `StateSyncBridge` runs a per-task `data.setTaskTarget` loop with a `refresh()` after each iteration.
4. Server state is asserted directly in e2e (`backendState()` in `e2e/helpers.ts`), which only works because writes happen per-interaction.

## Expected Behavior

- Engine commands run against a localStorage-backed staging store per owner with zero network, keeping the app responsive.
- A "Sync data" button (with pending-count indicator and status/error states) pushes all staged data to Supabase at once: pull → merge → push, idempotent and retry-safe, advancing a lastSynced snapshot.
- Deletes propagate via tombstones; resetAppState propagates via a full-wipe marker; a bootstrap guard prevents an uninitialized store from wiping server data.
- The Tauri app shows a close-request dialog prompting to sync first; the web syncs best-effort on pagehide with a next-visit "unsynced changes" banner as backstop.
- Focus/visibility refreshes become sync triggers, and StateSyncBridge's per-task loops collapse to local writes plus one sync call.

## Actual Behavior

- Every interaction, focus change, and visibility change causes full Supabase pull + push round trips (`src/lib/data/SupabaseDataAccess.ts` transition/hydrate; `src/state/AppStateContext.tsx` wrapVoid + focus/visibility listeners; `src/state/ProjectManagerContext.tsx` focus/visibility `refreshPM` plus a 750ms debounced `savePMState` push).
- `StateSyncBridge` pushes estimates per-task with a refresh after each (`setTaskTarget` loop).
- No updated_at columns exist on tasks/settings/timer_state/pm_state, so last-writer-wins merging has no timestamp basis.
- No sync affordance exists for the user; the Tauri shell (`src-tauri/src/lib.rs`) has no close-request handling.

## Requirements for completed issue

1. Engine commands execute against a localStorage-backed per-owner staging store with zero network; Supabase writes happen only through one sync action.
2. A sync action pulls remote state, merges with staged changes (updated_at LWW for tasks, whole-row LWW for JSONB rows, log union dedup by ID, tombstone DELETEs, transactional wipe), pushes, and advances a lastSynced snapshot — idempotent and retry-safe, with a bootstrap guard so an uninitialized store can never wipe server data, and a live-timer rule protecting in-flight timers during background pulls.
3. A "Sync data" button with pending-count indicator and status/error states; a Tauri close-request dialog offering to sync before exit; best-effort web sync on pagehide plus a next-visit "unsynced changes" banner.
4. Focus/visibility refreshes become sync triggers; StateSyncBridge per-task setTaskTarget loops and refresh-after-each simplify to local writes plus one sync call.
5. A migration adds updated_at to tasks/settings/timer_state/pm_state (with backfill for existing rows) and confirms client-supplied log IDs; existing RPCs (persist_transition, complete_timer) and engine tests stay green; AGENTS.md guardrail amended to permit the localStorage staging store.
6. Test-suite adaptation: e2e flows trigger sync before asserting server state, integration checks cover the migration, and PWA/platform gates re-verified.

## Context

- Files:
  - `docs/brainstorming/Data-Architecture.md` — the outline this issue is based on.
  - `src/lib/data/DataAccess.ts` — per-interaction DataAccess interface (fetchState, createTask, startWorkTimer, setTaskTarget, resetAppState, savePMState, loadPMState, ...).
  - `src/lib/data/SupabaseDataAccess.ts` — transition()/hydrate() per-interaction pull + push; complete_timer CAS; resetAppState direct deletes.
  - `src/lib/data/defaultDataAccess.ts`, `src/lib/data/InMemoryDataAccess.ts` — other DataAccess implementations.
  - `src/state/AppStateContext.tsx` — wrapVoid (command + refresh), focus/visibilitychange full refreshes.
  - `src/state/ProjectManagerContext.tsx` — debounced (750ms) savePMState push, loadPMState pull, focus/visibility refreshPM; localStorage used only for UI prefs (`pm_state_v1`).
  - `src/state/StateSyncBridge.tsx` — per-task setTaskTarget loop with refresh-after-each (estimate propagation effect).
  - `src/state/types.ts` — PomodoroLogEntry has no id field; AppStateData shape.
  - `supabase/migrations/20260801000000_foundation.sql` — tasks, pomodoro_logs (row tables), settings, timer_state, pm_state (per-owner JSONB rows); no updated_at columns; pomodoro_logs.id defaults to gen_random_uuid().
  - `supabase/migrations/20260801010000_timer_completion_guard.sql` — timer_state.completed flag.
  - `supabase/migrations/20260801020000_transactional_writes.sql` — persist_transition and complete_timer RPCs (security definer, owner from JWT).
  - `src-tauri/src/lib.rs` — slim shell with only opener + notification plugins; no close-request handling.
  - `e2e/helpers.ts`, `e2e/timer.spec.ts` — server state asserted directly via backendState().
  - `AGENTS.md` — guardrail: "Do not add Tauri invoke data paths, local JSON persistence, service-role credentials, invite codes, or push/background-sync behavior."

- Code Snippets:

```ts
// src/lib/data/SupabaseDataAccess.ts — every interaction pulls then pushes:
private async transition<T>(ownerId: string, command: (state: AppStateData) => { state: AppStateData; value: T }, newTimerGeneration = false) {
    const before = await this.hydrate(ownerId);        // full pull
    const result = command(before.state);
    await this.persistTransition(ownerId, before.state, result.state, newTimerGeneration); // full push
    return { state: cloneAppState(result.state), value: clone(result.value) };
}
```

```tsx
// src/state/AppStateContext.tsx — focus/visibility trigger full refreshes:
useEffect(() => {
    void refresh().catch(() => undefined);
    const onFocus = () => void refresh().catch(() => undefined);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    ...
}, [refresh]);
```

```tsx
// src/state/StateSyncBridge.tsx — per-task backend push with refresh after each:
await data.setTaskTarget(pmTask.appTaskId, desired);
if (cancelled) return;
await refresh();
```

```sql
-- supabase/migrations/20260801000000_foundation.sql — no updated_at columns:
create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    ...
);
-- pomodoro_logs has id uuid primary key default gen_random_uuid() but the app never reads it;
-- settings, timer_state, pm_state are per-owner single JSONB rows (owner_id primary key).
```

## Notes

- The data-safety core is the staging store + sync engine pair: the bootstrap guard (never push from an uninitialized store) and idempotent diffing are what prevent the "empty local store wipes my server" disaster, so they deserve the most test coverage.
- Multi-tab last-writer-wins via updated_at; token refresh must be handled on staged pushes; live timers must be protected during background pulls.
- The web reality is that close-time sync is best-effort — the next-visit banner is the backstop, not a guarantee.
- Keep existing RPCs (persist_transition, complete_timer) and engine tests green; the sync path should build on them or coexist with them. Do not add Tauri invoke data paths, service-role credentials, or push/background-sync behavior.
- Proposed work steps (from the outline): schema prep → staging store → pure-TS sync engine → sync UI + platform hooks → context/bridge rewiring → test-suite adaptation.
