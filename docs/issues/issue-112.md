# Title: Recover from transient JWT-issued-in-the-future sync failures

## Tags

Complexity Classification: T2
Classification Reason: The likely change is contained to sync orchestration and its tests, but the cause and best recovery behavior for the JWT timing error are not yet confirmed.

Severity: Medium
Severity Reason: An automatic sync can fail temporarily, although local changes remain safe and a subsequent manual sync has succeeded.

Needs research before implementation: Yes

### Research Needed

Confirm whether `PGRST303` (“JWT issued at future”) is caused by sync starting too soon or by another session/token timing condition. Determine which automatic sync triggers need delayed startup, retry behavior, or both.

- Review automatic sync triggers and status handling in `src/state/SyncContext.tsx`.
- Review auth-error recognition and retry behavior in `src/lib/data/sync/SyncCoordinator.ts` and `src/lib/data/SupabaseDataAccess.ts`.
- Check the Supabase/PostgREST error behavior and available test coverage before deciding on recovery behavior.

## Summary

Sync occasionally fails with a Supabase `PGRST303` error stating that the JWT was issued in the future. Reports have included `pet_fixations` and `todos` queries. Pressing **Sync data** again has succeeded. Investigate the transient failure and ensure automatic sync can recover appropriately; waiting briefly before an automatic attempt may be worthwhile if timing is contributing.

## Steps to Reproduce Context

1. Open or return to the authenticated app while a sync is triggered automatically, such as on startup, window focus, or when the page becomes visible.
2. If the timing condition occurs, observe a sync error such as `Supabase pet_fixations query failed: JWT issued at future (code=PGRST303)` or the equivalent error for `todos`.
3. Press **Sync data** again; the subsequent attempt has been reported to succeed.

The failure is intermittent; no deterministic reproduction is currently known.

## Expected Behavior

- Automatic sync handles transient JWT timing failures appropriately rather than leaving the user with an error that requires a manual retry.
- Any timing-sensitive automatic sync behavior is considered, including whether waiting briefly before attempting sync would avoid the failure.
- Local changes remain safe while sync is failing.

## Actual Behavior

- An automatic sync can display a `PGRST303` “JWT issued at future” query failure.
- A later manual sync has succeeded, suggesting the failure may be transient.
- The user-facing sync error remains until another sync attempt succeeds.

## Requirements for completed issue

1. Identify and address the sync behavior associated with intermittent `PGRST303` JWT timing failures.
2. Evaluate whether a brief wait before automatic sync attempts is appropriate if timing is contributing to the failure.
3. Preserve local changes across failed attempts and provide accurate sync status after recovery.

### Testing

- Add or update sync tests to cover a transient `PGRST303` failure followed by successful recovery through the chosen behavior.
- Cover any automatic-sync delay or retry behavior introduced, including that manual sync remains available and local staged changes are preserved.
- Run the relevant sync unit tests and the broader unit suite.

## Context

### Automatic sync triggers

Code Source: `src/state/SyncContext.tsx`
Code Description: Starts a bootstrap sync when the authenticated provider mounts, syncs on window focus and document visibility, and performs a best-effort web `pagehide` sync. These triggers update the shared sync status.

### Retry and query error handling

Code Source: `src/lib/data/sync/SyncCoordinator.ts`
Code Description: `performSync()` refreshes the session and retries the pull/merge/push attempt once when it catches a `DataAccessAuthError`; other errors are surfaced without that retry.

Code Source: `src/lib/data/SupabaseDataAccess.ts`
Code Description: `page()` reports table query errors through `fail()`, which formats the Supabase message and code into a regular `Error`. The pull issues `todos` and `pet_fixations` queries among its concurrent table requests. This means the reported `PGRST303` query error does not appear to take the coordinator's `DataAccessAuthError` refresh-and-retry path.

### Manual sync and user messaging

Code Source: `src/components/SyncControls.tsx`
Code Description: The **Sync data** button invokes a manual sync, and the status message says local changes are safe after a sync failure.

## Notes

Reported examples:

```text
Sync failed: Supabase pet_fixations query failed: JWT issued at future (code=PGRST303). Your local changes are safe.
Sync failed: Supabase todos query failed: JWT issued at future (code=PGRST303). Your local changes are safe.
```

The issue number follows the latest logged issue reference, #111.
