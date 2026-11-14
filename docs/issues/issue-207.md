# Title: Shell-level calendar busy snapshot for pet schedule reflow

## Tags

Complexity Classification: T2
Classification Reason: A new provider wired to an already-existing data-access method, with an async refresh lifecycle but no schema, API or server change. The complexity sits in the refresh triggers (mount, focus, rollover, settings edges, last-write-wins) and in the fail-soft rule, not in new domain logic.

Severity: Medium
Severity Reason: This provider decides whether the deck and reminders see busy time at all, and an incorrect clear-on-failure or stale overwrite would visibly un-shift the deck and could resurrect notifications. It is pure wiring and fully reversible.

Needs research before implementation: Yes

### Research Needed

Confirm the hosting and failure semantics before writing the provider:

- That `AuthenticatedShell` (`src/App.tsx:149-181`) has the `session` needed to construct `SupabaseGoogleCalendarDataAccess`, and whether the provider should receive the instance or build it like `ProjectManagerRoute` does.
- The exact `GoogleCalendarBusyResult` shape and error surface: `intervals`, `refreshedAt`, `sources[]`, `blocks[]`, and the `GoogleCalendarIntegrationError` codes (`GOOGLE_TOKEN_INVALID`, `GOOGLE_RATE_LIMITED`, `NETWORK_ERROR`) in `src/lib/data/GoogleCalendarDataAccess.ts`.
- Whether token refresh happens inside `fetchBusyIntervals`/the `google-calendar` Edge Function, so the provider does not need its own reconnect path.
- Any existing window-focus or visibility refresh convention in the shell to follow (for example in `src/state/SyncContext.tsx` or `AppStateContext`).
- How to detect "no connection" and "no selected calendar ids" cheaply without an extra round trip, e.g. from `sources[]` or connection state.

## Summary

Calendar busy time already exists in the app, but only inside the PM planner route: `ProjectManagerRoute` and `AuthenticatedIntegrationsRoute` each construct their own `SupabaseGoogleCalendarDataAccess` in `src/App.tsx`, so no shell-level component can read availability. `fetchBusyIntervals({ timeMin, timeMax })` already returns per-account attributed busy intervals for the schedule day in one call, and the `google-calendar` Edge Function's `eventInterval()` already drops all-day, transparent, cancelled and WorkTime-pushed events. No server change is needed.

This issue adds a provider in the authenticated shell (beside the existing pet providers) that owns one busy-interval snapshot and exposes it to both `PetReminderProvider` and the pet deck. It is issue 2 of 4 in dependency order and requires #206's busy interval types. It is consumed by #208 (deck UI) and #209 (deferred reminders).

## Steps to Reproduce Context

1. Connect Google Calendar with at least one selected calendar containing a timed meeting today.
2. Open the Pet page or leave the app idle on Today until a reminder is due.
3. Observe that no component outside the PM and Integrations routes has any access to availability, and nothing caches busy time for the schedule day.

## Requirements for completed issue

1. A provider in the authenticated shell owns a single busy-interval snapshot and exposes it through a hook usable by both `PetReminderProvider` and the pet deck.
2. The provider constructs its own `SupabaseGoogleCalendarDataAccess` instance (the per-route instances cannot be reused, because the reminder provider ticks above every route) and never shares or mutates another route's instance.
3. It resolves `[dayStart, dayEnd]` with `resolvePetScheduleDay` from the current `start_of_day` / `end_of_day` settings and calls `fetchBusyIntervals` once for that range.
4. The snapshot holds `{ intervals, refreshedAt, status }` where `status` distinguishes loading, ok, empty and unavailable.
5. Refresh triggers: mount, window focus, manual refresh, schedule-day rollover, and a settings change that moves a day edge. The one-second tick never triggers a fetch.
6. On failure the last good snapshot is kept and an unavailable state is surfaced; intervals are never cleared on error, because clearing would visibly un-shift the deck and could resurrect notifications.
7. With no Google connection, or a connection with no selected calendar ids, the provider yields an empty snapshot silently (no notice, no hint).
8. The snapshot object is referentially stable between refreshes so a one-second tick consumer does not re-render.
9. The provider works in both the browser PWA and the Tauri webview with no new credentials, no service-role usage and no push/background-sync behaviour.

## Expected Behavior

- Mounting the authenticated shell fetches busy intervals for the current schedule day exactly once.
- Returning focus to the window refreshes the snapshot; overlapping focus events resolve last-write-wins with no stale snapshot overwriting a newer one.
- Changing `start_of_day` or `end_of_day` re-resolves the range and refetches, so the range and the consumed reflow move together.
- Crossing the schedule-day rollover refreshes the range without any user action.
- `GOOGLE_TOKEN_INVALID` produces an unavailable notice with no reconnect call to action (Integrations owns reconnecting), and the previous intervals stay in place.
- A partial fan-out where one account fails and others succeed still yields intervals from the healthy accounts; `sources[]` carries the failure.
- A day edge already in the past, or a boundary pair that crosses midnight, still produces a valid range.
- With no connection configured the snapshot is empty and the rest of the app is unchanged.

## Actual Behavior

- Availability fetching is confined to the PM planner and Integrations routes; no shell-level consumer can read busy time.
- Nothing caches busy intervals for the pet schedule day, and nothing refreshes on focus or day rollover.
- Google connection state is not consulted outside those routes, so "no calendar configured" has no shell-level representation.

### Testing

- `pnpm test:unit` with a new `src/state/CalendarBusyContext.test.tsx`:
  - fetch once on mount with a range derived from the configured day edges.
  - no fetch from a one-second tick.
  - focus refresh, manual refresh, settings-edge change and rollover each refetch.
  - failure keeps prior intervals and reports unavailable; `GOOGLE_TOKEN_INVALID` maps to unavailable without a reconnect action.
  - no connection / empty selected calendars yields empty status silently.
  - partial `sources[]` failure still returns intervals.
  - overlapping fetches resolve last-write-wins; a stale response never replaces a newer one.
  - snapshot reference is stable between refreshes; `usePetReminder`-style consumers do not re-render on tick.
- `pnpm test:unit` for the reminder provider and pet page consumers still passing after the wiring change.
- `pnpm run build` and `pnpm test:platform` pass.

## Issue Context

### New Files

`src/state/CalendarBusyContext.tsx` — owner of the shell-level busy snapshot. Suggested shape:

```tsx
export type CalendarBusyStatus = "loading" | "ok" | "empty" | "unavailable";

export interface CalendarBusySnapshot {
    /** Clipped raw intervals for the resolved schedule day; never persisted. */
    intervals: Array<{ start: string; end: string }>;
    refreshedAt: string | null;
    status: CalendarBusyStatus;
    /** Resolved window the snapshot belongs to. */
    dayStart: Date;
    dayEnd: Date;
}

export interface CalendarBusyContextValue {
    snapshot: CalendarBusySnapshot;
    /** Manual refresh; also used by the deck's refresh control. */
    refresh(): void;
}

export const CalendarBusyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => { /* ... */ };
export function useCalendarBusy(): CalendarBusyContextValue;
```

### Change Files

#### `src/App.tsx` — provider placement

Code Source: `src/App.tsx:149-181`
Code Description: `AuthenticatedShell` builds the owner-scoped provider stack; `PetProvider > PetActivityProvider > PetReminderProvider` wraps the routed content.
Code Change Description: Insert `CalendarBusyProvider` above `PetReminderProvider` so both the reminder provider and routed pet content read the same snapshot. Construct the `SupabaseGoogleCalendarDataAccess` inside the provider the way `ProjectManagerRoute` (`src/App.tsx:111`) and `AuthenticatedIntegrationsRoute` (`src/App.tsx:120`) do.

```tsx
<PetProvider>
    <PetActivityProvider>
        <CalendarBusyProvider>
            <PetReminderProvider>
                {/* ...existing ResumeMemoProvider, StateSyncBridge, shell chrome, Outlet... */}
            </PetReminderProvider>
        </CalendarBusyProvider>
    </PetActivityProvider>
</PetProvider>
```

#### `src/lib/data/GoogleCalendarDataAccess.ts` — consume only

Code Source: `src/lib/data/GoogleCalendarDataAccess.ts:37-42`, `:347-363`
Code Description: `fetchBusyIntervals` returns `{ intervals, refreshedAt, blocks?, sources? }`; `GoogleCalendarIntegrationError` carries a known code set.
Code Change Description: No change expected. The provider consumes `intervals`, `refreshedAt` and `sources`; only extend this file if a busy-specific error classification proves necessary.

```ts
export interface GoogleCalendarBusyResult {
    intervals: GoogleCalendarInterval[];
    refreshedAt: string;
    blocks?: GoogleCalendarBusyBlock[];
    sources?: GoogleCalendarSource[];
}

async fetchBusyIntervals(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarBusyResult>
```

#### `src/lib/pets/schedule.ts` — day resolution only

Code Source: `src/lib/pets/schedule.ts:33-44`
Code Description: `resolvePetScheduleDay(now, startOfDay, endOfDay)` returns the resolved `{ dayStart, dayEnd }` for the current schedule day.
Code Change Description: No change; the provider calls it to build the fetch range and consumers pass the same bounds into `buildPetSchedule`.

```ts
export function resolvePetScheduleDay(
    now: Date,
    startOfDay = DEFAULT_START_OF_DAY,
    endOfDay = DEFAULT_END_OF_DAY,
): { dayStart: Date; dayEnd: Date }
```

#### `supabase/functions/google-calendar/googleCalendarApi.ts` — reference only

Code Source: `supabase/functions/google-calendar/googleCalendarApi.ts:118-131`
Code Description: `eventInterval()` already drops cancelled, transparent and WorkTime-pushed events and all-day events (no `dateTime`).
Code Change Description: None. Documenting that no server change is required and that a second definition of "my calendar" must not appear.

## Notes

- Dependencies: #206 (busy interval types).
- Deliberately out of scope: event titles or any events-API dependency, a settings toggle, persisting shifts, pushing pet items to the calendar, Start-of-Day planner awareness in either direction, pet-vs-pet blocking, and background polling.
