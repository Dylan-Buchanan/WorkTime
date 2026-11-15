# Title: GitHub integration: connection status, a reachable Reconnect, and a Disconnect that actually disconnects

## Tags

Complexity Classification: T2
Classification Reason: Frontend-only change on one card surface, but it rewrites how account status is derived and reported across several code paths (load, enumeration failure, reconnect, disconnect), touches the GitHub data access `disconnect()` contract, and needs new component coverage. It is a multi-part state-model change, not an isolated edit.

Severity: Medium
Severity Reason: The integration is unusable once the stored token is invalid, and the card advertises a green "Connected" status while it is broken. Users cannot recover from the card, and Disconnect leaves an ambiguous state. No data corruption or cross-owner exposure, and recovery is possible through a fresh OAuth connect.

Needs research before implementation: No

## Summary

The GitHub integration card reports connection status from a single fact — whether a `github_settings` row exists — so a stored-but-revoked token still renders the green **Connected** badge, the signed-in login, and the "last synced" line, while the card simultaneously shows "Your GitHub connection is invalid or has been revoked. Reconnect to continue."

The only reconnect affordance in the card is a link inside that error alert, and it is rendered only when `errorCode === "GITHUB_TOKEN_INVALID"`. The initial load path sets the error message without setting `errorCode`, so the load-time invalid-token failure (the case in the screenshot) has no reconnect control at all. The card then offers only **Disconnect**.

Disconnect itself clears local React state optimistically after an unverified delete. `SupabaseGitHubDataAccess.disconnect()` issues a `delete()` with no `.select()`, so a delete that removes zero rows is reported as success, and the card never re-reads `/github_settings` afterwards. Pressing Disconnect therefore does not reliably leave the account disconnected, and the connection can appear again as soon as the settings row is read back.

## Steps to Reproduce Context

1. Open **Integrations** and connect GitHub via **Connect GitHub** (OAuth completes and the card shows `CONNECTED`, "Signed in as …").
2. Invalidate the stored token at GitHub (revoke the WorkTime OAuth App's access for the account, or otherwise make the token fail).
3. Reload **Integrations**. The card shows the green `CONNECTED` badge, "Signed in as …", the "No repositories are tracked yet…" placeholder, and the red alert "Your GitHub connection is invalid or has been revoked. Reconnect to continue." — with no Reconnect control, only **Disconnect**. This is the reported screenshot.
4. Press **Disconnect**. The card does not reliably end up in a clean not-connected state; the connection can appear connected again (reported as "pressing the disconnect button seems to actually reconnect an account").

## Requirements for completed issue

1. The card exposes one explicit connection status with three values — connected, needs reconnecting, and not connected — derived from a live check against GitHub, not only from the presence of a `github_settings` row.
2. The status badge and card body always agree with that status; a stored token that GitHub rejects never renders as green/`Connected`.
3. A **Reconnect** control is reachable in every needs-reconnecting state, including when the failure happens during the initial load/enumeration rather than during a sync.
4. Reconnect starts the existing OAuth flow (fresh one-time state, existing callback handling) and, on return, shows the post-reconnect status without requiring the user to manually reload.
5. Actions that require a working connection — sync, select-all, per-repository options, and issue attach — are unavailable while the card is in the needs-reconnecting state.
6. **Disconnect** asks for confirmation before removing the connection.
7. A completed Disconnect removes the stored connection, verifies the removal, and leaves the card in the not-connected state; that state survives a remount, a page reload, and a settings re-read.
8. A failed or ineffective Disconnect surfaces an error and does not present the account as disconnected while the connection still exists.
9. The card can only return to connected through a completed OAuth exchange — never as a side effect of a failed/partial delete or stale local state.
10. Existing behaviour is preserved: stale repository rows stay editable but not syncable, per-repository project/label/include-closed preferences keep working, and the sync-preview/task-creation flow is unchanged.

## Expected Behavior

- The card shows `Connected` only when the stored connection actually works.
- An invalid or revoked token renders a distinct `Needs reconnecting` status with a visible, usable **Reconnect** button next to **Disconnect**.
- Reconnect always launches the OAuth authorize flow and returns to a correct status.
- Disconnect confirms, then leaves the card showing a genuine not-connected state with a **Connect GitHub** button, stable across reloads.
- Repository preferences and the sync/attach controls behave as before for a healthy connection.

## Actual Behavior

- The card shows green `CONNECTED` and the signed-in login while the token is invalid.
- The invalid-token alert says "Reconnect to continue" but renders no Reconnect control when the failure comes from the initial load/enumeration, because `errorCode` is never set on that path.
- Pressing Disconnect clears local state optimistically; the delete is not verified and settings are not re-read, so the connection can appear connected again.

### Testing

1. `src/components/GithubIntegrationCard.test.tsx`: add coverage for a `loadSettings()` success followed by `listRepos()` rejecting with `GITHUB_TOKEN_INVALID` — assert the card does not show a green `Connected` status and that a **Reconnect** control is present and starts `beginAuthorization` with a fresh `web.` state.
2. Assert that a needs-reconnecting card disables sync/select-all/attach and offers no repository actions.
3. Assert Disconnect asks for confirmation, and that cancelling leaves the connection untouched (`disconnect` not called).
4. Assert that a successful Disconnect leaves the not-connected view and that a subsequent settings read returning `null` keeps it not connected.
5. Assert that a Disconnect which does not remove the connection (data access rejects, or reports the row still present) surfaces an error and does not claim disconnection.
6. Keep the existing sync-failure Reconnect test (`GithubIntegrationCard.test.tsx:264-280`) and the disconnect test (`:414-423`) passing, updating them to the confirmed flow.
7. If `disconnect()` gains a verification contract, cover it in `src/lib/data/GitHubDataAccess.test.ts`.
8. Manual check with the local Supabase stack: connect, revoke the token at GitHub, reload Integrations, reconnect, then disconnect and reload to confirm the not-connected state persists.

## Issue Context

### New Files

None.

### Remove Files

None.

### Change Files

#### Connection status rendering

Code Source: `src/components/GithubIntegrationCard.tsx`
Code Description: The card renders the green status badge purely from the presence of loaded settings.
Code Change Description: Status must reflect a live check (connected / needs reconnecting / not connected) and drive the badge, body, and action availability.
Files Using: `src/components/IntegrationsPage.tsx`, `src/App.tsx` (`AuthenticatedIntegrationsRoute`)

```tsx
{settings && <span className="rounded-full border border-emerald-700/60 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-300">Connected</span>}
```

#### Initial-load error path never sets `errorCode`

Code Source: `src/components/GithubIntegrationCard.tsx`
Code Description: The mount effect loads settings, then enumerates repositories. Its catch sets the message text only.
Code Change Description: This path must produce a status the UI can act on (including reachable reconnect), not just a message. `recordError()` is the only place that sets `errorCode`.
Files Using: `src/lib/data/GitHubDataAccess.ts` (`listRepos`), `supabase/functions/github-enumerate-repos/index.ts`

```tsx
void dataAccess.loadSettings().then(async (loaded) => {
    if (!active) return;
    setSettings(loaded);
    if (loaded) {
        const list = await dataAccess.listRepos();
        ...
    }
}).catch((caught) => {
    if (active) setError(errorMessage(caught));   // errorCode is never set here
}).finally(...)
```

```tsx
const recordError = (caught: unknown) => {
    setError(errorMessage(caught));
    setErrorCode(caught instanceof GitHubIntegrationError ? caught.code : "NETWORK_ERROR");
};
```

```tsx
{error && !preview && (
    <div role="alert" className="...">
        <p>{error}</p>
        {errorCode === "GITHUB_TOKEN_INVALID" && (
            <button type="button" onClick={() => void connect()} ...>Reconnect</button>
        )}
    </div>
)}
```

#### Disconnect is optimistic and unverified

Code Source: `src/components/GithubIntegrationCard.tsx`
Code Description: Disconnect deletes, then immediately clears all local state. There is no confirmation, no re-read of settings, and no check that the connection is actually gone.
Code Change Description: Disconnect must be confirmed, verified, and reflected in the card status; a failed delete must not look like a disconnect.
Files Using: `src/lib/data/GitHubDataAccess.ts`, `src/lib/integrations/githubOAuthReturn.ts` (reconnect state)

```tsx
async function disconnect() {
    if (anyBusy) return;
    clearError();
    setBusy("disconnect");
    try {
        await dataAccess.disconnect();
        setSettings(null);
        setRepos([]);
        setLabels({});
        setSummaries({});
        setPreview(null);
        setAttachCandidates(new Map());
        setFilter("");
        setExpandedRepos({});
    } catch (caught) {
        recordError(caught);
    } finally {
        setBusy(null);
    }
}
```

#### `disconnect()` cannot report a no-op delete

Code Source: `src/lib/data/GitHubDataAccess.ts`
Code Description: `disconnect()` deletes the owner's `github_settings` row without `.select()`, so PostgREST reports success even when zero rows match. Compare `writeRepoPreferences()` below, which asserts the row was actually written.
Code Change Description: The disconnect contract must let the card distinguish "removed" from "nothing removed".
Files Using: `src/components/GithubIntegrationCard.tsx`, `integration/githubSettings.integration.test.ts`

```ts
async disconnect(): Promise<void> {
    let response;
    try {
        response = await this.client.from("github_settings").delete().eq("owner_id", this.ownerId);
    } catch (error) {
        throw transportError("Unable to disconnect GitHub.", error);
    }
    if (response.error) throw new GitHubIntegrationError("SETTINGS_DELETE_FAILED", "Unable to disconnect GitHub.");
}
```

```ts
if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new GitHubIntegrationError("GITHUB_REPO_NOT_FOUND", "GitHub repository was not found.");
}
```

#### In-repo precedent for reconnect state

Code Source: `src/components/LinearIntegrationCard.tsx`
Code Description: The Linear card models a `reconnecting` flag, swaps the connection form in with `const showConnectionForm = !settings || reconnecting;`, offers a Reconnect link inside the invalid-token alert, and keeps a persistent Reconnect button beside Disconnect.
Files Using: `src/components/LinearIntegrationCard.test.tsx`

```tsx
const showConnectionForm = !settings || reconnecting;
...
{errorCode === "LINEAR_TOKEN_INVALID" && settings && !reconnecting && (
    <button type="button" onClick={() => { clearError(); setReconnecting(true); }} className="mt-2 underline underline-offset-2">Reconnect</button>
)}
...
<button type="button" onClick={() => setReconnecting(true)} disabled={busy !== null} className="...">Reconnect</button>
<button type="button" onClick={() => void disconnect()} disabled={busy !== null} className="...">
    {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
</button>
```

#### Related contracts that must stay intact

Code Source: `src/lib/data/GitHubDataAccess.ts`
Code Description: The card's full data-access surface; only `listRepos()` currently exercises the stored token, which is how `GITHUB_TOKEN_INVALID` reaches the UI.
Files Using: `src/components/GithubIntegrationCard.tsx`, `src/components/auth/GithubOAuthCallbackPage.tsx`

```ts
export interface GitHubDataAccess {
    beginAuthorization(state: string): Promise<string>;
    completeAuthorization(code: string): Promise<GitHubAuthorizationResult>;
    loadSettings(): Promise<GitHubSettings | null>;
    listRepos(): Promise<GitHubRepoListResult>;
    toggleSelection(repoFullName: string, selected: boolean): Promise<void>;
    updateRepoOptions(repoFullName: string, options: GitHubRepoOptionsInput): Promise<void>;
    removeRepo(repoFullName: string): Promise<void>;
    sync(repoFullName: string, options?: GitHubSyncOptions): Promise<GitHubSyncResult>;
    disconnect(): Promise<void>;
}
```

- Server token failures surface as `GITHUB_TOKEN_INVALID` from GitHub 401/403 (`supabase/functions/_shared/githubApi.ts:128-129`), so enumeration, sync, and preference writes can all detect a revoked token.
- `supabase/migrations/20260831000000_github_integration.sql` grants the browser an owner-scoped delete on `github_settings`, and `github_repos` cascades from it. No schema or Edge Function change is in scope.
- `supabase/README.md:176` documents that classic OAuth App tokens do not expire and that revocation requires reconnecting the integration.

## Notes

Reported screenshot shows the card in the invalid-token state: green `CONNECTED` badge, "Signed in as Dylan-Buchanan", "Last synced: 11/8/2026, 9:10:34 AM", the "No repositories are tracked yet…" placeholder, the red invalid-token alert, and a lone **Disconnect** button — no Reconnect control anywhere.

This replaces the previous content of issue #185 (screenshot-only report: "No reconnect button for github").
