# Task: Add Shortcut preferences and typed data access

## Classification

Type: T2: moderate data-access change
Reasoning: Adds one narrow database RPC plus a typed browser adapter and focused tests. Blast Radius=2, Uncertainty=1, Behavior=4, Testing=1, Reversibility=1. Total=9.

## Goal

Expose owner-scoped load/connect/update/disconnect/sync operations without ever reading or retaining a stored Shortcut token in the browser.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `supabase/migrations/20260812010000_shortcut_preferences_rpc.sql` | create |
| `supabase/README.md` | update |
| `src/lib/data/ShortcutDataAccess.ts` | create |
| `src/lib/data/ShortcutDataAccess.test.ts` | create |
| `integration/shortcutSettings.integration.test.ts` | update |

## Step-by-Step Instructions

### 1. Add a secret-free preference RPC

**File:** `supabase/migrations/20260812010000_shortcut_preferences_rpc.sql`

Create `update_shortcut_preferences(p_team_name text, p_excluded_statuses text[])`, security-definer with a fixed search path. Derive the owner from `auth.uid()`, update only that owner's existing row, and fail when unauthenticated or not configured. Grant execution only to authenticated and service-role callers.

### 2. Add the typed Supabase adapter

**File:** `src/lib/data/ShortcutDataAccess.ts`

Define public non-secret settings, sync success, stable error-code, and adapter interfaces. Implement load through a named non-secret column selection, connect through `save_shortcut_settings`, preference updates through the new RPC, owner-scoped deletion, and Edge Function invocation. Normalize thrown errors into a `ShortcutIntegrationError` while preserving structured function codes and retry delay.

### 3. Document and integration-test the preference boundary

**Files:** `supabase/README.md`, `integration/shortcutSettings.integration.test.ts`

Document the separate connect/reconnect and public-preference RPCs. Extend the local Supabase test to prove an owner can change team/exclusions without changing the stored token, another owner cannot alter that row, and an absent configuration is rejected.

## Edge Cases to Handle

- Empty token, team, or status entries are rejected before transport.
- Function errors may expose a JSON `Response` context or only a generic network error.
- The adapter never selects `shortcut_token`.
- Disconnect targets the authenticated owner ID in addition to relying on RLS.
- Preference updates fail for an absent row and cannot create or take over another owner's configuration.

## Related Files (read-only context)

- `supabase/migrations/20260812000000_shortcut_settings.sql`
- `supabase/functions/shortcut-sync/index.ts`
- `src/lib/data/SupabaseDataAccess.ts`
