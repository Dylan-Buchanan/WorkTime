# Overview

> **Issue:** 74
> **Classification Type:** T3
> **Severity:** Medium

## Goal

Add secure, owner-scoped Shortcut integration settings and an authenticated Edge Function that returns the signed-in owner's selected-team stories with workflow-state names.

## Approach

Create a dedicated singleton table. Store the API token as plaintext protected by RLS, service-role access, and column-level grants that allow an authenticated owner to write but never select the token through the Data API. Add a JWT-verifying Edge Function that independently validates the bearer token, derives the owner ID, reads the settings with the service role, calls Shortcut v3, maps a slim payload, and records `last_synced_at` only after success.

Use `GET /api/v3/member` for the authenticated Shortcut mention name, `GET /api/v3/workflows` for state names, and `GET /api/v3/search/stories` with `team:"<name>" owner:<mention_name>`, full search detail (needed for descriptions), and the returned `next` path. Map that response down to the slim WorkTime contract. Cap traversal at four 250-result pages (Shortcut's documented 1,000-result limit), validate pagination URLs, and preserve distinct 401/429 responses.

## Key Files

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260812000000_shortcut_settings.sql` | Singleton schema, safe save RPC, column grants, RLS quartet, timestamp trigger |
| `supabase/functions/shortcut-sync/shortcutApi.ts` | Shortcut request, pagination, mapping, and typed errors |
| `supabase/functions/shortcut-sync/index.ts` | CORS, JWT authentication, settings read, response, last-sync update |
| `supabase/config.toml` | Enable JWT verification for `shortcut-sync` |
| `package.json` | Serve both functions with their per-function JWT settings |
| `integration/shortcutSettings.integration.test.ts` | RLS, token non-readability, and owner isolation |
| `integration/shortcutApi.integration.test.ts` | Mocked Shortcut pagination, mapping, and error behavior |

## Dependencies / Prerequisites

- Local integration validation requires Docker Desktop and the local Supabase stack.
- Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- The issue-75 consumer should use the response payload documented by the function types.

## Risks / Open Questions

- Plaintext-with-RLS is the selected storage model because Vault is not configured. The token remains server-readable, while authenticated Data API callers receive no SELECT privilege on its column.
- Team selection is stored by team name because Shortcut's documented `team:` search operator accepts a Team name; owner filtering uses the current member's mention name.
- No real Shortcut credential is committed or required in tests; external behavior is covered with injected HTTP mocks.
