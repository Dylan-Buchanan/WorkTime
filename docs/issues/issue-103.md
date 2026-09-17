## Title: Pet care reminders & overdue toasts (app-open only)

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Touches the shared, carefully guarded notification entry point in `src/state/AppStateContext.tsx` (refactoring `maybeNotifyTimerEnd` through a shared `notifyNow` helper risks regressions in existing timer reminders), adds a scheduler effect behind the authenticated shell, and needs reminded-state dedup plus overdue-toast coordination with Issue C's toast system. Blast Radius=3 (notification context, new scheduler, pet state/page integration), Uncertainty=2 (reminded-mark persistence location, dedup edge cases, interaction with visibility guards), Behavior=4 (reminder semantics shared across the app's only notification path — the repo explicitly protects this entry point), Testing=2 (Tauri-mock-throws + Web Notification stub pattern exists but scheduler timing/dedup is hard to test), Reversibility=1. Total=12.
Needs research before implementation: Yes
Research needed: How `maybeNotifyTimerEnd` and the visibility guard are currently structured in `AppStateContext.tsx` so the `notifyNow` extraction preserves timer notification semantics exactly; where the "reminded" dedup state should live given it must survive refires but (per repo constraints) has no push/background-sync path.

## Summary

Route pet care-item reminders (scheduled items and the potty interval) through the app's existing single notification entry point, firing only while the app is open, plus an overdue toast when an item crosses overdue while the app is open. No push, no background sync, no native/Rust changes — the Tauri notification plugin and its Web Notification fallback already exist and must remain the one entry point.

## Steps to Reproduce Context

1. The pet schedule (Issue A/B) computes next-due times, but nothing fires when a potty interval elapses or a scheduled item becomes due.
2. The user gets absorbed in work while the app is open and misses care reminders entirely.
3. When a schedule item crosses overdue while the user is on the page, there is no toast (the persistent banner from Issue B exists but has no toast accompaniment).

## Expected Behavior

While the app is open, care reminders fire through the same notification entry point the timer uses (Tauri plugin in the desktop app, Web Notification fallback in the PWA). A toast appears when an item crosses overdue. Reminders do not refire for the same occurrence, and timer notifications continue to behave exactly as before.

## Actual Behavior

No care reminders exist; the notification entry point is used only by the timer; overdue items are silent beyond Issue B's banner.

## Requirements for completed issue

1. **Single entry point (preserved, not duplicated)**: extract a shared `notifyNow`-style helper from the module-level `notify`/`ensureNotification()` machinery in `src/state/AppStateContext.tsx` and route *both* the timer's `maybeNotifyTimerEnd` and the pet reminder scheduler through it. One permission-request path, one Tauri/Web fallback, for all notification sources. Timer notification semantics (including the `document.hidden`/`hasFocus` visibility guard and the `pomodoroFinish`/`breakOver` sounds) must be preserved — existing tests in `src/state/AppStateContext.test.tsx` must continue passing.
2. **Reminder scheduler**: an effect in a provider behind the authenticated shell (same constraint as `DataProvider`/`AppStateProvider`) compares engine next-due times (Issue A) against now on the existing 1-second-tick pattern, and fires a reminder when an item comes due. A potty interval reminder follows the interval anchor (latest potty record); a post-wake pull-forward (from the nap flow) re-anchors its reminder automatically because it reads computed engine state.
3. **App-open only (repo constraint)**: no push notifications, no background sync, no service-worker notification handling, **no changes in `src-tauri/`** (plugin, capabilities, and `verify-platform-cleanup.mjs` guards stay untouched). Reminders simply do not exist when the app is closed — this is accepted and intentional.
4. **No refire**: once a reminder for a given occurrence has fired, mark that occurrence as reminded so it does not repeat on every tick (dedup state persisted via the staging-store/data-access pattern, schema plumbing landing with Issue G). If the underlying schedule state changes (correction, nap reflow, new record), the dedup logic must not suppress a genuinely new occurrence.
5. **Overdue toast**: when a schedule item crosses overdue while the app is open, a toast fires using **Issue C's toast subsystem** (not a second mechanism). The persistent overdue banner remains owned by Issue B; this issue only adds the toast on the crossing moment.
6. **No quiet hours, no catch-up digest** (decided): reminders fire regardless of time of day while the app is open; there is no "here's what you missed" summary on reopen.
7. **Permission flow**: reuse the existing implicit request-permission flow inside `ensureNotification()`; do not add a new settings UI for permissions.
8. Optional sound: pair with `useSounds` (`src/hooks/useSounds.ts`) using the existing SoundKey extension pattern — one care-reminder sound, only if trivial to add.
9. Tests: follow `src/state/AppStateContext.test.tsx` lines ~246–263 — mock the Tauri plugin module to throw, stub the global `Notification` class, assert Web-fallback delivery; use `resetNotifyForTesting()` between tests. Cover: reminder fires at due time, does not refire, re-arms after a correction/new record, overdue toast fires once per crossing.

## Context

- Files:
  - `src/state/AppStateContext.tsx` (lines 10–30, 89–101, 179–190) — the module-level `notify`/`ensureNotification()`, the visibility guard, and the 1-second tick + expiry effect that is the scheduling pattern to copy.
  - `src/types/notification.d.ts` — hand-written Tauri plugin API declaration (`sendNotification({ title, body? })`).
  - `src/hooks/useSounds.ts` — sound extension pattern.
  - `src/pwa/registerServiceWorker.ts` — confirms no SW notification handling exists and none should be added.
  - `scripts/verify-platform-cleanup.mjs` — the platform check that would fail if `src-tauri/` notification wiring were touched.
- Code Snippets:

  The entry point being extended (`src/state/AppStateContext.tsx`):
  ```ts
  let notify: ((opts: { title: string; body?: string }) => void) | null = null;
  async function ensureNotification() { /* Tauri plugin first, Web Notification fallback in catch */ }
  ```

  The scheduling pattern to copy (`AppStateContext.tsx`, lines ~179–188):
  ```ts
  // 1-second tick drives an effect comparing timer.ends_at against Date.now();
  // care reminders follow the same tick pattern against engine next-due times
  ```

## Notes

- The existing pattern suppresses notifications when the app is visible/focused (in-app users get the sound instead). Decide consciously whether care reminders adopt the same guard or fire regardless of focus; either is acceptable, but write the choice down — the timer guard must not change behavior either way.
- This issue is deliberately ordered after C (toast subsystem) and works best after B (UI state to observe), but its scheduler only needs Issue A's computed next-due state.
