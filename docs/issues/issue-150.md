# Title: Forgot password via a special reset password instead of an emailed reset link

## Tags

Complexity Classification: T3
Classification Reason: The change crosses the React auth UI (`src/components/auth/LoginPage.tsx`, `src/components/auth/ResetPasswordPage.tsx`), the auth provider (`src/auth/AuthContext.tsx`), error mapping (`src/auth/authErrors.ts`), the route table (`src/App.tsx`), a new Supabase Edge Function plus its per-function JWT setting and server-only secret, deployment/setup docs, and the unit/E2E suites. Removing the emailed-link path also removes `PASSWORD_RECOVERY`/`recoveringPassword`, which currently gates `updatePassword` and the reset page. Resolution of an account by email through the service-role admin client is a genuine unknown, so research is still required.

Severity: High
Severity Reason: Password recovery is the only way back into the app after a forgotten password. If the shared reset password is checked incorrectly, any known email can be taken over; if the flow or the function configuration is wrong, the owner can be locked out with no working recovery path. The change also touches the only server-only secret gate in the auth area.

Needs research before implementation: Yes

### Research Needed

The flow itself is clear; the open questions are about how the server side safely finds and updates an account, and what removing the email-recovery path affects.

- Decide how `reset-password` resolves a user id from an email with the service-role client. `invite-signup` only ever creates users; it never looks one up. Compare bounded `admin.listUsers({ page, perPage })` pagination against a small Postgres RPC, and note whether a migration is needed.
- Confirm `admin.updateUserById(id, { password })` is the right server-side update, whether it enforces `minimum_password_length` from `supabase/config.toml`, and whether existing sessions on other devices are left valid (decide if that is out of scope).
- Enumerate every consumer of `resetPassword`, `recoveringPassword`, and the `INVALID_RECOVERY` code so removing the emailed path does not leave dead state or a route guard that bounces users. Check `src/auth/AuthContext.tsx`, `src/auth/authErrors.ts`, `src/components/auth/ResetPasswordPage.tsx`, `src/components/auth/LoginPage.tsx`, and `src/App.test.tsx`.
- Decide whether `/reset-password` stays a standalone public route or moves under `RedirectIfAuthenticated` in `src/App.tsx` L81–86, and how the email is passed from `/login` to `/reset-password` (router state vs. query parameter) without putting the reset password anywhere near the URL.
- Confirm local and hosted setup for a new `verify_jwt = false` function: `supabase/.env.local`, `supabase secrets set`, `functions deploy --no-verify-jwt`, and the `[functions.reset-password]` entry in `supabase/config.toml`.
- Decide the abuse story for a single shared reset password (no GoTrue rate limit applies to a custom function) and whether the E2E test should follow the skippable `TEST_SIGNUP_INVITE_CODE` pattern in `e2e/auth.spec.ts`.

## Summary

Password reset currently depends on Supabase sending a recovery email and the browser landing back on `/reset-password` with a `PASSWORD_RECOVERY` session. WorkTime is a personal app with a tiny, known user set, so this should be a direct flow instead: the user enters their email, proves they know the app's special reset password, and sets a new password immediately.

This issue replaces the emailed-link reset with a special-password reset:

1. The user presses **Forgot password?** on `/login`.
2. `/reset-password` opens with the email already filled in.
3. The user enters the special reset password, a new password, and its confirmation.
4. The reset password is verified server-side by a new `reset-password` Edge Function against a server-only secret; on success the account password is updated.
5. The user is returned to `/login` with the email prefilled and a "password updated" notice, ready to sign in.

The special reset password must never reach the client bundle, a `VITE_` variable, or local storage.

## Steps to Reproduce Context

1. Sign out, or open the app at `/login`.
2. Enter the account email and press **Forgot password?** (`src/components/auth/LoginPage.tsx` L45–61, L73).
3. Observe that the only recovery path is an email: `resetPassword` calls `client.auth.resetPasswordForEmail(...)` with `redirectTo` `${VITE_PUBLIC_APP_URL}/reset-password` (`src/auth/AuthContext.tsx` L91–98).
4. Follow the emailed link and land on `/reset-password`, which only shows the new-password form when `session && recoveringPassword` is true (`src/components/auth/ResetPasswordPage.tsx` L48–49); `recoveringPassword` is set only by the `PASSWORD_RECOVERY` auth event (`src/auth/AuthContext.tsx` L44).

## Expected Behavior

- **Forgot password?** on `/login` opens the reset page with the email the user already typed prefilled, without sending any email.
- The reset page collects the email, the special reset password, the new password, and the new-password confirmation in one simple form.
- The password changes only when the submitted special reset password matches the server-side secret, the email belongs to an existing account, and the new password passes the existing minimum-length rule (6 characters, `minimum_password_length` in `supabase/config.toml`).
- A wrong reset password or an unknown email shows a clear error and changes nothing; the user stays on the reset page and can retry.
- A successful reset does not sign the user in. It returns them to `/login` with the email prefilled and a notice that the password was updated, matching the existing `state: { passwordReset: true }` notice.
- The emailed reset-link path is gone end to end: no `resetPasswordForEmail` call, no `PASSWORD_RECOVERY`/`recoveringPassword` gating, no "reset link invalid or expired" copy, and no redirect-allow-list entry that implies an emailed reset.
- The special reset password and the service-role key stay server-side only; the browser client talks to the Edge Function with the public anon key.
- The rest of sign-in, signup with an invite code, sign-out, and the authenticated shell behave exactly as they do today.

## Actual Behavior

- **Forgot password?** requires a working SMTP setup and an emailed link. The owner cannot reset the password from inside the app.
- `/reset-password` is a recovery-link landing page: without a `PASSWORD_RECOVERY` session it renders "This password-reset link is invalid or has expired." (`src/components/auth/ResetPasswordPage.tsx` L49).
- `updatePassword` refuses to run unless `session && recoveringPassword` (`src/auth/AuthContext.tsx` L100–106), so no password change is possible from a plain, logged-out visit.
- `src/App.test.tsx` L84–98 asserts the string "Reset link unavailable" for `/reset-password`, encoding the current email-link behaviour.
- `src/auth/authErrors.ts` exposes `INVALID_RECOVERY` with the message "This password-reset link is invalid or has expired." (`L6`, `L14`, `L55–57`).

## Requirements for completed issue

1. `/login` shows a **Forgot password?** control that navigates to the reset page with the email field prefilled when the typed email is valid.
2. The reset page has one form with email, special reset password, new password, and confirmation, and a single submit action.
3. A new `reset-password` Edge Function validates the submitted special reset password against a new server-only secret (for example `RESET_PASSWORD_CODE`) before doing anything else, and returns a safe error when the secret is unset.
4. A valid request updates the password for the account matching the normalized email through the service-role admin client, without creating or requiring a session on the client.
5. Invalid input, a wrong reset password, and a missing account each show a clear, specific error and leave the password unchanged.
6. Success returns the user to `/login` with the email prefilled and the existing "password updated" notice, and no active session.
7. The emailed reset-link path and its state are fully removed (`resetPassword`/`resetPasswordForEmail`, `recoveringPassword`, the `PASSWORD_RECOVERY` branch, and the `INVALID_RECOVERY` code) with no dead references left behind.
8. The reset password and the service-role key appear only in the ignored `supabase/.env.local` and hosted Supabase secrets — never in a `VITE_` variable, committed source, client bundle, log, or local storage.
9. `supabase/config.toml` declares the new function with `verify_jwt = false`; `supabase/README.md` documents the local secret, hosted secret, deploy command, and manual cases; any now-misleading emailed-reset guidance is corrected.
10. The design does not add a Tauri `invoke` data path, background sync, or any change to timer/task/data-sync semantics.

### Testing

1. `pnpm test:unit` — update the route table test in `src/App.test.tsx` L84–98 to the new reset-page heading, and keep its assertion that public auth routes construct no authenticated data.
2. New unit coverage for the auth provider's reset call using the injectable `client` (the `AuthProvider` already accepts `client`): success invokes the function once with normalized email; failure surfaces the mapped error; no session is created; a short or mismatched new password is rejected before invoking.
3. New unit coverage for the reset page: prefilled email from router state, validation messages, pending state, and navigation to `/login` with `{ email, passwordReset: true }` on success.
4. Function-level coverage for the reset handler (pure handler with an injected client, following the existing `supabase/functions/**` test pattern): wrong reset password, missing secret, unknown email, success, and malformed JSON return safe status codes and change no password.
5. `pnpm lint:supabase` (deno check on all functions) and `pnpm build` pass.
6. E2E in `e2e/auth.spec.ts`, skipped unless a test reset password is configured (mirroring the `TEST_SIGNUP_INVITE_CODE` pattern at L43–44): create a user with the local service-role key, reset it through the UI, confirm the login page shows the prefilled email and notice, sign in with the new password, then delete the user.
7. Manual checks: wrong reset password, unknown email, mismatched confirmation, 5-character password, correct reset in both the browser and the packaged Tauri app, and confirmation that no recovery email is sent.

## Context

### Current forgot-password trigger

Code Source: `src/components/auth/LoginPage.tsx` L45–61, L73
Code Description: Validates the typed email and sends a recovery email; the notice text is what changes.

```tsx
async function forgotPassword() {
    setError(null);
    setNotice(null);
    if (!isEmail(email)) {
        setError("Enter your email address first.");
        return;
    }
    setPending(true);
    try {
        await resetPassword(email);
        setNotice("If an account matches that email, a password-reset link will be sent.");
    } catch (cause) {
        setError(cause instanceof AuthActionError ? cause.message : "Unable to request a password reset.");
    } finally {
        setPending(false);
    }
}

<button type="button" … onClick={forgotPassword} disabled={pending}>Forgot password?</button>
```

The login form already initializes its notice from `location.state?.passwordReset` (L26), which is the success signal the new flow can reuse.

### Current recovery API surface

Code Source: `src/auth/AuthContext.tsx` L13–23, L91–106
Code Description: `resetPassword` sends the email; `updatePassword` is gated by a recovery session, and `recoveringPassword` comes from the `PASSWORD_RECOVERY` event at L44.

```ts
export interface AuthContextValue {
    session: Session | null;
    user: User | null;
    loading: boolean;
    recoveringPassword: boolean;
    signIn(email: string, password: string): Promise<void>;
    signUp(input: SignUpInput): Promise<void>;
    signOut(): Promise<void>;
    resetPassword(email: string): Promise<void>;
    updatePassword(password: string): Promise<void>;
}

const resetPassword = useCallback(async (email: string) => {
    const normalizedEmail = email.trim();
    if (!validEmail(normalizedEmail)) throw invalidFields();
    const { publicAppUrl } = readPublicAppEnv(import.meta.env);
    const origin = publicAppUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
    const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${origin.replace(/\/+$/, "")}/reset-password` });
    if (error) throw mapAuthError(error, "recovery");
}, [client]);

const updatePassword = useCallback(async (password: string) => {
    if (password.length < 6) throw invalidFields();
    if (!session || !recoveringPassword) throw new AuthActionError("INVALID_RECOVERY");
    const { error } = await client.auth.updateUser({ password });
    if (error) throw mapAuthError(error, "recovery");
    if (mounted.current) setRecoveringPassword(false);
}, [client, recoveringPassword, session]);
```

`AuthProvider` already accepts an injectable `client` (L31), so tests can supply a fake.

### Current reset page gate and success path

Code Source: `src/components/auth/ResetPasswordPage.tsx` L22–49
Code Description: Redirects away when a session exists, and otherwise requires a recovery session; on success it signs out and navigates to `/login`.

```tsx
useEffect(() => {
    if (!checking && !pending && session && !recoveringPassword) navigate("/", { replace: true });
}, [checking, navigate, pending, recoveringPassword, session]);

if (loading || checking) return <AuthPageLayout title="Checking reset link">…</AuthPageLayout>;
if (!session || !recoveringPassword) return <AuthPageLayout title="Reset link unavailable">…</AuthPageLayout>;

// on submit success:
await updatePassword(newPassword);
await signOut();
navigate("/login", { replace: true, state: { passwordReset: true } });
```

The new page needs a different gate (no session, no link) and should pass `{ email, passwordReset: true }` so `/login` can prefill the email.

### Route registration

Code Source: `src/App.tsx` L81–86
Code Description: `/login` and `/signup` are wrapped in `RedirectIfAuthenticated`; `/reset-password` is a standalone public route. Also note `src/App.tsx` L54–58 lazy-loads `ResetPasswordPage`.

```tsx
<Route element={<RedirectIfAuthenticated />}>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
</Route>
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

### Existing server-side secret pattern to follow

Code Source: `supabase/functions/invite-signup/index.ts` L24–71
Code Description: The only current secret-gated function. It validates POST JSON, compares against a server-only env secret, and uses the service-role client. `reset-password` should mirror this shape (CORS, method guard, safe JSON errors, `500` when the secret or service-role values are missing).

```ts
const expectedInviteCode = Deno.env.get("SIGNUP_INVITE_CODE");
if (!expectedInviteCode) {
    return jsonResponse({ error: "Signup is unavailable" }, 500);
}
if (payload.inviteCode !== expectedInviteCode) {
    return jsonResponse({ error: "Invalid invite" }, 403);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data, error } = await supabase.auth.admin.createUser({ … });
```

Deployment/config references:

- `supabase/config.toml` L385–386 — `[functions.invite-signup] verify_jwt = false` is the model for the new entry.
- `supabase/config.toml` L163 — `additional_redirect_urls` currently lists the reset-password URLs and should be revisited when the email path goes.
- `supabase/config.toml` L182 — `minimum_password_length = 6`.
- `supabase/README.md` L21, L23–58 — the emailed-reset guidance and the invite-secret/deploy procedure to mirror.

### Error mapping to update

Code Source: `src/auth/authErrors.ts` L1–16, L39–57
Code Description: `INVALID_RECOVERY` is specific to link recovery; the new flow needs codes/messages for a wrong reset password and a missing account.

```ts
export type AuthErrorCode = "INVALID_FIELDS" | "INVALID_CREDENTIALS" | "INVALID_INVITE" | "ACCOUNT_EXISTS" | "INVALID_RECOVERY" | "AUTH_UNAVAILABLE";
const messages: Record<AuthErrorCode, string> = {
    …
    INVALID_RECOVERY: "This password-reset link is invalid or has expired.",
    …
};
if (operation === "recovery" && (status === 400 || /expired|invalid.*(token|recovery|refresh)/.test(text))) {
    return new AuthActionError("INVALID_RECOVERY");
}
```

### Tests that encode current behaviour

Code Source: `src/App.test.tsx` L84–98
Code Description: The public-route table asserts the old reset-page heading; it must change to the new heading while keeping the "no authenticated data" guarantee.

```tsx
it.each([
    ["/login", "Sign in"],
    ["/signup", "Create an account"],
    ["/reset-password", "Reset link unavailable"],
    ["/goals", "Sign in"],
])("never constructs authenticated data or reads goals for public/unauthenticated %s", …);
```

Code Source: `e2e/auth.spec.ts` L43–66
Code Description: The only skippable secret-gated E2E test. It creates and deletes a user with the local service-role client — the same cleanup shape the reset E2E needs.

```ts
test("signs up with a valid invite and lands on timer", async ({ browser }) => {
    test.skip(!process.env.TEST_SIGNUP_INVITE_CODE, "Set TEST_SIGNUP_INVITE_CODE and serve invite-signup to run invite signup E2E");
    const config = localSupabaseConfig();
    const admin = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    …
});
```

## Notes

- **Assumption:** one app-wide special reset password, stored as a new server-only Edge Function secret (suggested name `RESET_PASSWORD_CODE`), rather than reusing `SIGNUP_INVITE_CODE` or per-user codes. Confirm before implementation; reusing the invite code is a smaller change if preferred.
- **Assumption:** the emailed reset-link flow is replaced, not kept alongside this one, because the request says "instead of an email".
- **Assumption:** failures are explicit (a wrong special reset password says so, and an unknown email says no account exists) rather than generic. This is friendlier for a personal app but does disclose whether an email is registered; switch to a generic message if that matters.
- The reset password can be typed by anyone who knows it, for any registered email; that is the accepted trade-off for this personal app. A modest delay or per-IP throttle in the function is optional, and no GoTrue rate limit covers a custom function.
- Existing sessions on other devices are expected to stay valid after the reset; revoking them is out of scope unless implementation decides otherwise.
- Repo constraints to preserve: no service-role key, invite code, or new secret in a `VITE_` variable or committed source; no Tauri `invoke` data path; keep `DataProvider`, `AppStateProvider`, `ProjectManagerProvider`, and `StateSyncBridge` behind the authenticated route shell, and do not let public auth pages trigger authenticated data reads.
