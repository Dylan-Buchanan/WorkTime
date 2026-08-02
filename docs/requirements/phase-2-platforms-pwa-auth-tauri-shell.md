# Requirements: Phase 2: Platforms — installable PWA, auth UX, and slimmed Tauri shell

## Things To Implement

**PWA support**

- Add a web app manifest (`manifest.webmanifest`) declaring `name`, `short_name`, icons (192px and 512px), `start_url` of `"/"`, `display` of `standalone`, `theme_color`, and `background_color`; link it from `index.html` so the app is installable (add-to-home-screen) on phones.
- Add a service worker via `vite-plugin-pwa` configured with `registerType: "autoUpdate"` and precaching of the build assets, so the PWA is installable and loads from cache; new deploys auto-update.
- Add mobile-friendly meta tags to `index.html` (`theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and an `apple-touch-icon`) and replace the title `"Tauri + React + Typescript"` with the product name.
- Configure `vite.config.ts` with the `vite-plugin-pwa` plugin and a root base path (`base: "/"`) for Cloudflare Pages deployment; the existing Tauri dev server config (fixed port 3000, `TAURI_DEV_HOST` handling) must remain so `tauri dev` still works.
- Supabase URL and anon key must come only from build-time env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (no hardcoding); the build must fail fast if either is missing rather than producing a bundle that throws at runtime.
- Add a Cloudflare Pages SPA fallback (`public/_redirects` containing `/* /index.html 200`) so BrowserRouter deep links resolve on the static host.

**Auth UX**

- Add an `AuthProvider` (or hook) that subscribes to Supabase `auth.onAuthStateChange`, exposes the current session/user and `signIn`/`signUp`/`signOut`/`resetPassword` actions, and persists/refreshes the session in both the Tauri webview and the browser PWA using the existing `supabaseAuthStorageKey`-derived localStorage key.
- Add a `/login` route with email + password fields that signs in via Supabase `signInWithPassword`; show a clear error on invalid credentials.
- Add a `/signup` route with email, password, and invite-code fields that creates the account by calling the existing `invite-signup` Edge Function, then signs the user in with `signInWithPassword` on success; show clear errors for an invalid invite code, an already-existing email, and missing/invalid fields.
- Add a `RequireAuth` routing guard so unauthenticated visits to protected routes (`/`, `/projects`, `/analytics`) redirect to `/login` while preserving the intended destination, and authenticated visits to `/login`, `/signup`, or `/reset-password` redirect to `/`.
- Add a "forgot password" control on `/login` that calls Supabase `resetPasswordForEmail` with `redirectTo` the hosted PWA's `/reset-password` URL.
- Add a `/reset-password` route that reads the recovery token from the URL (Supabase `detectSessionInUrl`), lets the user set a new password via Supabase `auth.updateUser`, and on success redirects to `/login`.
- Add a sign-out control reachable from the authenticated app (e.g. in the top nav or settings) that calls `signOut` and returns the user to `/login`.

**Tauri shell slimming**

- Remove all `#[tauri::command]` data wrappers, the pure domain functions, and the Rust unit tests from `src-tauri/src/lib.rs`; reduce `run()` to building the Tauri app with only the `tauri-plugin-opener` and `tauri-plugin-notification` plugins and no `invoke_handler`.
- Remove Rust dependencies that were only used by the removed data commands (`chrono`, `uuid`, `serde`, `serde_json`) from `src-tauri/Cargo.toml`, keeping `tauri`, `tauri-plugin-opener`, `tauri-plugin-notification`, and build deps.
- Keep the existing capabilities (`opener:default`, `notification:default`, `notification:allow-request-permission`) and the window config; the desktop build must still produce an MSI via `npm run tauri build`.
- The Tauri webview must load the bundled local `dist` (`frontendDist: ../dist`) with Supabase env vars baked at build time; `npm run tauri build` must have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` present in its build environment.
- Remove the now-dead `e2e/mock-ipc.js` Tauri IPC bridge (the app no longer calls `invoke` and e2e uses real Supabase) and update `AGENTS.md` references to it.
- Update `AGENTS.md` testing section and the `test:all` script in `package.json`: remove `npm run test:rust` and the note about mirroring `lib.rs` changes to `e2e/mock-ipc.js`, since the Rust suite and the mock are gone.

**Notifications**

- Notifications must continue to work on Windows via the native `tauri-plugin-notification` path and on the phone PWA via the Web Notification API fallback; the existing `ensureNotification` fallback in `AppStateContext` must remain the single notification entry point and must not be broken by the service worker.

## Tests To Create Or Update

- For the PWA manifest/service-worker items:
    - A build-output assertion that `npm run build` succeeds and `dist/` contains `manifest.webmanifest`, a registered service worker file, and an `index.html` that references the manifest link and the mobile meta tags.
    - A static check that `public/_redirects` contains the `/* /index.html 200` SPA fallback rule.
    - Manual visual check: install the hosted PWA on a phone and confirm add-to-home-screen and a local timer-end notification (automated installability verification is not practical).
- For the `AuthProvider`/`RequireAuth` items:
    - Unit test that the provider renders children when a session is present and routes to login when absent; that `signIn`/`signUp`/`signOut`/`resetPassword` call a mocked Supabase client with the correct arguments; and that it reacts to `onAuthStateChange`.
    - Unit test that `RequireAuth` redirects to `/login` with the `from` location preserved when no session, renders children when a session exists, and redirects `/login` → `/` when already authenticated.
- For the `/signup` item:
    - Unit test that it posts `email`/`password`/`inviteCode` to the `invite-signup` Edge Function, then calls `signInWithPassword` on success; renders error messages for an invalid invite (403), an existing email (409), and missing fields.
- For the `/login` item:
    - Unit test that it calls `signInWithPassword` and renders an error on invalid credentials.
- For the password-reset items:
    - Unit test that the "forgot password" control calls `resetPasswordForEmail` with the correct `redirectTo`; that the `/reset-password` page calls `auth.updateUser` with the new password from the recovery token and redirects to `/login` on success.
- For the auth flow end-to-end:
    - Playwright tests against local Supabase: an unauthenticated visit to `/` redirects to `/login`; a signup with a valid invite code creates an account and lands on the timer; a login with the wrong password shows an error; sign-out returns to `/login`. (Requires the `invite-signup` function to be served locally with a known `SIGNUP_INVITE_CODE`; document this test setup.)
- For the Tauri slimming items:
    - A build smoke gate that `npm run tauri build` succeeds and produces an MSI.
    - A static/review check that `src-tauri/src/lib.rs` no longer contains `#[tauri::command]` or an `invoke_handler`, and `src-tauri/Cargo.toml` no longer lists `chrono`/`uuid`/`serde`/`serde_json`.
    - Regression: `npm run test:unit` and `npm run test:e2e` still pass after the Rust suite and `mock-ipc.js` removal; `package.json` `test:all` and `AGENTS.md` no longer reference `test:rust` or `mock-ipc.js`.
- For the notifications item:
    - Keep/extend a unit test asserting the Web Notification fallback is used when the Tauri notification plugin import fails (non-Tauri environment); existing `AppStateContext` behavior tests must still pass.
    - Manual check: confirm a timer-end native notification fires in the MSI build and a local notification fires in the installed phone PWA.

## Important Background Information

- The frontend is already rewired to Supabase: `App.tsx` uses `defaultDataAccess` → `SupabaseDataAccess`, and `src/lib/supabase.ts` already reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from env (throws if missing). There are no remaining `invoke` call sites for data in `src/` (Phase 1 removed them), so the Tauri slimming is Rust-only plus dead-mock cleanup.
- The `invite-signup` Edge Function already exists (`supabase/functions/invite-signup/index.ts`): it validates the invite code against `SIGNUP_INVITE_CODE`, creates a user with `email_confirm: true`, and returns safe `id`/`email`. Public email/password signup is disabled in Supabase Auth, so signup must go through this function. The function must be deployed for the hosted PWA signup to work.
- `supabaseAuthStorageKey` derives the localStorage key from the Supabase URL hostname (`sb-<ref>-auth-token`), so the session is stored under the same key in both the Tauri webview and the browser PWA; this is why session persistence works across both surfaces without per-origin config.
- The Tauri webview origin on Windows is `https://tauri.localhost` (a custom protocol). Service worker registration may not succeed there; `vite-plugin-pwa`'s registration must fail silently in the webview and must not break the Tauri build or runtime. SW/PWA installability matters only for the browser PWA.
- Notifications already fall back to the Web Notification API in browsers (`AppStateContext.tsx` `ensureNotification`), and sounds use `HTMLAudioElement`, so the web build is platform-ready; the slimming must not change this fallback.
- The e2e suite already runs against real local Supabase with per-test users (`tests/supabase/localSupabase.ts` `createLocalUser`) and injects the session into localStorage; `e2e/mock-ipc.js` is no longer injected or used by e2e.
- `tauri.conf.json` bundles `../dist` with `beforeBuildCommand: npm run build`; because Supabase config is read at Vite build time, the MSI build environment must supply the env vars.
- Password reset uses an email link to the hosted PWA `/reset-password`; Tauri webview users reset via the browser (hosted PWA), then sign back in inside the desktop app with the new password.

## Things To Ensure Are Not Done

- Do not change timer/task domain semantics. The pure TypeScript engine (`src/lib/engine`) remains the source of truth; removing the Rust pure functions does not alter TS behavior. Do not re-introduce any Tauri `invoke` data path.
- Do not hardcode the Supabase URL/anon key, service-role keys, or the invite code in any client bundle or `VITE_` variable. Service-role credentials and `SIGNUP_INVITE_CODE` remain server-only.
- Do not point the Tauri webview at the hosted PWA URL; it must bundle local `dist` so the shell is self-contained.
- Do not remove the `tauri-plugin-opener` or `tauri-plugin-notification` plugins or their capabilities; the window and native notifications must remain.
- Do not break the existing unit/e2e suites: the Rust suite removal must not leave dangling references in `package.json` `test:all` or `AGENTS.md`, and removing `mock-ipc.js` must not break any test that imports it (verify none do).
- Do not regress the Web Notification fallback for non-Tauri browsers; the service worker must not intercept or break local `Notification` construction.
- Do not enable public email/password signup in Supabase Auth; signup must remain invite-gated through the Edge Function.
- Do not add push notifications or background sync; phone notifications are local (timer-end) only, matching the existing foreground timer model.
- Do not refactor unrelated contexts (`AppStateContext`, `ProjectManagerContext`, `StateSyncBridge`) beyond what auth gating requires.

## User Decisions Made During Requirement Creation

| Decision Needed                           | Answer                                               | Reason                                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which static host should the PWA target?  | Cloudflare Pages                                     | Fast global CDN, simple SPA fallback via `_redirects`, env vars in dashboard, good reach for a phone PWA.                                                                                                       |
| Which service-worker/caching approach?    | `vite-plugin-pwa` with `autoUpdate` + precache       | Standard Vite PWA plugin; generates manifest + workbox SW, precaches build assets, auto-updates on new deploys. Best fit for a Vite SPA.                                                                        |
| How far should the Rust slimming go?      | Remove commands + pure functions + Rust tests        | The frontend no longer calls `invoke`; the TS engine parity suite already covers timer semantics. Slim `lib.rs` to window + notification plugins only and drop the Rust suite, updating `AGENTS.md`/`test:all`. |
| Which routing/auth-guard approach?        | BrowserRouter + SPA fallback + `RequireAuth` guard   | Keeps the existing `BrowserRouter`, gives clean shareable URLs, and supports the email-link `/reset-password` landing route. Cloudflare Pages SPA fallback is a one-line `_redirects`.                          |
| Which password-reset flow?                | Email reset link → hosted PWA `/reset-password` page | Uses Supabase `resetPasswordForEmail` with `redirectTo` the hosted PWA reset page; Tauri users reset via the browser then sign back in, since the webview cannot receive email deep links.                      |
| How should the Tauri shell source its UI? | Bundle local `dist` with build-time env vars         | Keeps the shell self-contained (`frontendDist: ../dist`); `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are baked at `tauri build` time so the webview talks directly to Supabase.                               |
