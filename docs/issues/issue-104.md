## Title: Staging store & Supabase persistence for the pet domain

## Tags

Complexity Classification: T4
Severity: High
Reason: Full-stack data-model change: staging schema v6→7 migration chain extension (touches users' existing local data), eight entity groups added across StagedOwnerRecord/SyncSnapshot/merge/SyncCoordinator/PushPlan/SupabaseDataAccess, new SQL migrations for eight pet tables per the owner-RLS pattern, and another drop+recreate extension of `apply_staged_sync` with LWW gating and tombstone guards, plus PetContext wiring and cross-layer tests. Blast Radius=4 (staging, sync, data access, SQL, contexts — 15+ files across two systems), Uncertainty=1 (established per-domain precedent from habits/todos migrations), Behavior=4 (data model, database schema, sync RPC), Testing=2 (migration correctness and data-loss risk across LocalStagingStore/merge/SupabaseDataAccess/integration), Reversibility=3 (schema migration + local staging migration are hard to undo without data cleanup). Total=14, which lands in T3 by sum, but Behavior=4 combined with Reversibility=3 on a destructive-ish persistence boundary mirrors the skill's data-format-change example and justifies raising to T4.
Needs research before implementation: Yes
Research needed: Exact current `apply_staged_sync` signature and the established extension mechanics (the habit/todos migrations show the drop+recreate trade-offs), the `REQUIRED_FIELD_CHECKS`/`freshRecord` shape at v6, and how the eight pet entity groups should be ordered in the migration and RPC args to keep the v6→v7 block consistent with the existing linear chain.

## Summary

Give the pet domain real persistence: bump the per-owner localStorage staging store schema to v7 with a v6→7 migration, thread the pet entity groups through the full staged-sync pipeline (store deltas, push plan, Supabase transport), create the pet tables in Supabase with owner-RLS per the established pattern, extend the `apply_staged_sync` RPC, and wire a `PetProvider` into the authenticated shell. The pet domain follows the exact habits/todos precedent at every layer.

## Steps to Reproduce Context

1. Issues A–E define pet records (profile, schedule items, activity records, nap records, weight log, training skills, fixations, notable events) but only the `DataAccess` interface pairs exist; `StagedDataAccess` has nowhere to put them and `SupabaseDataAccess` cannot sync them.
2. A user logging activities today would lose all pet data on reload, and the PWA and desktop app could not share pet state.

## Expected Behavior

All pet records persist in the per-owner staging store (`worktime:staging:v1:<ownerId>`, schema v7), survive reload, sync bidirectionally with Supabase via `apply_staged_sync` with last-write-wins semantics and tombstone deletes, and appear consistently in both the Tauri app and the PWA for the signed-in owner.

## Actual Behavior

No pet fields exist in `StagedOwnerRecord`/`SyncSnapshot` (staging schema is at v6); no pet tables exist in Supabase; `apply_staged_sync` has no pet arguments; no `PetProvider` is mounted.

## Requirements for completed issue

1. **Staging schema v7** (in `src/lib/data/staging/types.ts`): bump `STAGING_SCHEMA_VERSION` to 7; add the pet domain fields to `StagedOwnerRecord` and `SyncSnapshot` — for each pet entity group (pet profile, schedule items, activity records, nap records, weight log, training skills, fixations, notable events): a current-entities map keyed by id, an `updatedAt` LWW stamp map, a tombstone map (`{ id, deletedAt }`), plus mirrors in `lastSynced`. Add the v6→7 in-memory migration block to the linear chain in `parseStagedOwnerRecord`, the new `REQUIRED_FIELD_CHECKS` entries, validators, and `freshRecord()` defaults. Unknown/newer versions still rejected.
2. **Store mechanics** (`src/lib/data/staging/LocalStagingStore.ts`): add pet delta counters to `countPending()` (per-domain helper style, e.g. `countPetDeltas`) and include pet fields in both branches of `discardPendingChanges()` (baseline-restore and fresh-record).
3. **Push plan** (`src/lib/data/sync/merge.ts`, `src/lib/data/sync/types.ts`): add per-group pet upserts/tombstones to `PushPlan`/`AcknowledgedChanges`; add pet delta builders to `buildPushPlan` (both the wipe and normal branches); mirror in `isPlanNonEmpty` and `pushedSnapshotFromPlan` (`SyncCoordinator.ts`). Follow the tolerant-args precedent (`plan.todoCompletionUpserts ?? []`) so older remotes can be addressed during rolling updates.
4. **DataAccess implementation** (`src/lib/data/StagedDataAccess.ts`): implement the save/load pairs from Issues C/D/E (activities, naps, weight, training skills, fixations, notable events, plus profile/schedule items from A) following `saveHabits`: full-set diff → fresh LWW stamps for new/changed → tombstones for missing → tombstone clearing on re-add → one `store.update()`.
5. **Supabase transport** (`src/lib/data/SupabaseDataAccess.ts`): row serializers + validators per pet group; add the pet tables to `pull()`'s paginated query list; add `p_pet_*` jsonb arguments to `push()`'s `apply_staged_sync` call.
6. **SQL migrations** (new files in `supabase/migrations/`, one or more, following `20260803000000_habits.sql` exactly): per pet table — `id uuid primary key default gen_random_uuid()`, `owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade`, domain columns with checks, `created_at/updated_at timestamptz not null default now()`, `unique (owner_id, id)` conflict target, owner-scoped indexes, `revoke all ... from anon; grant ... to authenticated, service_role;`, RLS enabled with the four owner policies (`select/insert/update/delete` using/with-check `owner_id = auth.uid()`), and the `touch_updated_at` trigger (client-authored LWW stamps preserved).
7. **RPC extension** (new migration following `20260804000000_habit_staged_sync_rpc.sql`): `drop function if exists` the old `apply_staged_sync` signature and recreate with pet arguments — tombstones delete **before** upserts; upserts LWW-gated (`where excluded.updated_at > public.<table>.updated_at`); tombstones delete only rows with `updated_at <= deleted_at`; the pet domain sits **outside the full-wipe branch** (wipes preserve pet data, like habits/todos/pm_state); re-grant `execute to authenticated, service_role` and revoke from anon.
8. **PetProvider** (`src/state/PetContext.tsx`, modeled on `HabitContext.tsx`): Record-keyed state, load on hydrate via `useData()`, save on state/revision change with serialized-slice comparison guards, reload on `useSync()` revision bumps, local `now()`/`uuid()` injection, `normalize*` for untrusted loads, `usePets()` hook with provider guard. Mount `PetProvider` in the `AuthenticatedShell` provider stack in `src/App.tsx` (next to `HabitProvider`/`TodoProvider`); UI-only pet state stays in a separate `pet_..._v1` localStorage key outside the staging store.
9. **Tests**: extend `staging/LocalStagingStore.test.ts` (migration v6→v7, parsing, countPending, discard), `sync/merge.test.ts` (push plan deltas), `SyncCoordinator.test.ts`, `SupabaseDataAccess.test.ts` (serializers, pull, push args), and `pnpm test:integration` local-Supabase schema/RLS checks. Per AGENTS.md, run `pnpm install && pnpm run build` and the smallest relevant gates (`pnpm test:unit` at minimum; `pnpm test:integration` requires the local stack).

## Context

- Files:
  - `src/lib/data/staging/types.ts` (lines ~95–141 `StagedOwnerRecord`; ~405–531 migration chain + `REQUIRED_FIELD_CHECKS`) — the schema, version constant (`STAGING_SCHEMA_VERSION = 6`), and migration chain to extend.
  - `src/lib/data/staging/LocalStagingStore.ts` — `STAGING_STORAGE_PREFIX`/`stagingKey()`, `update()` (lock + revision + notify), `countPending()` (lines ~194–269), `discardPendingChanges()` (lines ~351–405).
  - `src/lib/data/StagedDataAccess.ts` — `saveHabits` (lines ~410–464) as the full-set replace template.
  - `src/lib/data/sync/merge.ts` (`buildPushPlan`, lines ~1136–1352), `src/lib/data/sync/types.ts` (`PushPlan`/`AcknowledgedChanges`), `src/lib/data/sync/SyncCoordinator.ts` (`isPlanNonEmpty`, `pushedSnapshotFromPlan`).
  - `src/lib/data/SupabaseDataAccess.ts` — `pull()` (lines ~277–366), row serializers (~78–95), `push()` (~424–479).
  - `supabase/migrations/20260803000000_habits.sql` — the new-domain SQL template; `supabase/migrations/20260804000000_habit_staged_sync_rpc.sql` — the RPC extension template; `supabase/migrations/20260802000000_sync_metadata.sql` — `touch_updated_at`.
  - `src/state/HabitContext.tsx` + `src/App.tsx` (`AuthenticatedShell` provider stack) — context wiring pattern.
- Code Snippets:

  Per-domain staging fields precedent (`staging/types.ts`):
  ```ts
  // Habit domain (added in v2 migration):
  habits: Record<string, Habit>;
  habitCompletions: Record<string, HabitCompletion>;
  habitUpdatedAt: Record<string, string>;
  habitTombstones: Record<string, { id: string; deletedAt: string }>;
  habitCompletionTombstones: Record<string, HabitCompletionTombstone>;
  ```

  RLS owner pattern (`20260803000000_habits.sql:46-63`):
  ```sql
  create policy habits_owner_select on public.habits
      for select to authenticated using (owner_id = auth.uid());
  create policy habits_owner_insert on public.habits
      for insert to authenticated with check (owner_id = auth.uid());
  -- update/delete policies follow the same owner_id = auth.uid() pattern
  ```

## Notes

- Sync mechanics: reads are direct owner-scoped table pulls; **writes go exclusively through `apply_staged_sync`** — never direct table DML. Domain contexts never sync directly; they stage via `data.saveX()` and rely on `SyncProvider` triggers (bootstrap/focus/visibility/pagehide/Tauri close).
- `StateSyncBridge` needs no changes for pets (it propagates PM/task estimates, unrelated to domain sync).
- No Edge Function changes are needed — pet sync rides `apply_staged_sync`.
- The v6→7 migration is forward-only in-memory field injection; existing v1–v6 records must continue to parse. Data-loss risk is the reason for the T4 rating — test the migration against a representative v6 fixture.
