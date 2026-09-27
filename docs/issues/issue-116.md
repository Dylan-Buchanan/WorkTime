# Title: Remove the historical sync-metadata replay from integration tests

## Tags

Complexity Classification: T1
Classification Reason: This is a contained change to the integration-test command and removal of one standalone script; current trigger behavior already has integration coverage.

Severity: Low
Severity Reason: The replay adds unnecessary time and Docker-dependent failure points to integration runs, but does not affect application behavior.

Needs research before implementation: No

## Summary

Remove the historical replay of `20260802000000_sync_metadata.sql` from the integration-test workflow and delete its verification script. Migrations are not changed after they go live, so replaying this already-live migration does not provide ongoing regression coverage. Preserve the existing behavior of resetting the local database to the latest schema before the integration tests run.

## Steps to Reproduce Context

1. Start the local Supabase stack.
2. Run `pnpm test:integration`.
3. Observe that the command first runs `scripts/verify-local-first-migration.mjs`, which resets to a historical schema, seeds and replays migrations, then resets to the latest schema before Vitest starts.

## Expected Behavior

- `pnpm test:integration` resets the local database to the latest schema and then runs the integration tests.
- The integration-test workflow does not replay the historical sync-metadata migration.

## Actual Behavior

- `test:integration` runs a historical migration replay before Vitest. The script performs database resets, Docker gateway restarts, and throwaway-user setup, then resets the database to the latest schema in its `finally` block.

## Requirements for completed issue

1. `test:integration` explicitly resets the local database to the latest schema before running Vitest.
2. `test:integration` no longer invokes `scripts/verify-local-first-migration.mjs`.
3. Delete `scripts/verify-local-first-migration.mjs`.
4. The integration suite still runs against the latest local schema after the historical replay is removed.

### Testing

- Run `pnpm test:integration` with the local Supabase stack available; verify it resets to the latest schema and the integration tests pass.
- Verify `pnpm test:all` continues to reach and pass the integration-test step.

## Context

- `package.json` currently defines `test:integration` as:

  ```json
  "test:integration": "node scripts/verify-local-first-migration.mjs && vitest run --config vitest.integration.config.ts"
  ```

- `package.json` already provides the `supabase:reset` script for resetting the local database.
- `scripts/verify-local-first-migration.mjs` replays the historical migration, then performs a full local reset in its `finally` block. The reset-to-latest behavior must remain, without the replay.
- `integration/localFirstSync.integration.test.ts` and `integration/timerCompletionGuard.integration.test.ts` already exercise relevant `updated_at` and LWW behavior against the current schema.
- The script has no other references in the repository.

## Notes

- The user confirmed that migrations are not modified once live and that the reset-to-latest precondition should be preserved explicitly.
