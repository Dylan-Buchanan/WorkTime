## Title: GitHub OAuth App wiring + token-exchange Edge Function

## Tags

Complexity Classification: T3
Severity: Medium
Reason: New Edge Function handling the OAuth authorize redirect, callback, and code-for-token exchange, storing a server-only client secret and a user token in `github_settings`. Auth/security-sensitive behavior across browser origins and the function boundary.
Needs research before implementation: No — GitHub's OAuth App token semantics are documented and known (classic OAuth App user access tokens do not expire); the only open item is recording the no-refresh decision explicitly.

## Summary

Wire a custom GitHub OAuth App end-to-end: the frontend starts the authorize redirect, GitHub calls back with a `code`, and a new Edge Function exchanges the code for a user access token using a server-side client secret, then stores the token and connected username into `github_settings`. The client secret never reaches the browser.

## Steps to Reproduce Context

1. The Integrations page lists GitHub (`src/lib/integrations/registry.ts`) but its Connect control is a disabled placeholder; there is no OAuth authorize URL builder and no exchange function.
2. `supabase/functions/` contains only `shortcut-sync` and `invite-signup`; neither handles OAuth code exchange.
3. `github_settings` from issue 86 is the storage target for the exchanged token and connected username.

## Expected Behavior

- A new Edge Function (e.g. `github-oauth-exchange`) accepts the authorization `code` from a browser-authenticated caller, verifies the Supabase JWT (mirroring `shortcut-sync/index.ts` bearer-token handling), and exchanges the code at GitHub's access-token endpoint using a client secret read from Deno env (never shipped to the client).
- On success it upserts `github_settings` (token, connected GitHub username, e.g. from `GET /user`) via the service role and returns the connected username / non-secret settings to the caller.
- Failure modes map to explicit codes (invalid/expired code, GitHub upstream error, GitHub not configured, exchange unavailable) following the `shortcut-sync` error-body shape (`{ error, code }`).
- The OAuth App's callback URL targets the canonical origin (`VITE_PUBLIC_APP_URL`) per issue 93's callback handling; the authorize-URL construction is shared between PWA and Tauri.
- A decision record confirms refresh semantics: classic GitHub OAuth App user tokens do not expire, so no refresh-token storage/rotation is needed (unlike GitHub Apps); if the implementation instead uses a GitHub App, expiry/refresh handling must be added and documented.

## Actual Behavior

No OAuth flow exists; GitHub cannot be connected.

## Requirements for completed issue

1. A `github-oauth-exchange` (or equivalently named) Edge Function that authenticates the caller, exchanges the `code` server-side, and upserts `github_settings` with the token and connected username; the client secret is read only from Deno env and is never returned.
2. Explicit error codes and status mapping mirroring `shortcut-sync/index.ts` (`AUTH_REQUIRED`, `GITHUB_NOT_CONFIGURED`, upstream/invalid-code failures), including CORS handling consistent with existing functions.
3. The frontend can construct the authorize URL (client id, scopes limited to repo access needed, redirect URI from `VITE_PUBLIC_APP_URL`) and complete connect using the exchange function through the data access layer (issue 91 wires it up).
4. A recorded decision on token expiry/refresh (expected: none needed for OAuth Apps).
5. Unit tests for any shared authorize-URL/error-mapping logic; secret stays out of all client bundles and logs.

## Context

- Files:
  - `supabase/functions/shortcut-sync/index.ts` — JWT verification via `supabase.auth.getUser(accessToken)`, service-role client creation, CORS headers, and `{ error, code }` error bodies to mirror.
  - `supabase/migrations/20260812000000_shortcut_settings.sql` — the settings-upsert RPC pattern the function should write through.
  - `src/lib/supabase.ts` / `src/vite-env.d.ts` — the only browser-configurable values are `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_APP_URL`.
  - `docs/issues/issue-93.md` — callback round-trip handling on both origins.
- Code Snippets:

```ts
// supabase/functions/shortcut-sync/index.ts (patterns to mirror)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// ...
const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
if (userError || !userData.user) return jsonResponse({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
```

## Notes

- Keep the client secret and any signing material server-only per repo AGENTS.md; nothing beyond the three public Vite variables may be used in browser configuration.
- Scopes should be the minimum that supports `GET /user/repos` and repo issue reads (e.g. `repo` / fine-grained equivalent); document the chosen scope set.
- This issue depends on issue 86 (`github_settings` exists) and is a prerequisite for issues 88–89 and the connect button in issue 92.
