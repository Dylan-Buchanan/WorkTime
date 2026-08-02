# Task: Prompt for sync on Tauri close without commands or new dependencies

## Classification

Type: T2: constrained native/frontend lifecycle handshake
Reasoning: The task crosses Rust and React and must avoid a close-event loop, but it uses the existing Tauri core event/window APIs, a two-event protocol, and static platform validation. Blast Radius=2, Uncertainty=1, Behavior=5, Testing=2, Reversibility=1. Total=11.

## Goal

Intercept native close requests, keep the window alive while authenticated pending data can be synced or skipped, and then allow exactly one frontend `window.close()` call. Login/public pages must still close immediately and no Tauri command, invoke handler, plugin, Cargo dependency, or data path may be added.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src-tauri/src/lib.rs` | update |
| `src/lib/platform/tauriClose.ts` | create |
| `src/state/TauriCloseContext.tsx` | create |
| `src/App.tsx` | update |
| `src/state/TauriCloseContext.test.tsx` | create |
| `scripts/verify-platform-cleanup.mjs` | update |

## Step-by-Step Instructions

### 1. Add a Rust allow-once close protocol

**File:** `src-tauri/src/lib.rs`

Import only Tauri traits/types plus `std::sync::atomic::{AtomicBool, Ordering}`. Keep the opener and notification plugin initializers. Register:

- a listener for frontend event `worktime-close-approved` that sets an allow-once atomic flag;
- `.on_window_event` handling `tauri::WindowEvent::CloseRequested { api, .. }`;
- when the flag is set, consume it and allow close;
- otherwise call the repository's actual Tauri 2.8 API `api.prevent_close()` and emit `worktime-close-requested` to the frontend window.

Use `tauri::Emitter`/`tauri::Listener`; do not add `#[tauri::command]`, `invoke_handler`, managed data APIs, serialization dependencies, or Cargo changes.

The allow-once branch is mandatory: calling `getCurrentWindow().close()` generates another close request, so an always-prevent handler would loop forever.

### 2. Isolate dynamic Tauri window/event calls

**File:** `src/lib/platform/tauriClose.ts`

Create a browser-safe adapter:

```ts
export interface TauriCloseAdapter {
    listen(handler: () => void): Promise<() => void>;
    approveAndClose(): Promise<void>;
}

export async function createTauriCloseAdapter(): Promise<TauriCloseAdapter | null>;
```

Return null when `isTauri()` is false. In Tauri, dynamically import `getCurrentWindow`, listen for `worktime-close-requested`, and implement `approveAndClose` as `await window.emit("worktime-close-approved"); await window.close();`. Await the emit before close so Rust sees the flag first.

### 3. Mount a root close provider that is safe on public routes

**Files:** `src/state/TauriCloseContext.tsx`, `src/App.tsx`

Mount `TauriCloseProvider` inside `AuthProvider` but outside authenticated `DataProvider`/routes. It owns the native listener and exposes registration for an optional authenticated sync handler:

```ts
export interface CloseSyncHandler {
    pendingCount(): number;
    syncForClose(): Promise<void>;
}
```

`SyncProvider` registers/unregisters that handler while authenticated. On a close request with no registered handler (login/signup/reset routes) or zero pending changes, approve and close immediately without data reads. With pending data, open a dialog.

The dialog offers:

- **Sync and exit**: call `sync({reason:"close"})`; close only on success;
- **Exit without syncing**: leave staged data intact, approve, and close;
- **Cancel**: dismiss and keep the window open.

If sync/auth fails, keep the dialog open, show the error, and retain retry/skip/cancel choices. Disable duplicate actions while syncing.

### 4. Extend the static platform gate

**File:** `scripts/verify-platform-cleanup.mjs`

Keep all existing assertions and add checks that `lib.rs` contains `WindowEvent::CloseRequested`, `prevent_close()`, both event names, and no command/invoke code. Assert `Cargo.toml` still contains only the retained dependency set relevant to the current gate. Do not require a new capability unless the existing `core:default` fails the actual Tauri build; if a narrower core event/window permission is required, document and assert only that exact permission.

### 5. Unit-test frontend close decisions

**File:** `src/state/TauriCloseContext.test.tsx`

Inject a fake adapter and handler. Cover public/no-handler immediate close, clean authenticated immediate close, dialog for pending work, sync-success close, sync-error stays open, auth-error copy, skip preserves pending work, cancel, duplicate close request, and listener cleanup. Assert `approve` precedes `close` in the fake call log.

## Edge Cases to Handle

- Closing on a public auth page must never become impossible because authenticated providers are absent.
- A second OS close request while the dialog is open must not open duplicate dialogs or approve unexpectedly.
- Sign-out while the dialog is open unregisters the sync handler; the next action must not access the old owner's store.
- The allow-once flag must be consumed by exactly one close request.
- Frontend adapter import/listen failures should log a concise warning and leave normal web behavior untouched.

## Related Files (read-only context)

- `src-tauri/Cargo.toml` - dependency guardrail
- `src-tauri/capabilities/default.json` - current `core:default` and retained plugin permissions
- `node_modules/@tauri-apps/api/window.d.ts` - installed `listen`, `emit`, and `close` APIs
- Tauri 2.8 local crate source - installed `CloseRequestApi::prevent_close()` contract

