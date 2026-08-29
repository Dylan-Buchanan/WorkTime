## Title: GitHub schema + RLS + RPCs (github_settings, github_repos)

## Tags

Complexity Classification: T3
Severity: Medium
Reason: New data model plus security-definer RPCs and column-level grants. Token-privilege mistakes can leak the GitHub token, so behavior/security weighting raises this above a routine migration. Mirrors the existing `shortcut_settings` pattern and `integration/rpcPrivileges.integration.test.ts`.
Needs research before implementation: No — the `shortcut_settings` migrations provide the exact template.

## Summary

Add the GitHub integration's data model: `github_settings` (per-owner token and connected username; token never selectable by browsers) and `github_repos` (per-repo selection, project assignment, one-label filter, include-closed toggle, staleness flag), with owner-scoped RLS, column-level privileges, and security-definer RPCs mirroring the Shortcut settings migrations.

## Steps to Reproduce Context

1. `supabase/migrations/` contains the Shortcut data model (`20260812000000_shortcut_settings.sql`, `20260812010000_shortcut_preferences_rpc.sql`) but no GitHub tables.
2. The Edge Functions planned in issues 87–89 have nowhere to store or read the token, connected username, or repo rows.
3. `integration/rpcPrivileges.integration.test.ts` covers Shortcut RPC privilege boundaries but nothing for GitHub.

## Expected Behavior

- `github_settings`: `owner_id` (PK, references `auth.users(id)` on delete cascade), `token` (non-empty text), `github_username`, `last_synced_at` (server-authored), `updated_at` (touch trigger). Column grants follow the Shortcut pattern: authenticated clients may insert/update/delete but can only select non-secret columns; the token is readable only by the service role used by Edge Functions.
- `github_repos`: `owner_id`, `full_name` (`owner/repo`), `selected` (auto-true on connect), `project_id` (nullable; per-repo, multiple repos may share one project), `label_filter` (single label, nullable — no join table), `include_closed` (bool), `is_stale` (bool), `updated_at`. RLS restricts all operations to the owning user's rows.
- Security-definer RPCs (owner derived from `auth.uid()`, never accepted as a parameter) cover settings upsert/preference updates and repo-row mutation, raising distinct exceptions (e.g. `AUTH_OWNER_REQUIRED`, `GITHUB_NOT_CONFIGURED`) on boundary violations.
- Integration tests in `integration/` mirror `rpcPrivileges.integration.test.ts`: anonymous calls to the new RPCs are denied with `42501 permission denied for function`.

## Actual Behavior

No GitHub tables, policies, grants, or RPCs exist; the planned Edge Functions and frontend data access have no persistence layer.

## Requirements for completed issue

1. A new migration creating `github_settings` and `github_repos` with the columns, constraints, triggers, RLS policies, and column-level grants described above; the token column is not selectable by `authenticated`.
2. Security-definer RPCs for settings/repo mutation with owner derived from `auth.uid()` and explicit exception codes; `execute` revoked from `public`/`anon` and granted to `authenticated`/`service_role`.
3. Integration tests mirroring `integration/rpcPrivileges.integration.test.ts` proving anonymous RPC calls are denied and the token column is not readable by authenticated clients.
4. `pnpm test:integration` passes against the local stack with the new migration applied.

## Context

- Files:
  - `supabase/migrations/20260812000000_shortcut_settings.sql` — the exact pattern to mirror: column grants (`grant select (owner_id, team_name, ...)` excluding the token), RLS owner policies, `touch_updated_at` trigger, and a narrow security-definer upsert RPC so PostgREST upserts never require table-level SELECT on the secret column.
  - `supabase/migrations/20260812010000_shortcut_preferences_rpc.sql` — non-secret preference updates without resubmitting the token; raises `SHORTCUT_NOT_CONFIGURED` when no row exists.
  - `integration/rpcPrivileges.integration.test.ts` — anonymous-denial test harness using `expectPermissionDenied` (expects `code: "42501"`).
- Code Snippets:

```sql
-- 20260812000000_shortcut_settings.sql (pattern to mirror)
revoke all on table public.shortcut_settings from anon, authenticated;
grant all on table public.shortcut_settings to service_role;
grant select (owner_id, team_name, excluded_statuses, last_synced_at, updated_at)
    on table public.shortcut_settings to authenticated;
```

```ts
// integration/rpcPrivileges.integration.test.ts
it("denies anonymous Shortcut credential writes", async () => {
    const client = anonymousClient();
    await expectPermissionDenied(client.rpc("save_shortcut_settings", { /* ... */ }));
});
```

## Notes

- Follow the repo migration naming convention (`YYYYMMDDHHMMSS_name.sql`).
- Keep `last_synced_at` server-authored (written by the sync function only after a successful fetch), read-only to authenticated clients, as `shortcut_settings` does.
- `github_repos` needs a uniqueness rule per `(owner_id, full_name)` to support idempotent upserts from the enumeration endpoint (issue 88).
