## Title: Provide an in-place reconnect workflow when the Google Calendar connection is invalid

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Adding a reconnect affordance when `GOOGLE_TOKEN_INVALID` is a UI/state-management change with established sibling patterns to copy (GitHub's `errorCode` + inline Reconnect, Shortcut's `reconnecting` state). The primary change is `src/components/GoogleCalendarIntegrationCard.tsx` (track the error code, render a reconnect action reusing `beginAuthorization`), with the same message also surfaced in `GoogleCalendarTaskSection.tsx` and `AgentPanel.tsx`, plus unit tests. Blast Radius=2 (integration card plus task/agent panels), Uncertainty=2 (whether reconnect should preserve the `schedule` scope tier, since the only current `connect()` path hardcodes `readonly`, and whether every surface gets the action), Behavior=3 (state + error handling + re-auth flow), Testing=1 (existing Vitest coverage for the card and sibling patterns), Reversibility=1.
Needs research before implementation: Yes — Confirm the correct `scopeLevel` to use on reconnect so a `schedule`-tier connection is not silently downgraded to `readonly` (verify the `include_granted_scopes=true` behavior of the auth URL and OAuth callback), and confirm whether the reconnect action belongs on every surface that renders the message or only the Integrations card.

## Summary

When the stored Google refresh token is no longer valid, the app displays "Google Calendar must be reconnected" but offers no direct way to reconnect. The only available path is to click the "X" (Disconnect) on the Integrations Google Calendar card and then run the full connect flow again. Because the connection appears to become invalid relatively often, this should be a simpler, in-place workflow.

## Steps to Reproduce Context

1. Connect Google Calendar from the Integrations page.
2. Let the stored refresh token become invalid (for example, per Google's testing-mode token expiration policy noted in `supabase/README.md`).
3. Use any Google Calendar feature (load this week's events, refresh calendar busy time, or push a task to Google) so the request reaches the backend and the stored token is rejected.
4. Observe the "Google Calendar must be reconnected" error rendered in the UI.

## Expected Behavior

When the connection is reported as invalid, the affected surface presents a clear, direct action to re-authorize Google Calendar without first having to disconnect it. Completing that action restores a working connection and the previously connected settings.

## Actual Behavior

The message is shown as plain text only. No reconnect control is rendered. The user must manually press the "X" button on the Integrations Google Calendar card to disconnect, then start a brand-new connection, which loses the in-place recovery workflow and requires redoing the connection steps.

## Requirements for completed issue

1. Each surface that reports the invalid-connection message provides a direct way to re-authorize Google Calendar without requiring a prior manual disconnect.
2. Reconnecting successfully restores the integration to a usable state so the previously failing Google Calendar operation can be retried.
3. Reconnecting does not silently reduce an existing connection's granted capability (for example, a `schedule`-tier connection should not be downgraded to `readonly`).
4. Existing unit tests are updated or added to cover the reconnect behavior.

## Context

- Files:
  - `src/components/GoogleCalendarIntegrationCard.tsx`
  - `src/components/ProjectManager/GoogleCalendarTaskSection.tsx`
  - `src/components/ProjectManager/AgentPanel.tsx`
  - `src/lib/data/GoogleCalendarDataAccess.ts`
  - `supabase/functions/google-calendar/index.ts`
  - `supabase/functions/google-calendar/googleCalendarApi.ts`
  - `supabase/functions/google-calendar-auth/googleOAuth.ts`
  - `src/components/GoogleCalendarIntegrationCard.test.tsx`
  - `supabase/README.md`
- Code Snippets:
  - The message is produced server-side when the stored refresh token is rejected:
    - `supabase/functions/google-calendar-auth/googleOAuth.ts:134` and `:195` throw `GOOGLE_TOKEN_INVALID` with "Google Calendar must be reconnected".
    - `supabase/functions/google-calendar/googleCalendarApi.ts:60` throws the same on a Calendar API 401.
    - `supabase/functions/google-calendar/index.ts` `errorResponse` returns `{ error, code: "GOOGLE_TOKEN_INVALID" }` (HTTP 401).
    - `src/lib/data/GoogleCalendarDataAccess.ts` `mapFunctionError` maps that into a `GoogleCalendarIntegrationError` with code `GOOGLE_TOKEN_INVALID`.
  - The Integrations card surfaces the message as text with no action, and its `connect()` is only reachable when not connected:
    ```tsx
    // src/components/GoogleCalendarIntegrationCard.tsx:187
    {settings && <button type="button" aria-label="Disconnect Google Calendar" onClick={() => void disconnect()} disabled={busy} ...><X size={15} /></button>}
    ```
    ```tsx
    // src/components/GoogleCalendarIntegrationCard.tsx:190-193
    {loading ? <p ...>Loading Google Calendar…</p> : !settings ? (
        <div className="mt-auto border-t border-neutral-800 pt-4">
            <button type="button" onClick={() => void connect()} disabled={busy} ...>{busy ? "Opening Google…" : "Connect read only"}</button>
        </div>
    ) : ( ... )}
    ```
    ```tsx
    // src/components/GoogleCalendarIntegrationCard.tsx:276
    {error && <p role="alert" className="mt-3 text-[10px] text-red-300">{error}</p>}
    ```
  - `connect()` hardcodes the read-only scope:
    ```tsx
    // src/components/GoogleCalendarIntegrationCard.tsx:131-132
    const returnTo = `${window.location.origin}${window.location.pathname}`;
    navigateTo(await dataAccess.beginAuthorization({ scopeLevel: "readonly", returnTo }));
    ```
  - Other surfaces also render the message without an action:
    - `src/components/ProjectManager/GoogleCalendarTaskSection.tsx:226`
    - `src/components/ProjectManager/AgentPanel.tsx:269` and `:360`
  - Data-access already supports re-authorization without disconnecting:
    ```ts
    // src/lib/data/GoogleCalendarDataAccess.ts:84-89
    beginAuthorization(input: {
        scopeLevel: GoogleCalendarScopeLevel;
        returnTo: string;
        pendingTaskId?: string;
        pendingScheduledStart?: string;
    }): Promise<string>;
    ```
    The OAuth callback overwrites the existing connection via the `save_google_calendar_connection` RPC (`supabase/functions/google-calendar-auth/index.ts:164`).
  - Established sibling patterns to mirror:
    - `GithubIntegrationCard.tsx:510-517` tracks `errorCode` and renders an inline "Reconnect" button when `GITHUB_TOKEN_INVALID`, reusing `connect()`.
    - `ShortcutIntegrationCard.tsx:303-305,331` uses a `reconnecting` state with an inline "Reconnect" button.
    - Tests: `GithubIntegrationCard.test.tsx:274`, `ShortcutIntegrationCard.test.tsx:189`.

## Notes

- `supabase/README.md:155` states: "Consent screens left in Google Testing mode follow Google's testing-token expiration policy; promotion to Production is a Google Cloud setting, not a WorkTime client setting." This is a likely reason the connection becomes invalid frequently, but it is external configuration and not something this issue resolves. The issue is scoped to making the reconnect workflow easier.
