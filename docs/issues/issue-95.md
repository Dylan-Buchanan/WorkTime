## Title: Tauri/PWA OAuth callback handling for GitHub connect

## Tags

Complexity Classification: T3
Severity: Medium
Reason: The OAuth redirect round-trip must work on both the browser PWA origin and the Tauri webview origin, potentially touching the Tauri shell/config for deep-link or loopback handling. Cross-surface routing/security behavior with the highest uncertainty in the epic.
Needs research before implementation: Yes — determine the feasible Tauri callback mechanism (deep-link vs loopback redirect vs webview-origin redirect) that survives the round-trip without adding Tauri `invoke` data paths, and confirm how the custom OAuth App's callback URL(s) must be registered for both surfaces.

## Summary

Ensure the GitHub OAuth connect flow (issue 89) survives the redirect round-trip on both origins: the browser PWA uses the canonical hosted origin (`VITE_PUBLIC_APP_URL`), and the Tauri desktop app must return the user to an authenticated state where the connect flow can complete. The app's existing recovery-origin convention (`VITE_PUBLIC_APP_URL`, no path, no trailing slash) is the model to follow.

## Steps to Reproduce Context

1. The app already solves a redirect round-trip for password recovery: `resetPasswordForEmail` uses `redirectTo: ${origin.replace(/\/+$/, "")}/reset-password` (`src/auth/AuthContext.tsx`), and production requires `VITE_PUBLIC_APP_URL` as the canonical origin without a path or trailing slash.
2. The Tauri app (`src-tauri/`) is a slim native shell (opener + notification plugins only) sharing the same React app; its webview origin differs from the PWA origin, so a GitHub OAuth callback URL registered for the PWA will not land back in the Tauri window.
3. There is no OAuth callback route (`/auth/callback` or equivalent) in `src/App.tsx` — routes are only `/login`, `/signup`, `/reset-password`, and the authenticated shell.

## Expected Behavior

- Browser PWA: the GitHub authorize redirect targets the callback URL on the canonical `VITE_PUBLIC_APP_URL` origin; the callback route/page hands the `code` to the exchange function (issue 89) and returns the user to `/integrations` with the connect flow completing.
- Tauri: the round-trip returns the user to the desktop app with the `code` available to the exchange flow — via whichever mechanism research validates (system-browser + deep-link capture, loopback redirect, or redirect through the canonical origin that then bridges into the webview). The session used for the exchange call must be the Tauri app's Supabase session.
- The callback path handles failure states (denied auth, missing/expired `code`, wrong state) with user-facing copy and a route back to Integrations.
- No new Tauri `invoke` data paths, no service-role or secret material in the client; only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_APP_URL` are used in browser/Tauri configuration.

## Actual Behavior

No OAuth callback route or Tauri round-trip handling exists; connecting GitHub from the Tauri app would strand the user in the browser (or lose the `code` entirely).

## Requirements for completed issue

1. A documented decision on the Tauri callback mechanism with the trade-offs evaluated (deep-link vs loopback vs canonical-origin bridge), consistent with the slim-shell constraint (no new `invoke` data paths).
2. A callback route/page in the React app that completes the exchange via issue 89's function on the PWA origin and works for the Tauri flow, including error/denied states.
3. The OAuth App's registered callback URL(s) cover both surfaces (documented in setup notes, e.g. `supabase/README.md` or equivalent docs) using `VITE_PUBLIC_APP_URL` as the canonical production value.
4. E2E or unit coverage that the callback route parses the `code`/error params and triggers the exchange path; a manual verification path for the Tauri round-trip is documented (automating the native redirect in Playwright is out of scope if infeasible).
5. `pnpm test:platform` still passes (slim-shell/capability checks unaffected) and `pnpm tauri build` produces the MSI with the flow intact.

## Context

- Files:
  - `src/auth/AuthContext.tsx` — the recovery redirect pattern: `redirectTo: \`${origin.replace(/\/+$/, "")}/reset-password\``.
  - `src/App.tsx` — route table where the callback route must be added (outside `RequireAuth` if completion happens pre-session, or inside if the user is already signed in — connect requires an authenticated user, so the callback must handle the existing-session case).
  - `src/vite-env.d.ts` — `VITE_PUBLIC_APP_URL` documented as the canonical hosted PWA origin for redirects.
  - `src-tauri/` — slim shell; any deep-link/loopback config lives here and must respect `pnpm test:platform` static checks.
  - `src/lib/Tauri*` / `src/state/TauriCloseContext.tsx` — existing Tauri-aware frontend code showing how the app detects the Tauri environment.
- Code Snippets:

```ts
// src/auth/AuthContext.tsx (existing round-trip convention)
const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo: `${origin.replace(/\/+$/, "")}/reset-password`,
});
```

```tsx
// src/App.tsx (route table to extend)
<Route path="/reset-password" element={<ResetPasswordPage />} />
```

## Notes

- GitHub's OAuth App allows exactly one callback URL per app; if a single URL cannot serve both origins, the canonical-origin bridge (browser-hosted callback page that forwards into Tauri) is the likely resolution — this is the core research question.
- Connect requires an authenticated Supabase session; in Tauri the callback completion must reuse the webview's stored GoTrue session (`sb-...-auth-token`), not start a new login.
- Depends on issue 89 (exchange function + authorize URL construction); consumed by issue 94's connect button.
