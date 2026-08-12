# Task: Add owner-scoped Shortcut settings storage

## Classification

Type: T2: moderate data-model change following an established pattern
Reasoning: One migration adds a singleton table, constrained columns, grants, RLS policies, and a known timestamp trigger. Blast Radius=1, Uncertainty=1, Behavior=4, Testing=2, Reversibility=2. Total=10.

## Goal

Persist each owner's Shortcut token and sync configuration while preventing the token from being selected through the authenticated browser Data API.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `supabase/migrations/20260812000000_shortcut_settings.sql` | create |

## Step-by-Step Instructions

### 1. Create the singleton table

**File:** `supabase/migrations/20260812000000_shortcut_settings.sql`

Create `public.shortcut_settings` with `owner_id uuid primary key default auth.uid()` referencing `auth.users`, a non-empty `shortcut_token`, non-empty `team_name`, `excluded_statuses text[]`, nullable `last_synced_at`, and `updated_at default now()`. Attach `public.touch_updated_at()`. Add `save_shortcut_settings(text, text, text[])`, a security-definer RPC that derives `auth.uid()` and performs the singleton upsert without returning the token; PostgREST upserts otherwise require table-level SELECT.

### 2. Apply least-privilege grants and owner RLS

**File:** `supabase/migrations/20260812000000_shortcut_settings.sql`

Revoke all from `anon` and `authenticated`; grant the service role full access. Give authenticated callers SELECT only on non-secret columns, INSERT/UPDATE only on intended writable columns, and table DELETE. Add the canonical select/insert/update/delete policies using `owner_id = auth.uid()`.

## Edge Cases to Handle

- Empty or whitespace-only tokens/team names must fail constraints.
- An owner may have only one row.
- A browser query naming `shortcut_token` must fail rather than return it.
- Cross-owner reads, inserts, updates, and deletes must remain blocked.

## Related Files (read-only context)

- `supabase/migrations/20260801000000_foundation.sql`
- `supabase/migrations/20260802000000_sync_metadata.sql`
