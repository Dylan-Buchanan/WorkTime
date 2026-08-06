## Title: To-dos — Supabase schema, staged persistence, and TodoContext

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Full-stack slice mirroring the habit tracker end-to-end: a new owner-RLS migration, an extension of the shared `apply_staged_sync` RPC boundary, `DataAccess.saveTodos/loadTodos` across the interface and all implementations, a staging `schemaVersion` bump (2 → 3) with an in-memory migration path for every existing owner's localStorage record, sync/merge additions (SyncSnapshot, deltas, tombstones, EMPTY_SNAPSHOT), and a new `TodoContext` with hydrate/persist/reload lifecycle — 10+ files across DB, data layer, and UI state. Blast Radius=4 (cross-system: shared sync RPC, global staging schema, all DataAccess implementations), Uncertainty=2 (the habits pattern is established, but the exact todos schema depends on Issue A's engine types and recurrence semantics; the forward-only RPC signature change and schemaVersion migration add unknowns), Behavior=4 (data model + RLS + state management), Testing=2 (integration tests required; high user impact if the migration or RPC breaks existing sync), Reversibility=2 (forward-only SQL migration dropping the old RPC signature and a client schema bump need coordinated/cleanup-based rollback). Total=14 → T3.
Needs research before implementation: Yes — the exact todos schema depends on Issue A's engine rule types (how a recurring rule is stored, how one-active-instance state is modeled) and on the existing staged-sync RPC signature (`apply_staged_sync` params, `seed.sql`, `supabase/README.md`) before writing the migration and merge code. See Notes.

## Summary

Add persistence for the to-do domain mirroring the habits pattern: a `todos` table migration with owner RLS, `DataAccess.saveTodos/loadTodos` through every implementation, staging store support (record fields, schema version bump, merge/sync plumbing, pending counting), and a `TodoContext` with hydrate/persist/reload-on-revision. No `invoke` paths and the public auth routes stay untouched.

## Steps to Reproduce Context

1. The recurrence engine types from Issue A exist in `src/lib/todos/`.
2. Today the staged-sync domain has no to-do storage: the Supabase schema has no `todos` table, `DataAccess` has no `saveTodos`/`loadTodos`, the per-owner staging record (`schemaVersion: 2`) has no todos fields, the merge/transport layers know nothing about todos, and there is no `TodoContext`.

## Expected Behavior

- A `supabase/migrations/*_todos.sql` migration adds an owner-scoped `todos` table with the same structure as the habits migration (owner_id column, RLS owner policies, `touch_updated_at` trigger, `unique (owner_id, id)`, grants limited to authenticated/service_role), plus the seed/README updates.
- `DataAccess` exposes `saveTodos`/`loadTodos`; `StagedDataAccess`, `SupabaseDataAccess`, and `InMemoryDataAccess` implement them following the `saveHabits`/`loadHabits` path (stamping, tombstones, transport serialization, pull/push).
- The staging record gains todos fields (`SyncSnapshot`, `StagedOwnerRecord`, validators) and a schema version bump with an in-memory migration path so existing owners' v2 records keep loading; `LocalStagingStore.countPending` and `merge.ts` count/merge todos deltas.
- `TodoContext` provides hydrate/persist/reload-on-revision with the same suppress-first-save and reload guards as `HabitContext`.
- Integration tests mirror the habit suite (`integration/SupabaseDataAccess.integration.test.ts`, `integration/localFirstSync.integration.test.ts`).

## Actual Behavior

No todos table, transport, staging, merge, or context exist. The habit domain is fully wired end-to-end and is the model to copy: `supabase/migrations/20260803000000_habits.sql`, `DataAccess.saveHabits/loadHabits` (`src/lib/data/DataAccess.ts`), `StagedDataAccess.saveHabits/loadHabits` (`src/lib/data/StagedDataAccess.ts`), staging record fields in `src/lib/data/staging/types.ts` with `parseStagedOwnerRecord` v1→v2 migration, `LocalStagingStore.countPending`, `merge.ts` habit merge/delta functions, `SupabaseDataAccess` `pull`/`push`, and `src/state/HabitContext.tsx`.

## Requirements for completed issue

1. `todos` migration with owner RLS plus integration tests (push/pull/replay idempotency, RLS enforcement) mirroring the habit suite.
2. `DataAccess.saveTodos/loadTodos` through `StagedDataAccess`, `SupabaseDataAccess`, and `InMemoryDataAccess`, including staging store key support, schema version bump with an in-memory migration for existing records, and merge/sync pending-count integration.
3. `TodoContext` with hydrate/persist/reload-on-revision lifecycle matching `HabitContext` (no `invoke` paths, public auth untouched).

## Context

- Files:
  - `supabase/migrations/20260803000000_habits.sql` — the migration template (owner_id, RLS policies, `touch_updated_at` trigger, `unique (owner_id, id)`).
  - `supabase/seed.sql`, `supabase/README.md` — need todos updates alongside the migration.
  - `src/lib/data/DataAccess.ts` — `saveHabits(habits, completions)` / `loadHabits()` on the interface (lines 112–113); the todos methods mirror these.
  - `src/lib/data/StagedDataAccess.ts` — `saveHabits`/`loadHabits` implementation over the staging store with LWW stamping and tombstone logic (lines 391–453).
  - `src/lib/data/staging/types.ts` — `StagedOwnerRecord` (`schemaVersion: 2` literal, line 122), `SyncSnapshot`, validators, `parseStagedOwnerRecord` (v1→v2 in-memory migration, lines 337–410); todos fields and a v2→v3 path follow this.
  - `src/lib/data/staging/LocalStagingStore.ts` — `freshRecord` (lines 38–63), entity-based `countPending` (lines 155–226), `STAGING_STORAGE_PREFIX`.
  - `src/lib/data/sync/types.ts` — `SyncSnapshot`, `PushPlan`, `AcknowledgedChanges` (habit/habitCompletion upsert + tombstone arrays).
  - `src/lib/data/sync/merge.ts` — `mergeHabits`, `mergeHabitRow`, `habitDeltasOf`, `completionDeltasOf`, `countPending`, `commitAcknowledgedPush`, `EMPTY_SNAPSHOT`.
  - `src/lib/data/SupabaseDataAccess.ts` — `pull`/`push` transport with `habitRow`/`habitCompletionRow` serialization and row validators.
  - `src/state/HabitContext.tsx` — the context lifecycle pattern to mirror: hydrate on mount, persist on state/revision change, reload-on-revision, suppress-first-save refs, local UI state key.
  - `integration/SupabaseDataAccess.integration.test.ts`, `integration/localFirstSync.integration.test.ts` — integration test patterns.
- Code Snippets:

```
// src/lib/data/DataAccess.ts — the habits interface pair the todos methods mirror
saveHabits(habits: Habit[], completions: HabitCompletion[]): Promise<void>;
loadHabits(): Promise<{ habits: Habit[]; completions: HabitCompletion[] }>;
```

## Notes

- Dependency slice #2 of the to-do list feature (issue #51); depends on Issue A's engine types (`src/lib/todos/`).
- Research needed before implementation: the exact todos schema given Issue A's recurrence model (single `rules` column vs. separate columns, how the single active occurrence / due-date state is stored), the current `apply_staged_sync` RPC parameter set and its forward-only signature change pattern (`20260804000000_habit_staged_sync_rpc.sql` precedent), and the v2→v3 staging migration rules (default fields for existing records, validation/backfill).
- Must keep service-role keys and invite codes server-only; browser config limited to the existing public Vite variables.
