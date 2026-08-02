# Supabase foundation

This directory contains the local Supabase CLI project, the Phase 0 schema/RLS migration, and the invite-gated signup Edge Function. Docker and the Supabase CLI are required.

## Local setup

From the repository root:

```sh
npx supabase start
npx supabase db reset
npx supabase status
```

`db reset` is destructive to the local Supabase data. Never run it against a hosted project. Use the URLs and keys printed by `supabase status` for local clients; do not copy them into source control. Stop the stack with `npx supabase stop`.

The local Auth configuration disables direct email/password signup while preserving password sign-in. The hosted Auth dashboard must have the equivalent “Allow new users to sign up” setting disabled; `db push` does not change hosted Auth settings.

The browser and Tauri builds require the public variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and (for production builds) `VITE_PUBLIC_APP_URL`. Set the last value to the canonical Cloudflare Pages origin, without a path or trailing slash. Password-reset emails use its `/reset-password` route, so add that exact URL to the hosted Supabase Auth redirect allow-list. Local development also allows the `http://localhost:1420/reset-password` and `http://127.0.0.1:1420/reset-password` routes above.

## Invite function

Create the ignored `supabase/.env.local` file with a temporary local secret:

```dotenv
SIGNUP_INVITE_CODE=replace-with-a-local-secret
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. Never commit or put either privileged value, or the invite code, in a `VITE_` variable.

Serve locally with:

```sh
npx supabase functions serve invite-signup --no-verify-jwt --env-file supabase/.env.local
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

## Owner-isolation verification matrix

Use two temporary users and their JWTs with the local URL from `supabase status`.

| Case | Expected result |
| --- | --- |
| Owner A CRUD on each table | Succeeds for A’s rows |
| Owner B selects A’s rows | Zero rows |
| Owner B updates/deletes A’s IDs | No affected rows |
| B inserts or updates `owner_id=A` | RLS denial |
| Anon-key-only table access | Denied or zero rows |
| Second `settings`, `timer_state`, or `pm_state` row for one owner | Primary-key conflict |
| Delete a task that has logs | Task is removed and its historical logs remain |
| Finalize a zero-progress task and persist it | A target of `0` is accepted, matching the domain engine |
| Delete an auth user | All rows owned by that user cascade; another owner’s rows remain |

For a quick REST check, send the user JWT as `Authorization: Bearer <jwt>` and the anon key as `apikey`; query each table through `<local-url>/rest/v1/<table>`. Verify owner inserts omit `owner_id` (the default is `auth.uid()`), then separately test a spoofed owner value. Do not use production users or secrets.
