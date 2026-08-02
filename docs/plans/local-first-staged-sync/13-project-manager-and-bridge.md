# Task: Stage PM edits immediately and collapse bridge writes to one sync

## Classification

Type: T2: coordinated context/bridge behavior change
Reasoning: The task removes an established async save queue and changes a cross-context effect, but the replacement uses existing server-slice helpers, the new local DataAccess, and a single explicit sync call. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Remove PM network debounce/seed/unmount behavior, retain its local UI and suppress-once reload semantics, batch estimate propagation as local writes plus one sync, and make app reset preserve PM projects/estimates.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/state/ProjectManagerContext.tsx` | update |
| `src/state/StateSyncBridge.tsx` | update |
| `src/components/SettingsPanel.tsx` | update |
| `src/state/ProjectManagerContext.test.tsx` | update |
| `src/components/SettingsPanel.test.tsx` | create |

## Step-by-Step Instructions

### 1. Replace the 750ms queue with immediate local staging

**File:** `src/state/ProjectManagerContext.tsx`

Delete `saveQueueRef`, `pendingSnapshotRef`, `flushTimeoutRef`, `flushPendingSnapshot`, the timer-based `persistSnapshot`, and the unmount flush. Keep `serverSlice`, `applyServerState`, `lastServerSerializedRef`, and `suppressServerSaveRef`.

After hydration, when the serialized server slice changes and is not the suppress-once reload value, call `data.savePMState(serverSlice(state))` immediately. This method is localStorage-only now, so no debounce is needed. Surface/log a local staging error without rolling React ahead of an unpersisted value; if necessary, move server-slice mutations through an async staging helper rather than the current unconditional `setState` wrapper.

### 2. Remove the unsafe null-remote seed push and preserve reload merging

**File:** `src/state/ProjectManagerContext.tsx`

On initial `loadPMState() === null`, render the normalized default PM state but do not immediately call `savePMState` as part of bootstrap hydration. Gate the normal post-hydration local-change effect on `SyncContext.initialized`; only after a successful pull establishes initialization may that effect stage the default for a later sync. It must never bypass the store bootstrap guard.

Consume `SyncContext.revision` to reload staged PM via `loadPMState`, apply `applyServerState(remote, currentUI)`, set `lastServerSerializedRef`, and set `suppressServerSaveRef=true` so the reload is not written back once. Keep `pm_state_v1` restricted to the `ui` slice.

Retain a `refreshPM` helper only as a sync trigger plus local reload:

```ts
const refreshPM = useCallback(async () => {
    await sync({ reason: "manual" });
    // reload staged PM and apply server slice while retaining UI
}, [sync, ...]);
```

Remove PM-owned focus/visibility listeners because `SyncProvider` centralizes them.

### 3. Batch PM estimate propagation

**File:** `src/state/StateSyncBridge.tsx`

In the PM estimate -> app target effect, retain `pendingTargetsRef` behavior shared with metadata/progress effects. Stage every divergent `data.setTaskTarget` locally, update the local app view once after the batch (or adopt each returned state without a fetch), then call `sync({reason:"bridge"})` exactly once when at least one target changed. Remove `refresh()` after each item.

On failure, clear only pending entries still equal to the attempted desired value. Preserve later edits. Keep no in-flight overlapping batch by using a ref/promise guard or cancellation generation. Do not auto-sync from the cross-tab storage listener.

For the legacy PM-entry auto-create loop, commands are already local; collapse repeated local refreshes to at most one post-loop view refresh and do not add a per-item sync.

### 4. Make reset UI match the PM-survival requirement

**File:** `src/components/SettingsPanel.tsx`

Remove `pm.resetPM()` from the "Delete Data" action and stop acquiring `usePM` solely for reset. Update confirmation copy so it accurately says timer tasks, logs, settings, and timer state are reset while projects/estimates remain. The staged full-wipe marker and server RPC already exclude `pm_state`.

### 5. Update PM and bridge tests, and add the reset-scope component test

**Files:** `src/state/ProjectManagerContext.test.tsx`, `src/components/SettingsPanel.test.tsx`

Use fake timers/spies to prove PM edits call local `savePMState` immediately (no 750ms wait and no network/sync), null remote does not seed before bootstrap, suppress-once reload does not restage, `serverSlice`/`applyServerState` retain UI filtering, focus no longer performs PM refresh, a storage/sync revision reloads the view, target propagation performs N local writes plus one sync, pending-target coordination survives failure/later edit, and reset preserves the existing PM slice.

In `src/components/SettingsPanel.test.tsx`, render `SettingsPanel` inside the existing app/PM provider test harness (or a focused fake) and assert the reset-scope regression: the "Delete Data" confirmation copy mentions timer tasks, logs, settings, and timer state while stating projects/estimates remain; the confirm action calls `resetAll` exactly once; and `resetPM` is never invoked. Use a spy on the PM context (or assert via the staged store) to prove no `resetPM` call reaches the PM provider. Cover both the updated confirmation copy and the button-disabled-until-"yes" gating.

## Edge Cases to Handle

- PM state can change again while an immediate local save promise is pending; serialize storage writes or use store revisions so older snapshots cannot overwrite newer ones.
- StrictMode hydration effects must not stage a default before the first pull.
- A remote PM deletion/null row after initialization must pass through normalization without an immediate inverse seed push.
- Bridge sync failure leaves local target edits pending and visible for manual retry.
- The reset dialog copy and behavior must agree; do not retain hidden `resetPM` invocation.

## Related Files (read-only context)

- `src/state/SyncContext.tsx` - revision and sync action
- `src/lib/data/StagedDataAccess.ts` - immediate local PM persistence
- `src/state/AppStateContext.tsx` - local app task view updates
- `src/lib/engine/engine.test.ts` - task target/reset semantics
