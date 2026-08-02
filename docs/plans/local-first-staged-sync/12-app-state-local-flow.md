# Task: Rewire app-state commands and progression to local results

## Classification

Type: T2: high-impact context state-flow change
Reasoning: Most edits are within one provider and follow existing result shapes, but timer progression/notifications are user-critical and command-following refresh behavior changes throughout the app. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Make `AppStateContext` adopt staged command results directly, respond to sync/storage revisions by rereading local state, and preserve timer notification/progression behavior without any per-command or focus-triggered remote round trips.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/state/AppStateContext.tsx` | update |
| `src/state/AppStateContext.test.tsx` | update |

## Step-by-Step Instructions

### 1. Treat `fetchState` as a local view read

**File:** `src/state/AppStateContext.tsx`

Keep `refresh(): Promise<AppStateData>` in the context API for callers, but it now reads staged local state only. Consume `revision` from `useSync`; on mount and each revision, call local `fetchState`, adopt it, and process any local expired-timer reconciliation. Remove this provider's `focus` and `visibilitychange` listeners because `SyncProvider` owns those triggers.

Initial uninitialized state may render engine defaults briefly; bootstrap sync will update the store/revision after the first successful pull. Never bypass the bootstrap guard by asking Supabase directly.

### 2. Adopt command results instead of refreshing afterward

**File:** `src/state/AppStateContext.tsx`

Replace `wrapVoid(fn); await refresh()` with a helper that awaits the `EngineResult`, sets `state` from `result.state`, and handles errors. Apply it to active-task, timer start/stop/pause/resume/skip, settings, finalize, reset, and task creation. `createTask` still returns `result.value` and throws to its caller on failure.

Do not call `sync()` from ordinary commands. The explicit/lifecycle/bridge sync action remains the only Supabase write path.

### 3. Preserve local timer progression and notification semantics

**File:** `src/state/AppStateContext.tsx`

Keep the one-second tick, optional native/Web Notification entry point, sounds, queued reconciliation guard, and work<->break auto-start rules. `runProgression` must use the staged `completeTimer` result and then staged `startBreakTimer`/`startWorkTimer` results directly. On `applied=false`, reread staged local state before deciding whether to auto-start. Do not add server completion inside pull.

### 4. Preserve PM-independent reset behavior

**File:** `src/state/AppStateContext.tsx`

`resetAll` calls only `data.resetAppState`, adopts its local state, and exposes any storage error. It does not reach Project Manager state; Task 13 corrects the UI call site accordingly.

### 5. Update context regression tests

**File:** `src/state/AppStateContext.test.tsx`

Extend the in-memory/staged fake with method spies. Assert commands update the rendered view with no follow-up `fetchState`, focus/visibility are not registered here, sync revision reloads local state, expired timers auto-progress exactly once, notifications still fall back to Web Notifications, and errors keep the last persisted state.

## Edge Cases to Handle

- A local storage event/sync revision arriving during progression must queue/reconcile rather than start two progression loops.
- Pause/resume command methods remain fire-and-forget in the public context API but errors must still reach `error` state.
- A failed local persistence must not update React state optimistically.
- An uninitialized offline owner may stage commands; the view must show them and the sync error must not discard them.
- Preserve existing notification permission fallback and public component API.

## Related Files (read-only context)

- `src/state/SyncContext.tsx` - centralized lifecycle triggers and revision
- `src/lib/data/StagedDataAccess.ts` - local command result contract
- `src/lib/engine/engine.test.ts` - authoritative timer/task semantics
- `src/hooks/useSounds.ts` - sound behavior

