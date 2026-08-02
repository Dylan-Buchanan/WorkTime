# Task: Make RPC writes idempotent and add the transactional staged push

## Classification

Type: T2: security-sensitive server write contract
Reasoning: The work is confined to one forward migration and follows the established owner-derived `security definer` pattern, but it adds transactional delete/upsert behavior and concurrency predicates. Blast Radius=2, Uncertainty=1, Behavior=5, Testing=2, Reversibility=1. Total=11.

## Goal

Keep the public signatures of `persist_transition` and `complete_timer` intact while accepting client log IDs and timestamps, then add one owner-scoped transactional RPC for non-completion staged upserts, tombstones, and full wipes.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `supabase/migrations/20260802010000_staged_sync_rpc.sql` | create |

## Step-by-Step Instructions

### 1. Replace existing functions without changing signatures

**File:** `supabase/migrations/20260802010000_staged_sync_rpc.sql`

Use `create or replace function` with the exact existing parameter lists:

```sql
public.persist_transition(jsonb, jsonb, jsonb, jsonb, boolean)
public.complete_timer(jsonb, jsonb, jsonb, jsonb)
```

For task inserts/upserts, read optional `updated_at` from the JSON task and fall back to `now()` for legacy callers. For log inserts, require `id`, include it in the INSERT list, and use `on conflict (owner_id, id) do nothing`. Keep `complete_timer`'s `completed = false` plus exact expected-timer predicate and single-row guard unchanged. Its timer-state UPDATE must advance `updated_at` through the migration trigger.

### 2. Add a single transactional batch RPC

**File:** `supabase/migrations/20260802010000_staged_sync_rpc.sql`

Create this contract (parameter names may be kept exactly as shown so the TypeScript transport is unambiguous):

```sql
public.apply_staged_sync(
    p_task_upserts jsonb,
    p_task_tombstones jsonb,
    p_log_upserts jsonb,
    p_log_tombstones jsonb,
    p_settings_data jsonb,
    p_settings_updated_at timestamptz,
    p_timer_data jsonb,
    p_timer_updated_at timestamptz,
    p_timer_new_generation boolean,
    p_pm_data jsonb,
    p_pm_updated_at timestamptz,
    p_full_wipe boolean
) returns void
```

Derive `v_owner := auth.uid()` and reject null owners. Never accept an owner ID from the payload.

### 3. Apply wipe, tombstone, and upsert semantics in one transaction

**File:** `supabase/migrations/20260802010000_staged_sync_rpc.sql`

When `p_full_wipe` is true, delete the owner's tasks, logs, settings, and timer state first, but never delete `pm_state`. Require non-null default settings/timer payloads for a wipe, then reinsert those defaults and force `timer_state.completed = false` in the same function call.

For ordinary task tombstones, delete only when the current row's `updated_at <= tombstone.deleted_at`; a newer remote update survives and will be adopted on the next pull. Log tombstones delete by `(owner_id, id)` because logs are immutable. Upsert tasks and singleton rows only when `excluded.updated_at >= current.updated_at`, making server-side retries and pull/push races LWW-safe. Use `(owner_id, id)` for log conflict handling.

For timer upserts, retain the existing completion flag unless `p_timer_new_generation` is true; new generations reset it to false. Completion-derived changes are intentionally excluded from this RPC and continue through `complete_timer`.

### 4. Preserve grants and document the new boundary

**File:** `supabase/migrations/20260802010000_staged_sync_rpc.sql`

Re-grant the two replaced function signatures exactly as before. Grant `apply_staged_sync` to `authenticated` (and only any additional role already required by the repository's migration conventions). Add comments stating that it is the atomic push boundary for staged non-completion changes and that `pm_state` is excluded from full wipe.

## Edge Cases to Handle

- Null/empty arrays are no-ops; an empty batch must not create rows accidentally.
- Replaying the same log upsert or tombstone must succeed without duplicates/errors.
- A full-wipe retry must remain safe and must always leave default settings/timer rows with `completed=false`.
- A full wipe plus an unrelated staged PM edit may upsert PM, but the wipe itself must never delete PM.
- Older task/singleton timestamps must not overwrite a row changed after the pull.
- Existing callers that omit task `updated_at` must remain functional.

## Related Files (read-only context)

- `supabase/migrations/20260801020000_transactional_writes.sql` - current function bodies and grants
- `supabase/migrations/20260802000000_sync_metadata.sql` - timestamp/trigger and constraint prerequisites
- `integration/SupabaseDataAccess.integration.test.ts` - transaction rollback expectations
- `integration/timerCompletionGuard.integration.test.ts` - CAS behavior that must remain intact
