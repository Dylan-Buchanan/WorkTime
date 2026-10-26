# Title: Frontend — Google Calendar multi-account management UI, attribution, and planner integration

## Tags

Complexity Classification: T3
Classification Reason: Frontend-only, but a cross-module contract rewrite. The data layer (`src/lib/data/GoogleCalendarDataAccess.ts`) changes its primary read from `loadSettings()` to a connections contract, adds error codes and validators, and re-keys every RPC call; three consumer components (`GoogleCalendarIntegrationCard`, `GoogleCalendarTaskSection`, `AgentPanel`) plus the OAuth return parser and the resume plumbing in `ProjectManagerPage` change with it, and five test files must be updated or extended. It defines no schema, RLS, or auth rules itself.

Severity: High
Severity Reason: Two user-visible failures are silent. If a second account's busy time is omitted, Start-of-Day budgets are wrong without any error; if a push goes to the wrong account, a focus event is written to the wrong Google calendar and then attributed to the wrong account on every later unpush/resync. Not Critical because no data-model or credential boundary lives here.

Needs research before implementation: Yes

### Research Needed

This issue consumes a backend contract that does not exist in the codebase yet. It should not start until #127 has fixed the connection shape; the open questions are about how this repository's existing screens express the new data, not about the backend itself.

- Confirm the row shape `loadConnections()` will return: `id`, account email, `scopeLevel`, `selectedCalendarIds`, `isSchedulingTarget`, `worktimeCalendarId`, and whether token validity is a field or only inferable from a failed call.
- Confirm how the fan-out response attributes events: `connection_id`/`account_email` on each event, and what a legacy row with no identity looks like before the server-side backfill in #127 runs.
- Confirm the `sources[]` shape emitted by `busy` and how a per-source error code should map to a user-facing reconnect prompt.
- Confirm how `connection_id` round-trips through `google-calendar-auth` without putting the account email in the URL, and whether an "add account mid-resume" can be distinguished from a targeted upgrade using only the returned keys.
- Read `src/components/GoogleCalendarIntegrationCard.test.tsx`, `src/components/ProjectManager/GoogleCalendarTaskSection.test.tsx`, `src/state/AgentApprovalContext.test.tsx`, `src/lib/data/GoogleCalendarDataAccess.test.ts`, and `src/lib/integrations/googleCalendarOAuthReturn.test.ts` to see how each mock is built before changing the interface.

## Summary

Once more than one Google account can be connected (backend #127), every screen that assumes "the" connection is wrong. `loadSettings()` returns a single object, the integration card renders one scope badge and one calendar picker, the week strip has no notion of provenance, and the task inspector's push path cannot tell which credential set should own the event.

Without this issue the backend capability is unreachable, and Start-of-Day budgets silently omit the second account's calendars. The work is: widen the data-access contract, turn the card into an account list, attribute events to their account in the week strip, make the task section push against the scheduling account (including a targeted scope upgrade), and make the agent panel report merged busy time with per-account degradation.

Parent request: #121. Backend contract: #127 (blocking).

## Steps to Reproduce Context

1. Connect a Google account and open `/integrations`. `GoogleCalendarIntegrationCard` shows one scope badge ("Connected — read only"), one "Busy-time calendars" picker, and one disconnect control.
2. Open the week strip inside that card. Each event renders with a title and time only; nothing records which Google account it came from.
3. Open a project task. `GoogleCalendarTaskSection` calls `loadTaskLink(task.id)`, which returns `taskId`, `calendarId`, `eventId`, and schedule bounds — there is no account anywhere in `GoogleCalendarTaskLink`.
4. Start the day from `AgentPanel`. `fetchCalendarBusy` calls `loadSettings()` and then `fetchBusyIntervals(...)`, and reports "Calendar refreshed: N busy minutes." A second account's calendars are simply absent from that number, with no indication they were skipped.
5. Attempt a push from a read-only account. `beginAuthorization({ scopeLevel: "schedule", returnTo, pendingTaskId, pendingScheduledStart })` carries no connection, so the upgrade cannot name which account it is upgrading.
6. Disconnect. `disconnect()` has no argument and removes every connection for the owner.

## Expected Behavior

- The integration card lists every connected Google account as a row with its own email, scope badge, calendar picker, disconnect, and reconnect-when-invalid, plus an "Add Google account" action that is disabled at the cap with an explanation.
- Exactly one row is marked as the account used for focus events, and that choice is unambiguous and changeable.
- Week-strip events carry a visible account chip whose label does not depend on colour alone and whose hover title names the account email.
- A pushed task shows which account owns its event; push, resync, and unpush act on that account, and a read-only account offers a scope upgrade that targets that specific connection so the resume pushes to the right account.
- The agent panel reports busy minutes merged across accounts, names how many accounts contributed, and warns per account when one needs reconnecting — with the reconnect action targeting that account.
- Copy that assumes a single connection is gone.
- Losing one account does not make the whole calendar surface look broken.

## Actual Behavior

- `GoogleCalendarDataAccess` exposes `loadSettings(): Promise<GoogleCalendarSettings | null>`; there is no notion of a connection list, a scheduling target, or a per-connection disconnect.
- `GoogleCalendarIntegrationCard` holds a single `settings` state and renders one badge, one picker, and one disconnect for the whole owner.
- `GoogleCalendarEvent` has `{ id, title, start, end, allDay }` and `GoogleCalendarTaskLink` has no account attribution, so the week strip and the task section cannot show provenance.
- `GoogleCalendarIntegrationErrorCode` has no `GOOGLE_ACCOUNT_LIMIT_REACHED`, `GOOGLE_CONNECTION_NOT_FOUND`, or `GOOGLE_SCHEDULING_ACCOUNT_REQUIRED`, so those server errors fall through to `NETWORK_ERROR` in `mapFunctionError`'s `KNOWN_CODES` check and render as a generic failure.
- `AgentPanel` derives its whole calendar flow from one settings object and reports a single minute count.
- `GoogleCalendarTaskSection`'s empty state tells the user to "Connect Google Calendar in Integrations" with no account context.

## Requirements for completed issue

1. `GoogleCalendarDataAccess` replaces `loadSettings()` with `loadConnections()`, and every method is account-aware: `beginAuthorization` accepts an optional `connectionId`; `updateSelectedCalendars(connectionId, ids)`; a new `setSchedulingConnection(connectionId)`; `fetchBusyIntervals` returns merged intervals plus `sources[]`; `loadTaskLink` returns the owning `connectionId`/`accountEmail`; `disconnect(connectionId?)` accepts an optional target.
2. `GoogleCalendarIntegrationErrorCode` gains `GOOGLE_ACCOUNT_LIMIT_REACHED`, `GOOGLE_CONNECTION_NOT_FOUND`, and `GOOGLE_SCHEDULING_ACCOUNT_REQUIRED`, and each is mapped from the Edge Function response rather than collapsing to `NETWORK_ERROR`. Response validation covers unknown connection ids.
3. `GoogleCalendarIntegrationCard` renders an account list inside the single existing card: per-row account email, scope badge, "Use for focus events" radio, per-row calendar picker grouped under its account with a 50-per-account cap, per-row disconnect, and per-row reconnect when that account's token is invalid. An "Add Google account" button is disabled at 5 with an explanatory label.
4. The zero-connection state keeps the current "Connect read only" entry point.
5. The week strip merges events across accounts and shows a small account chip (stable initial and colour keyed by `connection_id`) on each event, with the account email in the event's hover title. Account-less legacy rows render a neutral "Unidentified" chip until backfill lands. The chip's accessible name does not rely on colour alone.
6. `GoogleCalendarTaskSection` shows which account owns a pushed task's event, pushes against the scheduling account, and — when that account is read-only — requests a scope upgrade targeting that connection with the pending task, so the resume pushes to the right account exactly once. `unpush` and `resync` target the link's own connection, not the current scheduling target.
7. `AgentPanel` uses `loadConnections()` for merged busy time, reports "Calendar refreshed: N busy minutes across M accounts", and surfaces per-account degradation warnings that name the account needing reconnection, with the reconnect button targeting that connection.
8. Copy that assumes one connection is corrected throughout: "Select busy-time calendars" becomes per-account, "Connected — read only" becomes per-row, "Connect Google Calendar in Integrations" becomes an account choice.
9. No account identity (email or id) is written into the OAuth return URL, and the existing return parser/consumer continues to strip every return key it reads.
10. Existing tests are updated and extended: card (two accounts, cap reached, per-row invalid token, scheduling radio), task section (account-scoped unpush, targeted upgrade), agent panel (partial-failure warning, merged minutes), data access (response validation, unknown connection id), and OAuth return parsing.

### Testing

- `pnpm test:unit` — `src/components/GoogleCalendarIntegrationCard.test.tsx`: two accounts render two rows with distinct emails and badges; the radio marks exactly one scheduling row and switching it calls `setSchedulingConnection`; a sixth account is not offered (button disabled with the explanatory label); `GOOGLE_TOKEN_INVALID` on one row renders reconnect for that row only; a per-row picker enforces its own 50 cap; the zero-connection state still shows "Connect read only".
- `pnpm test:unit` — `src/components/ProjectManager/GoogleCalendarTaskSection.test.tsx`: a link owned by a non-target connection renders that account; `unpush` is called for the link's connection while the target is a different connection; a read-only scheduling account triggers `beginAuthorization` with `connectionId` plus `pendingTaskId`/`pendingScheduledStart`; the resume effect pushes exactly once and to the advertised connection.
- `pnpm test:unit` — `src/state/AgentApprovalContext.test.tsx`: merged busy minutes across two accounts produce the "across M accounts" feedback; a partial failure produces a warning naming the account while still returning the surviving intervals; an all-connections failure reads as an error, not as "no busy time".
- `pnpm test:unit` — `src/lib/data/GoogleCalendarDataAccess.test.ts`: `loadConnections` validates the row shape; an unknown connection id surfaces `GOOGLE_CONNECTION_NOT_FOUND`; `GOOGLE_ACCOUNT_LIMIT_REACHED` and `GOOGLE_SCHEDULING_ACCOUNT_REQUIRED` map through `mapFunctionError` instead of `NETWORK_ERROR`; `sources[]` is validated and preserved.
- `pnpm test:unit` — `src/lib/integrations/googleCalendarOAuthReturn.test.ts`: the return parser learns any new keys, and asserts that no account email or id is read from or left in the URL after consumption.
- `pnpm test:unit` — chip accessibility: assert the chip exposes an accessible name containing the account, not just a colour class.
- `pnpm run build` and `pnpm test:pwa` after the interface change, since `App.tsx` constructs the data access for both `/projects` and `/integrations`.

## Context

### The contract being replaced

Code Source: `src/lib/data/GoogleCalendarDataAccess.ts`
Code Description: The single-connection interface, the types that gain attribution, and the error-code union that gains three members. `KNOWN_CODES` is what currently turns an unrecognised server code into `NETWORK_ERROR`.

```ts
export interface GoogleCalendarSettings {
    scopeLevel: GoogleCalendarScopeLevel;
    selectedCalendarIds: string[];
    worktimeCalendarId: string | null;
    connectedAt: string;
    updatedAt: string;
}

export interface GoogleCalendarEvent { id: string; title: string; start: string; end: string; allDay: boolean; }

export interface GoogleCalendarTaskLink {
    taskId: string; calendarId: string; eventId: string;
    scheduledStart: string; scheduledEnd: string;
    estimatePomos: number; workMinutes: number; updatedAt: string;
}

export interface GoogleCalendarDataAccess {
    loadSettings(): Promise<GoogleCalendarSettings | null>;
    beginAuthorization(input: { scopeLevel: GoogleCalendarScopeLevel; returnTo: string; pendingTaskId?: string; pendingScheduledStart?: string }): Promise<string>;
    listCalendars(): Promise<GoogleCalendarChoice[]>;
    updateSelectedCalendars(calendarIds: readonly string[]): Promise<void>;
    fetchEvents(input: { timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]>;
    fetchBusyIntervals(input: { timeMin: string; timeMax: string }): Promise<{ intervals: GoogleCalendarInterval[]; refreshedAt: string }>;
    loadTaskLink(taskId: string): Promise<GoogleCalendarTaskLink | null>;
    pushTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink>;
    resyncTask(input: GoogleCalendarPushInput): Promise<GoogleCalendarTaskLink>;
    unpushTask(taskId: string): Promise<void>;
    disconnect(): Promise<void>;
}
```

The preference write is currently a single-argument RPC:

```ts
response = await this.client.rpc("update_google_calendar_preferences", { p_selected_calendar_ids: selected });
```

### Single-settings state in the card and week strip

Code Source: `src/components/GoogleCalendarIntegrationCard.tsx`
Code Description: Loads one settings object, renders one badge, one picker, and the week strip that needs account chips.

```tsx
const [settings, setSettings] = useState<GoogleCalendarSettings | null>(null);
// ...
void dataAccess.loadSettings().then((value) => { setSettings(value); setSelected(value?.selectedCalendarIds ?? []); /* ... */ });
// ...
{settings && <span className="...">{settings.scopeLevel === "schedule" ? "Connected — can schedule" : "Connected — read only"}</span>}
```

```tsx
<div aria-label="Current week calendar" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
    {/* per-day <section> containing per-event <article> with title + time only */}
</div>
```

The picker is a single disclosure with a hard 50 cap shared by the whole owner:

```tsx
const toggle = (id: string) => setSelected((current) => current.includes(id)
    ? current.filter((value) => value !== id)
    : current.length < 50 ? [...current, id] : current);
```

### Task section push and targeted upgrade

Code Source: `src/components/ProjectManager/GoogleCalendarTaskSection.tsx`
Code Description: `settings.scopeLevel` decides whether a push happens or an upgrade is requested; neither path can name a connection today.

```tsx
if (settings?.scopeLevel === "readonly") {
    navigateTo(await dataAccess.beginAuthorization({
        scopeLevel: "schedule", returnTo,
        pendingTaskId: task.id,
        pendingScheduledStart: input.scheduledStart,
    }));
    return;
}
```

The resume effect that must still push exactly once, to the advertised account:

```tsx
if (!resume?.connected || !resume.pendingTaskId || !resume.pendingScheduledStart || resume.pendingTaskId !== task.id) return;
const key = `${resume.pendingTaskId}:${resume.pendingScheduledStart}`;
if (resumedRef.current === key) return;
```

### Agent panel busy fetch and reconnect

Code Source: `src/components/ProjectManager/AgentPanel.tsx`
Code Description: Single-setting busy fetch, single minute count, and a reconnect that cannot name an account.

```tsx
const settings = await googleCalendarDataAccess.loadSettings();
if (!settings) { if (report) setCalendarFeedback("Connect Google Calendar in Integrations to include busy time."); return []; }
if (settings.selectedCalendarIds.length === 0) { if (report) setCalendarFeedback("Select at least one busy-time calendar in Integrations."); return []; }
const result = await googleCalendarDataAccess.fetchBusyIntervals({ timeMin: now.toISOString(), timeMax: absoluteWorkUntil.toISOString() });
if (report) {
    const minutes = Math.round(result.intervals.reduce((sum, interval) =>
        sum + new Date(interval.end).getTime() - new Date(interval.start).getTime(), 0) / 60_000);
    setCalendarFeedback(`Calendar refreshed: ${minutes} busy minute${minutes === 1 ? "" : "s"}.`);
}
```

```tsx
const settings = await googleCalendarDataAccess.loadSettings();
navigateTo(await googleCalendarDataAccess.beginAuthorization({ scopeLevel: settings?.scopeLevel ?? "readonly", returnTo }));
```

### OAuth return surface

Code Source: `src/lib/integrations/googleCalendarOAuthReturn.ts`
Code Description: The only keys the client may read from the return URL. Account identity must not be added here.

```ts
const RETURN_KEYS = [
    "google_calendar", "google_calendar_scope", "google_calendar_error",
    "pending_task_id", "pending_scheduled_start",
] as const;
```

### Wiring and construction sites

Code Source: `src/App.tsx`, `src/components/IntegrationsPage.tsx`, `src/components/ProjectManager/ProjectManagerPage.tsx`, `src/components/ProjectManager/TaskInspector.tsx`
Code Description: `SupabaseGoogleCalendarDataAccess` is constructed once per route; the OAuth return is consumed once in `ProjectManagerPage` and passed down as `resume`.

```tsx
const googleCalendarDataAccess = useMemo(
    () => new SupabaseGoogleCalendarDataAccess(supabase, session!.user.id), [supabase, session]);
```

```tsx
const [googleCalendarResume, setGoogleCalendarResume] = useState<GoogleCalendarOAuthReturn | null>(() =>
    googleCalendarDataAccess ? consumeGoogleCalendarOAuthReturn() : null);
```

## Notes

- Blocked by #127. The `loadConnections()` row shape, the `sources[]` payload, and the three new error codes must be fixed there first; this issue should not guess them.
- Both the backend and this issue are currently unlabeled work for parent request #121.
- Repository rules in `AGENTS.md` still apply: no Tauri `invoke` data paths, and the notification entry point and its Web Notification fallback must be preserved.
- `dataAccess` is dependency-injected in every component, so all of these screens remain unit-testable with mocks; no new network surface is introduced here.
