## Title: Google Calendar Integration

## Tags

Complexity Classification: T4
Severity: Medium
Reason: Full epic spanning multiple systems (planner engine, integration UI, data access layer, Supabase migration/RLS RPCs, a new Edge Function, OAuth token handling) plus an external dependency with irreversible side effects (pushed calendar events). Blast radius and behavioral risk (OAuth security, RLS, idempotent push lifecycle) justify the epic tier.
Needs research before implementation: Yes — Google OAuth token storage/refresh strategy within the existing Shortcut-integration pattern, the Google Calendar freebusy/event API shape and conflict/idempotency semantics, and how busy intervals feed `calculateWorkBudget` without breaking the pure-engine rule (wall-clock/network-free).

## Summary

Integrate Google Calendar with WorkTime under the philosophy "reading is ambient; writing is always deliberate." (1) Busy time from selected calendars is subtracted from the planner's available work window before computing `workBudgetPomos`, so real meetings reduce the day's planned work. (2) Each task can be explicitly, opt-in pushed to a dedicated "WorkTime" calendar as a blocked focus-time event, upgraded lazily from read-only to read+write OAuth scope. WorkTime never pushes or syncs anything on its own; calendar data stays out of `pm_state` and the staging store, and event titles are never persisted.

## Steps to Reproduce Context

1. This is a new feature against an existing placeholder: the `google-calendar` entry in `src/lib/integrations/registry.ts` (lines 14-22) is registered with `authFlow: "oauth2"` but `isPlaceholder: true`, and renders as a disabled "Coming soon" card in `src/components/IntegrationsPage.tsx`.
2. The planner currently computes the work budget without any calendar awareness (`calculateWorkBudget` in `src/lib/engine/plannerContext.ts`, lines 90-94, sets `workBudgetPomos` at line 216).
3. The Shortcut integration is the established pattern to mirror for token storage/refresh and Edge Function access (`supabase/migrations/20260812000000_shortcut_settings.sql`, `supabase/functions/shortcut-sync/index.ts`, `src/lib/data/ShortcutDataAccess.ts`).

## Expected Behavior

- Feature 1 (busy-time shaping): On demand (plan generation or manual refresh), the backend queries Google's `freebusy` endpoint for busy intervals between `now` and `workUntil` for user-selected calendars; recurring events are expanded server-side (no RRULE parsing). Intervals are reduced to start/end times and subtract from the window before pomodoro conversion. All-day events are excluded. Pushed WorkTime events (marked with a `worktime:taskId` extended property) are excluded from the busy computation to avoid double-counting.
- Feature 2 (per-task push): Clicking "push" on a task lazily (a) upgrades OAuth scope read-only → read+write via same-window redirect (popups are fragile in the Tauri webview; the pending task survives the round-trip), (b) creates the dedicated "WorkTime" calendar if missing, (c) inserts an event titled from the task with duration `estimatePomos × workMinutes` on the due/selected date, each step idempotent and independently recoverable, (d) stores event-id + calendar-id linkage for UI push status, and (e) warns on conflict with a real busy event before inserting. Updates are user-driven only: a changed estimate after push shows an "out of sync" state with an explicit resync action; un-pushing deletes the event; a WorkTime calendar deleted in Google is recreated on next push.
- OAuth: PKCE + auth-code exchange in an Edge Function (client secret never in the browser); refresh token stored server-side mirroring the Shortcut pattern (`save_shortcut_settings` RPC + Edge Function fetch); access tokens refreshed silently server-side. Two-tier connection state: "Connected — read only" vs "Connected — can schedule," with a subtle upgrade affordance only on first push attempt.
- Constraints: no background sync; no Tauri `invoke` data paths; engine stays pure (rounding/budget logic pure TypeScript, unit-tested, no network/wall-clock); event titles never stored, only busy intervals and task-linkage metadata.

## Actual Behavior

No Google Calendar functionality exists. The `google-calendar` integration is a placeholder (`isPlaceholder: true`) with no OAuth flow, no token storage, no Edge Function, and no effect on the planner budget. The planner's `workBudgetPomos` accounts only for the `now` → `workUntil` window divided by `work_minutes`, with no awareness of busy events.

## Requirements for completed issue

1. A user can connect Google Calendar with read-only OAuth scope (`calendar.readonly`), see a "Connected — read only" state, and the planner's `workBudgetPomos` is reduced by busy time from user-selected calendars (all-day events excluded, WorkTime-linked events excluded), computed on demand/manual refresh with no background sync.
2. The planner busy-time logic is pure TypeScript in the style of `plannerContext`, unit-tested (colocated `*.test.ts`, Vitest), deterministic (caller supplies `now`), and free of network/wall-clock dependencies.
3. A user can opt-in, per task, push a blocked focus-time event to a dedicated "WorkTime" calendar, with lazy scope upgrade (read-only → read+write via same-window redirect, pending task preserved), calendar auto-creation, idempotent/recoverable insert steps, linkage stored for UI push status, and conflict warning against real busy events before insert.
4. Push lifecycle is user-controlled: estimate changes after push surface an "out of sync" state with an explicit resync action; un-pushing deletes the event; a WorkTime calendar deleted directly in Google is recreated on next push rather than erroring.
5. OAuth refresh tokens are stored server-side under RLS mirroring the Shortcut pattern (narrow security-definer RPC; never selectable by clients; read only by a service-role Edge Function); access tokens refresh silently server-side; PKCE code exchange happens in the Edge Function so no client secret reaches the browser.
6. Calendar data respects existing constraints: no Tauri `invoke` data paths (all token storage and Google API calls via Supabase Edge Functions + RLS-guarded tables like Shortcut); event titles never persisted (only busy intervals and task-linkage metadata); the staging store (`worktime:staging:v1:*`) and `pm_state` remain free of calendar data.

## Context

- Files:
  - `src/lib/engine/plannerContext.ts` — `calculateWorkBudget` (lines 90-94), `calculatePomodoroBudget` (lines 96-104), `buildPlannerContext` setting `workBudgetPomos` (line 216); `PlannerContextInput` (lines 12-19).
  - `src/lib/engine/plannerContext.test.ts` — colocated pure-engine Vitest test style to follow.
  - `src/lib/integrations/registry.ts` — `google-calendar` placeholder entry (lines 14-22).
  - `src/components/IntegrationsPage.tsx` — renders placeholder card as disabled "Coming soon".
  - `src/lib/data/ShortcutDataAccess.ts` — client data-access pattern to mirror (connect/updatePreferences/disconnect/sync).
  - `supabase/migrations/20260812000000_shortcut_settings.sql` — `shortcut_settings` table + RLS + `save_shortcut_settings` security-definer RPC pattern to mirror (extended by `...020000`, `...030000` incl. `update_shortcut_preferences`, `...040000`, `...050000`).
  - `supabase/functions/shortcut-sync/index.ts` — service-role Edge Function pattern for token read + upstream fetch + `last_synced_at`.
  - `src/state/types.ts` — `PMTask` (lines 33-54) with `title`, `dueDate?`, `estimatePomos?`; `Settings.work_minutes` (line 112, default 25).
  - `src/lib/data/staging/LocalStagingStore.ts` / `types.ts` — `worktime:staging:v1:*` staging store; must remain free of calendar data.
  - `supabase/README.md` (lines 60-93) — documented Shortcut token pattern and RLS rule (selecting `shortcut_token` intentionally denied).

- Code Snippets:
  - `src/lib/engine/plannerContext.ts` lines 90-94:
    ```ts
    function calculateWorkBudget(now: Date, workUntil: Date | null, workMinutes: number): number {
        if (!workUntil || !Number.isFinite(workMinutes) || workMinutes <= 0) return 0;
        const minutesAvailable = (workUntil.getTime() - now.getTime()) / 60000;
        return Math.max(0, Math.floor(minutesAvailable / workMinutes));
    }
    ```
  - `src/lib/engine/plannerContext.ts` line 216:
    ```ts
    workBudgetPomos: calculateWorkBudget(now, workUntil, input.settings.work_minutes),
    ```
  - `src/lib/integrations/registry.ts` lines 15-22:
    ```ts
    {
        id: "google-calendar",
        name: "Google Calendar",
        description: "Bring calendar events into WorkTime and keep focused work visible on your schedule.",
        icon: "calendar",
        authFlow: "oauth2",
        isPlaceholder: true,
    },
    ```

## Notes

- The Google entry in `registry.ts` was explicitly designed to be flipped: `authFlow: "oauth2"` is already set; implementation replaces `isPlaceholder: true` with a real card/data access.
- No existing freebusy/Google API code exists beyond the placeholder registry entry; matching hits in the repo are unrelated (workbox-google-analytics dep, seed user email, GoTrue config comments).
- Calendar data sensitivity: only busy intervals and task-linkage metadata may be persisted; event titles must not enter `pm_state`, the staging store, or logs.
- The OAuth re-login frequency answer depends on the Google Cloud Console app status: while "Testing," refresh tokens expire every 7 days; exiting testing mode is a console setting (not code) that turns "reconnect weekly" into "reconnect never."
- External side effects are not cleanly reversible (pushed calendar events), reinforcing the requirement to keep push explicit, opt-in, idempotent, and user-controlled.