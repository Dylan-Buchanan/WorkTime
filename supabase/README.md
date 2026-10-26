# Supabase foundation

This directory contains the local Supabase CLI project, schema/RLS migrations, and the invite-signup, Shortcut, Linear, GitHub, and Google Calendar Edge Functions. Docker and the Supabase CLI are required.

## Local setup

From the repository root:

```sh
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` is destructive to the local Supabase data. Never run it against a hosted project. Use the URLs and keys printed by `supabase status` for local clients; do not copy them into source control. Stop the stack with `npx supabase stop`.

`db reset` also replays `supabase/seed.sql`, which creates a fixed local test user (`dbuchananh@gmail.com` / `Test123!`) plus representative timer tasks, project-manager projects/tasks, habits with completion history, and to-dos. It is idempotent: re-runs update the password and upsert the same fixed records rather than duplicating them. Never run this seed against a hosted project.

The local Auth configuration disables direct email/password signup while preserving password sign-in. The hosted Auth dashboard must have the equivalent “Allow new users to sign up” setting disabled; `db push` does not change hosted Auth settings.

The browser and Tauri builds require the public variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and (for production builds) `VITE_PUBLIC_APP_URL`. Set the last value to the canonical Cloudflare Pages origin, without a path or trailing slash. Password-reset emails use its `/reset-password` route, so add that exact URL to the hosted Supabase Auth redirect allow-list. Local development also allows the `http://localhost:3000/reset-password` and `http://127.0.0.1:3000/reset-password` routes above.

## Invite function

Create the ignored `supabase/.env.local` file with a temporary local secret:

```dotenv
SIGNUP_INVITE_CODE=replace-with-a-local-secret
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. Never commit or put either privileged value, or the invite code, in a `VITE_` variable.

Serve all local functions with their per-function JWT settings from `config.toml`:

```sh
pnpm supabase:serve
```

For a hosted project, use secure input for real secrets where possible rather than putting them in shell history:

```sh
npx supabase link --project-ref <project-ref>
npx supabase secrets set SIGNUP_INVITE_CODE=<temporary-secret>
npx supabase db push
npx supabase functions deploy invite-signup --no-verify-jwt
```

The function accepts `POST` JSON with `email`, `password`, and `inviteCode`; it normalizes only the email and returns safe `id`/`email` fields on success. It uses `email_confirm: true`, so the new user can immediately sign in with `signInWithPassword` without an invite code.

Client signup must continue to use this invite function; direct anonymous `auth.signUp` is intentionally disabled. Keep `SIGNUP_INVITE_CODE` and the service-role key only in the ignored Edge Function environment.

Manual Auth cases:

1. Malformed JSON, missing fields, and an invalid invite return `400`/`403` and create no user.
2. A valid invite creates exactly one user and returns `201`; repeating the email returns a safe conflict.
3. Direct anonymous `auth.signUp` is rejected because public signup is disabled.
4. The created user can authenticate with `signInWithPassword` without an invite.
5. `OPTIONS` returns CORS headers without creating a user.

## Shortcut sync function

`public.shortcut_settings` stores one Shortcut connection per owner. Save or replace it through the owner-derived RPC so PostgREST never needs SELECT permission on the token column:

```ts
await supabase.rpc("save_shortcut_settings", {
    p_shortcut_token: token,
    p_team_name: teamName,
    p_included_statuses: includedStatuses,
    p_default_project_id: defaultProjectId,
});
```

After connection, update only the non-secret preferences without retaining or re-entering the token:

```ts
await supabase.rpc("update_shortcut_preferences", {
    p_team_name: teamName,
    p_included_statuses: includedStatuses,
    p_default_project_id: defaultProjectId,
});
```

Authenticated clients may select only `owner_id`, `team_name`, `included_statuses`, `default_project_id`, `last_synced_at`, and `updated_at`. Selecting `shortcut_token` is intentionally denied. The token is plaintext within Postgres under RLS and column privileges; it is readable by the `shortcut-sync` service-role path and database administrators, but is never returned by the save RPC or sync function.

Invoke `shortcut-sync` with `POST` through the authenticated Supabase client. The function independently verifies the bearer JWT, derives the owner, resolves the current Shortcut member and workflow states, explicitly excludes archived stories in its Shortcut search query, follows at most four 250-result search pages, and returns `{ stories, synced_at }`. A successful call updates `last_synced_at`. Stable error codes include `AUTH_REQUIRED`, `SHORTCUT_NOT_CONFIGURED`, `SHORTCUT_TOKEN_INVALID`, `SHORTCUT_RATE_LIMITED`, and `SHORTCUT_UPSTREAM_ERROR`; rate-limit responses may include `retry_after_seconds`.

Deploy the authenticated function without `--no-verify-jwt`:

```sh
npx supabase functions deploy shortcut-sync
```

No Shortcut token belongs in an environment file, log, `VITE_` variable, or committed source.

## Linear sync function

`public.linear_settings` stores one personal API key and connection per owner. Save or replace it through the public invoker RPC over the private, owner-derived definer:

```ts
await supabase.rpc("save_linear_settings", {
    p_linear_token: token,
    p_team_key: teamKey,                  // null or blank means all accessible teams
    p_included_statuses: includedStatuses, // defaults to []
    p_default_project_id: defaultProjectId,
});

await supabase.rpc("update_linear_preferences", {
    p_team_key: teamKey,
    p_included_statuses: includedStatuses,
    p_default_project_id: defaultProjectId,
});
```

The preference RPC never reads or replaces the stored key. Both RPCs derive the owner from `auth.uid()` and reject anonymous execution. Disconnect by deleting the owner's `linear_settings` row. `default_project_id` is a nullable text identifier for a project in `pm_state_v1`, with no relational foreign key. Blank team/project values become null. Team matching uses Linear's `eqIgnoreCase` comparator. `included_statuses` defaults to an empty array so the frontend imports nothing until names are selected; the sync itself returns assigned issues without a status filter so the frontend can explain empty results.

Authenticated clients may select only `owner_id`, `team_key`, `included_statuses`, `default_project_id`, `last_synced_at`, and `updated_at`. The plaintext `linear_token` is writable but never selectable by authenticated clients; the service role and database administrators can read it. Both timestamps are read-only to authenticated clients. Keep `private` out of the exposed Data API schemas. No Linear token belongs in an environment file, log, `VITE_` variable, or committed source.

Invoke `linear-sync` with an authenticated `POST`; it accepts no configuration overrides from the request body. Gateway JWT verification stays enabled, and the handler independently verifies the JWT and scopes both settings reads and timestamp writes to its owner. It sends the raw personal API key as `Authorization: <key>` to the fixed `https://api.linear.app/graphql` endpoint. A pasted `Bearer ` prefix is rejected with a clear `LINEAR_TOKEN_INVALID` message before an upstream request. Redirects are disabled, and cursors are GraphQL variables, never request URLs.

The query is exported as `LINEAR_SYNC_QUERY` in `functions/linear-sync/linearApi.ts`. Its `issues` connection filters `assignee.isMe.eq = true`; the aliased `states: workflowStates` connection discovers workflow names independently of assigned issues, and `matchingTeams: teams` checks a configured team key on the first request. Both paginated connections request 50 records per page, with at most 20 requests per run (up to 1,000 issues and 1,000 workflow states). Completed connections are omitted from later requests. This deliberately small query has no nested paginated connections and does not request `estimate`. See [Linear authentication/error handling](https://linear.app/developers/graphql), [pagination](https://linear.app/developers/pagination), [filtering](https://linear.app/developers/filtering), and the [published schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql). The implementation uses the documented baseline in `docs/research/issue-122-linear-spike.md`; live workspace behavior and measured query complexity remain unverified.

The 50-record page size leaves substantial complexity headroom: using Linear's documented calculation, issue nodes cost roughly `50 × (1 + 7 × 0.1 + 1 + 0.1) = 140` points and workflow-state nodes roughly `50 × (1 + 0.1) = 55`, plus a small amount for connections, page info, and the optional team lookup. This is approximately 200 points per request against the documented 10,000-point ceiling; it is an estimate, not an observed `X-Complexity` value. See [Linear's complexity rules](https://linear.app/developers/rate-limiting#understanding-query-complexity).

A successful response is `{ issues, states, synced_at, truncated }`:

- Each issue has `id`, `identifier`, `title`, `description`, `url`, `dueDate`, `priority`, and `state: { name }`. These retain GraphQL field names; a null description becomes `""`, and `dueDate` remains a nullable string. Priority is Linear's integer scale 0–4. No estimate is returned.
- Issues are deduplicated by `id`, retaining the first occurrence. `states` is a sorted, distinct array of workflow names in the selected team or all accessible teams, including names on fetched issues. It can contain names even when `issues` is empty.
- `truncated` is true if either connection still has another page at the cap, so issues or state hints may be incomplete. Continuing cursors must be nonempty opaque strings and must not repeat or look like external URLs; terminal pages may have a repeated cursor.
- `synced_at` is an ISO timestamp written to `last_synced_at` only after the entire bounded fetch succeeds. Truncated results count as a successful bounded fetch. A failed fetch never stamps the row; a failed timestamp write or a concurrently deleted connection returns an error.

Sync failures use `{ error, code, retry_after_seconds? }`:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `LINEAR_NOT_CONFIGURED` | 409 | No saved connection |
| `LINEAR_TOKEN_INVALID` | 401 | Missing, Bearer-prefixed, invalid, or revoked personal key |
| `LINEAR_RATE_LIMITED` | 429 | HTTP 429 or GraphQL `RATELIMITED`; carries `retry_after_seconds` when `Retry-After` is available |
| `LINEAR_TEAM_NOT_FOUND` | 404 | Team key was not found or is inaccessible; distinct from a known team with no assigned issues |
| `LINEAR_INVALID_RESPONSE` | 502 | Malformed JSON/data or unsafe/repeated continuing cursor |
| `LINEAR_UPSTREAM_ERROR` | 502 | Transport, HTTP, or GraphQL query failure |

Any nonempty GraphQL `errors` array rejects partial data, including with HTTP 200. Upstream error text is never returned. General handler failures use `METHOD_NOT_ALLOWED`, `AUTH_REQUIRED`, `SYNC_UNAVAILABLE`, `SETTINGS_READ_FAILED`, `SYNC_STATE_UPDATE_FAILED`, or `SYNC_FAILED`. The frontend integration in #126 must allowlist the six Linear codes and preserve `issues`, `states`, and `truncated`.

Deploy with JWT verification enabled:

```sh
npx supabase functions deploy linear-sync
```

`pnpm test:integration` resets the local database and covers the settings/grants/RLS, anonymous RPC denials, injected-fetcher API cases, and handler owner/timestamp behavior. API and handler tests use fake keys and require no Linear workspace. For a local function smoke check, run `pnpm supabase:reset`, then `pnpm supabase:serve`, and invoke with a local user's JWT: an unconfigured user gets 409 `LINEAR_NOT_CONFIGURED`; a configured user gets the response above after a successful fetch. A live success check requires a personal key supplied through the RPC without logging or committing it.

## GitHub OAuth App integration

GitHub connection uses a classic GitHub OAuth App. Configure these values only in the ignored `supabase/.env.local` file for local development and as hosted Supabase secrets:

```dotenv
INTEGRATION_GITHUB_OAUTH_CLIENT_ID=...
INTEGRATION_GITHUB_OAUTH_CLIENT_SECRET=...
INTEGRATION_GITHUB_OAUTH_REDIRECT_URI=http://localhost:3000/auth/github/callback
```

Register `INTEGRATION_GITHUB_OAUTH_REDIRECT_URI` as the OAuth App's exact authorization callback URL, with wildcard matching disabled. In production it must be `${VITE_PUBLIC_APP_URL}/auth/github/callback`, using the canonical origin without a trailing slash. The same server-configured URI is sent during authorization and code exchange; no GitHub value belongs in a `VITE_` variable or client bundle. Development and production normally use separate OAuth Apps because their callback origins differ.

The callback uses a canonical-origin bridge for the packaged Windows app. Connect stores a one-time OAuth state in the initiating surface's `sessionStorage`; Tauri-marked responses arriving at a different hosted origin are forwarded, with only GitHub response parameters, to the fixed internal `http://tauri.localhost/index.html` entry asset. React routes that entry path to the callback page after the packaged SPA loads, avoiding a native asset lookup for the client-side `/auth/github/callback` route. The packaged origin then validates and consumes the state before its own Supabase session exchanges the code. During `tauri dev`, the callback and initiating webview share Vite's origin; the matching pending state is detected and the unavailable production asset bridge is skipped. The destination never comes from query input.

This bridge was chosen over the alternatives so the native shell remains slim:

- A custom deep link would work with the system browser, but would add native registration, a deep-link plugin/capability, and lifecycle handling.
- A loopback callback would require a native HTTP listener, dynamic-port coordination, and a different registered callback strategy.
- The canonical bridge reuses the existing same-webview navigation and one public callback without adding a Tauri command, `invoke` data path, plugin, secret, or public environment variable.

Do not change GitHub navigation to the opener/system browser without first implementing a deep-link return path: an ordinary browser cannot resolve Tauri's internal origin. Do not enable Tauri `useHttpsScheme` just for OAuth; the repository's Windows production origin is currently `http://tauri.localhost`, and changing it would also change the app's local storage origin.

The authorization request asks only for the classic OAuth App `repo` scope, which is needed to enumerate and read issues from both public and private repositories. The function independently verifies the WorkTime bearer JWT, exchanges the one-time code with the server-only client secret, fetches `GET /user`, and service-role upserts the token and connected login into `github_settings`. It returns only the login; the token remains non-selectable by authenticated browser clients.

Classic GitHub OAuth App user access tokens do not expire by default, unlike expiring GitHub App user tokens. WorkTime therefore stores no refresh token and performs no refresh rotation; revocation requires reconnecting the integration.

Deploy the authenticated function with gateway JWT verification enabled:

```sh
npx supabase secrets set INTEGRATION_GITHUB_OAUTH_CLIENT_ID=... INTEGRATION_GITHUB_OAUTH_CLIENT_SECRET=... INTEGRATION_GITHUB_OAUTH_REDIRECT_URI=...
npx supabase functions deploy github-oauth-exchange
npx supabase functions deploy github-enumerate-repos
npx supabase functions deploy github-sync
```

`github-enumerate-repos` uses the stored server-only token to list accessible repositories and labels. It seeds new repositories as selected, preserves existing per-repository preferences, and marks repositories missing from later listings as stale rather than deleting them.

Manual desktop round-trip verification:

1. Set the hosted Edge Function secret and OAuth App callback to `${VITE_PUBLIC_APP_URL}/auth/github/callback` exactly, with wildcard matching disabled.
2. Build and install the MSI with all three public Vite variables, then sign in inside WorkTime.
3. Select **Connect GitHub**, approve access, and confirm the webview briefly reaches the hosted callback before returning through `http://tauri.localhost/index.html` and then `/integrations`.
4. Confirm the connected username and repositories load, then repeat while denying access and confirm the callback shows cancellation copy with a route back to Integrations.
5. Start a new attempt and alter/remove the callback state or code (using development tools); confirm the exchange is rejected with safe expired/unverified copy.

Invoke `github-sync` with `POST` through the authenticated Supabase client and a body of `{ "full_name": "owner/repository" }`. The function verifies that the repository row belongs to the caller, reads `include_closed` and `label_filter` from that row (request bodies cannot override them), and fetches at most four 100-entry GitHub issue pages. Pull requests returned by GitHub's issues endpoint are excluded. A successful response is `{ issues, repo, synced_at }` and only then updates `github_settings.last_synced_at`.

GitHub sync errors use `{ error, code }`; rate-limit responses can also include `retry_after_seconds`. `GITHUB_REPO_NOT_FOUND` remains distinct from `GITHUB_TOKEN_INVALID`, and sync failures do not modify the token, repository staleness, project assignment, label filter, or include-closed preference.

## Google Calendar integration

Google Calendar uses a Google OAuth web client and the Calendar API. Configure these server-only function values in ignored `supabase/.env.local` for local development and as hosted Supabase secrets:

```dotenv
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_REDIRECT_URI=http://127.0.0.1:54321/functions/v1/google-calendar-auth
GOOGLE_CALENDAR_ALLOWED_RETURN_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://tauri.localhost
```

The redirect URI must exactly match an authorized redirect URI on the Google OAuth web client. Enable the Google Calendar API and configure the consent screen before testing. Consent screens left in Google Testing mode follow Google's testing-token expiration policy; promotion to Production is a Google Cloud setting, not a WorkTime client setting.

The initial connection requests `calendar.readonly`. The first explicit task push incrementally adds `calendar.app.created`, which is limited to secondary calendars created by WorkTime and their events. OAuth start uses a WorkTime JWT verified inside `google-calendar-auth`; Google's GET callback is why that function alone has gateway JWT verification disabled. PKCE verifier/state rows are one-time, short-lived, and service-role-only.

`public.google_calendar_settings.refresh_token` is not selectable by authenticated clients. The callback writes it through the service-role-only `save_google_calendar_connection` RPC boundary. Clients can read only public connection fields and update selected calendars through `update_google_calendar_preferences`. Task linkages contain only IDs, schedule bounds, and estimate/work-minute snapshots—never event titles—and are authored only by the service-role function.

Busy time is fetched on Start-of-Day generation or manual refresh only. The function calls Google free/busy and a metadata-minimized recurring-instance event query so it can exclude all-day, transparent, cancelled, and `worktime:taskId` events. No background sync is registered.

Deploy the callback without gateway JWT verification and the operation function with verification enabled:

```sh
npx supabase functions deploy google-calendar-auth --no-verify-jwt
npx supabase functions deploy google-calendar
```

Disconnect revokes the token best-effort and removes WorkTime's settings/link metadata. Existing external Google calendars/events remain until the user explicitly removes them in Google or unpushes them before disconnecting.

## Owner-isolation verification matrix

Use two temporary users and their JWTs with the local URL from `supabase status`.

| Case                                                              | Expected result                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Owner A CRUD on each table                                        | Succeeds for A’s rows                                            |
| Owner B selects A’s rows                                          | Zero rows                                                        |
| Owner B updates/deletes A’s IDs                                   | No affected rows                                                 |
| B inserts or updates `owner_id=A`                                 | RLS denial                                                       |
| Anon-key-only table access                                        | Denied or zero rows                                              |
| Owner selects `linear_token` or `*` from `linear_settings`          | Permission denied; service role can read the token                |
| Owner inserts/updates Linear sync timestamps                       | Permission denied; timestamps are server-authored                 |
| Second `settings`, `timer_state`, or `pm_state` row for one owner | Primary-key conflict                                             |
| Delete a task that has logs                                       | Task is removed and its historical logs remain                   |
| Finalize a zero-progress task and persist it                      | A target of `0` is accepted, matching the domain engine          |
| Delete an auth user                                               | All rows owned by that user cascade; another owner’s rows remain |

For a quick REST check, send the user JWT as `Authorization: Bearer <jwt>` and the anon key as `apikey`; query each table through `<local-url>/rest/v1/<table>`. Verify owner inserts omit `owner_id` (the default is `auth.uid()`), then separately test a spoofed owner value. Do not use production users or secrets.
