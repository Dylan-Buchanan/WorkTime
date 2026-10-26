# Title: Backend — Google Calendar per-account connections (multi-account OAuth, fan-out reads, scheduling target)

## Tags

Complexity Classification: T4
Classification Reason: Replaces the primary data model for the integration (`google_calendar_settings` keyed by `owner_id` becomes `google_calendar_connections` keyed by `id`, with composite/partial uniques, a per-owner cap, and a same-migration drop of the old table) and rewires the security boundary around it: column-level grants keeping `refresh_token` unselectable, a connection-keyed service-role-only writer, a changed `update_google_calendar_preferences` signature, and a new atomic scheduling-target RPC. It also propagates through both Edge Functions, the Google API client (fan-out reads, dedupe, partial-failure degradation), the shared payload types, integration tests, and `supabase/README.md`.

Severity: High
Severity Reason: A mistake leaks a Google refresh token to the browser, lets one owner read another owner's connection, or pushes a focus event to the wrong account. The migration also drops user data, and the only copy of each refresh token lives in the dropped table, so a bad backfill cannot be reconstructed without every user re-consenting.

Needs research before implementation: Yes

### Research Needed

The spec is detailed, but four areas are unverified in this repository and should be settled before the migration is written. None require external spikes; they require reading existing code and confirming Google API behaviour against the live local stack.

- Fan-out read semantics: confirm how the current per-calendar freeBusy error handling in `supabase/functions/google-calendar/googleCalendarApi.ts` (`calendarExpansionMax: 50`, per-calendar `errors` → `GOOGLE_CALENDAR_SELECTION_INVALID 409`) must be reshaped so one account's failure degrades instead of aborting, and how "strongest accessRole" ordering should be expressed (`owner` > `writer` > `reader`).
- Google identity: confirm the userinfo endpoint response shape, whether `openid email` scopes are sufficient to read `sub` and `email` without a `profile` scope, and what Google returns when email is withheld.
- Migration ordering: read `supabase/migrations/20260812040000_restrict_security_definer_rpc_execution.sql`, `20260812050000_use_invoker_rpc_boundaries.sql`, and `20260812060000_optimize_owner_rls_initplans.sql`, then confirm the order for backfill-insert → constraint creation → RPC replacement → old-table drop, and that the drop does not strand the `private.save_google_calendar_connection` definer.
- Local verification path: `supabase/functions/google-calendar-auth/index.ts` currently passes `existingRefreshToken` unconditionally; confirm the targeted-upgrade path and the return-URL contract keep working with `connection_id` in the state row. Check `tests/supabase/localSupabase.ts` for the helpers the new integration tests will need.

## Summary

WorkTime stores exactly one Google connection per owner: `public.google_calendar_settings.owner_id` is the primary key, holding one `refresh_token`, one `scope_level`, and one `worktime_calendar_id`.

Calendars shared with the user's "main" account at busy-only level are deliberately excluded from the picker (`minAccessRole: "reader"` in `listGoogleCalendars`), and if they were selectable the busy filtering in `fetchGoogleBusyIntervals` → `listTimedBusyEvents` would misclassify all-day, transparent, and `worktime:taskId` events, because a busy-only grant cannot see `transparency`, `status`, or `extendedProperties/private`.

Authorizing the owning account alongside the main account gives WorkTime one detail-rich view of each calendar and a complete Start-of-Day budget, without relaxing the existing safety invariant that only detail-capable calendars may be selected. That requires the connection itself to become an addressable entity rather than a per-owner singleton.

Reads fan out across every connection; writes stay pinned to exactly one "scheduling" connection so a task's focus event has a single, stable owning credential.

Parent request: #121. The consuming frontend work is a separate issue (#128) and is blocked by this one.

## Steps to Reproduce Context

1. Connect Google Calendar with account A. `public.google_calendar_settings` contains exactly one row, keyed by `owner_id`.
2. Add a calendar to account A's `calendarList` with access role `freeBusyReader` (the "See only free/busy" sharing level). It never appears in the picker, because `listGoogleCalendars` sends `minAccessRole: "reader"`.
3. Even if it were forced into the picker, `listTimedBusyEvents` requests `fields: nextPageToken,items(start,end,status,transparency,extendedProperties/private)` and rejects all-day, `transparent`, cancelled, and `worktime:taskId` events. A busy-only grant cannot serve those fields, so the event data would be silently wrong rather than merely incomplete.
4. Add account B as a second Google account. There is no row shape to store it: `save_google_calendar_connection(p_owner_id, p_refresh_token, p_scope_level)` upserts `on conflict (owner_id)`, so account B silently replaces account A's credentials, and `google-calendar` reads a single `maybeSingle()` settings row.
5. Push a task and then ask which account owns the resulting event. Nothing in `google_calendar_task_links` records the credential set used, so attribution is impossible.

## Expected Behavior

- An owner can hold up to 5 Google connections, each identified by the Google account it represents; the same account re-authorized updates its existing row instead of consuming another slot.
- `refresh_token` remains unselectable by `authenticated`, and only a service-role-only boundary writes it.
- Reads (`list_calendars`, `busy`, `list_events`) span every connection and report which connection produced each calendar, event, and busy block.
- Busy time is deduped per calendar id and served by the strongest access role that can see that calendar, so a calendar visible from two accounts is never counted twice.
- One failing connection degrades the response with a warning instead of failing it; only "every connection failed" is an error.
- Writes always use exactly one connection: the one flagged as the scheduling target. Tasks pushed earlier keep pointing at the connection that actually created their event.
- Disconnecting one account leaves the others working; disconnect-all keeps today's behaviour.
- Users who connected before this migration keep working without re-consenting.
- No Google account identity appears in an OAuth return URL.

## Actual Behavior

- `public.google_calendar_settings.owner_id` is the primary key, so exactly one refresh token, scope level, selected-calendar list, and WorkTime calendar can exist per owner.
- `google-calendar` loads that single row and returns `GOOGLE_CALENDAR_NOT_CONFIGURED` (409) when absent.
- `google_calendar_task_links` has no `connection_id`; links are unfalsifiable about which account created the event.
- `google_calendar_oauth_states` has no `connection_id`, so every consent is indistinguishable from a first connect.
- `google-calendar-auth` passes `existingRefreshToken` on every callback and does not resolve which Google account consented.
- `disconnect` is owner-wide: it revokes one token and deletes every link for the owner.

## Requirements for completed issue

1. `public.google_calendar_connections` exists with `id uuid` primary key, `owner_id` FK to `auth.users` (`on delete cascade`), `google_account_id` (Google `sub`), `google_account_email`, `primary_calendar_id`, `refresh_token`, `scope_level` (`readonly` | `schedule`), `selected_calendar_ids` (≤50), `worktime_calendar_id`, `is_scheduling_target`, `identity_source`, and timestamps; `google_account_id` is nullable only for un-backfilled legacy rows.
2. Uniqueness is enforced as described: `unique (owner_id, google_account_id)` and a partial unique index on `owner_id where is_scheduling_target`. An owner can never exceed 5 connections, enforced by the writer and not only by the client.
3. The secret boundary is preserved: `authenticated` may select only non-secret columns and may not select `refresh_token`; RLS restricts reads to the owner; `refresh_token` is written only through a service-role-only `save_google_calendar_connection`, which is connection-keyed and can both insert a new connection and update an existing one.
4. Preference and target writes go through owner-checked invoker RPCs: `update_google_calendar_preferences(p_connection_id, p_selected_calendar_ids)` and a new `set_google_calendar_scheduling_connection(p_connection_id)` that clears and sets the target atomically. A cross-owner connection id is rejected.
5. `google_calendar_oauth_states` gains a nullable `connection_id`, so a scope upgrade names the account it targets.
6. `google_calendar_task_links` gains `connection_id` (FK, `on delete cascade`) while keeping `(owner_id, task_id)` as the primary key.
7. `google-calendar-auth` requests `openid email` alongside the calendar scopes and uses `prompt=select_account`, so a second connect can pick a different account instead of silently re-authorizing the first. A `connection_id` may be supplied to target an upgrade.
8. The OAuth callback resolves the consented identity via the Google userinfo endpoint, then matches an existing connection by sub, then by email, then by primary calendar id; it adopts a single legacy unidentified row whose primary calendar matches; it rejects at the 5-account cap with `GOOGLE_ACCOUNT_LIMIT_REACHED` before any write; and it only passes `existingRefreshToken` when re-authorizing the same connection. Concurrency on the same identity resolves to an update, not an error.
9. No Google account identity is written into the return URL. The existing `validateReturnUrl` reserved-key stripping stays consistent with the return keys actually used.
10. `google-calendar` fans reads across connections: `list_calendars` returns every connection's list tagged with `connection_id` and `account_email`; `busy` and `list_events` dedupe calendars by id and read each from the strongest access role across connections; events gain `connection_id` and `account_email`; `busy` gains a `sources[]` array carrying `connection_id`, `account_email`, calendar count, busy minutes, and a per-source error code.
11. Partial failure degrades: a failing non-scheduling connection yields a 200 with a warning in `sources[]`; only the case where every connection failed returns an error. A selected calendar that freeBusy rejects falls back to another connection that also sees it, and warns only if none can serve it.
12. Writes target the `is_scheduling_target` connection and its own `worktime_calendar_id`. `unpush_task` and `resync_task` for an existing link use the link's `connection_id`, so a task pushed before a target switch stays on its original account. `deterministicGoogleEventId(ownerId, taskId)` is unchanged.
13. `disconnect` accepts an optional `connection_id`: revoke that token, delete that connection's OAuth state and links, and leave Google events in place. With no `connection_id` it disconnects everything, preserving today's behaviour.
14. Removing the scheduling connection promotes the oldest remaining `schedule` connection, else the oldest remaining connection, else clears the target. A push with no scheduling connection surfaces `GOOGLE_SCHEDULING_ACCOUNT_REQUIRED`.
15. Legacy rows without a `google_account_id` resolve their identity from the primary `calendarList` entry (readable with the existing readonly scope) on any action and persist it, so pre-migration users keep working without re-consenting. A legacy row whose primary calendar id is not its email address must still match its own account rather than creating a second connection.
16. The migration inserts one row per existing `google_calendar_settings` row with `google_account_id = null` and `is_scheduling_target = true`, then drops `public.google_calendar_settings` in the same migration.
17. `MAX_PAGES` and the existing per-request limits are preserved under fan-out; one account's `429` or `401` must not fail the whole response.
18. `supabase/README.md`'s Google Calendar section documents the multi-connection model, the cap, the scheduling-target rule, the new RPCs, and the disconnect behaviour.

### Testing

- `pnpm test:integration` — extend `integration/googleCalendarSettings.integration.test.ts` (or add a sibling): two connections for one owner; cross-owner RLS isolation on select and on both preference RPCs; `refresh_token` invisible to `authenticated` while the admin client can read it; a 6th connection rejected; two connections cannot both be the scheduling target; a cross-owner `p_connection_id` rejected by `update_google_calendar_preferences` and `set_google_calendar_scheduling_connection`; task links scoped to their connection and cascade-deleted with it.
- `pnpm test:integration` — extend `integration/googleCalendarApi.integration.test.ts` with a fake injected fetcher: per-connection `list_calendars` tagging, dedupe of a calendar visible from two connections with the strongest role winning, `sources[]` populated on partial failure, a 200 when one of two connections fails, an error only when all fail, freeBusy rejection falling back to another connection, and `429`/`401` isolation per connection.
- Backfill check: seed a legacy-shaped `google_calendar_settings` row before migrating, run `pnpm supabase:reset`, and confirm exactly one connection row appears with `google_account_id = null` and `is_scheduling_target = true`, and that the old table is gone.
- `pnpm test:unit` — confirm nothing in the frontend unit suite regresses from the shared type changes.
- Manual `pnpm supabase:serve` pass: connect account A, add account B, confirm both appear with `connection_id`/`account_email`, switch the scheduling target, push with each, confirm `unpush`/`resync` stay on the original account, then disconnect one account and confirm the other still reads busy time.

## Context

### Current singleton storage and secret boundary

Code Source: `supabase/migrations/20260813000000_google_calendar_integration.sql`
Code Description: One row per owner; `refresh_token` excluded from the authenticated column grant and written through a private definer + public invoker wrapper.
Files Using: `supabase/functions/google-calendar/index.ts`, `supabase/functions/google-calendar-auth/index.ts`, `src/lib/data/GoogleCalendarDataAccess.ts`, `integration/googleCalendarSettings.integration.test.ts`

```sql
create table public.google_calendar_settings (
    owner_id uuid primary key references auth.users(id) on delete cascade,
    refresh_token text not null check (length(btrim(refresh_token)) > 0),
    scope_level text not null check (scope_level in ('readonly', 'schedule')),
    selected_calendar_ids text[] not null default '{}'::text[]
        check (cardinality(selected_calendar_ids) <= 50),
    worktime_calendar_id text,
    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

grant select (
    owner_id, scope_level, selected_calendar_ids, worktime_calendar_id,
    connected_at, updated_at
) on table public.google_calendar_settings to authenticated;
```

The writer that must become connection-keyed:

```sql
create function private.save_google_calendar_connection(
    p_owner_id uuid, p_refresh_token text, p_scope_level text
) returns void ... insert into public.google_calendar_settings (owner_id, refresh_token, scope_level)
    on conflict (owner_id) do update set refresh_token = excluded.refresh_token, scope_level = excluded.scope_level;
```

### Single-row read and owner-wide disconnect

Code Source: `supabase/functions/google-calendar/index.ts`
Code Description: The function reads one settings row and every action derives from it, including the owner-wide disconnect.

```ts
const { data: settings } = await supabase
    .from("google_calendar_settings")
    .select("refresh_token, scope_level, selected_calendar_ids, worktime_calendar_id")
    .eq("owner_id", ownerId)
    .maybeSingle();
if (!settings || typeof settings.refresh_token !== "string") {
    return jsonResponse({ error: "Google Calendar is not connected", code: "GOOGLE_CALENDAR_NOT_CONFIGURED" }, 409);
}
// ...
if (body.action === "disconnect") {
    await fetch("https://oauth2.googleapis.com/revoke", { /* token: settings.refresh_token */ });
    await supabase.from("google_calendar_oauth_states").delete().eq("owner_id", ownerId);
    await supabase.from("google_calendar_task_links").delete().eq("owner_id", ownerId);
    await supabase.from("google_calendar_settings").delete().eq("owner_id", ownerId);
}
```

### Fan-out boundary

Code Source: `supabase/functions/google-calendar/googleCalendarApi.ts`
Code Description: Calendar listing already filters to detail-capable calendars, which is the invariant that must be preserved. Busy fetching currently throws on any rejected calendar, which becomes per-source degradation. `deterministicGoogleEventId` must not change.

```ts
// Detail capability is required so all-day/transparent/worktime:taskId events can be excluded.
minAccessRole: "reader",
fields: "nextPageToken,items(id,summary,description,primary,selected,accessRole),"

// Today: one rejected calendar aborts the whole request.
if (Array.isArray(record.errors) && record.errors.length) {
    throw new GoogleCalendarApiError("GOOGLE_CALENDAR_SELECTION_INVALID", 409, "A selected calendar is unavailable");
}

export async function deterministicGoogleEventId(ownerId: string, taskId: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ownerId}:${taskId}`)));
    return `a${base32Hex(digest)}`;
}
```

`MAX_PAGES = 10` is the page cap shared by `listGoogleCalendars`, `listTimedBusyEvents`, and `listCalendarEvents`; freeBusy sends `calendarExpansionMax: 50`.

### OAuth start and callback

Code Source: `supabase/functions/google-calendar-auth/index.ts`, `supabase/functions/google-calendar-auth/googleOAuth.ts`
Code Description: Start writes one state row; the callback deletes it, reads the existing token unconditionally, exchanges, saves, and redirects with the pending-task pair.

```ts
url.searchParams.set("scope", scopesForLevel(input.scopeLevel).join(" "));
url.searchParams.set("access_type", "offline");
url.searchParams.set("include_granted_scopes", "true");
url.searchParams.set("prompt", "consent");     // must become select_account
```

```ts
const { data: existing } = await supabase
    .from("google_calendar_settings").select("refresh_token")
    .eq("owner_id", oauthState.owner_id).maybeSingle();
const token = await exchangeGoogleAuthorizationCode({
    code, codeVerifier, clientId, clientSecret, redirectUri,
    existingRefreshToken: typeof existing?.refresh_token === "string" ? existing.refresh_token : null,
});
```

### Shared payload types to extend

Code Source: `supabase/functions/_shared/googleCalendarTypes.ts`
Code Description: Both Edge Functions and the frontend depend on these. `GoogleCalendarAction` currently has no per-connection variant, and `GoogleCalendarErrorCode` needs the three new codes.

```ts
export interface GoogleCalendarEvent { id: string; title: string; start: string; end: string; allDay: boolean; }
export type GoogleCalendarAction =
    | "list_calendars" | "list_events" | "busy"
    | "push_task" | "resync_task" | "unpush_task" | "disconnect";
```

### Tables gaining a connection reference

Code Source: `supabase/migrations/20260813000000_google_calendar_integration.sql`
Code Description: `google_calendar_oauth_states` (service-role-only, one-time, 10-minute expiry) and `google_calendar_task_links` (PK `(owner_id, task_id)`, unique `(owner_id, calendar_id, event_id)`) both need a connection reference.

```sql
create table public.google_calendar_task_links (
    owner_id uuid not null references auth.users(id) on delete cascade,
    task_id text not null check (length(btrim(task_id)) > 0),
    calendar_id text not null check (length(btrim(calendar_id)) > 0),
    event_id text not null check (length(btrim(event_id)) > 0),
    -- ...
    primary key (owner_id, task_id),
    unique (owner_id, calendar_id, event_id)
);
```

### Documentation to update

Code Source: `supabase/README.md` (Google Calendar integration section, ~lines 144–171)
Code Description: Describes the single refresh-token boundary, the readonly → `calendar.app.created` upgrade, the Start-of-Day busy fetch, deploy commands, and disconnect behaviour. All four statements change.

## Notes

- Sibling issue: #128 (frontend) consumes this contract and must not start until the connection shape, `sources[]`, and the new error codes are fixed here.
- `refresh_token` is stored in plaintext today, protected only by column privileges and RLS. This issue preserves that model; it does not add encryption.
- Repository rules in `AGENTS.md` still apply: no Tauri `invoke` data paths, service-role keys stay server-only, and no background sync.
