## Title: Agentic planning assistant — snapshot & revert

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Cross-file/cross-system feature. The snapshot & revert subsystem touches the PM context (`ProjectManagerContext.tsx` must expose snapshot capture and dirty-checked write-back through updateTask/createTask/archiveTask), a new localStorage snapshot format (new key outside the staging store, following the pm_state_v1 exception precedent), the staged PM save/reload path (reloadStagedPM + revision reloads can clobber or be clobbered by a revert), StateSyncBridge (its background effects stamp updatedAt continuously — workedPomos/timeSpentMinutes/lastWorkedAt and auto-Done — which undermines updatedAt dirty-checks), a new conflict-surfacing UI, and the not-yet-existing agentic workflow runner. Blast Radius=3 (5-10 files, cross-module: new snapshot store module, ProjectManagerContext, StateSyncBridge, new workflow runner, conflict UI, tests), Uncertainty=3 (dirty-check vs StateSyncBridge's constant updatedAt bumps, reload/revision interplay, and LWW semantics are acknowledged edge cases with open design), Behavior=4 (complex state management plus a new persistent data format and LWW/concurrency concerns), Testing=2 (dirty-check/LWW/surface-separation edge cases are hard to test; a broken revert could overwrite synced task data), Reversibility=2 (revert write-backs sync to Supabase via LWW; a bad revert has data consequences recoverable only via the snapshot being overwritten). Total=14 → T3.
Needs research before implementation: Yes — whether updatedAt dirty-checks survive StateSyncBridge's continuous background updates and the sync-merge stamp semantics in `src/lib/data/sync/merge.ts` (how a restored snapshot's updatedAt is treated by the staged PM save path and reloadStagedPM/revision reloads); where the agentic workflow runner hooks in (it does not exist yet) so snapshot capture points are known; how revert write-backs avoid re-triggering StateSyncBridge estimate/progress propagation and LWW wins against the backend; PWA vs Tauri localStorage separation handling for snapshot key entry and capture.

## Summary

Add pre-workflow snapshot capture and dirty-checked revert for the agentic planning assistant: the selected project's PM tasks are snapshotted before each workflow in a new localStorage key outside the staging store, and a revert restores that state after surfacing any task whose `updatedAt` moved since the snapshot.

## Steps to Reproduce Context

1. (Once workflows exist) the agent proposes changes to the selected project's tasks.
2. Today PM tasks are mutated through `ProjectManagerContext` ops with no snapshot or revert capability; a user has no way to undo a batch of agent-approved changes.

## Expected Behavior

- A snapshot of the selected project's PM tasks is taken before each workflow in a new localStorage key outside the staging store (documented intentional exception, per pm_state_v1 precedent).
- Revert is a dirty-checked write-back through PM context ops: any task whose updatedAt moved since the snapshot is surfaced before overwriting.
- In-flight workflows are not persisted across app close, but the snapshot remains for manual revert.

## Actual Behavior

No snapshot or revert exists. `src/state/ProjectManagerContext.tsx` persists the PM slice via the staged store and keeps only UI prefs in `pm_state_v1`; `src/lib/data/staging/LocalStagingStore.ts` owns the `worktime:staging:v1:*` keys (`STAGING_STORAGE_PREFIX`); there is no mechanism to restore a prior PM task state.

## Requirements for completed issue

1. Snapshot of the selected project's PM tasks taken before each workflow in a new localStorage key outside the staging store (documented intentional exception, per pm_state_v1 precedent).
2. Revert is a dirty-checked write-back through PM context ops: any task whose updatedAt moved since the snapshot is surfaced before overwriting.
3. In-flight workflows are not persisted across app close, but the snapshot remains for manual revert.

## Context

- Files:
  - `src/lib/data/staging/LocalStagingStore.ts` — `STAGING_STORAGE_PREFIX = "worktime:staging:v1:"`; per AGENTS.md this is the only application-data persistence exception, and agent keys are new documented intentional exceptions as `pm_state_v1` is.
  - `src/state/ProjectManagerContext.tsx` — `LS_KEY = "pm_state_v1"` (UI prefs only in localStorage); `updateTask` stamps `updatedAt: now()` on every mutation; `createTask` is async and dedupes via appTaskId; `archiveTask`/`reorderTasks`/`moveTaskToStatus` write through the same persist path; `reloadStagedPM`/`revision` reloads can interact with a revert.
  - `src/state/StateSyncBridge.tsx` — background effects stamp `updatedAt` continuously (workedPomos/timeSpentMinutes/lastWorkedAt at lines ~241–291, auto-Done at lines ~294–304), which dirty-checks must account for.
  - `src/state/types.ts` — `PMTask.updatedAt` (ISO string) is the dirty-check field.
- Code Snippets:

```
// src/state/ProjectManagerContext.tsx
const LS_KEY = "pm_state_v1";       // UI prefs only in localStorage
```

## Notes

- Known edge cases to design around: PWA vs. Tauri localStorage separation (key + snapshot entered/taken per surface); revert vs. LWW sync (dirty-check on `updatedAt`); auto-Done from StateSyncBridge can race agent status writes (last-write-wins, accept for v1).
- This is dependency slice #4 of the agentic planning assistant split.
