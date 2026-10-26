# Title: Backend — linear_settings schema and linear-sync Edge Function

## Tags

Complexity Classification: T4
Classification Reason: New owner-scoped credential table plus a new authenticated Edge Function. Additive, but security-critical at four layers: Postgres grants/RLS, the private-definer/public-invoker RPC boundary, Deno function auth and owner derivation, and the sync response contract. It also establishes the response shape that the frontend issue consumes.

Severity: High
Severity Reason: A mistake here can expose a third-party API token to the browser or let one owner's sync read another owner's credentials, which is essentially unrecoverable. Not Critical because everything is new and additive — no existing table, RPC, or user data is modified.

Needs research before implementation: Yes

### Research Needed

Linear's GraphQL semantics are unverified in this repository and do not map cleanly onto the Shortcut implementation being mirrored. The findings from the spike issue (`docs/research/linear-spike-findings.md`) supply the verbatim query string and state names; this issue should not begin until that document exists.

- Confirm the verbatim query and the exact header form from the spike document, and how aliases are used to discover workflow state names in the same run.
- Confirm how Relay cursor pagination (`pageInfo.hasNextPage` / `endCursor`) is rejected when a cursor revisits a page, since `nextSearchUrl` in `supabase/functions/shortcut-sync/shortcutApi.ts` guards full URLs rather than opaque cursors.
- Confirm the error surface: HTTP 200 with a populated `errors` array, and whether rate limiting arrives as `429` with `extensions.code: "RATELIMITED"` plus `Retry-After`.
- Read `supabase/migrations/20260812050000_use_invoker_rpc_boundaries.sql` and `20260812040000_restrict_security_definer_rpc_execution.sql` to reproduce the private/public RPC split exactly.
- Read `supabase/migrations/20260812060000_optimize_owner_rls_initplans.sql` before writing new policies.

## Summary

Add the Linear backend that mirrors the Shortcut backend at `supabase/migrations/20260812000000_shortcut_settings.sql` and `supabase/functions/shortcut-sync/`, with Linear's differences.

Two guarantees must hold exactly as they already do for Shortcut: the Linear API token is never readable by the browser, and sync is owner-scoped. Reusing that proven boundary is preferable to designing a new one. The function also owns pagination and truncation policy, which the frontend cannot enforce safely, and it returns the discovered state names, which is what makes a name-based status filter usable at all.

Parent request: #122. Blocked by the spike issue (#124).

## Steps to Reproduce Context

1. Open the Integrations page — there is no Linear integration, so there is nothing to configure.
2. Inspect `public.shortcut_settings` — an owner-scoped credential table exists for Shortcut, with no Linear equivalent.
3. Inspect `supabase/functions/shortcut-sync/index.ts` — it loads a per-owner token via the service-role client and returns `{ stories, synced_at }`; no equivalent exists for Linear.
4. Look for a way to discover a workspace's status names — there is none, so a name-based status filter cannot be configured today.

## Expected Behavior

- `public.linear_settings` stores one Linear connection per owner, with `linear_token` readable only by the service role and the Edge Function.
- A nullable `team_key` scopes sync to one team when set; null means all teams, and comparison is case-insensitive.
- `included_statuses` defaults to an empty array, so nothing imports until the user configures the names discovered during a sync.
- `linear-sync` requires a valid JWT, derives the owner from it, rejects cursors that leave the expected endpoint or revisit a page, paginates with a hard page cap, and returns `{ issues, states, synced_at, truncated }`.
- Failures return stable, distinguishable error codes with `retry_after_seconds` carried through on rate limits.
- `last_synced_at` is updated only after a successful sync.

## Actual Behavior

- No Linear settings table, RPCs, or Edge Function exist.
- There is no server-side place to hold a Linear token out of the browser's reach.
- There is no pagination or truncation policy for Linear issues.
- There is no way for the frontend to learn the distinct state names in the connected workspace.

## Requirements for completed issue

1. `public.linear_settings` exists with `owner_id`, `linear_token`, nullable `team_key`, `included_statuses` (empty default), `default_project_id`, `last_synced_at`, and `updated_at`.
2. Column grants let authenticated clients select/insert/update everything except `linear_token`; the token is not selectable by authenticated clients and remains readable by the service role.
3. Owner-scoped RLS policies and the `touch_updated_at` trigger are in place, following the existing Shortcut migration.
4. `save_linear_settings` follows the established private-definer plus public-invoker-wrapper pattern so `ON CONFLICT` privileges never reach the browser, and `update_linear_preferences` updates non-secret preferences without reading or replacing the token.
5. `linear-sync` is registered with `verify_jwt = true` in `supabase/config.toml`.
6. The function checks method, verifies the JWT, derives the owner, loads settings, and updates `last_synced_at` only after a successful fetch.
7. A pure `linearApi.ts` takes an injected fetcher, posts GraphQL to `https://api.linear.app/graphql`, inspects the `errors` array before trusting `data`, and paginates with a hard page cap.
8. The response is `{ issues, states, synced_at, truncated }`, where `states` are the distinct state names discovered during the run.
9. An unknown team key returns `LINEAR_TEAM_NOT_FOUND`, kept distinct from a legitimately empty result.
10. Stable error codes `LINEAR_NOT_CONFIGURED`, `LINEAR_TOKEN_INVALID`, `LINEAR_RATE_LIMITED`, `LINEAR_TEAM_NOT_FOUND`, `LINEAR_INVALID_RESPONSE`, and `LINEAR_UPSTREAM_ERROR` are returned with `retry_after_seconds` on rate limits.
11. The `estimate` field is not requested in any query.
12. Integration tests cover settings/RLS and the API client, anonymous-write denial cases are added, and `supabase/README.md` documents the Linear setup.

### Testing

- `pnpm test:integration` — settings/RLS test mirroring `integration/shortcutSettings.integration.test.ts`: owner upsert via the RPC, preference update, visibility of non-secret columns, and denial when selecting `linear_token` as the authenticated owner while the admin/service-role client can read it; plus cross-owner isolation.
- `pnpm test:integration` — API client test mirroring `integration/shortcutApi.integration.test.ts` with a fake injected fetcher: request body/headers, `errors`-array handling on a 200 response, cursor following, page-cap truncation, cross-page dedupe, team-not-found, and rate-limit `retry_after_seconds`.
- `pnpm test:integration` — new anonymous-write denial cases in `integration/rpcPrivileges.integration.test.ts` for both Linear RPCs.
- `pnpm supabase:reset` then verify the function locally through `pnpm supabase:serve` for the not-configured and successful paths.

## Context

### Credential table and column-level grants to mirror

Code Source: `supabase/migrations/20260812000000_shortcut_settings.sql`
Code Description: The token is stored plaintext under RLS and column privileges only. The selective grants are what keep it unreadable by authenticated clients. Files using: `src/lib/data/ShortcutDataAccess.ts`, `supabase/functions/shortcut-sync/index.ts`.

```sql
revoke all on table public.shortcut_settings from anon, authenticated;
grant all on table public.shortcut_settings to service_role;

grant select (owner_id, team_name, excluded_statuses, last_synced_at, updated_at)
    on table public.shortcut_settings to authenticated;
grant insert (owner_id, shortcut_token, team_name, excluded_statuses)
    on table public.shortcut_settings to authenticated;
```

### RPC boundary to reproduce

Code Source: `supabase/migrations/20260812050000_use_invoker_rpc_boundaries.sql`
Code Description: The definer implementation lives in the unexposed `private` schema and the public wrapper is SECURITY INVOKER with an empty `search_path`. This is the pattern `save_linear_settings` must follow. Files using: `supabase/migrations/20260812030000_shortcut_default_project.sql`.

```sql
alter function public.save_shortcut_settings(text, text, text[], text) set schema private;

revoke all on function private.save_shortcut_settings(text, text, text[], text) from public, anon;
grant execute on function private.save_shortcut_settings(text, text, text[], text) to authenticated, service_role;

create function public.save_shortcut_settings(
    p_shortcut_token text,
    p_team_name text,
    p_included_statuses text[] default array['In Discovery', 'Ready for Dev', 'In Dev']::text[],
    p_default_project_id text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.save_shortcut_settings(
        p_shortcut_token, p_team_name, p_included_statuses, p_default_project_id
    )
$$;
```

### Function skeleton and response contract

Code Source: `supabase/functions/shortcut-sync/index.ts`
Code Description: Method/JWT handling, owner derivation, settings load, `last_synced_at` update, and error-to-JSON mapping are directly reusable. The Linear response differs: `{ issues, states, synced_at, truncated }` instead of `{ stories, synced_at }`, and a 409 `LINEAR_NOT_CONFIGURED` instead of `SHORTCUT_NOT_CONFIGURED`.

```ts
const { data: settings, error: settingsError } = await supabase
    .from("shortcut_settings")
    .select("shortcut_token, team_name")
    .eq("owner_id", userData.user.id)
    .maybeSingle();
if (settingsError) return jsonResponse({ error: "Unable to load Shortcut settings", code: "SETTINGS_READ_FAILED" }, 500);
if (!settings || typeof settings.shortcut_token !== "string" || typeof settings.team_name !== "string") {
    return jsonResponse({ error: "Shortcut is not configured", code: "SHORTCUT_NOT_CONFIGURED" }, 409);
}
```

```ts
if (error instanceof ShortcutApiError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (error.retryAfterSeconds !== undefined) body.retry_after_seconds = error.retryAfterSeconds;
    return jsonResponse(body, error.status);
}
```

### Pure API client shape to mirror, with injected fetcher

Code Source: `supabase/functions/shortcut-sync/shortcutApi.ts`
Code Description: The injected `Fetcher` type, the `Retry-After` parser, and the `MAX_PAGES` cap are reusable. `PAGE_SIZE = 250` and `MAX_PAGES = 4` are Shortcut-specific and must be replaced with the Linear page size confirmed by the spike.

```ts
const PAGE_SIZE = 250;
const MAX_PAGES = 4;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
```

```ts
export class ShortcutApiError extends Error {
    readonly status: number;
    readonly code: ShortcutErrorCode;
    readonly retryAfterSeconds?: number;
}
```

### Config registration

Code Source: `supabase/config.toml`
Code Description: `verify_jwt = true` is required alongside the existing function entries.

```toml
[functions.shortcut-sync]
verify_jwt = true
```

### Documentation to extend

Code Source: `supabase/README.md`
Code Description: The `## Shortcut sync function` section documents the RPCs, the selectable column set, the response contract, the deploy command, and the no-secrets rule. The Linear section should follow the same structure.

## Notes

Edge cases that must be handled:

- Explicit page cap plus a `truncated` flag, rather than Shortcut's silent 1,000-issue ceiling.
- Deduplicate issues that appear across page boundaries.
- Reject a cursor that leaves the expected endpoint or revisits a page already fetched.
- A key pasted with a leading `Bearer ` should be reported clearly rather than sent and rejected with a confusing 401.
- A workspace with no assigned issues must return a successful empty result, not an error.
- `team_key` comparison is case-insensitive; null means all teams.
- `default_project_id` is a plain text identifier with no foreign key, because projects live in `pm_state_v1`.
- No Linear token belongs in an environment file, log, committed source, or `VITE_` variable.
