# Research: Goal project link persistence and model foundation

## Overview

Goals v1 persists an optional project on the goal only: `goals.project_id text` (`supabase/migrations/20261030000000_goals.sql:29`), read and written through hand-written, closed column lists in four independent layers - the domain model and validators (`src/state/types.ts`, `src/lib/goals/factories.ts`), the remote row mappers (`src/lib/data/SupabaseDataAccess.ts`), the staged-sync RPC (`supabase/migrations/20261031000000_goal_staged_sync_rpc.sql`), and the local staging snapshot validators (`src/lib/data/staging/types.ts`). Trackers have no project field anywhere.

That layering is the whole risk of this issue: a column the RPC does not enumerate is written as its default on insert and left untouched on update, with no error and no response body, and a goal shape the staging validator rejects makes the entire per-owner staging record unreadable rather than dropping rows. This issue is storage/model/mapping only, and every later issue in the epic (`docs/issues/issue-199.md` through `issue-203.md`) depends on the model and column names chosen here.

## Issue Context

- User/requested outcome (from `docs/issues/issue-198.md:38-46`):
  - `goal_trackers.project_id text` (nullable) and `goals.project_link_mode text not null default 'inherit'`.
  - A database check constraint enforcing: `'project'` requires a non-null `project_id`; `'inherit'`/`'none'` require `project_id is null`; plus an allowed-values check.
  - A new migration redefines `apply_staged_sync` (private implementation and public wrapper) so both new columns appear in the explicit insert and `do update set` lists. The argument list is unchanged.
  - `seed.sql` seeds rows that satisfy the invariant.
  - `GoalTracker` gains `projectId: string | null`; `Goal.projectId` is replaced by `GoalProjectLink = { mode: "inherit" } | { mode: "none" } | { mode: "project"; projectId: string }`.
  - Row->model and model->row mappers for both new columns.
  - `isGoal` rejects cross-mode half-states.
  - Staged payloads written before this issue (schemaVersion <= 10, goals carrying `projectId: string | null`) upgrade on read: non-null -> `{ mode: "project", projectId }`, null -> `{ mode: "inherit" }`, without hiding goals.
  - Consumer call sites compile with the union; no behaviour change beyond type plumbing.
- Current pain or bug: a tracker cannot carry a default project, so every goal in a tracker repeats the same project; and both failure modes are silent - the RPC drops unnamed columns, while a bad goal shape fails record validation.
- Scope classification: T4 (issue header, `docs/issues/issue-198.md:5-9`).
- The issue's own research questions (`docs/issues/issue-198.md:15-19`):
  1. Does the check constraint require a same-migration backfill before it is added?
  2. Is a `STAGING_SCHEMA_VERSION` 11 bump with a v10->v11 step required, or can the union be derived inside the existing hydration/validation path?
  3. What does a still-old client pushing legacy goal JSON into the redefined RPC do?

## Current Behavior

**Domain model and validators**

- `Goal.projectId: string | null` (`src/state/types.ts:363`). `GoalTracker` has no project field (`src/state/types.ts:334-346`). `GoalCheckIn` has no project field (`src/state/types.ts:373-386`).
- `isGoal` accepts only `null` or a non-empty string: `(v.projectId === null || nonempty(v.projectId))` (`src/lib/goals/factories.ts:30`). It does not reject unknown keys, does not trim, and does not check that the id resolves to a PM project.
- `isGoalTracker` has no project branch (`src/lib/goals/factories.ts:23-27`).
- `createGoal` defaults `projectId: null` before the input spread (`src/lib/goals/factories.ts:47-52`). `createGoalTracker` defaults purpose/color/sortOrder/isArchived/lastBuiltPeriodStart only (`src/lib/goals/factories.ts:41-46`).
- Precedent for strict union key checks exists but is not used for goals: `isGoalCheckIn` explicitly rejects `periodEnd` (`src/lib/goals/factories.ts:38`), and the goal-set file parser requires exact own keys for every object (`src/lib/goals/goalSetFile.ts:71-78`).
- `NewGoalInput.projectId?: string | null` (`src/state/GoalContext.tsx:33`); `updateGoal` patches through `Partial<Omit<Goal, "id" | "trackerId" | "createdAt">>` and re-validates with `isGoal` (`src/state/GoalContext.tsx:269-279`). `tsconfig.json` sets `strict` but not `exactOptionalPropertyTypes`, so an explicit `projectId: undefined` is type-legal and is spread over the `null` default, after which `isGoal` throws `RangeError("Invalid goal")` (`src/lib/goals/factories.ts:48-50`). No test covers that path.

**Database**

- `public.goals.project_id text` is nullable with no default, no FK, no CHECK, no index (`supabase/migrations/20261030000000_goals.sql:29`). It cannot be an FK to projects because PM projects are a JSONB blob inside `public.pm_state.data->'projects'` (`supabase/seed.sql:158-193`).
- `public.goal_trackers` has 12 columns and no project column (`supabase/migrations/20261030000000_goals.sql:3-20`). `goals` has a composite FK `(owner_id, tracker_id) -> goal_trackers(owner_id,id) on delete cascade` (`:38`).
- RLS is owner-scoped for select/insert/update plus a structural delete policy with no delete grant (`supabase/migrations/20261030000000_goals.sql:68-81`). A `before update` trigger calls `public.touch_updated_at()` (`:79`), which stamps `now()` only when the caller left `updated_at` unchanged (`supabase/migrations/20260802000000_sync_metadata.sql:44-60`).
- There are no generated Supabase types (`supabase gen types` is not wired up); the client is untyped and row objects are `any` (`src/lib/data/SupabaseDataAccess.ts:3`, `:388-402`). The migration SQL is the schema of record.

**Remote mapping and the staged-sync RPC**

- `goalTrackerRow` maps 11 keys and has no `project_id` (`src/lib/data/SupabaseDataAccess.ts:139-141`); `goalRow` maps 12 keys including `project_id: value.projectId` (`:142-144`); `goalCheckInRow` maps 12 keys (`:145-147`). Both directions are closed literals: `validateGoalTracker` / `validateGoal` read only the enumerated keys (`:388-397`), and `updated_at` is always the transport stamp, not the domain `updatedAt` (`:140`, `:143`).
- `pull` issues `select("*")` per table (`src/lib/data/SupabaseDataAccess.ts:203`), so a new column arrives on the wire but is ignored unless the mapper reads it; a mapped-but-absent field becomes `undefined`, which fails `isGoal`/`isGoalTracker` and throws `invalid row` (`:390`, `:395`).
- The push call sends exactly 42 named inputs; goal inputs are `plan.goalUpsert...map(({ value, updatedAt }) => goalRow(value, updatedAt))` (`src/lib/data/SupabaseDataAccess.ts:669-674`). The unit test asserts the 42-key argument object (`src/lib/data/SupabaseDataAccess.test.ts:419`).
- SQL enumerates columns explicitly. Tracker insert list `owner_id,id,name,purpose,cadence,cadence_anchor_at,color,sort_order,is_archived,last_built_period_start,created_at,updated_at` (`supabase/migrations/20261031000000_goal_staged_sync_rpc.sql:64`) with `do update set` at `:67`. Goal insert list includes `project_id` (`:71`) with `project_id=excluded.project_id` in the update (`:74`). Check-in list at `:78`/`:80-82`. Each upsert is gated `where excluded.updated_at > <table>.updated_at` (`:68`, `:75`, `:82`); tracker `last_built_period_start` uses `greatest(...)` (`:67`).
- The SQL reads only enumerated JSON keys via `v_row->>'...'`; extra keys in an upsert object are ignored and a missing key becomes SQL NULL. There is no validation or warning. A column present on the table but absent from the RPC insert/update lists is therefore written as its default on insert and left unchanged on update, with no error (confirmed against `:63-83`).
- `push` checks only `response.error` and discards the body; the function returns `void` (`src/lib/data/SupabaseDataAccess.ts:677`; SQL `returns void`, `:49`, `:129`). There is no read-back.
- After a successful push the coordinator commits a purely local projection of the acknowledged plan (`src/lib/data/sync/SyncCoordinator.ts:299-306`; `src/lib/data/sync/merge.ts:1705-1852`) and clears local stamps. Inference: a column silently dropped by the server is acknowledged, its stamp cleared, and the value is lost on the next merge because the remote row then wins.

**Local staging**

- `STAGING_SCHEMA_VERSION = 10` (`src/lib/data/staging/types.ts:212`) and the record interface pins the literal `schemaVersion: 10` (`:132`). The accepted-version gate lists numeric literals 1 through 10 (`:691-706`).
- Goals live only in three top-level maps plus their stamps/tombstones (`src/lib/data/staging/types.ts:123-131`) and in the `lastSynced` baseline as `{ value, updatedAt }` wrappers (`:55-63`). `state` is `AppStateData` (tasks/logs/settings/timer) with no goals (`src/state/types.ts:177-184`), and `pendingCompletions` is timer-only with no goal data (`src/lib/data/staging/types.ts:89-100`). The issue's change description (`docs/issues/issue-198.md:148`) lists `state` and the journal as goal carriers; current code has no goals in either.
- Goal rows are validated through `isGoal`/`isGoalTracker`/`isGoalCheckIn` in `REQUIRED_FIELD_CHECKS` (`src/lib/data/staging/types.ts:603-611`) and again inside `isSyncSnapshot` for `lastSynced` (`:543-552`). Both are record-level gates: a single invalid goal rejects the whole record (`:875-879`, `:898-900`). The "v2 record check" referenced in the issue as line 549 is `isSyncSnapshot`, not a v2 migration step.
- Migrations run inline in `parseStagedOwnerRecord` (`src/lib/data/staging/types.ts:681-905`); there are no per-version functions. The chain ends at v10 with a v9->v10 step that retires `inProgressPomodoros` and backfills `state.timer.window_started_at` only (`:852-869`). No existing step rewrites populated goal rows; the only goal step installs empty maps at v8->v9 (`:840-851`).
- Migration output is not written back on read; the on-disk version advances only on the next `update`/`discardPendingChanges` (`src/lib/data/staging/LocalStagingStore.ts:380-385`, `:416-424`, `:507-509`).
- `update` validates only owner, target version, and journal length (`src/lib/data/staging/LocalStagingStore.ts:403-415`); it does not run the row/record validators, so a bad mutation can persist a record that every later read rejects.
- Every staging access re-reads and re-parses the whole record (`src/lib/data/StagedDataAccess.ts` calls `store.read` in each method, e.g. `:236`, `:308`, `:471`, `:668`, `:673`, `:853`). Consequence: a record that fails validation breaks tasks, logs, settings, timer, and goals for that owner, not just goal rows. Goal-level filtering in `GoalContext` (`src/state/GoalContext.tsx:91-104`, strict path `:93-98`) is only reached when the record itself parses.

**UI and current write paths**

- The tracker form has name, purpose, cadence, weekday, interval, and colour only; submit sends `{ name, purpose, cadence, color }` (`src/components/GoalsPage.tsx:521-536`). No project control, and `NewGoalTrackerInput` has no field (`src/state/GoalContext.tsx:22-28`).
- The goal editor's project select writes a raw id: `onSave({ title, notes, projectId: projectId || null, metric: nextMetric })` (`src/components/GoalsPage.tsx:801`; local state init at `:678`, missing-project detection at `:679`, select markup at `:816-820`). Note: the issue cites line 788; the working tree has it at 801.
- Goal rows render a project link only when non-null (`src/components/GoalsPage.tsx:656`) using the page-local `GoalProjectLink` which resolves `pm.state.projects[projectId]` and renders "Linked project is missing" when absent (`:586-592`).
- Quick add creates goals with no project (`src/components/GoalsPage.tsx:438`; factory default `null`).
- Tracker header and `TrackerRail` show no project (`src/components/GoalsPage.tsx:328-423`; `src/components/goals/TrackerRail.tsx:165-196`).
- Deleting a PM project nulls `PMTask.projectId` for its tasks but never touches goal links (`src/state/ProjectManagerContext.tsx:498-519`), so dangling goal links persist by design today.
- Consumers reading the raw field: `buildGoalEvidence` early-returns on null and filters PM tasks by `task.projectId === goal.projectId` (`src/lib/goals/evidence.ts:90-93`); `GoalEvidencePanel` reads it for the freeze baseline, re-baseline, prefill guard and render gate (`src/components/goals/GoalEvidencePanel.tsx:41`, `:66`, `:68`, `:85`, `:91`, `:93`); `CheckInWizard` gates the panel on it (`src/components/goals/CheckInWizard.tsx:301`). The deck plan has no project reference at all (`src/lib/goals/deck/plan.ts`), and the live deck build does not pass `evidenceTitlesByGoal` (`src/components/GoalsPage.tsx:236-244`).

**Goal-set file**

- `GOAL_SET_VERSION = 1` with an exact goal key set `["title","notes","projectId","metric","lifecycle","sortOrder"]` (`src/lib/goals/goalSetFile.ts:9`, `:59`); `readGoal` requires exact own keys and accepts `projectId: null` or a non-empty string (`:151-169`); `readGoalSet` gates `version === 1` exactly (`:177-179`).
- Export copies `projectId: goal.projectId` (`:225`); import materialises through `createGoal({ ..., projectId: goal.projectId })` (`:285`), and the UI adapter clears any id not present in local PM state (`src/components/goals/GoalSetActions.tsx:163`).

## Relevant Files And Entry Points

- `src/state/types.ts:334-346`, `:358-371` - `GoalTracker` and `Goal` declarations; the union replaces `Goal.projectId` here.
- `src/lib/goals/factories.ts:23-33`, `:41-52` - `isGoalTracker`, `isGoal`, `createGoalTracker`, `createGoal`; the only shared validators used by UI, mappers, in-memory data access, staging, and goal-set import.
- `src/lib/data/SupabaseDataAccess.ts:139-147` - `goalTrackerRow`, `goalRow`, `goalCheckInRow` (closed column literals, module-private, exercised only through push/pull).
- `src/lib/data/SupabaseDataAccess.ts:388-397` - `validateGoalTracker`, `validateGoal`; row->model mapping and the `invalid row` failure path.
- `src/lib/data/SupabaseDataAccess.ts:669-674` - goal inputs to `apply_staged_sync`.
- `supabase/migrations/20261030000000_goals.sql:3-20`, `:23-43`, `:68-81` - table DDL, checks, grants, RLS, `touch_updated_at` trigger.
- `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql:1-4`, `:6-49`, `:63-83`, `:86-136` - predecessor rename, 42-arg private function, explicit column lists, public invoker wrapper, revoke/grant statements.
- `supabase/migrations/20261101000000_goal_habit_metrics.sql:1-24` - the most recent goal migration; shows the `drop constraint if exists` / `add constraint` replay pattern and the derived `goals_metric_check` name.
- `supabase/migrations/20261108000000_log_work_window_id.sql` - last applied migration by filename order; the new migration must sort after it.
- `supabase/seed.sql:477-512`, `:514-574`, `:579-676` - tracker, goal, check-in seeds for the fixed local user `dbuchananh@gmail.com`; `project_id` is seeded as `null` at `:524`. Seeded PM project ids are `20000000-0000-4000-8000-000000000001..3` (`:158-193`).
- `supabase/config.toml:13`, `:59-71` - exposed schemas, migrations enabled with no declarative schema, seed enabled from `./seed.sql`.
- `src/lib/data/staging/types.ts:122-212` - record shape, schema version constant, requirement that every goal row validate.
- `src/lib/data/staging/types.ts:543-611` - `isSyncSnapshot` and `REQUIRED_FIELD_CHECKS`; both call the goal validators.
- `src/lib/data/staging/types.ts:667-905` - doc comment, version gate, full v1->v10 upgrade chain, owner/record validation.
- `src/lib/data/staging/LocalStagingStore.ts:380-436` - read/parse, write-side checks, whole-record rewrite, revision bump.
- `src/state/GoalContext.tsx:22-56`, `:262-279` - `NewGoalTrackerInput` / `NewGoalInput`, create/update commands and their validator calls; `:108-134` reconcile; `:188-202` save.
- `src/lib/data/StagedDataAccess.ts:672-714` - `loadGoals` / `saveGoals`; full-set write, stamping, monotonic `lastBuiltPeriodStart`.
- `src/components/GoalsPage.tsx:521-536`, `:671-820` - `TrackerForm`, `GoalEditor`, project select, save handler.
- `src/lib/goals/evidence.ts:88-154` - project-driven evidence selection.
- `src/components/goals/GoalEvidencePanel.tsx:41-93` - six raw `goal.projectId` reads.
- `src/components/goals/CheckInWizard.tsx:301` - evidence panel mount gate.
- `src/lib/goals/goalSetFile.ts:57-78`, `:151-192`, `:207-295` - closed v1 file contract, parse/serialize/materialise.
- `src/lib/goals/testFixtures.ts:22-51`, `:81-110` - tracker/goal fixture override types and builders; every fixture flows through the factories and therefore through the validators.

## Data Flow Or Control Flow

**Flow A - goal edit to remote row**

1. `GoalEditor` submits `{ title, notes, projectId | null, metric }` (`src/components/GoalsPage.tsx:801`).
2. `goals.updateGoal` spreads the patch, forces `id`/`trackerId`/`createdAt`, stamps `updatedAt`, and validates the whole row with `isGoal`; an invalid row throws and nothing is published (`src/state/GoalContext.tsx:269-279`).
3. `mutate` publishes optimistically, then the save effect serialises the whole slice and calls `save()` (`src/state/GoalContext.tsx:214-226`).
4. `save()` strict-loads staged goals, reconciles local rows over the accepted baseline, and calls `data.saveGoals(sortedTrackers, sortedGoals, sortedCheckIns)` (`src/state/GoalContext.tsx:188-202`).
5. `StagedDataAccess.saveGoals` validates every row again, stamps only changed rows, writes the local maps/stamps/tombstones, and serialises the whole staging record under the owner lock (`src/lib/data/StagedDataAccess.ts:678-714`; `src/lib/data/staging/LocalStagingStore.ts:399-436`).
6. On the next sync trigger, `buildPushPlan` emits a goal upsert only when the value differs from `lastSynced` and an `updatedAt` stamp exists (`src/lib/data/sync/merge.ts:1326-1366`, `:1508`), `goalRow` converts it, and one `client.rpc("apply_staged_sync", {...42 inputs})` is sent (`src/lib/data/SupabaseDataAccess.ts:599-678`).
7. SQL inserts/updates only the enumerated columns; extra JSON keys are ignored and unenumerated table columns fall back to defaults (`supabase/migrations/20261031000000_goal_staged_sync_rpc.sql:63-83`).
8. `push` resolves `void`; the coordinator advances the baseline from its local projection and clears stamps (`src/lib/data/sync/SyncCoordinator.ts:299-306`).

**Flow B - remote pull to UI**

1. `pull` selects `*` from `goal_trackers`/`goals`/`goal_check_ins`, paginated for goals (`src/lib/data/SupabaseDataAccess.ts:203`, `:446`).
2. `validateGoalTracker`/`validateGoal` rebuild domain objects from the enumerated rows and call the shared validators; failure throws and aborts the whole pull (`:388-397`).
3. `mergePulledSnapshot` merges goals as a whole-row LWW versioned collection, forces `lastBuiltPeriodStart = max(local, remote)`, collapses duplicate check-ins by natural key, and sets `lastSynced` to the remote snapshot (`src/lib/data/sync/merge.ts:749-801`, `:852-885`, `:1170`).
4. The merged record is written back to staging and `GoalContext` re-hydrates through `loadGoals`, filtering any row the validators reject with a warning (`src/state/GoalContext.tsx:91-104`).
5. `GoalsPage` renders the link from PM state and passes raw ids to evidence/panel/wizard consumers (`src/components/GoalsPage.tsx:586-592`, `:656`).

**Flow C - local boot with a pre-issue staging record**

1. `LocalStagingStore.read` parses the stored JSON and returns a fresh record when the key is absent (`src/lib/data/staging/LocalStagingStore.ts:380-385`).
2. `parseStagedOwnerRecord` gates the version, runs every upgrade step inline, checks the owner, then validates required fields, app state, journal, and baseline (`src/lib/data/staging/types.ts:681-905`).
3. A pre-issue goal row is validated with the current `isGoal` after the chain; if the goal shape changed without a v10->v11 step, `REQUIRED_FIELD_CHECKS` throws and the record is rejected (`:606`, `:875-879`).
4. Rejection propagates out of `read`, so every `StagedDataAccess` method for that owner fails, not only goal reads (`src/lib/data/StagedDataAccess.ts:668-673`, `:853`).
5. A migrated record stays in memory until the next write rewrites the key at the current version (`src/lib/data/staging/LocalStagingStore.ts:416-424`, `:507-509`).

## Important Contracts And Constraints

- **RPC signature is fixed**: 42 named jsonb/timestamptz/boolean inputs in a fixed order, identical between the private implementation and the public invoker wrapper; the client asserts the count (`src/lib/data/SupabaseDataAccess.test.ts:419`). Adding RPC inputs is out of scope; only the function bodies change.
- **Explicit column lists are the wire contract.** Both goal tables are written only through `insert ... values ... on conflict ... do update set` with fully enumerated columns (`supabase/migrations/20261031000000_goal_staged_sync_rpc.sql:64-75`). A new columns must appear in both the insert list/values and the `do update set` list, or it never syncs.
- **LWW is `excluded.updated_at > table.updated_at`** for all three goal tables (`:68`, `:75`, `:82`), and `touch_updated_at` preserves a client-authored newer stamp while stamping `now()` for ordinary updates (`supabase/migrations/20260802000000_sync_metadata.sql:44-60`). Any `update` the migration itself runs on `public.goals` fires that trigger, so backfilled rows get `updated_at = now()` at migration time even though the payload columns did not change.
- **`last_built_period_start` uses `greatest(...)`** server-side (`:67`), so it can never be lowered through this RPC; an integration test asserts the retention (`integration/SupabaseDataAccess.integration.test.ts:640-644`).
- **Goal deletions are impossible through this API**: no delete grant (`supabase/migrations/20261030000000_goals.sql:69`) and any non-empty goal/check-in/tracker tombstone raises `GOALS_ARCHIVE_ONLY` (`:56-60`), which rolls back the entire batch including non-goal domains.
- **Grants must survive the redefinition.** The existing migration restates `revoke ... from public,anon` and `grant execute ... to authenticated,service_role` for both functions (`:133-136`). `create or replace function` on the unchanged signature preserves existing grants; `drop function` + `create function` does not, and would need the exact 42-type argument lists restated.
- **Check constraints validate immediately.** PostgreSQL `ALTER TABLE ... ADD CONSTRAINT ... CHECK` scans and validates existing rows unless marked `NOT VALID`. Existing goals with a non-null `project_id` would receive the column default `'inherit'`, so adding the invariant constraint before the backfill aborts the migration. Because each migration file runs in one transaction, an abort leaves nothing behind.
- **Constraint strictness vs client strictness.** The proposed invariant only requires `project_id is not null` for `'project'`, while `isGoal` requires a non-empty, non-whitespace id (`src/lib/goals/factories.ts:30`). An empty-string `project_id` would satisfy the database and fail the client validator on pull, which throws for the whole pull (`src/lib/data/SupabaseDataAccess.ts:390-397`).
- **Staging version bump is a four-place change**: the record interface literal (`src/lib/data/staging/types.ts:132`), the constant (`:212`), the accepted-version gate (`:691-706`), and the doc comment (`:667-680`). `LocalStagingStore.update` also force-writes the constant and rejects a mutation that returns a different version (`src/lib/data/staging/LocalStagingStore.ts:406-410`, `:419`).
- **Staging validation is record-level, not row-level.** `REQUIRED_FIELD_CHECKS` and `isSyncSnapshot` cover goal rows (`src/lib/data/staging/types.ts:603-611`, `:543-552`) and any failure throws (`:875-879`, `:898-900`). Rows are not dropped and the record is not repaired.
- **There is no forward compatibility.** A newer stored version is rejected by the gate (`:691-705`), so a downgraded/older build cannot read a v11 record at all; `update`, `discardPendingChanges`, and `pendingCount` all re-read first and fail too (`src/lib/data/staging/LocalStagingStore.ts:401`, `:445`, `:561`).
- **Goal-set v1 is a closed file contract.** Exact key set and exact version (`src/lib/goals/goalSetFile.ts:57-62`, `:177-179`); reusing the `projectId` key with a union value would break every previously exported file, and adding `projectLink` would be rejected as an unknown field.
- **The value stored in `lastSynced` is a projection, not a server echo.** `commitAcknowledgedPush` writes a locally computed post-push snapshot (`src/lib/data/sync/merge.ts:1705-1852`); nothing re-reads the server after a push, so the client cannot detect a dropped column.
- **Seed data is fixed-user scoped** (`dbuchananh@gmail.com`, `supabase/seed.sql:1-7`, `:48`) and is replayed by every `supabase db reset` (`supabase/config.toml:66-71`; `package.json:23`). Goal seed rows must satisfy the new invariant, and a seeded tracker project id that is not one of `20000000-...-000000000001..3` would render as "Linked project is missing" in the UI.
- **Migrations are forward-only and replay-from-scratch.** There is no down migration and no `db push` script; `pnpm test:integration` runs `supabase db reset` then the integration suite (`package.json:23`).
- **Repository constraints (AGENTS.md)** that bear on this work: goals live in `src/lib/goals/**` with pure unit tests; the application data layer and pure engine are the source of truth; no Tauri invoke data paths or service-role credentials in the browser; the per-owner staging store is the only general localStorage exception.

## Existing Tests And Validation

- `src/lib/data/SupabaseDataAccess.test.ts:401-437` - "goal row transport": builds a tracker/goal/check-in, asserts exact pushed rows (`:407-409`) and the 42-input argument object (`:419`). The goal fixture uses the factory default `projectId: null`, so no non-null `project_id` is asserted; malformed rows are rejected at `:425-436`.
- `src/lib/goals/factories.test.ts:1-61` - metric and check-in validator coverage and factory determinism. No `projectId` case exists (no reference anywhere in the file).
- `src/lib/data/goalsFoundation.test.tsx:43-78` - a literal v8 staging record loads through `LocalStagingStore` + `StagedDataAccess` + `DataProvider`, expects migration to `schemaVersion: 10` with the nine empty goal maps in both record and `lastSynced`, and asserts the persisted version after a save. `:80-312` covers stamps, owner isolation, reversion during push, idempotent saves, tombstones, whole-row LWW, check-in natural keys, `lastBuiltPeriodStart`, wipe preservation, and "malformed staged rows rejected before writing".
- `src/lib/data/staging/LocalStagingStore.test.ts:684-705` - rejects invalid JSON, versions `0/11/999` and a missing version, plus owner mismatch; `:299-318` v6->v10 representative migration; `:907-924` populated v9 round-trip; `:971-1005` v5->v10 and v9->v10; `:1047-1136` v2->v10 and v1->v10; `:233-261` fresh-record defaults. No test builds a v10 record containing goal rows with `projectId`.
- `src/components/GoalsPage.test.tsx:1417-1444` - editor round-trip: selecting a project persists the id and reopening shows it; clearing persists `null`. `:1446-1461` - a dangling id renders "Linked project is missing" with no alert. `:386` - quick-add defaults to `null`.
- `src/lib/goals/evidence.test.ts:113-138`, `:192-213` - project-scoped task/log selection, unlinked goal empty evidence, missing project `brokenProject: true`.
- `src/components/goals/GoalEvidencePanel.test.tsx:193-265` - missing-project note, prefill/freeze/refresh, no overwrite of existing `current`, past/future periods never prefill, unlinked goal renders nothing.
- `src/components/goals/CheckInWizard.test.tsx:656-709` - evidence appears for a linked goal and not for an unlinked one; `:711-796` prefill/freeze/re-prefill.
- `src/lib/goals/goalSetFile.test.ts:82-135` - canonical key order and indentation including `"projectId": "project-1"`; `:260-320` exact error codes, including a missing or empty `projectId`. `src/components/goals/GoalSetActions.test.tsx:282-304` - unknown project ids are cleared on import, known ones kept.
- `integration/SupabaseDataAccess.integration.test.ts:582-624` - goal metric check replay and 12 invalid metric shapes failing `23514`; `:626-663` - goal push/pull round-trip, idempotent replay, LWW gating, `lastBuiltPeriodStart` retention, check-in natural-key id retention, `GOALS_ARCHIVE_ONLY`, RLS/anon/delete denials, cross-owner FK `23503`, owner spoof `42501`. All goal fixtures use `project_id: null` (`:604`, `:629`, `:658`).
- `integration/localFirstSync.integration.test.ts:589-648` - the old 20-arg signature no longer resolves; two-device check-in convergence and pending count zero.
- `integration/rpcPrivileges.integration.test.ts:18-65` - anonymous executes all 42 named args and must fail `42501`.
- Validation commands available: `pnpm test:unit` (Vitest, `src/**/*.test.{ts,tsx}`), `pnpm test:integration` (`supabase db reset` + Node-config integration suite), `pnpm run build` (`tsc && vite build`), `pnpm lint:supabase` (`deno check` + `npx supabase db lint --local --fail-on error`), `pnpm test:all`.
- Missing coverage relative to this issue: no non-null goal `project_id` round-trip in unit or integration; no tracker project anywhere; no v10->v11 upgrade test and no v10 record containing populated goals; no test of the check constraint rejecting an inconsistent row; `seed.sql` is never asserted by any automated test (`grep` for the fixed user in `**/*.ts` returns nothing); `merge.test.ts` has no goal-specific describe block; `SyncCoordinator.test.ts`'s fake server implements no goal semantics; there is no goals e2e spec.

## Risks, Edge Cases, And Unknowns

1. **Constraint ordering (issue research question 1).** The DDL snippet in `docs/issues/issue-198.md:74-88` adds `project_link_mode` and both checks in one `ALTER TABLE`, then backfills in a later `DO` block. Existing goals with `project_id is not null` would hold the default `'inherit'`, so `ADD CONSTRAINT` fails immediately and the whole migration rolls back. The prose at `:90` says to order the backfill first, but the snippet does not. Add column -> backfill -> add constraints, as separate statements.
2. **Migration backfill bumps `updated_at`.** The `goals_touch_updated_at` trigger (`supabase/migrations/20261030000000_goals.sql:79`) sets `now()` when the backfill leaves `updated_at` unchanged. Every backfilled goal row then carries the migration timestamp, which is newer than any pre-migration client stamp and will win LWW against a queued offline edit for that row until the client edits it again. Not covered by any test.
3. **Old clients pushing legacy goal JSON (issue research question 3).** No current SQL branch tolerates a missing key: `(v_row->>'project_link_mode')::text` yields SQL NULL, and an explicit NULL into a `not null default 'inherit'` column raises `23502`. If the new RPC instead coalesces to `'inherit'`, an old client's goal that has a project id raises the invariant check `23514`; and for a `'none'` goal it would silently rewrite the mode to `'inherit'`. Either way the failure (or clobber) is per-batch: one RPC request carries every domain, so a single rejected goal rolls back tasks, logs, habits, todos, pets, settings, timer, PM state, and check-ins for that sync. Production impact is limited to owners with project-linked goals editing them on a build that predates this migration. The issue's requirement 3 keeps the argument list unchanged, so this is a decision the implementation must make explicitly.
4. **Tracker `projectId` also needs an upgrade default.** Requirement 8 only mentions deriving `projectLink` for goals, but a required `isGoalTracker` check (in the shape of `isGoal`'s) makes every v10 tracker row invalid, and `REQUIRED_FIELD_CHECKS` then rejects the whole record (`src/lib/data/staging/types.ts:603`, `:875-879`). Either the v10->v11 step adds `projectId: null` to every tracker in `goalTrackers` and `lastSynced.goalTrackers[].value`, or the validator must accept `undefined` as `null` - which weakens "new rows always satisfy the invariant".
5. **The issue's upgrade target list is inaccurate.** There are no goals in `state` (`src/state/types.ts:177-184`) and none in the timer journal (`src/lib/data/staging/types.ts:89-100`). The v10->v11 step needs to rewrite only the top-level `goals` map and `lastSynced.goals[].value` (when `lastSynced` is non-null). `goalTrackers` holds trackers, not goals.
6. **Whole-record rejection, not hidden rows.** The issue says an unknown goal shape makes rows "disappear from the Goals page" (`docs/issues/issue-198.md:58`). In code, record validation throws first (`src/lib/data/staging/types.ts:875-879`, `:898-900`) and `LocalStagingStore.read` propagates the error (`src/lib/data/staging/LocalStagingStore.ts:380-385`), so every staged data read for that owner fails; the row-filtering path in `GoalContext.loadedSlice` is never reached. This raises the blast radius of a missed upgrade from "goals look empty" to "the app cannot load or save local data".
7. **Forward compatibility after the bump.** A v11 record is unreadable by any build that only accepts up to v10 (`:691-705`), including reads taken by `update`/`pendingCount`. Staging is per-device, so this is a downgrade/rollback risk (older Tauri installer, stale cached bundle), not a cross-device one.
8. **Write-side staging validation gap.** `update` does not run the validators (`src/lib/data/staging/LocalStagingStore.ts:403-415`), so a union half-state produced by a mapper bug would persist and only surface as a record rejection on the next read, potentially bricking local data with no in-app repair path (no `removeItem`, no repair flow).
9. **DB invariant is weaker than the client invariant.** `'project'` with `project_id = ''` passes the proposed check (`'' is not null`) but fails `isGoal` (`nonempty`) on the next pull, which throws for the entire pull. The same class of hazard already exists for `goals.project_id` today (`supabase/migrations/20261030000000_goals.sql:29` vs `src/lib/goals/factories.ts:30`). A tracker `project_id` with an empty string has the same effect once `isGoalTracker` validates it.
10. **Union projection into the goal-set file is lossy for `'none'`.** `serializeGoalSet` writes `projectId` (`src/lib/goals/goalSetFile.ts:225`) and import materialises through `createGoal` (`:285`), which will default to `'inherit'`. Mapping `'none'` to `null` on export therefore re-imports as `'inherit'`. Requirement 9 says no behaviour change, so the v1 projection rule needs to be stated even though `'none'` is unreachable from the UI in this issue.
11. **Editor mapping is a semantic choice.** The editor currently sends `projectId || null` (`src/components/GoalsPage.tsx:801`). With the union it must send something; `''` can become either `{ mode: "inherit" }` or `{ mode: "none" }`, and that choice determines what issue 201's tri-state control has to migrate. This is the only place in this issue where "mechanical type update" still encodes product meaning.
12. **`undefined` patch values.** `exactOptionalPropertyTypes` is off (`tsconfig.json`), `updateGoal` takes `Partial<Omit<Goal, ...>>`, and `GoalContext.clone` strips `undefined` before the spread (`src/state/GoalContext.tsx:61`, `:272`). A union plus a partial patch still permits `{ projectLink: undefined }` at the type level in some call sites; `isGoal` will reject it, but only at runtime.
13. **Every tracker literal and fixture must gain `projectId`.** `isGoalTracker` is called from creation, in-memory save, remote validation, staging checks, and goal-set materialisation. `lastBuiltPeriodStart:` appears 38 times across 16 files under `src/`, and `GoalTrackerFixtureOverrides` (`src/lib/goals/testFixtures.ts:22-35`) has no project field. A strict validator makes each of those a compile-or-runtime failure.
14. **`createGoalTracker` needs the same default-before-spread treatment as `createGoal`.** Otherwise `projectId` is absent from constructed trackers and `isGoalTracker` rejects them; and an explicit `projectId: undefined` would repeat the `createGoal` trap at `src/lib/goals/factories.ts:48-50`.
15. **Unknown: whether the hosted or local database already contains rows that break the new invariant or the stricter client rule.** The backfill covers `project_id is not null`, but rows with `project_id = ''` (passable today) cannot be detected from the repo and would be invisible to the check constraint while failing client validation. Also unknown: whether hosted data satisfies the 20261101 metric rule, which is the same class of pre-existing risk.
16. **Unknown: how goal tombstones interact with the new mode.** Structural goal tombstones are produced locally (`src/lib/data/StagedDataAccess.ts:700-703`) and rejected server-side (`supabase/migrations/20261031000000_goal_staged_sync_rpc.sql:56-60`); this issue does not change that, but any test that omits a goal while pushing will fail the whole batch.
17. **Stale line references in the issue.** `GoalsPage.tsx:788` is actually `:801`; the "v2 record check (line 549)" is `isSyncSnapshot`; `docs/issues/issue-200.md`/`issue-201.md` cite nearby but shifted lines. Implementers should locate by symbol, not line.

## Downstream Guidance

- Requirements should account for:
  - The exact ordering of the migration statements (add column, backfill, then add/validate constraints) and the fact that the constraint addition fails atomically otherwise.
  - The tracker upgrade, not just the goal upgrade: `GoalTracker.projectId` must be defaulted for every pre-existing tracker row in both the record and `lastSynced`.
  - The actual goal holders in staging: the top-level `goals` map and `lastSynced.goals[].value` only.
  - A stated rule for a legacy/old-client payload whose `project_link_mode` key is absent (fail loudly, or derive from `project_id`), because no existing SQL branch tolerates a missing required key and the whole batch is transactional.
  - A stated rule for projecting the union into the v1 goal-set `projectId` field, including what happens to `'none'`.
  - The stricter client-side definition of a valid id (non-empty) versus the database check (`is not null`), and whether the database should enforce the stronger rule.
  - That `'none'` will exist in the type but have no UI producer in this issue.
- Planning should consider:
  - The new migration sorts after `20261108000000_log_work_window_id.sql`; the function bodies can be replaced in place on the unchanged 42-arg signature, which keeps existing grants, or grants must be restated exactly as at `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql:133-136`.
  - Change order that keeps the tree compiling: model union and validators, then mappers, then the staging version bump and upgrade step, then consumers and fixtures. The union will break `testFixtures`, the goal-set module, evidence, the panel, and the wizard at compile time, which is useful as a checklist.
  - Test surfaces to extend: `src/lib/goals/factories.test.ts` (half-states, tracker project), `src/lib/data/SupabaseDataAccess.test.ts` (both mappers, a non-null project, 42 inputs unchanged), `src/lib/data/staging/LocalStagingStore.test.ts` (a v10 record with linked and unlinked goals and a tracker, upgraded and re-serialised at v11 with no rows lost), `src/lib/data/goalsFoundation.test.tsx` (persisted version), and new integration assertions for the constraint and a non-null `project_id` round-trip. Note `integration/SupabaseDataAccess.integration.test.ts` currently only exercises `project_id: null`.
  - Seed verification is manual: no automated test reads `seed.sql`, and `pnpm test:integration` starts with `supabase db reset`, which replays all migrations and the seed.
  - Use a seeded PM project id for the seeded tracker/goal link so the Goals page and evidence panel show a healthy link rather than "missing".
  - Line/reference drift: locate code by symbol, not the line numbers quoted in the issue.
- Do not include: tracker form or header UI, goal-row deviation display, the tri-state editor, `resolveGoalProject`, evidence/panel/wizard rewiring, deck project context, goal-set v2 format, dangling-link cleanup or project-deletion cascades, referential integrity to PM projects, changes to LWW/tombstone semantics, or a refactor of the closed mappers into generated column maps. Those belong to `docs/issues/issue-199.md` through `issue-203.md` or are explicitly out of scope.
