# WorkTime repository guidance

WorkTime is a Windows Tauri desktop app with a React/Vite frontend. The browser PWA and Tauri webview share the Supabase-backed React application and authenticated routes. The Tauri backend is a slim native shell containing only the opener and notification plugins; application data and timer behavior live in the frontend Supabase data access layer and pure TypeScript engine.

## Project basics

- `src/` contains React routes, auth, contexts, shared state types, display helpers, and frontend tests.
- `src/lib/engine/` is the pure TypeScript timer/task source of truth. It has no I/O, network, wall-clock, or random-ID dependencies in command inputs.
- `src-tauri/` contains only the native Tauri startup shell and retained plugin configuration.
- `e2e/` contains Playwright tests against the real React app and local Supabase.
- `supabase/` contains the schema/RLS migration, local Auth configuration, invite-signup Edge Function, and setup notes.
- `public/` contains PWA install artwork and the Cloudflare Pages SPA fallback.

Do not add Tauri `invoke` data paths, service-role credentials, invite codes, or push/background-sync behavior. Keep service-role keys and `SIGNUP_INVITE_CODE` server-only. Browser configuration may use only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the public recovery origin `VITE_PUBLIC_APP_URL`.

The per-owner localStorage staging store (`worktime:staging:v1:*`, implemented in `src/lib/data/staging/`) is the only application-data persistence exception. It is frontend-owned, holds only the owner's local app/PM state plus sync metadata, and must not be replaced by Tauri `invoke`/file paths or moved server-side. Everything under `pm_state_v1` (UI-only) and the GoTrue `sb-...-auth-token` key remains outside the staging store.

## Environment and Supabase

Production web and Tauri builds require all three public Vite variables. Development may omit `VITE_PUBLIC_APP_URL`, in which case recovery uses the current browser origin. The canonical production value must be an origin without a path or trailing slash.

Docker Desktop is required for local Supabase:

```powershell
pnpm supabase:start
pnpm supabase:status
pnpm supabase:serve
```

## Updating and testing

After dependency or source changes, run `pnpm install` and `pnpm run build`. Before completion, use the smallest relevant checks:

- `pnpm test:unit` — Vitest frontend, auth, context, and pure-engine tests.
- `pnpm test:pwa` — production build plus generated manifest/service-worker/mobile metadata checks; provide the required public env.
- `pnpm test:platform` — static checks for the slim native shell, retained capabilities, local `dist` packaging, and workflow cleanup.
- `pnpm test:integration` — local Supabase configuration/data checks; requires the local stack.
- `pnpm test:e2e` — Playwright against local Supabase and the served invite function; requires Chromium and the local stack.
- `pnpm test:all` — unit, PWA, platform, integration, and E2E coverage.
- `pnpm tauri build` — explicit Windows packaging smoke gate; requires all public Vite variables and should produce an MSI under `src-tauri/target/release/bundle/msi/`.

Keep `DataProvider`, `AppStateProvider`, `ProjectManagerProvider`, and `StateSyncBridge` behind the authenticated route shell. Public auth pages must not trigger authenticated data reads. Preserve the existing notification entry point and its Web Notification fallback, and do not change timer/task semantics without updating the TypeScript engine tests.
