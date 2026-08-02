# Task: Define and persist the per-owner staging record

## Classification

Type: T2: moderate persistence primitive
Reasoning: This introduces a new local persistence boundary with versioning and subscriptions, but it is isolated from React and the network and has an injectable storage seam. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Create the localStorage-backed, per-owner record that holds local state, sync metadata, tombstones, full-wipe intent, completion journal entries, and the `lastSynced` baseline without ever confusing an absent record with an initialized empty server.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/data/staging/types.ts` | create |
| `src/lib/data/staging/LocalStagingStore.ts` | create |
| `src/lib/data/staging/LocalStagingStore.test.ts` | create |
| `AGENTS.md` | update |

## Step-by-Step Instructions

### 1. Define the persisted schema separately from UI/domain state

**File:** `src/lib/data/staging/types.ts`

Define serializable types for the timer row, versioned singleton rows, remote snapshots, tombstones, timer completion journal entries, and the owner record. Keep database transport metadata out of `AppStateData` except for the required log ID.

```ts
export interface TimerStateSlice {
    active_task: string | null;
    current_cycle_pomodoros: number;
    timer: ActiveTimer | null;
}

export interface VersionedValue<T> {
    value: T | null;
    updatedAt: string | null;
}

export interface SyncSnapshot {
    tasks: Record<string, { value: Task; updatedAt: string }>;
    logs: Record<string, PomodoroLogEntry>;
    settings: VersionedValue<Settings>;
    timerState: VersionedValue<TimerStateSlice> & { completed: boolean };
    pmState: VersionedValue<SyncedPMState>;
}
```

The persisted owner record must include at least:

```ts
export interface StagedOwnerRecord {
    schemaVersion: 1;
    ownerId: string;
    revision: number;
    initialized: boolean;
    state: AppStateData;
    pmState: SyncedPMState | null;
    taskUpdatedAt: Record<string, string>;
    settingsUpdatedAt: string | null;
    timerUpdatedAt: string | null;
    pmUpdatedAt: string | null;
    timerCompleted: boolean;
    taskTombstones: Record<string, { id: string; deletedAt: string }>;
    logTombstones: Record<string, { id: string; deletedAt: string }>;
    fullWipe: { createdAt: string } | null;
    pendingCompletions: PendingTimerCompletion[];
    lastSynced: SyncSnapshot | null;
}
```

`initialized` may become true only after a successful remote pull. `lastSynced === null` is valid only while uninitialized. Add runtime validation/migration dispatch based on `schemaVersion`; unknown/newer versions must throw a blocking staging error rather than silently overwriting local data.

### 2. Implement owner-keyed storage with read-modify-write updates

**File:** `src/lib/data/staging/LocalStagingStore.ts`

Create an injectable storage interface compatible with `window.localStorage` and use the key format `worktime:staging:v1:<ownerId>`. Export the prefix/key helper for storage-event filtering.

```ts
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export class LocalStagingStore {
    constructor(storage: StorageLike, options?: { now?: () => Date });
    read(ownerId: string): StagedOwnerRecord;
    update(ownerId: string, mutate: (current: StagedOwnerRecord) => StagedOwnerRecord): StagedOwnerRecord;
    replaceFromExternal(ownerId: string): StagedOwnerRecord;
    subscribe(ownerId: string, listener: () => void): () => void;
    pendingCount(ownerId: string): number;
    hasPending(ownerId: string): boolean;
}
```

`read` must read storage on every call so `localStorage.clear()` and other-tab writes are observed. An absent key returns a fresh uninitialized default record with default app state and null PM/baseline. `update` must re-read immediately before applying the mutation, increment `revision`, persist, then notify same-tab subscribers.

Do not cache the entire record as source of truth. Do not listen for browser `storage` events in this class; React lifecycle wiring owns that event and calls `replaceFromExternal`/notifies views.

### 3. Define one entity-based pending-count rule

**File:** `src/lib/data/staging/LocalStagingStore.ts`

Calculate pending work relative to `lastSynced`, not from a manually maintained counter. Count task upserts, task tombstones, new logs, log tombstones, and each changed settings/timer/PM singleton as one item. A full wipe counts as one scoped change instead of counting every removed row, plus one more only if PM independently differs. Completion-derived entities remain part of those entity counts; do not double-count the journal entry.

Return zero only when an initialized record exactly matches its baseline and has no markers/journal. An uninitialized but otherwise untouched record returns zero pending while still being ineligible to push.

### 4. Amend the repository guardrail narrowly

**File:** `AGENTS.md`

Replace the broad prohibition on local JSON persistence with wording that explicitly permits the per-owner localStorage staging store described by this feature. Retain prohibitions on Tauri invoke data paths, service-role/browser secrets, invite codes, and push/background-sync behavior. State that localStorage staging is the only application-data persistence exception and remains frontend-owned.

### 5. Unit-test persistence invariants

**File:** `src/lib/data/staging/LocalStagingStore.test.ts`

Cover distinct owner keys, absent records, `localStorage.clear()` between operations, revision increments, same-tab subscriptions, unknown schema versions, entity pending counts, full-wipe count behavior, and non-initialized default records. Use the jsdom storage from the existing test setup plus a small throwing/corrupt fake where needed.

## Edge Cases to Handle

- Clearing localStorage after a store instance is constructed must produce a new uninitialized record on the next read.
- A record whose embedded `ownerId` differs from the key owner must be rejected.
- Invalid JSON, an unknown schema version, or an unavailable/quota-failing storage write must surface an error and must never trigger a push.
- PM UI preferences under `pm_state_v1` and GoTrue's `sb-...-auth-token` key must remain untouched.
- Same-tab listeners must be notified after persistence succeeds, not before.

## Related Files (read-only context)

- `src/test/setup.ts` - global `localStorage.clear()` behavior
- `src/lib/supabaseAuthStorage.ts` - GoTrue key isolation
- `src/state/ProjectManagerContext.tsx` - separate `pm_state_v1` UI-only storage
- `docs/requirements/local-first-staged-sync.md` - bootstrap and guardrail invariants

