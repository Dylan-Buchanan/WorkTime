# Task: Add sync timestamps, backfill policy, and log uniqueness

## Classification

Type: T2: contained data-model migration
Reasoning: This is one forward migration with explicit backfill decisions, but it affects five persisted tables and hosted data. Blast Radius=2, Uncertainty=1, Behavior=4, Testing=2, Reversibility=2. Total=11.

## Goal

Give all mutable rows the timestamp basis required for deterministic merging, and establish the explicit per-owner log conflict target without changing existing table ownership or RLS policies.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `supabase/migrations/20260802000000_sync_metadata.sql` | create |
| `scripts/verify-local-first-migration.mjs` | create |
| `package.json` | update |

## Step-by-Step Instructions

### 1. Add and backfill `updated_at`

**File:** `supabase/migrations/20260802000000_sync_metadata.sql`

Use a staged nullable -> backfill -> default/not-null sequence so hosted rows migrate safely:

```sql
alter table public.tasks add column updated_at timestamptz;
update public.tasks set updated_at = created_at where updated_at is null;
alter table public.tasks alter column updated_at set default now();
alter table public.tasks alter column updated_at set not null;
```

Repeat for `settings`, `timer_state`, and `pm_state`, except backfill each JSONB table with a single migration timestamp captured once (for example `v_backfill_at := now()` in a `do` block). All rows updated by this migration must receive the same JSONB-row baseline time.

### 2. Preserve deliberate client timestamps while covering ordinary updates

**File:** `supabase/migrations/20260802000000_sync_metadata.sql`

Create one trigger function and attach it to the four timestamped tables. On UPDATE, assign `now()` only when `NEW.updated_at` is unchanged from `OLD.updated_at`; preserve a deliberately supplied different timestamp from the staged-sync RPC. INSERTs rely on the non-null `default now()` when no timestamp is supplied.

```sql
if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
end if;
```

This supports both legacy/direct writes and client-authored LWW timestamps. Do not use a trigger that always overwrites a staged timestamp.

### 3. Add the required log conflict target

**File:** `supabase/migrations/20260802000000_sync_metadata.sql`

Add a named `unique (owner_id, id)` constraint to `pomodoro_logs`. The existing global primary key remains; the new constraint exists because staged upserts must explicitly use the per-owner conflict target required by the sync contract.

### 4. Document schema intent in SQL comments

**File:** `supabase/migrations/20260802000000_sync_metadata.sql`

Add comments explaining the task-vs-JSONB backfill policy, deliberate client timestamp preservation, and the per-owner idempotency key. Do not modify the historical foundation migration.

### 5. Add a local-only historical migration replay script

**File:** `scripts/verify-local-first-migration.mjs`

Create a Node script that proves the backfill policy against a partial local schema. The script must:

- Hard-code `--local` for every `supabase` CLI invocation and refuse to run when the configured Supabase URL is not a loopback (`127.0.0.1` or `localhost`); abort with a clear error otherwise. Never run against a hosted project.
- In a `try` block: reset the local DB through `20260801020000` (i.e. `supabase db reset --local` to a point before this migration), create a throwaway local user and seed pre-migration rows (tasks with distinct `created_at` values, JSONB singleton rows), then run `supabase migration up --local` (or `db push --local`) to apply `20260802000000_sync_metadata.sql`.
- Assert via the authenticated client (or a service-role query restricted to the local throwaway owner) that `tasks.updated_at = tasks.created_at` exactly, that all JSONB rows share a single migration-window timestamp (within a small tolerance), that the trigger advances `updated_at` on an ordinary UPDATE that omits the column, and that a deliberately-supplied newer `updated_at` is preserved.
- In the `finally` block: perform a full `supabase db reset --local` to restore the latest local schema so subsequent integration/E2E suites start clean.

Use only `node:` built-ins and the existing `tests/supabase/localSupabase.ts` user-creation helper pattern (shell out to `npx supabase` and `npx supabase status -o env` for the anon key). Do not add new npm dependencies.

### 6. Wire the replay script into the integration gate

**File:** `package.json`

Update the `test:integration` script so it runs the migration replay script before the Vitest integration suites. Keep the existing `vitest run --config vitest.integration.config.ts` invocation; prepend the replay script so a backfill failure fails the gate before integration suites run. Example:

```json
"test:integration": "node scripts/verify-local-first-migration.mjs && vitest run --config vitest.integration.config.ts"
```

Do not change `test:all` ordering beyond what this single script update implies.

## Edge Cases to Handle

- Empty tables must migrate without special cases.
- Existing task timestamps must exactly equal `created_at`, including timezone precision.
- All pre-existing JSONB rows must share the captured migration timestamp rather than separate statement times.
- An ordinary UPDATE that omits `updated_at` must advance it; an RPC update that supplies a newer `updated_at` must preserve the supplied value.
- Do not alter `timer_state.completed`, grants, RLS, or table ownership.
- The replay script must restore the latest local schema even if an assertion fails mid-run; a non-loopback Supabase URL must abort before any reset/push.
- The replay script must not depend on `docs/brainstorming/Data-Architecture.md` or any file outside `supabase/`, `scripts/`, and `tests/supabase/`.

## Related Files (read-only context)

- `supabase/migrations/20260801000000_foundation.sql` - table definitions, grants, and RLS
- `supabase/migrations/20260801010000_timer_completion_guard.sql` - `timer_state.completed`
- `supabase/README.md` - local reset and hosted push workflow

