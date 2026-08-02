# Task: Implement the pure three-way merge and push plan

## Classification

Type: T2: complex but pure merge logic
Reasoning: Conflict resolution is high-impact, but it is isolated in pure TypeScript with fully specified inputs, deterministic ties, and no I/O. Blast Radius=2, Uncertainty=1, Behavior=4, Testing=2, Reversibility=1. Total=10.

## Goal

Convert `lastSynced`, current staging, and a new remote pull into a deterministic merged staging record and an idempotent push plan covering task fields, singleton rows, log union, tombstones, full wipe, and live-timer protection.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/data/sync/types.ts` | create |
| `src/lib/data/sync/merge.ts` | create |
| `src/lib/data/sync/merge.test.ts` | create |

## Step-by-Step Instructions

### 1. Define transport-neutral merge outputs

**File:** `src/lib/data/sync/types.ts`

Define a `PushPlan` that exactly matches the staged-sync RPC while keeping SQL naming out of the pure engine:

```ts
export interface PushPlan {
    baseRevision: number;
    taskUpserts: Array<{ value: Task; updatedAt: string }>;
    taskTombstones: Array<{ id: string; deletedAt: string }>;
    logUpserts: PomodoroLogEntry[];
    logTombstones: Array<{ id: string; deletedAt: string }>;
    settings: VersionedValue<Settings> | null;
    timerState: (VersionedValue<TimerStateSlice> & { newGeneration: boolean }) | null;
    pmState: VersionedValue<SyncedPMState> | null;
    fullWipe: boolean;
    acknowledged: AcknowledgedChanges;
}
```

Also define `MergeResult { record, remoteBaseline, pendingCount }` and helper equality/timestamp comparison types. `acknowledged` must identify exact values/tombstone timestamps rather than saying "clear all pending".

### 2. Implement task field-level three-way merge

**File:** `src/lib/data/sync/merge.ts`

For each task ID in the union of baseline/local/remote/tombstones:

1. Compare every persisted task field (`name`, target/completed counts, created/completed dates, skips, archive flag) against the baseline.
2. If only local changed a field, keep local; if only remote changed it, take remote; if neither changed, keep either equal value.
3. If both changed the same field, choose the row with later `updatedAt`; choose remote on an exact tie.
4. Use `max(localUpdatedAt, remoteUpdatedAt)` as the merged row timestamp.

A local task tombstone competes with a remote row using `deletedAt` versus remote `updatedAt`; newer deletion wins and remains pending, newer remote update revives the task and clears that tombstone. Remote absence relative to a baseline row is treated as a remote deletion.

### 3. Implement singleton, log, wipe, and live-timer rules

**File:** `src/lib/data/sync/merge.ts`

Settings, timer data, and PM state are whole-row three-way merges: unchanged branch yields to changed branch; true conflicts use `updatedAt` with remote winning ties.

Logs are a map/union by `id` and are always materialized to `AppStateData.logs` sorted by `finished_at`, then `id`. A local tombstone for a baseline log remains pending until pushed; a brand-new remote log is retained unless the same immutable ID is explicitly tombstoned.

If `record.fullWipe` is present, ignore remote tasks/logs/settings/timer for the merged local app slice, retain engine defaults and the wipe marker, and merge PM normally. Do not synthesize PM deletion.

Before merging timer state, compute:

```ts
export function isLiveTimer(timer: ActiveTimer | null, now: Date): boolean {
    return !!timer && !timer.paused && Date.parse(timer.ends_at) > now.getTime();
}
```

When true, keep the complete local timer-state slice regardless of remote timestamp. Continue merging tasks, logs, settings, and PM. Paused or expired timers are not protected.

### 4. Build only the delta that still differs from the pulled baseline

**File:** `src/lib/data/sync/merge.ts`

Export pure entry points:

```ts
export function mergePulledSnapshot(record: StagedOwnerRecord, remote: SyncSnapshot, now: Date): MergeResult;
export function buildPushPlan(record: StagedOwnerRecord): PushPlan;
export function commitAcknowledgedPush(record: StagedOwnerRecord, plan: PushPlan, pushed: SyncSnapshot): StagedOwnerRecord;
```

`buildPushPlan` must throw a bootstrap error when `record.initialized` is false or `lastSynced` is null. It includes only changed entities and markers. `commitAcknowledgedPush` clears an item only when the current stored value still equals the acknowledged value from `plan`; edits made after `baseRevision` stay pending against the new baseline.

### 5. Exhaustively unit-test the merge matrix

**File:** `src/lib/data/sync/merge.test.ts`

Use table-driven cases for local-only, remote-only, same-field conflict, different-field preservation, tie behavior, remote deletion, tombstone win/revival, JSONB whole-row conflict, log dedup/order/delete, full wipe with PM survival, initialized guard, live/paused/expired timer behavior, retry-identical plans, and a concurrent post-plan edit surviving commit.

## Edge Cases to Handle

- Missing baseline rows and null singleton rows must distinguish "never existed" from default UI/domain values.
- Invalid timestamps must fail safely; do not silently order `NaN` dates.
- Task `created_at` is mergeable data but should normally be stable; remote/local divergence still follows the declared rule.
- A remote task deletion must not delete a task independently created locally after the baseline.
- Full wipe must produce default settings/timer payloads for the transactional RPC even though the remote rows were deleted.
- Pure merge code must not access `Date.now`, localStorage, Supabase, or UUID generation directly.

## Related Files (read-only context)

- `src/lib/data/staging/types.ts` - persisted shapes and timestamps
- `src/lib/engine/core.ts` - app defaults and clone behavior
- `supabase/migrations/20260802010000_staged_sync_rpc.sql` - push contract and server-side LWW predicates
- `docs/requirements/local-first-staged-sync.md` - authoritative merge decisions
