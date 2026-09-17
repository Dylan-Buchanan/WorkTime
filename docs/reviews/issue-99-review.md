# Branch Review: main

**Date**: 2026-09-17
**Scope**: Unstaged changes (19 files changed: 12 modified, 7 added)

## Summary

One critical completion issue was found. The engine, persistence, provider, toast, and test foundations are implemented cleanly, but the user-facing logging, optional-duration, and timestamp-correction flows required by issue 99 are not reachable from production UI.

## Critical Issues

### Required user-facing activity flows are not implemented

- **Severity**: Critical
- **File(s)**: [`src/App.tsx:144`](../../src/App.tsx#L144), [`src/state/PetActivityContext.tsx:20`](../../src/state/PetActivityContext.tsx#L20), [`docs/issues/issue-99.md:29`](../issues/issue-99.md#L29)
- **Description**: The change mounts `PetActivityProvider` and exposes activity commands, but no production component consumes `usePetActivity`. Consequently, there is no schedule-card check, bottom potty action, inline training/playtime duration stepper, completed-entry timestamp editor, or UI wiring through the single command.
- **Evidence**: Issue 99 explicitly requires both logging controls to call the command, an inline optional duration stepper, and a today-only edit affordance. The production change in `App.tsx` only adds the providers; `usePetActivity` is referenced only by its context test. The `/pet` route and the cards/bar that could host these controls do not exist yet.
- **Impact**: Users still cannot log or correct a pet activity, so the issue's expected behavior and requirements 1, 3, and 5 are not complete even though the underlying APIs work.
- **Recommendation**: Resolve the ownership overlap with issue 100. Either implement the required controls as part of issue 99, or explicitly narrow issue 99 to the command/persistence/toast foundation and move the duration and correction affordances into issue 100 before marking issue 99 complete. In either case, add production-component tests proving both entry points use `logActivity` and that duration/correction UI obeys the stated restrictions.

## Files Reviewed

| File | Status | Issues |
| --- | --- | --- |
| [`src/App.tsx`](../../src/App.tsx) | Modified | 1 critical |
| [`src/components/ToastViewport.tsx`](../../src/components/ToastViewport.tsx) | Added | None |
| [`src/lib/data/DataAccess.ts`](../../src/lib/data/DataAccess.ts) | Modified | None |
| [`src/lib/data/InMemoryDataAccess.test.ts`](../../src/lib/data/InMemoryDataAccess.test.ts) | Modified | None |
| [`src/lib/data/InMemoryDataAccess.ts`](../../src/lib/data/InMemoryDataAccess.ts) | Modified | None |
| [`src/lib/data/StagedDataAccess.test.ts`](../../src/lib/data/StagedDataAccess.test.ts) | Modified | None |
| [`src/lib/data/StagedDataAccess.ts`](../../src/lib/data/StagedDataAccess.ts) | Modified | None |
| [`src/lib/data/staging/LocalStagingStore.test.ts`](../../src/lib/data/staging/LocalStagingStore.test.ts) | Modified | None |
| [`src/lib/data/staging/LocalStagingStore.ts`](../../src/lib/data/staging/LocalStagingStore.ts) | Modified | None |
| [`src/lib/data/staging/types.ts`](../../src/lib/data/staging/types.ts) | Modified | None |
| [`src/lib/data/sync/merge.test.ts`](../../src/lib/data/sync/merge.test.ts) | Modified | None |
| [`src/lib/data/sync/timerCompletions.test.ts`](../../src/lib/data/sync/timerCompletions.test.ts) | Modified | None |
| [`src/lib/pets/activityLog.test.ts`](../../src/lib/pets/activityLog.test.ts) | Added | None |
| [`src/lib/pets/activityLog.ts`](../../src/lib/pets/activityLog.ts) | Added | None |
| [`src/lib/pets/index.ts`](../../src/lib/pets/index.ts) | Modified | None |
| [`src/state/PetActivityContext.test.tsx`](../../src/state/PetActivityContext.test.tsx) | Added | None |
| [`src/state/PetActivityContext.tsx`](../../src/state/PetActivityContext.tsx) | Added | 1 critical |
| [`src/state/ToastContext.test.tsx`](../../src/state/ToastContext.test.tsx) | Added | None |
| [`src/state/ToastContext.tsx`](../../src/state/ToastContext.tsx) | Added | None |
