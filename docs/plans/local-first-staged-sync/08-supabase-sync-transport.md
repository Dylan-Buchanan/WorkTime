# Task: Refactor Supabase access into a paginated sync transport

## Classification

Type: T2: authenticated remote transport change
Reasoning: The class remains the only Supabase frontend boundary and follows existing pagination/error patterns, but it now covers all tables, session refresh, two RPCs, and strict row validation. Blast Radius=2, Uncertainty=1, Behavior=5, Testing=2, Reversibility=1. Total=11.

## Goal

Turn `SupabaseDataAccess` from the per-command source of truth into an authenticated remote used only by the sync coordinator: pull complete versioned snapshots, apply timer CAS operations, push ordinary staged changes transactionally, and refresh expired sessions without owning local state.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/data/sync/types.ts` | update |
| `src/lib/data/DataAccess.ts` | update |
| `src/lib/data/SupabaseDataAccess.ts` | update |
| `integration/SupabaseDataAccess.integration.test.ts` | update |
| `integration/timerCompletionGuard.integration.test.ts` | update |
| `integration/localFirstSync.integration.test.ts` | create |

## Step-by-Step Instructions

### 1. Define the remote-only interface

**File:** `src/lib/data/sync/types.ts`

Add:

```ts
export interface SyncRemote {
    pull(expectedOwnerId: string): Promise<SyncSnapshot>;
    installTimerGeneration(expectedOwnerId: string, entry: PendingTimerCompletion): Promise<void>;
    completeTimer(expectedOwnerId: string, entry: PendingTimerCompletion): Promise<boolean>;
    push(expectedOwnerId: string, plan: PushPlan): Promise<void>;
    refreshSession(expectedOwnerId: string): Promise<void>;
}
```

The owner argument is a verification value, not an RPC/DML owner input.

### 2. Strengthen auth errors without leaking staged data

**File:** `src/lib/data/DataAccess.ts`

Extend `DataAccessAuthError` so callers can distinguish no session, refresh failure, and owner mismatch while retaining `name="DataAccessAuthError"` and a stable auth-category code. Do not include access tokens or serialized session contents in messages.

### 3. Make `pull` read all versioned slices

**File:** `src/lib/data/SupabaseDataAccess.ts`

Keep `PAGE_SIZE=500` and the existing page loop. `pull` must:

- verify the current session owner equals `expectedOwnerId`;
- page tasks ordered by `id` and logs ordered by `finished_at,id`;
- select/validate task `updated_at` and log `id`;
- select `data,updated_at` for settings and PM;
- select `data,completed,updated_at` for timer state;
- represent absent singleton rows as `{value:null,updatedAt:null}` rather than substituting defaults;
- return a cloned `SyncSnapshot` with logs keyed by ID.

Remove read-side maintenance and expired-timer completion from the remote pull. Those mutations now occur locally in `StagedDataAccess` and are journaled.

### 4. Route writes through the existing CAS and new batch RPC

**File:** `src/lib/data/SupabaseDataAccess.ts`

`installTimerGeneration` calls the unchanged `persist_transition` signature with only timer data and `p_timer_new_generation=true`. `completeTimer` calls unchanged `complete_timer` with the journal's exact expected timer, result timer slice, client-ID log, and changed task, returning its boolean `applied` result.

`push` converts `PushPlan` to `apply_staged_sync` parameter names exactly, sends null for unchanged singletons, and never adds unresolved completion-derived rows. It must not issue direct per-table writes or split full wipe across requests.

### 5. Implement explicit session refresh support

**File:** `src/lib/data/SupabaseDataAccess.ts`

`refreshSession` calls `client.auth.refreshSession()`, requires a resulting session, and verifies the same owner. It throws `DataAccessAuthError` on failure. Ordinary `pull`/write methods still call `getSession()` before DML; the coordinator decides when to retry the whole sync.

### 6. Adapt transport integration tests

**Files:** `integration/SupabaseDataAccess.integration.test.ts`, `integration/timerCompletionGuard.integration.test.ts`

Replace per-command round-trip assertions with pull/push transport assertions. Keep unauthenticated access, transaction rollback, and two-client single-CAS-winner coverage. Add paged/order-aware log identity, task/singleton timestamps, idempotent retry, tombstone, and full-wipe-with-PM-survival cases where they are cheapest to prove against real Supabase.

### 7. Add the staged-sync RPC integration suite

**File:** `integration/localFirstSync.integration.test.ts`

Create a Vitest integration suite (run under `vitest.integration.config.ts` against local Supabase) that proves the `apply_staged_sync` RPC and the pull/push transport behave correctly under RLS, idempotency, and atomicity. Use the existing `createLocalUser`/`cleanup` lifecycle from `tests/supabase/localSupabase.ts` and construct a `SupabaseDataAccess` instance per case. Cover at minimum:

- **Idempotent staged batch under RLS:** push a `PushPlan` with task upserts, log upserts (fixed client UUIDs), tombstones, and singleton rows; assert the caller owner's rows match and a second owner's rows are untouched. Replay the same plan and assert no duplicate logs (`unique (owner_id, id)`), no duplicate tasks, and no spurious row creation.
- **Server-side LWW predicate:** push a task upsert with an older `updated_at` after a direct UPDATE has advanced the row; assert the stale timestamp is rejected and the newer server row survives. Repeat for settings/timer/PM singleton rows.
- **Tombstone DELETE propagation:** push a task tombstone whose `deleted_at` is newer than the current row's `updated_at` and assert deletion; push one whose `deleted_at` is older than a concurrent remote update and assert the remote row survives. Push a log tombstone by `(owner_id, id)` and assert deletion.
- **Transactional full wipe with PM survival:** push a `PushPlan` with `fullWipe=true` plus an invalid settings payload (e.g. violating a check constraint) and assert the whole batch rolls back — no tasks/logs/settings/timer rows changed. Then push a valid full-wipe plan plus an independent PM upsert and assert tasks/logs are gone, settings/timer are defaults with `completed=false`, and the `pm_state` row is the upserted value (unchanged by the wipe).
- **Pull pagination and ordering:** seed more than 1000 logs and assert `pull` returns all of them ordered by `(finished_at, id)` across pages.

Assert via the authenticated client only; never use service-role credentials in the test path. Clean up the throwaway user/rows in `afterEach`.

## Edge Cases to Handle

- `getSession()` may return no session without an SDK error; convert it to `DataAccessAuthError`.
- A refreshed session belonging to another user must never access or overwrite the original owner's local record.
- Empty singleton tables must remain distinguishable from default application values.
- Pulls over `api.max_rows=1000` must continue until a short page.
- Supabase error details may be surfaced, but tokens, service-role keys, and staged payload dumps must not be logged.
- The class must not expose timer/task command methods as the production application path after Task 09 wiring.

## Related Files (read-only context)

- `src/lib/supabase.ts` - `autoRefreshToken` client configuration
- `src/lib/supabaseAuthStorage.ts` - persisted GoTrue session key
- `tests/supabase/localSupabase.ts` - integration user lifecycle
- `supabase/config.toml` - API row cap

