# Task: Preserve timer-generation CAS semantics while completions are staged

## Classification

Type: T2: focused concurrency state machine
Reasoning: Timer completion is concurrency-sensitive, but the task is isolated to explicit journal records and pure winner/loser transformations with injected inputs. Blast Radius=2, Uncertainty=1, Behavior=5, Testing=2, Reversibility=1. Total=11.

## Goal

Record enough information when a timer completes locally to replay or reject that exact generation through `complete_timer` during sync, preventing duplicate task progress/logs while preserving later unrelated local edits.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/data/staging/types.ts` | update |
| `src/lib/data/StagedDataAccess.ts` | update |
| `src/lib/data/sync/timerCompletions.ts` | create |
| `src/lib/data/sync/merge.ts` | update |
| `src/lib/data/sync/timerCompletions.test.ts` | create |
| `src/lib/data/StagedDataAccess.test.ts` | update |

## Step-by-Step Instructions

### 1. Persist an exact completion record

**File:** `src/lib/data/staging/types.ts`

Define a completion entry that can distinguish a generation, call the existing RPC, and undo only completion-derived values on a CAS loss:

```ts
export interface PendingTimerCompletion {
    generationKey: string;
    sequence: number;
    expectedTimer: ActiveTimer;
    expectedTimerState: TimerStateSlice;
    resultTimerState: TimerStateSlice;
    taskBefore: Task | null;
    taskAfter: Task | null;
    log: PomodoroLogEntry;
    localOnlyGeneration: boolean;
    completedAt: string;
}
```

Generate `generationKey` from a canonical serialization of the complete `ActiveTimer` payload; do not use object insertion order or a random value. `localOnlyGeneration` is true when the expected timer is not the timer in `lastSynced` for that owner.

### 2. Make local completion single-winner and journaled

**File:** `src/lib/data/StagedDataAccess.ts`

Inside the staging store's read-modify-write update, reject completion when the current timer differs from `expectedTimer`, when the current record says that generation is already completed, or when the journal already contains the generation key. On the winner, run the engine once, capture exact before/after task and timer slices plus the one generated log, set the local completion guard, append one journal entry, and persist atomically with the resulting state.

Starting a work/break timer records a new local generation and sets `timerCompleted=false`; it must not erase unresolved older completion entries. Sort multiple journal entries by `sequence`/completion time for replay.

### 3. Implement pure winner/loser transformations

**File:** `src/lib/data/sync/timerCompletions.ts`

Export:

```ts
export function timerGenerationKey(timer: ActiveTimer): string;
export function completionRpcPayload(entry: PendingTimerCompletion): CompletionRpcPayload;
export function applyCompletionWinner(record: StagedOwnerRecord, entry: PendingTimerCompletion): StagedOwnerRecord;
export function applyCompletionLoser(record: StagedOwnerRecord, entry: PendingTimerCompletion, remote: SyncSnapshot, now: Date): StagedOwnerRecord;
```

The winner removes the exact journal entry only after the server has acknowledged it and incorporates the server completion into the baseline. The loser removes the exact client log ID, reverts completion-derived task fields only when the current local field still equals `taskAfter` (so a later user edit survives), adopts the remote winner's task/cycle/completion state, and then applies the normal live-timer rule: a later currently running local timer may remain authoritative, but it cannot reintroduce the losing completion's log or progress.

For `localOnlyGeneration`, the coordinator may first persist `expectedTimerState` with `p_timer_new_generation=true` only if the merged LWW decision says this local generation is authoritative. The journal payload must be sufficient for that preparatory call. If the remote timer wins LWW, treat the local completion as a CAS loser without installing it on the server.

### 4. Exclude unresolved completion effects from generic push

**Files:** `src/lib/data/sync/timerCompletions.ts`, `src/lib/data/sync/merge.ts`

Provide helpers used by `buildPushPlan` to mask task/log/timer values owned by unresolved journal entries. Those values may reach Supabase only through `persist_transition` (local generation install) and `complete_timer` (CAS), never through `apply_staged_sync`. After each winner/loser resolution, rebuild the ordinary merge/push plan.

### 5. Test generation races and preservation

**Files:** `src/lib/data/sync/timerCompletions.test.ts`, `src/lib/data/StagedDataAccess.test.ts`

Cover same-generation double completion, two staged access instances sharing one store, synced-generation winner, CAS loser cleanup, local-only generation preparation, multiple chronological completions, exact log removal, and a later task edit surviving loser rollback. Assert the RPC payload retains the client log ID and exact expected timer JSON.

## Edge Cases to Handle

- A paused timer is still the same generation and can be completed only after normal engine rules allow it.
- An expired but already journaled timer must not create a second UUID/log on a repeated `fetchState`.
- A CAS response lost after server commit must be safe to retry; log ID dedup plus the next pull resolves the journal.
- Later auto-started timer state must not be erased merely because the prior completion lost, unless remote LWW/live-timer rules require it.
- Do not change the public `complete_timer(jsonb,jsonb,jsonb,jsonb)` signature.

## Related Files (read-only context)

- `src/lib/data/InMemoryDataAccess.ts` - established completion guard test seam
- `src/lib/data/SupabaseDataAccess.ts` - current `completeHydrated` CAS call
- `supabase/migrations/20260801020000_transactional_writes.sql` - exact timer predicate
- `src/state/AppStateContext.tsx` - progression and race-loser behavior
