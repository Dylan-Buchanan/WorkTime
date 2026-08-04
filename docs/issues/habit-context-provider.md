## Title: Habit Tracker: HabitContext provider

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Large new provider replicating the established `ProjectManagerContext` template (hydration/reload/save-effect discipline, suppress-once refs, device-local UI key, action wrapper) plus a test file and `App.tsx` provider wiring. Edges into T3 only if the DataAccess/sync additions from earlier items are incomplete, hence research is required.
Needs research before implementation: Yes — confirm spec items 1–3 are complete (engine, schema migration, staged sync plumbing), the exact habit load/save interface `HabitContext` consumes, and how the device-local UI key should be named/stored per AGENTS.md.

## Summary

Implement the `HabitContext` provider that owns habits, completions, and device-local UI state (period, selected habit, expanded habits) and exposes all actions, following the `ProjectManagerContext` hydration/reload/save-effect discipline.

## Steps to Reproduce Context

1. User opens `/habits`; the provider hydrates from staged habit state plus the device-local UI slice.
2. User creates, checks, or reorders a habit; the provider stages immediately and never triggers a sync by itself.
3. Another tab revises habits; the provider reloads from the staging store on the `revision` bump.

## Expected Behavior

`HabitContext` mounts inside the authenticated route shell, hydrates from staged data, keeps device-local UI (period/selected/expanded) in its own localStorage key outside the staging store, reloads on revision changes, and exposes actions for create/update/archive/delete habit, check/uncheck completion, reorder, and UI state.

## Actual Behavior

No habit provider exists; `src/state/` contains only `AppStateContext`, `ProjectManagerContext`, `SyncContext`, `DataContext`, and `TauriCloseContext`.

## Requirements for completed issue

1. State slice (habits, completions, `ui: { period, selected, expanded }`, meta) and all actions are defined.
2. Hydration, save, and reload effects match `ProjectManagerContext` discipline: save gated on `hydrated && initialized`, suppress-once refs prevent restaging a reload, reload driven by the `revision` bump.
3. Device-local UI key persists period/selected/expanded outside the staging store per AGENTS.md and survives reloads without syncing.
4. Provider is wired into `App.tsx` behind the authenticated shell, and tests follow the `ProjectManagerContext.test.tsx` provider-wrap pattern (InMemoryDataAccess, probe components, zero-sync assertions).

## Context

- Files: `src/state/ProjectManagerContext.tsx` (template: `LS_KEY = "pm_state_v1"`, hydration/save/reload effects, `reorderTasks`), `src/state/ProjectManagerContext.test.tsx` (test pattern), `src/App.tsx` (provider hierarchy: `DataProvider → SyncProvider → AppStateProvider → ProjectManagerProvider → StateSyncBridge`), `src/lib/data/DataAccess.ts` (interface habit methods will extend), `AGENTS.md` (providers behind the authenticated shell; `pm_state_v1` and UI-only state outside the staging store).
- Code Snippets:

```ts
// src/state/ProjectManagerContext.tsx — the local UI key pattern to replicate
const LS_KEY = "pm_state_v1";
```

```ts
// src/state/ProjectManagerContext.tsx — reorder semantics to mirror for habits
reorderTasks(idsInOrder, withinStatus?) { /* assigns sortOrder = idx + updatedAt = now() */ }
```

## Notes

None.
