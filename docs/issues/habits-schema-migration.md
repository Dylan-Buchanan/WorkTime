## Title: Habit Tracker: Supabase schema migration for habits + habit_completions

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Additive single-file SQL migration following well-established conventions (foundation RLS/grant pattern, `touch_updated_at` trigger, per-owner idempotency unique constraints). Genuine schema unknowns remain (owner gating on habit_completions, exact column set, position uniqueness), so research is required before implementation.
Needs research before implementation: Yes — confirm how `habit_completions` RLS derives the owner (direct `owner_id` column vs. a join through `habits`), the exact `habits` column set implied by the spec, whether `(owner_id, position)` is unique, and whether integration assertions land here or are deferred to the E2E/integration issue.

## Summary

Add a Supabase migration creating the `habits` and `habit_completions` tables with owner-scoped RLS, LWW `updated_at` handling, idempotency keys, and indexes, following the conventions already established in `supabase/migrations/`.

## Steps to Reproduce Context

1. Apply the new migration against local Supabase (`npm run supabase:reset` / `supabase db reset`).
2. Insert and upsert habit and completion rows as an authenticated owner.
3. Verify RLS blocks cross-owner access, the LWW trigger preserves client-authored `updated_at`, and the idempotency keys make replays no-ops.

## Expected Behavior

`habits` and `habit_completions` exist with owner-scoped RLS gating on `auth.uid()`, a `unique(habit_id, bucket)` completion idempotency key, `unique(owner_id, id)` keys, `(owner_id, position)` and `(owner_id, habit_id, bucket)` indexes, and grants matching the existing tables.

## Actual Behavior

The tables do not exist.

## Requirements for completed issue

1. The migration creates both tables with the locked-in idempotency keys (`unique(habit_id, bucket)`, `unique(owner_id, id)`) and indexes (`(owner_id, position)`, `(owner_id, habit_id, bucket)`).
2. RLS policies gate on `owner_id = auth.uid()` consistently with `foundation.sql`; grants mirror the existing tables (authenticated/service_role).
3. `updated_at` and the `touch_updated_at` trigger follow `sync_metadata.sql` so client-authored LWW timestamps are preserved.
4. The migration is verified against the local Supabase stack.

## Context

- Files: `supabase/migrations/20260801000000_foundation.sql` (table/RLS/grant pattern), `supabase/migrations/20260802000000_sync_metadata.sql` (`updated_at` + trigger + per-owner unique pattern), `supabase/migrations/20260802010000_staged_sync_rpc.sql`, `docs/brainstorming/Habit-Tracker.md` (locked decisions: row-level habits + habit_completions, bucket keys, idempotent check, tombstone uncheck).
- Code Snippets:

```sql
-- supabase/migrations/20260802000000_sync_metadata.sql — LWW trigger to mirror
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
    if new.updated_at is not distinct from old.updated_at then
        new.updated_at := now();
    end if;
    return new;
end;
$$;
```

```sql
-- supabase/migrations/20260802000000_sync_metadata.sql — per-owner idempotency key pattern
alter table public.pomodoro_logs
    add constraint pomodoro_logs_owner_id_unique unique (owner_id, id);
```

## Notes

None.
