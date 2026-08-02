# Validation

## Automated Checks

Run from `C:\Users\dylan\Desktop\Coding\VSCode\WorkTime` in PowerShell. Use only the local Supabase project for reset/migration tests.

```powershell
# Dependency/source baseline required by repository guidance
pnpm install

$env:VITE_SUPABASE_URL = "http://127.0.0.1:54321"
$env:VITE_SUPABASE_ANON_KEY = "<local anon key from npx supabase status -o env>"
$env:VITE_PUBLIC_APP_URL = "https://example.com"
pnpm run build

# Pure engine, staging, merge, coordinator, React, and platform-adapter tests
npm run test:unit

# Slim Tauri shell/static contract
npm run test:platform

# Production PWA build/manifest/service-worker/mobile metadata
npm run test:pwa
```

Start the local data services before database/browser tests:

```powershell
npm run supabase:start
npx supabase status
npx supabase functions serve invite-signup --no-verify-jwt --env-file supabase/.env.local
```

In another PowerShell window with the same public Vite variables:

```powershell
# Must run the historical migration replay with explicit --local safeguards,
# restore the latest local schema, then run Vitest integration suites.
npm run test:integration

# Browser flows click Sync data before direct server assertions.
npm run test:e2e

# Full aggregate gate after targeted failures are resolved.
npm run test:all
```

Expected results:

- Unit suites prove zero remote calls for commands, pull-before-push, timer CAS reconciliation, and all merge rules.
- Migration replay proves hosted-row backfill policy against a partial local schema and restores the latest schema even after failure.
- Integration RPC retries produce no duplicate logs and full wipe is atomic/PM-preserving.
- E2E flows remain responsive locally and server state changes only after sync.
- PWA and platform scripts print their existing passing messages plus the new close-handler checks.

## Manual Verification Steps

1. Verify offline/local command responsiveness.
    - Sign in and complete one successful bootstrap sync, then stop local Supabase/network access.
    - Create/edit a task, start/pause/resume/stop a timer, change settings, and edit PM data.
    - Expected: every interaction updates immediately; pending count rises; no command hangs on a network request; refresh/reopen retains staged changes.

2. Verify bootstrap safety on a fresh owner/browser storage.
    - Seed server data, remove only that owner's `worktime:staging:v1:<owner>` key, then make the first pull fail.
    - Expected: no server row is deleted/overwritten, sync shows an error, and retry after restoring the network first pulls the seeded data.

3. Verify manual sync and cross-tab behavior.
    - Open two tabs for one owner. Stage a change in tab A and click "Sync data".
    - Expected: tab A reaches success/pending zero; tab B's view refreshes from the storage event but tab B does not start a sync request automatically.
    - Make conflicting edits on different and identical task fields, sync in a controlled order, and confirm three-way/LWW results.

4. Verify live-timer protection.
    - Start a running local work timer, change remote timer state from another client, then trigger focus sync.
    - Expected: local running timer remains; remote tasks/logs/settings/PM merge. Pause the local timer and sync again; the LWW timer row may now merge.

5. Verify reset scope.
    - Create timer tasks/logs/settings and PM projects/estimates, then confirm Reset All Data.
    - Expected: local app state resets and one wipe is pending; PM remains. After sync, server tasks/logs are gone, settings/timer are defaults with `completed=false`, and `pm_state` is unchanged.

6. Verify web pagehide/backstop.
    - Stage a change, navigate/close quickly enough that best-effort sync cannot finish, then revisit.
    - Expected: staged data is present and the previous-visit unsynced banner appears. The UI never claims pagehide guaranteed delivery.

7. Verify auth refresh behavior.
    - Expire/invalidate the access token while retaining a refreshable session, stage a change, and sync.
    - Expected: one refresh and whole-sync retry succeeds. With refresh revoked, an auth error is visible and staged data remains pending.

8. Verify packaged Tauri close behavior.
    - Build/run the native app, stage a change, and close the window using the title-bar close button.
    - Expected: the dialog offers Sync and exit / Exit without syncing / Cancel. Failed sync keeps the dialog open. Skip closes while retaining staged data. A clean/public-login window closes without trapping the user.

## Build / Compilation

Build the Windows package only after all web/data gates pass:

```powershell
$env:VITE_SUPABASE_URL = "<production-or-approved-smoke URL>"
$env:VITE_SUPABASE_ANON_KEY = "<matching anon key>"
$env:VITE_PUBLIC_APP_URL = "https://<canonical-origin-without-trailing-slash>"
npm run tauri build
```

Expected: an MSI exists under `src-tauri/target/release/bundle/msi/`, both opener and notification plugins remain initialized, the close handshake compiles with no new Cargo dependency, and no `#[tauri::command]`/`invoke_handler` exists.

## Common Pitfalls

- Never run `npm run supabase:reset`, `supabase db reset --linked`, or the migration replay against a hosted project. The replay script must hard-code `--local`, verify a loopback Supabase URL, and restore the latest local schema in `finally`.
- Do not interpret `localStorage.clear()` or a missing staging key as an initialized empty server snapshot.
- Do not clear all pending work after a push; acknowledge exact values from the pushed revision so in-flight edits survive.
- Do not send completion-derived log/task/timer values through the generic batch RPC before `complete_timer` resolves that generation.
- Do not let both AppState and PM contexts re-add focus/visibility listeners; `SyncProvider` owns them once.
- Do not use the Tauri frontend `close()` without the Rust allow-once flag; it would emit another intercepted close request.
- Do not reintroduce PM reset through `SettingsPanel`, a null-remote seed push, a debounce flush, or an unmount flush.
- Do not make `storage` events, service workers, pagehide, or the close dialog into background/push synchronization.
