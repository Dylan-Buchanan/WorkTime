## Title: Authentication — sign in, sign out, special-code account creation, and forgot password

## Tags

Complexity Classification: T4
Severity: Medium
Reason: A full auth system spanning every layer of the stack: a new Supabase table + migration storing the special codes, reworking the existing invite-signup Edge Function to validate against that table, and building the frontend sign-in/sign-out/sign-up/forgot-password flows with session persistence, refresh, and routing guards. Blast Radius=5 (frontend contexts and app entry, edge function, DB schema, env config, and coordination with the Phase 1 data-access precondition and Phase 2 auth-UX work), Uncertainty=3 (session behavior in the Tauri webview, RLS for the special-code table, forgot-password flow given email confirmations are disabled), Behavior=5 (auth is security-critical), Testing=3 (RLS/auth verification is documented manual-only), Reversibility=2 (new migration + table, created users, app-wide gating). Total=18.
Needs research before implementation: Yes
Research needed: how auth gating coordinates with the Phase 1 DataAccess layer precondition and Phase 2 auth-UX work; special-code table schema/semantics (single-use vs reusable, who administers rows) and its RLS policy; whether to modify or replace the existing `invite-signup` Edge Function and preserve its error contract (400/403/409, CORS); session persistence/refresh in the Tauri webview vs browser and whether `e2e/mock-ipc.js` needs auth simulation; the forgot-password flow given `config.toml` disables email confirmations.

## Summary

Add full authentication to the app: users can create an account using a special code (stored in a Supabase table and validated by an Edge Function), sign in with email + password, sign out, and recover a forgotten password. There is currently no auth anywhere in the app.

## Steps to Reproduce Context

1. The app has no auth today: `src/lib/supabase.ts` creates a Supabase client from `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, but nothing imports it (`AGENTS.md` defers importing it until a client-rewire task). There is no auth UI, session handling, or routing guard in `src/App.tsx` (routes are `/`, `/projects`, `/analytics`).
2. Supabase Auth is already configured to disallow direct signup: `supabase/config.toml` sets `enable_signup = false` (auth) and `[auth.email] enable_signup = false`, so new accounts can only be created server-side.
3. An Edge Function exists (`supabase/functions/invite-signup/index.ts`) that gates account creation by comparing an `inviteCode` against a single server-side env secret (`SIGNUP_INVITE_CODE`) and then creates the user via the service-role client with `email_confirm: true`. There is no table storing special codes, and the function has no password-recovery counterpart.
4. The Phase 0 migration (`supabase/migrations/20260801000000_phase_0_foundation.sql`) creates only the five owner-scoped data tables (`tasks`, `pomodoro_logs`, `settings`, `timer_state`, `pm_state`); no special-code table exists.
5. Downstream phases assume auth exists: Phase 1's data-access layer requires a valid Supabase session (`docs/requirements/phase-1-client-rewire-supabase.md`), and Phase 3 data migration depends on users being able to sign in.

## Expected Behavior

- A user can create an account by providing an email, password, and a special code. The special code is stored in a Supabase table, and a Supabase Edge Function validates it server-side before creating the account; invalid or missing codes fail cleanly and create no user.
- A returning user can sign in with email + password (no special code required).
- A signed-in user can sign out.
- A user who forgets their password can recover it through the Supabase Auth password-recovery flow.
- Authentication state is managed and persisted (survives app restarts), and the UI shows the appropriate views/guards for authenticated vs unauthenticated users.

## Actual Behavior

- There is no sign-in, sign-out, account creation, or password recovery anywhere in the app; all data lives behind a single local user with no account.
- Account creation gating exists only as an Edge Function that compares against a single server-side env secret (`SIGNUP_INVITE_CODE`), not a table, and no frontend calls it.

## Requirements for completed issue

1. A Supabase table exists that stores the special code(s) required for account creation, delivered via a migration under `supabase/migrations/`.
2. A Supabase Edge Function validates the special code against that table and creates the account only when the code is valid; invalid/missing codes return a clear error and create no user.
3. Users can sign in with email + password and sign out; sessions persist and refresh across app restarts (including the Tauri webview).
4. Users can recover a forgotten password through the Supabase Auth password-recovery flow.
5. The app has auth-aware UI: unauthenticated users see sign-in/sign-up views, authenticated users can reach the existing app views, and state is not compromised by sign-out.

## Context

- Files:
  - `src/lib/supabase.ts` — the existing (currently unused) Supabase client foundation reading `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  - `src/App.tsx` — route structure (`/`, `/projects`, `/analytics`) with no auth guards; `src/main.tsx` — app entry.
  - `supabase/functions/invite-signup/index.ts` — existing invite-gated account-creation Edge Function (validates an env-var secret, creates user via service role).
  - `supabase/migrations/20260801000000_phase_0_foundation.sql` — Phase 0 schema; contains the five owner-scoped RLS tables but no special-code table.
  - `supabase/config.toml` — Auth configuration: `enable_signup = false`, `[auth.email] enable_signup = false`, `minimum_password_length = 6`, email confirmations disabled.
  - `supabase/README.md` — invite function usage, ignored `supabase/.env.local` (`SIGNUP_INVITE_CODE`), and the manual auth verification matrix.
  - `docs/issues/phase-2-platforms-pwa-auth-tauri-shell.md` — scopes auth UX (invite-code sign-up, sign-in, session persistence/refresh) as part of Phase 2.
  - `docs/requirements/phase-1-client-rewire-supabase.md` — data-access layer requires a valid Supabase session as a precondition.
- Code Snippets:
  - Supabase client foundation (`src/lib/supabase.ts`):
    ```ts
    export const supabase = createClient(supabaseUrl, supabaseAnonKey);
    ```
  - Existing invite validation against an env secret (`supabase/functions/invite-signup/index.ts:48-55`):
    ```ts
    const expectedInviteCode = Deno.env.get("SIGNUP_INVITE_CODE");
    if (!expectedInviteCode) {
        return jsonResponse({ error: "Signup is unavailable" }, 500);
    }
    if (payload.inviteCode !== expectedInviteCode) {
        return jsonResponse({ error: "Invalid invite" }, 403);
    }
    ```
  - Direct signup disabled (`supabase/config.toml:176,221`): `enable_signup = false` under `[auth]` and `[auth.email]`.

## Notes

- The user's requested model (special code stored in a Supabase table, validated by an Edge Function) differs from the current implementation (single server-side env secret in the `invite-signup` function). Decide whether the existing function is modified or replaced, keeping its documented error contract (400/403/409, CORS) for compatibility.
- The special-code table's RLS policy needs its own decision; the Phase 0 owner-scoped pattern (`owner_id = auth.uid()`) does not directly apply because the table is consulted pre-authentication.
- Verify whether password recovery can work locally given email confirmations are disabled in `config.toml`, and document the manual verification cases per the pattern in `supabase/README.md`.
- The Phase 1 client rewire already assumes a valid session is present; this issue must coordinate so the auth flow and the data-access precondition line up without duplication.
