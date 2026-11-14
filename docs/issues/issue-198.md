# Title: Goal project link persistence and model foundation

## Tags

Complexity Classification: T4
Classification Reason: Spans the database migration and check constraint, the staged-sync RPC body, seed data, the model union, both row↔model mappers, the staging upgrade chain, and every consumer of `goal.projectId`.

Severity: Critical
Severity Reason: A new column omitted from the RPC is silently dropped on sync with no error, and a gap in the staging upgrade hides goal rows from the Goals page on load.

Needs research before implementation: Yes

### Research Needed

The two failure modes here are both silent, so the exact migration and upgrade order must be confirmed before writing code.

- Confirm whether existing rows need a same-migration backfill (`update ... set project_link_mode = 'project' where project_id is not null`) before the check constraint is added, or `alter table ... add constraint` rejects current data.
- Confirm the staging path: whether pre-union snapshots require `STAGING_SCHEMA_VERSION` 11 with a v10→v11 upgrade step, or can be derived inside the existing hydration/validation path without a version bump, and what a still-old client pushing legacy goal JSON into the redefined RPC does.
- Files: `supabase/migrations/20261030000000_goals.sql`, `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql`, `supabase/seed.sql`, `src/lib/data/staging/types.ts` (upgrade chain, lines 671-869), `src/lib/data/SupabaseDataAccess.ts`, `src/lib/data/sync/`.

## Summary

Goals can point at a project, but a tracker cannot, so every goal has to repeat the same project and there is no tracker-level default to inherit. This is the first issue of the goal-project-link epic and only adds the storage, model, and mapping layer: a nullable `project_id` on `goal_trackers`, a `project_link_mode` column on `goals` with a database-level invariant, both columns carried through the staged-sync RPC and seed data, `GoalTracker.projectId`, and a strict `projectLink` union in place of `Goal.projectId`.

Nothing in this issue changes behaviour. Existing call sites get mechanical type updates only.

## Steps to Reproduce Context

1. Open Goals and create or edit a tracker (`TrackerForm`, `src/components/GoalsPage.tsx:521`). The form has name, purpose, cadence, weekday, interval, and colour; there is no project field.
2. Edit a goal (`GoalEditor`, `src/components/GoalsPage.tsx:671`). The select writes a raw goal-level project id: `onSave({ title, notes, projectId: projectId || null, metric: nextMetric })` (`GoalsPage.tsx:788`).
3. Sync. `private.apply_staged_sync` in `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql` writes `goal_trackers` and `goals` with explicit, fully enumerated column lists (lines 63-76).
4. On reload, staged rows are validated by `isGoalTracker` / `isGoal` (`src/lib/goals/factories.ts:23,28`) from the staging validators in `src/lib/data/staging/types.ts:547-609`.

Because the RPC names every column explicitly, a column added to the table but not to the RPC is silently dropped on push with no error.

## Requirements for completed issue

1. `public.goal_trackers` has a nullable `project_id text` column. `public.goals` has `project_link_mode text not null default 'inherit'`.
2. A check constraint enforces the invariant: `project_link_mode = 'project'` requires `project_id is not null`; `'inherit'` and `'none'` require `project_id is null`.
3. A new migration redefines `apply_staged_sync` (the private implementation and its public wrapper) so both new columns appear in the explicit insert column lists and in the `do update set` lists for their tables. The RPC argument list is unchanged.
4. `supabase/seed.sql` seeds valid rows under the new invariant (tracker project value; goal link mode and matching project id).
5. `GoalTracker` gains `projectId: string | null`. `Goal.projectId` is replaced by a discriminated union: `{ mode: "inherit" } | { mode: "none" } | { mode: "project"; projectId: string }`.
6. Row→model and model→row mappers exist in both directions for both new columns (`goalTrackerRow`, `goalRow`, `validateGoalTracker`, `validateGoal` in `src/lib/data/SupabaseDataAccess.ts`).
7. `isGoal` rejects half-states: `mode: "inherit"` or `"none"` with a project id present, `mode: "project"` with a missing/empty id, and keys belonging to another mode.
8. Staged payloads written before this issue (staging `schemaVersion` 10 and earlier, which carry `projectId: string | null` on goals) are upgraded on read: a non-null id becomes `{ mode: "project", projectId }`, null becomes `{ mode: "inherit" }`. The loader must not reject the record or hide goal rows.
9. Consumer call sites compile with the new union. No behaviour changes beyond type plumbing.

## Expected Behavior

- A tracker row and a goal row can both carry a project reference, and both survive push/pull and a page reload.
- A goal can express "inherit the tracker project", "no project", or "this explicit project", and only the explicit mode stores an id.
- Old local data upgrades without losing rows, and new rows always satisfy the invariant.

## Actual Behavior

- `goal_trackers` has no project column; `goals.project_id` is nullable text with no mode.
- The staged-sync RPC writes only the columns it enumerates, so any new column is discarded on sync.
- A staged goal carrying an unknown shape is rejected by `isGoal` and disappears from the Goals page.

### Testing

1. `pnpm test:unit` — new/extended cases in `src/lib/goals/factories.test.ts` for `isGoal` half-states and `isGoalTracker` project acceptance, and mapper round-trip cases in `src/lib/data/SupabaseDataAccess.test.ts`.
2. Staging upgrade test: a schemaVersion 10 record containing goals with `projectId: "p1"` and `projectId: null` loads, maps to `project` and `inherit` respectively, and is re-serialized as schemaVersion 11 with no rows dropped (`src/lib/data/staging/LocalStagingStore.test.ts`, `src/lib/data/staging/types.ts` upgrade chain).
3. `pnpm test:integration` — reset the local stack and load `seed.sql`; confirm both tables accept the seeded rows and the check constraint rejects an inconsistent row.
4. Push a goal with each of the three modes plus a tracker project through `apply_staged_sync`, then pull and confirm the values round-trip (no silent drop).
5. `pnpm run build`.

## Issue Context

### New Files

`supabase/migrations/<timestamp>_goal_project_links.sql` — adds both columns and the check constraint, and redefines the staged-sync RPC. Suggested DDL for the invariant:

```sql
alter table public.goal_trackers add column project_id text;
alter table public.goals
    add column project_link_mode text not null default 'inherit',
    add constraint goals_project_link_mode_check
        check ((project_link_mode = 'project' and project_id is not null)
            or (project_link_mode in ('inherit', 'none') and project_id is null)),
    add constraint goals_project_link_mode_allowed
        check (project_link_mode in ('inherit', 'none', 'project'));
do $$ begin
    if exists (select 1 from public.goals where project_id is not null and project_link_mode = 'inherit') then
        update public.goals set project_link_mode = 'project' where project_id is not null;
    end if;
end $$;
```

Order the backfill before adding the constraint; existing rows with a project id must become `'project'`, not `'inherit'`.

### Remove Files

None.

### Change Files

#### Tracker and goal model

Code Source: `src/state/types.ts`
Code Description: `GoalTracker` (lines 334-346) and `Goal` (lines 358-371) currently hold `projectId: string | null` on the goal only.
Code Change Description: Add `projectId: string | null` to the tracker; replace the goal field with the union.
Files Using: `src/lib/goals/factories.ts`, `src/lib/data/SupabaseDataAccess.ts`, `src/lib/data/staging/types.ts`, `src/state/GoalContext.tsx`, `src/components/GoalsPage.tsx`, `src/lib/goals/evidence.ts`, `src/lib/goals/deck/plan.ts`, `src/components/goals/GoalEvidencePanel.tsx`, `src/components/goals/CheckInWizard.tsx`, `src/lib/goals/goalSetFile.ts`

```ts
export interface GoalTracker {
    id: string;
    name: string;
    // ...
    projectId: string | null;
}

export type GoalProjectLink =
    | { mode: "inherit" }
    | { mode: "none" }
    | { mode: "project"; projectId: string };
```

#### Validators and factories

Code Source: `src/lib/goals/factories.ts`
Code Description: `isGoal` (line 28) currently accepts `v.projectId === null || nonempty(v.projectId)`; `createGoal` defaults `projectId: null` (line 48).
Code Change Description: Validate the union strictly (branch keys exactly, id non-empty and the only extra key in `project` mode); default creation to `{ mode: "inherit" }`; accept `projectId` on tracker creation.

```ts
export function isGoal(v: unknown): v is Goal {
    return object(v) && base(v) && nonempty(v.trackerId) && nonempty(v.title) && text(v.notes) &&
        (isGoalProjectLink(v.projectLink)) /* ... */;
}
```

#### Remote mapping

Code Source: `src/lib/data/SupabaseDataAccess.ts`
Code Description: `goalTrackerRow` (139), `goalRow` (142), `validateGoalTracker` (388), `validateGoal` (393).
Code Change Description: Add `project_id` to the tracker row/mapper and `project_link_mode` + `project_id` to the goal row/mapper. Split the union into the two columns on write and rebuild it on read.

#### Staged sync RPC

Code Source: `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql`
Code Description: Explicit column lists for both tables.
Code Change Description: Redefine in the new migration with `project_id` in the tracker list, and `project_link_mode, project_id` in the goal list, in both the insert and the `do update set` clauses. Re-state the `revoke`/`grant` statements for both the private and public functions exactly as they stand.

#### Local staging upgrade

Code Source: `src/lib/data/staging/types.ts`
Code Description: Upgrade chain ends at `schemaVersion: 10` (line 852); goal rows are validated through `isGoal` in `REQUIRED_FIELD_CHECKS` (line 606) and the v2 record check (line 549).
Code Change Description: Add a v10→v11 step that derives `projectLink` from the legacy `projectId` on goals in `state`, `lastSynced`, `goalTrackers`, and the journal/baseline goal maps; bump `STAGING_SCHEMA_VERSION` to 11 and accept 10 as upgradable.

#### Seed data

Code Source: `supabase/seed.sql`
Code Description: `insert into public.goal_trackers (...)` (line 477) and `insert into public.goals (... project_id ...)` (line 514).
Code Change Description: Add `project_id` to the tracker insert and `project_link_mode` to the goal insert; keep seeded rows consistent with the constraint.

## Notes

- Provisional issue number; GitHub assigns the final number on creation.
- Epic order: this issue → goal project resolution contract → tracker write path and chip → goal row and tri-state control → deck project context → goal set v2.
- `supabase/.temp/` artefacts and the linked local stack are not part of the change.
