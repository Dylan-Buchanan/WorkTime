# Task: Add deterministic client log identity to engine and data-access contracts

## Classification

Type: T2: moderate cross-module contract change
Reasoning: The change is mechanically clear but touches the shared type, four log-producing engine paths, and both current data-access implementations. Blast Radius=3, Uncertainty=1, Behavior=3, Testing=1, Reversibility=1. Total=9.

## Goal

Make every `PomodoroLogEntry` carry a client-generated UUID before it enters application state. Preserve engine purity by passing log IDs as command inputs, and keep stable ordering by `(finished_at, id)`.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/state/types.ts` | update |
| `src/lib/engine/core.ts` | update |
| `src/lib/engine/taskCommands.ts` | update |
| `src/lib/engine/timerCommands.ts` | update |
| `src/lib/engine/sessionCommands.ts` | update |
| `src/lib/data/InMemoryDataAccess.ts` | update |
| `src/lib/data/SupabaseDataAccess.ts` | update |
| `src/lib/engine/engine.test.ts` | update |
| `src/lib/data/InMemoryDataAccess.test.ts` | update |

## Step-by-Step Instructions

### 1. Require IDs on log entries

**File:** `src/state/types.ts`

Add `id: string` to `PomodoroLogEntry`. Do not add server ownership fields to the frontend domain type.

```ts
export interface PomodoroLogEntry {
    id: string;
    task_id: string;
    duration_minutes: number;
    finished_at: string;
    was_break: boolean;
    break_skipped: boolean;
}
```

### 2. Pass the ID into the pure engine

**Files:** `src/lib/engine/core.ts`, `src/lib/engine/taskCommands.ts`, `src/lib/engine/timerCommands.ts`, `src/lib/engine/sessionCommands.ts`

Change `appendLog` to accept `logId` and write it into the entry. Change every command that can append a log so the ID is an explicit deterministic input:

```ts
export function setActiveTask(state: AppStateData, taskId: string, now: Date, logId: string): EngineResult<void>;
export function completeTimer(state: AppStateData, now: Date, logId: string): EngineResult<AppStateData>;
export function stopWorkTimer(state: AppStateData, now: Date, logId: string): EngineResult<AppStateData>;
export function skipBreak(state: AppStateData, now: Date, logId: string): EngineResult<AppStateData>;
```

`setActiveTask` may not append a log when the selection does not interrupt a running work timer; accepting an unused generated ID in that no-op case is acceptable and keeps the signature simple. Do not generate UUIDs inside `src/lib/engine/`.

### 3. Inject one UUID factory in data-access implementations

**Files:** `src/lib/data/InMemoryDataAccess.ts`, `src/lib/data/SupabaseDataAccess.ts`

Add `createLogId?: () => string` to both option interfaces, default it to the same browser-safe UUID helper used for task IDs, and pass a fresh value to every log-producing command. Hydration must retain `row.id` instead of dropping it. `persist_transition` and `complete_timer` payloads must carry the ID unchanged.

Keep task-ID and log-ID injection separate so tests can assert the exact log identity without consuming task IDs.

### 4. Update fixed engine fixtures and ordering assertions

**Files:** `src/lib/engine/engine.test.ts`, `src/lib/data/InMemoryDataAccess.test.ts`

Add fixed IDs to all existing log fixtures and command calls. Assert that returned/stored logs retain those IDs. Add a regression case with equal `finished_at` values and distinct IDs, then sort through the shared ordering helper (or the data-layer ordering function if introduced) and assert ascending `(finished_at, id)` order.

## Edge Cases to Handle

- A command that produces no log must not append an empty or placeholder ID.
- Retried persistence must reuse the ID already present on the staged log; never generate a new ID during push.
- Hydration must reject a remote log row whose `id` is absent or not a string.
- Equal `finished_at` values must have deterministic ID ordering.
- Existing engine behavior and error messages must remain unchanged apart from the new deterministic input.

## Related Files (read-only context)

- `supabase/migrations/20260801000000_foundation.sql` - current server-generated log primary key
- `supabase/migrations/20260801020000_transactional_writes.sql` - current RPC INSERT lists that drop the ID
- `integration/timerCompletionGuard.integration.test.ts` - single-winner completion expectations

