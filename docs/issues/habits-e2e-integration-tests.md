## Title: Habit Tracker: E2E and integration coverage

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Final test-coverage item adding Playwright flows and RPC integration tests plus small helper extensions; no production code changes. Test patterns and infrastructure are well established, so only the habit-specific details depend on the earlier feature items.
Needs research before implementation: Yes — the final `habits`/`habit_completions` schemas, the 4 new `apply_staged_sync` args and their LWW/tombstone semantics, the HabitContext UI labels/testids for stable Playwright selectors, and confirmation that items 1–6 are merged before this lands.

## Summary

Add end-to-end Playwright flows (create, check, period switch, reorder, expand) and RPC integration checks covering the habits domain and the new `apply_staged_sync` habit arguments.

## Steps to Reproduce Context

1. Playwright: open the app, create a habit, check a cell, switch periods, reorder, expand a 365 grid; assert the resulting server-side state.
2. Integration: exercise `SupabaseDataAccess.push`/`pull` with habit payloads against the local Supabase stack, including idempotent completion upserts.
3. Run `npm run test:integration` and `npm run test:e2e` (plus `npm run test:unit` for any helper changes) and confirm the full suites pass.

## Expected Behavior

Habit create/check/period-switch/reorder/expand flows are covered end to end with server-state assertions, and the staged-sync RPC handles habit upserts/tombstones and completion upserts/tombstones idempotently against local Supabase.

## Actual Behavior

No habit test coverage exists in `e2e/` or `integration/`.

## Requirements for completed issue

1. A Playwright spec covers create, check/uncheck, period switch, reorder, and expand, asserting server state (extending the `backendState`-style helpers for habits).
2. An integration spec covers push/pull and the new `apply_staged_sync` habit args against local Supabase, including idempotency replay.
3. `npm run test:unit`, `npm run test:integration`, and `npm run test:e2e` all pass.

## Context

- Files: `e2e/helpers.ts` (`openApp`, `backendState`/`backendPMState`, `syncData`), `e2e/project-manager.spec.ts` (spec pattern), `integration/localFirstSync.integration.test.ts` (push/pull against local Supabase), `integration/SupabaseDataAccess.integration.test.ts`, `tests/supabase/localSupabase.ts` (`localSupabaseConfig`, `createLocalUser`), `vitest.integration.config.ts`, `playwright.config.ts`, `package.json` (test scripts).
- Code Snippets:

```ts
// e2e/helpers.ts — pattern to extend for habit seeding/assertions
export function backendState(page) { /* reads server-side tasks/logs after sync */ }
export async function syncData(page) { /* clicks "Sync data" until the pending badge drains */ }
```

## Notes

None.
