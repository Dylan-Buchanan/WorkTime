## Title: Habit Tracker: staged sync plumbing (staging schema v2, merge, RPC)

## Tags

Complexity Classification: T3
Severity: High
Reason: Cross-system data-layer change extending the local-first staged sync protocol: staging schema v1→v2 with in-record migration, SyncSnapshot/merge/PushPlan/countPending/SyncCoordinator habit awareness, all three DataAccess implementations, and the `apply_staged_sync` security-definer RPC plus 4 new args. A bug means silent local-data corruption or bad remote pushes; the in-record migration and RPC signature change are hard to reverse.
Needs research before implementation: Yes — where/how the v1→v2 in-record migration runs under the currently fail-closed parser, the exact Habit/HabitCompletion shapes from items 1–2, whether habits/completions fall inside the fullWipe scope, interaction with `timerCompletions`' `completionMask`, and the `apply_staged_sync` signature-change mechanics (drop/recreate, grants, comments).

## Summary

Extend the staged-sync protocol so habits and habit completions ride the same local-first pipeline as tasks/logs: bump the staging schema to v2 with in-record migration, make SyncSnapshot/merge/PushPlan/countPending/SyncCoordinator habit-aware, add 4 args to `apply_staged_sync`, update all three DataAccess implementations, and update the sync/merge/store test suites.

## Steps to Reproduce Context

1. Existing users have v1 records under `worktime:staging:v1:<ownerId>`; the app loads and must migrate them in place without data loss.
2. A user checks/unchecks a habit locally; the change stages and pushes through `apply_staged_sync`.
3. Two devices edit the same habit or completion; LWW/tombstone semantics resolve deterministically.

## Expected Behavior

Habits sync across devices like tasks/logs: v2 records load transparently (v1 migrated in-record), habit upserts/tombstones and completion upserts/tombstones flow through merge → PushPlan → `apply_staged_sync`, pending counts include habit changes, and replaying the same completion is an idempotent no-op.

## Actual Behavior

The sync protocol has no habit awareness: `STAGING_SCHEMA_VERSION` is 1, `SyncSnapshot`/`StagedOwnerRecord`/`PushPlan` carry only tasks/logs/settings/timer/PM, `countPending` ignores habits, and `apply_staged_sync` takes 12 args with no habit handling.

## Requirements for completed issue

1. Staging schema is advanced to v2 with an in-record migration so existing v1 records load without data loss; the parser remains fail-closed for unknown/newer versions.
2. `SyncSnapshot`, `merge.ts` (`mergePulledSnapshot`, `buildPushPlan`, `commitAcknowledgedPush`), `PushPlan`/`AcknowledgedChanges`, `countPending` (store and merge), and `SyncCoordinator` handle habits and completions with the established LWW/tombstone/idempotency semantics.
3. `apply_staged_sync` gains 4 new args — LWW-gated habit upserts, guarded habit tombstones, idempotent completion upserts, identity completion tombstones — with updated grants and comments.
4. All three DataAccess implementations (`SupabaseDataAccess`, `InMemoryDataAccess`, `StagedDataAccess`) expose habit load/save, and the existing sync/merge/store test suites are updated to cover the new domain.

## Context

- Files: `src/lib/data/staging/types.ts` (`StagedOwnerRecord`, `SyncSnapshot`, `STAGING_SCHEMA_VERSION = 1`, fail-closed `parseStagedOwnerRecord`), `src/lib/data/staging/LocalStagingStore.ts` (`countPending`, `update`), `src/lib/data/sync/types.ts` (`PushPlan`, `AcknowledgedChanges`), `src/lib/data/sync/merge.ts` (pure three-way merge), `src/lib/data/sync/SyncCoordinator.ts`, `src/lib/data/sync/timerCompletions.ts` (`completionMask`), `src/lib/data/SupabaseDataAccess.ts` (PushPlan → RPC mapping), `src/lib/data/DataAccess.ts`, `supabase/migrations/20260802010000_staged_sync_rpc.sql`.
- Code Snippets:

```ts
// src/lib/data/staging/types.ts — currently fail-closed against newer schema versions
export const STAGING_SCHEMA_VERSION = 1 as const;
...
if (parsed.schemaVersion !== STAGING_SCHEMA_VERSION) {
    throw new StagingStorageError(
        `Unsupported staging schema version ${String(parsed.schemaVersion)} ...`
    );
}
```

```sql
-- supabase/migrations/20260802010000_staged_sync_rpc.sql — current 12-arg signature
create or replace function public.apply_staged_sync(
    p_task_upserts jsonb, p_task_tombstones jsonb,
    p_log_upserts jsonb, p_log_tombstones jsonb,
    p_settings_data jsonb, p_settings_updated_at timestamptz,
    p_timer_data jsonb, p_timer_updated_at timestamptz, p_timer_new_generation boolean,
    p_pm_data jsonb, p_pm_updated_at timestamptz,
    p_full_wipe boolean
) returns void ...
```

## Notes

None.
