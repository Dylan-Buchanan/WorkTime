# Task: Orchestrate bootstrap, merge, CAS, retry, push, and safe commit

## Classification

Type: T2: cross-boundary sync orchestration
Reasoning: The coordinator controls high-impact ordering and auth retry, but delegates all persistence, merge, and transport details to already-tested interfaces and serializes one owner at a time. Blast Radius=3, Uncertainty=1, Behavior=4, Testing=2, Reversibility=1. Total=11.

## Goal

Implement the one sync action and make the authenticated application construct `StagedDataAccess` for the current owner. The action must never push before a successful pull, must be idempotent, and must not clear edits created during an in-flight sync.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/data/sync/SyncCoordinator.ts` | create |
| `src/lib/data/sync/SyncCoordinator.test.ts` | create |
| `src/lib/data/defaultDataAccess.ts` | update |
| `src/lib/data/StagedDataAccess.ts` | update |
| `src/lib/data/SupabaseDataAccess.ts` | update |
| `src/App.tsx` | update |

## Step-by-Step Instructions

### 1. Serialize/coalesce sync calls per owner

**File:** `src/lib/data/sync/SyncCoordinator.ts`

Implement `SyncExecutor` with one in-flight promise per instance. Focus, visibility, manual, bridge, close, and pagehide triggers arriving while a sync is running must share or queue behind that promise rather than execute overlapping pull/push cycles in one tab.

```ts
export class SyncCoordinator implements SyncExecutor {
    constructor(
        ownerId: string,
        store: LocalStagingStore,
        remote: SyncRemote,
        options?: { now?: () => Date },
    );
    sync(options: SyncOptions): Promise<SyncResult>;
}
```

`bestEffort` changes error presentation/caller behavior only; it must not weaken data-safety checks.

### 2. Enforce pull-before-push and merge order

**File:** `src/lib/data/sync/SyncCoordinator.ts`

For each attempt:

1. Call `remote.pull(ownerId)` first.
2. Only after pull succeeds, merge it into the latest stored revision and set `initialized=true` with a real baseline.
3. Resolve pending completion entries chronologically: install a local-only generation only when local timer LWW wins, call `complete_timer`, and on any attempt pull again before applying winner/loser reconciliation.
4. Re-read the latest staging record, build the ordinary `PushPlan`, and call `remote.push` only when the plan is non-empty.
5. Commit only acknowledged values/tombstones against the current revision and advance `lastSynced` to the successfully pushed/merged snapshot.
6. Return the final local state, PM slice, pending count, and initialized flag.

If the initial pull fails, leave `initialized` unchanged and do not call any remote write method. If a push fails, retain every unacknowledged staged change/marker for retry. A successful pull followed by failed push may leave `initialized=true` and the pulled baseline persisted, with local diffs still pending.

### 3. Retry auth failure once after refresh

**File:** `src/lib/data/sync/SyncCoordinator.ts`

Catch only `DataAccessAuthError`, call `remote.refreshSession(ownerId)` once, and restart the entire pull -> merge -> push attempt from persisted staging. Surface the auth error if refresh or retry fails. Do not retry arbitrary network/database errors in a tight loop; the user or later lifecycle trigger can retry without data loss.

### 4. Build the production owner-scoped graph

**File:** `src/lib/data/defaultDataAccess.ts`

Replace the module-level `new SupabaseDataAccess(supabase)` singleton with:

```ts
export function createDefaultDataAccess(ownerId: string): DataAccess {
    const store = new LocalStagingStore(window.localStorage);
    const remote = new SupabaseDataAccess(supabase);
    const coordinator = new SyncCoordinator(ownerId, store, remote);
    return new StagedDataAccess(ownerId, store, coordinator);
}
```

Handle environments without localStorage by surfacing a clear authenticated data error; do not silently fall back to network-per-command behavior.

### 5. Scope the instance to the authenticated user

**File:** `src/App.tsx`

Inside `AuthenticatedShell`, obtain the already-authenticated `session.user.id`, construct the graph with `useMemo`, and pass it to `DataProvider`. A user change must produce a new graph and owner key. Keep all four existing application providers behind `RequireAuth`; do not construct the graph in public auth routes.

### 6. Remove the legacy production command path

**Files:** `src/lib/data/StagedDataAccess.ts`, `src/lib/data/SupabaseDataAccess.ts`

Ensure every `DataAccess` command used by the app is implemented by `StagedDataAccess`. Remove or make private/unreachable any legacy Supabase per-command `transition()`/`hydrate()` path after integration tests have moved to the remote interface. Retain shared row validation/pagination and existing RPC methods used by sync.

### 7. Test orchestration failure boundaries

**File:** `src/lib/data/sync/SyncCoordinator.test.ts`

Use fake store/remote hooks to prove: bootstrap pulls before any write; failed pull never pushes; pull -> merge -> push advances the baseline; identical retry produces no duplicate work; failed push keeps pending data; completion winner/loser flow; full-wipe atomic plan; auth refresh then whole-attempt retry; refresh failure surfaces auth; concurrent local edit during push remains pending; and simultaneous triggers coalesce.

## Edge Cases to Handle

- Logging out or changing owner during a sync must cause owner verification failure and leave both owners' records isolated.
- A sync with no pending local changes still pulls and merges remote view changes.
- A storage clear during sync must make the final commit revision-aware and must never treat the replacement record as acknowledged.
- A full-wipe marker must not be cleared until the transactional RPC succeeds.
- Pagehide may terminate before the promise resolves; no correctness assumption may depend on its completion.

## Related Files (read-only context)

- `src/auth/AuthContext.tsx` - authenticated session lifecycle
- `src/auth/RequireAuth.tsx` - provider boundary guarantee
- `src/state/DataContext.tsx` - injected instance contract
- `src/lib/data/sync/merge.ts` - merge/build/commit functions
- `src/lib/data/sync/timerCompletions.ts` - completion journal resolution
