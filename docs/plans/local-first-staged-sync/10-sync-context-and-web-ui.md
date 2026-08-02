# Task: Add sync state, controls, browser lifecycle triggers, and cross-tab refresh

## Classification

Type: T2: authenticated UI/lifecycle feature
Reasoning: The change spans a provider, global authenticated UI, and browser events, but all network work is delegated to one `DataAccess.sync` action and no platform-native code is involved. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Expose one authenticated sync action with pending/status/error UI, bootstrap automatically, replace focus/visibility pulls with sync triggers, attempt best-effort web pagehide sync, show the next-visit backstop banner, and refresh views—not Supabase—on cross-tab storage changes.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/state/SyncContext.tsx` | create |
| `src/components/SyncControls.tsx` | create |
| `src/App.tsx` | update |
| `src/state/SyncContext.test.tsx` | create |
| `src/components/SyncControls.test.tsx` | create |

## Step-by-Step Instructions

### 1. Own sync status and local revision in one provider

**File:** `src/state/SyncContext.tsx`

Create an authenticated provider directly inside `DataProvider` and outside `AppStateProvider`/`ProjectManagerProvider`:

```ts
export interface SyncContextValue {
    status: "idle" | "syncing" | "success" | "error";
    error: string | null;
    errorKind: "auth" | "sync" | null;
    pendingCount: number;
    initialized: boolean;
    revision: number;
    showUnsyncedBanner: boolean;
    sync(options?: Partial<SyncOptions>): Promise<SyncResult>;
    dismissUnsyncedBanner(): void;
}
```

Subscribe to `data.subscribe` to update pending/initialized state and increment a React `revision` used by consumer contexts to reread local staged views. Coalesce UI state around the underlying coordinator promise. Auth failures must be labeled and displayed; ordinary sync failures must not clear pending state.

Capture `data.pendingCount() > 0` once when the provider mounts and use that initial condition for the "previous visit" banner. New edits during the current visit are represented by the button indicator but do not retroactively become a previous-visit banner. Clear the banner after a successful clean sync; allow dismissal without clearing staged data.

### 2. Bootstrap and centralize focus/visibility triggers

**File:** `src/state/SyncContext.tsx`

On authenticated mount, call `sync({reason:"bootstrap"})`. Register exactly one `window.focus` listener and one `document.visibilitychange` listener; visible state calls `sync({reason:"visibility"})`. Remove duplicate listener ownership from app/PM contexts in later tasks. Triggering sync when there are no pending local changes is still required because it pulls remote changes.

Errors from automatic triggers update status/error but must not create unhandled promise rejections.

### 3. Add web best-effort pagehide behavior

**File:** `src/state/SyncContext.tsx`

Use `isTauri()` from `@tauri-apps/api/core` to register `pagehide` only for web/PWA. The handler calls `void data.sync({reason:"pagehide",bestEffort:true}).catch(() => undefined)`. Do not use service workers, Background Sync, `beforeunload` blocking, service-role credentials, or a delivery-guarantee message.

### 4. Refresh local views on other-tab writes without auto-sync

**File:** `src/state/SyncContext.tsx`

Register a browser `storage` listener filtered to the current owner's exported staging key. On a matching event call `data.reloadFromStorage()`, refresh pending/initialized state, and increment `revision`. Do not call `sync`. Ignore PM UI and Supabase auth-key events.

### 5. Render global controls and the next-visit banner

**File:** `src/components/SyncControls.tsx`

Render an accessible "Sync data" button suitable for `TopNav`. Show a numeric badge when `pendingCount > 0`, disable while syncing, and expose idle/syncing/success/error states in visible text or an adjacent live region. Manual clicks call `sync({reason:"manual"})`. Show auth-specific copy that tells the user to reauthenticate/retry without claiming staged data was lost.

Export a banner component for the authenticated shell: "Unsynced changes from your previous visit" with "Sync now" and dismiss controls. The banner is a backstop, not a success guarantee.

### 6. Mount providers and UI behind authentication

**File:** `src/App.tsx`

Use this order:

```tsx
<DataProvider dataAccess={dataAccess}>
    <SyncProvider>
        <AppStateProvider>
            <ProjectManagerProvider>
                <StateSyncBridge />
                {/* authenticated shell */}
            </ProjectManagerProvider>
        </AppStateProvider>
    </SyncProvider>
</DataProvider>
```

Place the button in `TopNav` before sign-out and the banner below navigation on every authenticated route. Public auth pages must not mount the data or sync providers.

### 7. Component-test triggers and UI states

**Files:** `src/state/SyncContext.test.tsx`, `src/components/SyncControls.test.tsx`

Test bootstrap, focus, visible-only visibility, pagehide web-only behavior, storage-event local reload with zero sync calls, pending updates, banner initial-only semantics, button calls/statuses, success, ordinary error, auth error, retry, and clean-store no-banner behavior. Mock `isTauri` using the existing PWA-test pattern.

## Edge Cases to Handle

- React StrictMode effect replay must not produce overlapping bootstrap pushes; coordinator coalescing remains the final guard.
- Hidden visibility events do nothing.
- `pagehide` after sign-out/provider unmount must have no listener.
- Other-owner staging keys and `event.key === null` from `localStorage.clear()` must not auto-sync; a clear may reload only the current local view as uninitialized.
- Success state should return to idle when a new local edit arrives, while retaining the new pending count.

## Related Files (read-only context)

- `src/pwa/registerServiceWorker.ts` - established `isTauri()` usage
- `src/state/DataContext.tsx` - data-access injection
- `src/auth/RequireAuth.tsx` - authenticated mount boundary
- `src/App.tsx` - current top navigation and provider order

