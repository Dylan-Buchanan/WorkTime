## Title: Phase 2: Platforms — installable PWA, auth UX, and slimmed Tauri shell

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Hosts the same React build as an installable PWA (manifest, service worker, env-driven Supabase config), adds the full sign-in/sign-up UX with invite-code gating, and slims the Tauri shell to windowing + native notifications (removing now-unused Rust commands). Blast Radius=4 (vite.config.ts, index.html, new PWA files, env config, auth components, app entry, lib.rs command removal, tauri.conf.json/capabilities), Uncertainty=2, Behavior=5, Testing=2, Reversibility=1, Total=14.
Needs research before implementation: Yes
Research needed: Confirm no remaining UI path invokes the Rust commands slated for removal; decide the PWA hosting platform and service-worker caching strategy for a Vite React SPA; define auth session persistence/refresh flow for both the webview and browser surfaces.

## Summary

Ship the phone experience and clean up the desktop build: deploy the same React app as an installable PWA backed by Supabase auth, add the sign-in/sign-up flow (secret invite code required to create an account, email + password to log in), and reduce the Windows Tauri app to a thin shell that loads the same Supabase-backed UI.

## Steps to Reproduce Context

1. `index.html` has no PWA manifest or mobile meta tags; `vite.config.ts` is configured only for Tauri dev (fixed port 3000, react plugin only).
2. There is currently no authentication UI or session handling anywhere in the app.
3. `src-tauri/src/lib.rs` still hosts all commands and `src-tauri/capabilities/default.json` grants `opener:default` and `notification:default`; after Phase 1 the Rust commands are no longer used by the frontend.
4. Notifications already fall back to the Web Notification API in browsers (`AppStateContext.tsx:19-33`), and sounds use plain `HTMLAudioElement` (`src/hooks/useSounds.ts`), so the web build is platform-ready.

## Expected Behavior

- The same React build runs as an installable PWA (add-to-home-screen, phone notifications) served from a static host, with Supabase URL/anon key injected via env vars.
- Users can create an account only with a secret invite code; returning users log in with email + password; sessions persist and refresh correctly in both a browser and the Tauri webview.
- The Windows app still installs as an MSI and still shows native notifications, but it no longer contains the Rust data commands — it is a thin shell around the shared Supabase-backed UI.

## Actual Behavior

- The app only runs as a desktop Tauri app over local files; there is no web deployment, no auth, and `lib.rs` still owns all backend commands.

## Requirements for completed issue

1. PWA support: `manifest.webmanifest`, service worker, mobile-friendly meta tags, and a hosted build of the same React app; Supabase URL/anon key come from build-time env vars (no hardcoding).
2. Auth UX: sign-up page requiring a secret invite code, email + password login page, logged-in/logged-out routing guard, and session persistence/refresh that works in both the webview and browser (including storefront redirect handling if used). Include password reset capabilities in case someone forgets their password
3. Tauri shell slimming: remove the now-unused data commands from `src-tauri/src/lib.rs` and their frontend `invoke` call sites; keep the window, the native notification plugin, and the necessary capabilities; the desktop build must still pass `npm run tauri build` and run against the same Supabase-backed UI.
4. Notifications continue to work on Windows (native) and on the phone (Web Notification API in the installed PWA).

## Context

- Files:
    - `index.html` — currently no manifest, no mobile meta tags, title "Tauri + React + Typescript".
    - `vite.config.ts` — react plugin only; no PWA/manifest/base-path handling.
    - `src-tauri/src/lib.rs` — the command set to be removed after Phase 1 (all `#[tauri::command]` fns and the `invoke_handler` list).
    - `src-tauri/src/main.rs` — trivial entry that calls `work_time_lib::run()`.
    - `src-tauri/capabilities/default.json` — `opener:default`, `notification:default`, `notification:allow-request-permission`.
    - `src-tauri/Cargo.toml` — tauri 2, `tauri-plugin-opener`, `tauri-plugin-notification`; the only deps needed after slimming.
    - `src/state/AppStateContext.tsx:7-35` — existing Web Notification API browser fallback.
    - `src/hooks/useSounds.ts` — `HTMLAudioElement`-based sounds, fully web-compatible.
- Code Snippets:
    - Invoke surface to be emptied: `AppStateContext.tsx` and `ProjectManagerContext.tsx`/`StateSyncBridge.tsx` `invoke` calls (all replaced in Phase 1) and the `invoke_handler` list in `lib.rs:558-577`.

## Notes

- Verify the PWA works in both the Tauri webview and a standalone browser tab; the Tauri build loads the same `dist/` output.
- Decide hosting (e.g., Vercel/Netlify/Cloudflare Pages) as part of this issue; Supabase does not natively host static sites.
