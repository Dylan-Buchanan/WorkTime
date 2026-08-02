# Task: Execute all application commands against local staging

## Classification

Type: T2: moderate data-access implementation
Reasoning: The task maps established pure engine commands onto one new store and test seam; it touches several interfaces but deliberately excludes network merge/orchestration. Blast Radius=3, Uncertainty=1, Behavior=3, Testing=1, Reversibility=1. Total=9.

## Goal

Implement a `StagedDataAccess` whose timer/task/PM methods read, mutate, and persist only the current owner's staging record. No application command may call Supabase; sync remains an injected, separately testable operation.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/data/DataAccess.ts` | update |
| `src/lib/data/StagedDataAccess.ts` | create |
| `src/lib/data/StagedDataAccess.test.ts` | create |
| `src/lib/data/InMemoryDataAccess.ts` | update |
| `src/lib/data/InMemoryDataAccess.test.ts` | update |

## Step-by-Step Instructions

### 1. Add sync observability to the shared interface

**File:** `src/lib/data/DataAccess.ts`

Keep all existing command names, result shapes, and `DataAccessAuthError`. Add the sync-facing contracts required by contexts without exposing Supabase:

```ts
export type SyncStatus = "idle" | "syncing" | "success" | "error";
export type SyncReason = "bootstrap" | "manual" | "focus" | "visibility" | "pagehide" | "bridge" | "close";

export interface SyncOptions {
    reason: SyncReason;
    bestEffort?: boolean;
}

export interface SyncResult {
    state: AppStateData;
    pmState: SyncedPMState | null;
    pendingCount: number;
    initialized: boolean;
}

export interface DataAccess {
    // existing methods...
    deleteTask(taskId: string): Promise<EngineResult<void>>;
    deletePomodoroLog(logId: string): Promise<EngineResult<void>>;
    sync(options: SyncOptions): Promise<SyncResult>;
    pendingCount(): number;
    isInitialized(): boolean;
    reloadFromStorage(): void;
    subscribe(listener: () => void): () => void;
}
```

Define a small `SyncExecutor` interface used by `StagedDataAccess` so this task can inject a zero-network fake and the later coordinator can supply the production implementation.

### 2. Implement local command transitions

**File:** `src/lib/data/StagedDataAccess.ts`

Use constructor injection for owner, store, clock, task/log UUID factories, and `SyncExecutor`:

```ts
export interface StagedDataAccessOptions {
    now?: () => Date;
    createTaskId?: () => string;
    createLogId?: () => string;
}

export class StagedDataAccess implements DataAccess {
    constructor(
        ownerId: string,
        store: LocalStagingStore,
        syncExecutor: SyncExecutor,
        options?: StagedDataAccessOptions,
    );
}
```

Create one private transition helper that loads the latest record, runs the engine command, compares before/after slices, stamps changed task IDs and singleton rows with the injected `now()`, updates completion-generation metadata where applicable, persists once, and returns cloned results. Do not call `fetchState()` after a command and do not call the `SyncExecutor` implicitly.

`fetchState()` runs `getState` maintenance locally and stages any maintenance changes. Expired timer reconciliation also executes locally and returns the existing `reconciledTimer` shape so `AppStateContext` keeps its notification/auto-progression contract.

### 3. Stage PM state immediately and preserve UI separation

**File:** `src/lib/data/StagedDataAccess.ts`

`savePMState` must clone only `{projects,tasks,meta}`, write it immediately to `record.pmState`, and stamp `pmUpdatedAt`. `loadPMState` reads only that staged slice. Neither method reads or writes `pm_state_v1` UI preferences.

### 4. Stage deletes and reset intent

**File:** `src/lib/data/StagedDataAccess.ts`

Implement the `DataAccess.deleteTask` and `DataAccess.deletePomodoroLog` contracts needed by the sync architecture even though the current UI has no log-delete control. A task deletion runs the existing pure engine command, removes the local task, and writes a timestamped tombstone. A log deletion removes by UUID and writes a log tombstone while returning the updated cloned app state. Implement the same methods in `InMemoryDataAccess` so tests and future existing callers do not need type casts.

`resetAppState` must replace only timer/task app state with engine defaults, clear scoped task/log staging, set `fullWipe`, and set `timerCompleted=false`. It must not change `pmState`, `pmUpdatedAt`, or PM UI preferences.

### 5. Make the in-memory seam satisfy the extended interface

**File:** `src/lib/data/InMemoryDataAccess.ts`

Add deterministic pending/subscription/sync behavior for context tests. Support an `onSync?: (options: SyncOptions) => void | Promise<void>` option and a sync call counter or observable hook. Local commands notify subscribers. Do not turn this fake into a localStorage implementation.

### 6. Prove command locality and state safety

**Files:** `src/lib/data/StagedDataAccess.test.ts`, `src/lib/data/InMemoryDataAccess.test.ts`

Inject a `SyncExecutor` whose method throws/counts calls. Execute representative task, timer, settings, reset, and PM commands and assert zero sync/remote calls. Verify per-owner isolation, immediate local reads, UUID retention, timestamps from the injected clock, tombstones, full-wipe behavior, PM preservation, and subscriber notifications.

## Edge Cases to Handle

- Commands may run while the store is uninitialized; they stage safely but cannot cause a push until bootstrap succeeds.
- A storage write failure must reject the command without returning an unpersisted result.
- Engine errors must leave the record/revision unchanged.
- Concurrent local callers must each read the latest stored revision before mutation.
- `resetAppState` must not call or simulate `resetPM`.
- A timer completion race loser must return `applied=false` without adding a second journal/log; detailed journal resolution is completed in Task 07.

## Related Files (read-only context)

- `src/lib/engine/index.ts` - command exports
- `src/lib/data/staging/LocalStagingStore.ts` - persistence/update contract
- `src/state/AppStateContext.tsx` - existing `FetchStateResult` and completion expectations
- `src/components/SettingsPanel.tsx` - current UI-side PM reset corrected in Task 13
