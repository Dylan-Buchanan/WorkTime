# Supabase foundation

This directory contains the local Supabase CLI project, schema/RLS migrations, and the invite-signup, Shortcut, and Google Calendar Edge Functions. Docker and the Supabase CLI are required.

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
| Second `settings`, `timer_state`, or `pm_state` row for one owner | Primary-key conflict                                             |
| Delete a task that has logs                                       | Task is removed and its historical logs remain                   |
| Finalize a zero-progress task and persist it                      | A target of `0` is accepted, matching the domain engine          |
| Delete an auth user                                               | All rows owned by that user cascade; another owner’s rows remain |

For a quick REST check, send the user JWT as `Authorization: Bearer <jwt>` and the anon key as `apikey`; query each table through `<local-url>/rest/v1/<table>`. Verify owner inserts omit `owner_id` (the default is `auth.uid()`), then separately test a spoofed owner value. Do not use production users or secrets.
