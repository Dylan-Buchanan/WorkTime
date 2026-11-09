# Research report — Epic #159 (waiting state + mid-window task switching)

Scope: worktree `epic/waiting-window` @ `e776d72`. Read-only; nothing was written. Sub-agent findings were spot-checked against the files cited below.

---

## Summary

The timer today is a **per-task** construct: `setActiveTask` credits the outgoing task and then computes the incoming task's duration from that task's saved partial-progress map, so a switch restarts the clock (`src/lib/engine/taskCommands.ts:32-72`). `inProgressPomodoros` is threaded through the engine, both `DataAccess` implementations, staging v9, the merge and five command signatures, and is owner-local only (`src/lib/data/staging/types.ts:139-140`). The PM layer is a **whole-blob LWW** singleton (`src/lib/data/sync/merge.ts:697-740`, `:1149`), writes through a non-functional `updateTask` (`src/state/ProjectManagerContext.tsx:647-656`), and the only cross-domain reconciler is `StateSyncBridge` (`src/state/StateSyncBridge.tsx:54-350`). Logs are inserted by exactly **three live SQL bodies**, all with explicit column lists, so unknown client fields are dropped (`supabase/migrations/20260802010000_staged_sync_rpc.sql:79`, `:163`; `20260805000000_habit_completion_tombstone_guard.sql:138`).

Two things the issues do not settle and which must be frozen: (a) three places where "window" and existing engine semantics conflict (expired-window switch vs. break auto-start; `finalizeTask` silently discarding a live window; window-relative vs. segment-relative progress), and (b) the break/expiry handoff rule that #173 and #178 currently state differently.

---

## A. Technical facts and recommended technical decisions

### A1. Current timer arithmetic (`#173` Q1)

- `makeTimer` (`src/lib/engine/timerCommands.ts:25-36`): `started_at = now`, `ends_at = now + planned`, `planned_secs = planned`, `accumulated_secs = 0`, `paused = false`, `paused_remaining_secs = 0`. Used for work **and** break timers (`:62`, `:75`).
- `startWorkTimer` (`:39-65`): optional cycle reset if `now - lastWorkLog.finished_at >= fullCycleDurationSecs` (`:48-56`); `workSecs = trunc(work_minutes*60)`; `planned = workSecs - resumablePomodoroElapsedSecs(map, taskId, workSecs)`; writes the map and **overwrites `next.timer` unconditionally** (no "already running" guard in the engine).
- `completeTimer` (`:81-113`): requires `now >= ends_at`; logs `planned/60` minutes (`:94`); work credit = `clampFraction(planned/workSecs)` (`:99-102`); `current_cycle_pomodoros += 1` for work only (`:103`); `timer = null` (`:105`).
- `stopWorkTimer` (`:116-141`): `elapsed = elapsedTimerSecs` (clamped to planned), credit `clampFraction(elapsed/workSecs)`, log `elapsed/60` (**even when 0**, `:134`), `timer = null`, **no cycle increment**.
- `setActiveTask` (`src/lib/engine/taskCommands.ts:20-76`): only acts when `timer.kind === "Work" && timer.task_id !== taskId` (`:32`). Credits outgoing `elapsed/workSecs` and logs `elapsed/60` only when `elapsed > 0` (`:38-43`); stores/deletes the outgoing map entry (`:45-53`); computes `targetBase` from the **incoming** task's saved progress (`:55-57`); `remaining = workSecs - targetBase`; sets `planned_secs = remaining`, `accumulated_secs = 0`, `started_at = now`, `ends_at = now + remaining`, `paused_remaining_secs = paused ? remaining : 0` (`:58-68`); or nulls the timer if `remaining <= 0` (`:69-71`). Then `active_task = taskId` (`:74`).
- `elapsedTimerSecs` (`src/lib/engine/core.ts:69-76`): `paused ? accumulated : accumulated + max(0, now-started_at)`, clamped `[0, planned]`.
- `plannedTimerSecs` (`:63-67`): `planned_secs` when `> 0`, else `ends_at - started_at`.
- `pauseTimer` (`src/lib/engine/sessionCommands.ts:10-25`): `accumulated += now - started_at`; `paused_remaining = planned - accumulated`; does **not** rewrite `ends_at`.
- `resumeTimer` (`:28-40`): `started_at = now`, `ends_at = now + paused_remaining`, `paused_remaining = 0`; `accumulated` is retained.
- `finalizeTask` (`src/lib/engine/taskCommands.ts:112-133`): if the live timer belongs to the task and is Work, **`next.timer = null` with no credit and no log** (`:120`) — see B3.
- `getState` (`src/lib/engine/stateCommands.ts:11-28`) archives completed tasks and clears `active_task` when archived, but never touches `timer`.

**Recommended arithmetic (no product change):** treat the window as `window_started_at` + `planned_secs` initialised to `workSecs` and never reset by a switch.

```
windowBudgetSecs(timer, settings)  = work_minutes*60               // Work only
windowRemainingSecs(timer, now)    = max(0, planned_secs - elapsedTimerSecs(timer, now))
windowElapsedSecs(timer, now)      = windowBudget - windowRemaining
```

Switch algebra (`setActiveTask`, running Work window):

```
elapsed   = elapsedTimerSecs(timer, now)            // integer seconds, clamped
remainder = planned_secs - elapsed                  // >= 0
if (now >= ends_at) -> expired path (A7 edge 2)
else:
  credit/lag elapsed exactly as today (only when elapsed > 0)
  nextTimer = { ...timer, task_id, planned_secs: remainder, accumulated_secs: 0,
                started_at: now,
                ends_at: paused ? addSeconds(now, remainder) : timer.ends_at,   // end time never moves
                paused_remaining_secs: paused ? remainder : 0 }
```

Conservation proof (integer seconds): `remainder_i = planned_{i-1} − trunc(e_i)` and `e_i ≤ planned_{i-1}`, so `Σ trunc(e_i) ≤ workSecs`; the final `completeTimer` credits and logs exactly `planned_last/60`. Credit and logged minutes for one window therefore sum to ≤ `work_minutes`; today they do not because `planned` is reset to `workSecs − targetBase`.

### A2. `inProgressPomodoros` inventory (`#173` Q2)

Full set, verified by repo-wide search (no matches in `e2e/`, `supabase/`, `scripts/`, or JSON fixtures):

- Module: `src/lib/engine/pomodoroProgress.ts` (whole file; exports at `:7,9,13,22,31`).
- Types/engine: `src/lib/engine/core.ts:3,8-9`; `index.ts:13-18`; `taskCommands.ts:13-17,25,28,35,45-57,75,82,91,99,107,116,131`; `timerCommands.ts:14-18,42,46,59-64,85,109-111,120,139`; `stateCommands.ts:8,63,66`.
- Data access: `src/lib/data/StagedDataAccess.ts:3,184,190,195-197,261-262,266-267,310,332,348-349,369,373,383,412`; `src/lib/data/InMemoryDataAccess.ts:3,69,131,137,189-190,227,232,251-262,269,274-275,280,284,458,478,509`.
- Staging: `src/lib/data/staging/types.ts:22,133,139-140,215,236-243,626,782-784`; `LocalStagingStore.ts:40-45,385,417-425,444-461,510-512`.
- Sync: `src/lib/data/sync/merge.ts:7,1097,1173`.
- Tests: `engine.test.ts:102,106,118,149,165,180,190,215-231,255-270,319-331`; `InMemoryDataAccess.test.ts:79-125`; `StagedDataAccess.test.ts:272,282,295,308,571,582,602,618`; `LocalStagingStore.test.ts:174,206,215,230,246,922,931,984-1003,1019,1062,1109`; `merge.test.ts:130,192,494-517,1046-1059`; `timerCompletions.test.ts:124`; **`goalsFoundation.test.tsx:53,72,76`** (a v8 full-record equality fixture that #173 does not list — it pins both `inProgressPomodoros: { task: 600 }` and `schemaVersion: 9` and will fail after v10).

### A3. Does a break timer carry `window_started_at`? (`#173` Q3)

**Recommendation: no, and optional everywhere.**

- A break is not a window; `window_started_at` on a break would be a fabricated identity and would make the "one window" invariant ambiguous. `#179` only needs identity for `was_break = false` logs (A24).
- `ActiveTimer.window_started_at?: string` (`src/state/types.ts:126-135`), set only by `makeTimer(..., "Work", ...)`.
- `isTimer` (`src/lib/data/staging/types.ts:271-280`) should accept it when present: `(value.window_started_at === undefined || typeof value.window_started_at === "string")`. `isTimerSlice` (`:282-289`) delegates and needs no change.
- Making it required would force `startBreakTimer` to invent a value, and would break every pre-upgrade `ActiveTimer` (staging `state.timer`, `pendingCompletions[*].expectedTimer`, `lastSynced.timerState.value.timer`) — all of which are validated by `isTimer`/`isAppState` (`:518-530`, `:596-609`, `:871`).

### A4. `data @> p_expected_timer` containment (`#173` Q4)

- Live guard: `public.complete_timer`, `supabase/migrations/20260802010000_staged_sync_rpc.sql:145-158`:
  `update timer_state set data = p_timer_data, completed = true … where owner_id = v_owner and completed = false and data @> jsonb_build_object('timer', p_expected_timer)`; `0` rows → returns `applied = false` (`:154-157`).
- It is **subset containment of the timer object only**; `active_task` / `current_cycle_pomodoros` are not compared, and extra stored keys do not block the match.
- Therefore:
  - **Old timer row (no field) + client expecting the field** → containment fails → `applied = false`. This is repaired by the existing install path: `StagedDataAccess.timerGenerationKey`/`sameAsLastSyncedTimer` marks the entry `localOnlyGeneration = true` when the local timer no longer equals `lastSynced.timerState.value.timer` (`src/lib/data/StagedDataAccess.ts:138-141,324`), and `SyncCoordinator.resolveCompletion` calls `installTimerGeneration` → `persist_transition` writes `expectedTimerState` (which contains the new field) before the CAS (`src/lib/data/sync/SyncCoordinator.ts:322-341`; `src/lib/data/SupabaseDataAccess.ts:550-561`).
  - **New timer row + old client** → old client's expected object is a subset → CAS still succeeds. New fields are forward/backward compatible in this direction. `p_timer_data` is stored verbatim; `timer_state` has **no** CHECK/RPC shape validation (only `20260801000000_foundation.sql:33-37`, `completed` at `20260801010000_timer_completion_guard.sql:1-2`).
- **No SQL migration is needed for the guard.** Client-side handling is exactly: never strip the field from `p_expected_timer`, and rely on the existing local-generation install. Caveat: if the install is skipped because `localTimerLwwWins` is false (`SyncCoordinator.ts:363-367`), the CAS loses and the loser path rolls the log/task back — same failure mode as today's concurrent-completion race, not new.

### A5. Journal generation keys and upgrade (`#173` Q5)

- `timerGenerationKey` = canonical JSON of the **whole** `ActiveTimer` with recursively sorted keys (`src/lib/data/sync/timerCompletions.ts:87-107`). Adding any field changes the key of every timer created after the change (intended).
- Pending entries are persisted in `StagedOwnerRecord.pendingCompletions` (`staging/types.ts:90-101,153`), validated by `isPendingCompletion` → `isTimer` (`:596-609`), so an old-shape entry loads as long as the field is optional.
- Replay uses the **stored** `entry.expectedTimer` (`completionRpcPayload` `:110-117`), not a recomputed key, so an old-shape entry replays correctly against an old-shape server row and against a newer row containing the extra field (subset containment).
- Dedup compares `entry.generationKey` with `timerGenerationKey(captured live timer)` (`StagedDataAccess.ts:230,288,301`). These can only diverge if the **live** timer shape changes while a journal entry for that same generation exists; a completion nulls the timer (`timerCommands.ts:105`), so the two cannot coexist.
- **Recommendation:** do **not** rewrite journal entries during the v9→v10 migration, and do not backfill `pendingCompletions[*].expectedTimer/expectedTimerState/resultTimerState`. Old entries resolve on their own. `applyCompletionWinner` writing an old-shape baseline (`timerCompletions.ts:134-141`) is harmless: the next pull sees the remote row as changed and adopts it.

### A6. Staging v9 → v10 (`#173` Q6)

- Version sites: `StagedOwnerRecord.schemaVersion: 9` (`staging/types.ts:133`), `STAGING_SCHEMA_VERSION = 9` (`:215`), gate literal list (`:701-715`), v5→v6 install (`:782-784`); `LocalStagingStore` writes the constant (`:40,407,420`).
- **Recommendation: bump to 10 and backfill a live Work timer.**
  ```
  if (record.schemaVersion === 9) {
    // drop the retired owner-local map
    const { inProgressPomodoros: _drop, ...rest } = record;
    let state = rest.state;
    const timer = isObject(state) ? state.timer : null;
    if (isObject(timer) && timer.kind === "Work" && typeof timer.started_at === "string"
        && (timer.window_started_at === undefined)) {
        const accumulated = typeof timer.accumulated_secs === "number" ? timer.accumulated_secs : 0;
        timer.window_started_at = new Date(Date.parse(timer.started_at) - accumulated * 1000).toISOString();
        state = { ...state, timer: { ...timer } };
    }
    record = { ...rest, schemaVersion: 10, state };
  }
  ```
  Rationale: gives one identity for every Work window after upgrade and keeps `#179` logs uniform; the CAS trace in A4 shows the resulting "local-only generation" install is already supported and is the intended repair path. Break timers and pre-existing journal entries stay untouched.
- **Dropped map:** delete the field and its required check (`:626`); nothing else is needed — credit already lives in `completed_pomodoros`/logs. `LocalStagingStore.discardPendingChanges` (`:444-461`) must lose its snapshot/restore of the field. Same for the v8 fixture in `goalsFoundation.test.tsx:53-77` and `LocalStagingStore.test.ts:978-1001`.
- Note `#173`'s claim "Records at v9 load successfully" is satisfied by the chain; `schemaVersion` is still accepted as a literal `10`.

### A7. Edge-case semantics (`#173` Q7, req 9)

All in `setActiveTask` (`src/lib/engine/taskCommands.ts`), with `elapsed = elapsedTimerSecs(timer, now)`, `remainder = planned_secs - elapsed`:

| Case | Engine behaviour |
|---|---|
| Switch at `t=0` | `elapsed = 0` → no credit, no log (`:38` already gates); `remaining = planned`; incoming `planned_secs = planned`, `accumulated = 0`, `started_at = now`, `ends_at` unchanged; `active_task` = incoming. |
| Window expired, not reconciled (`now >= ends_at`, `!paused`) | Take the **completion branch, not the switch branch**: credit `clampFraction(planned/workSecs)`, append log `planned/60` with the window id, `current_cycle_pomodoros += 1`, `timer = null`; `active_task = incoming`; **no new timer**. Exactly the same numbers as `completeTimer`. Then the break question in B1 applies. |
| Switch while paused | `elapsed = accumulated` (no wall time); credit/log that accumulated slice; `paused` stays `true`; `started_at = now`; `planned = remainder`; `paused_remaining = remainder`; `ends_at = now + remainder` (irrelevant while paused, `resumeTimer` rebuilds it). `completeTimer` can never fire on a paused timer (`src/state/AppStateContext.tsx:205-209` and `src/lib/data/StagedDataAccess.ts:223-224` both require `!paused`). |
| Outgoing archived | Task still in `tasks` → credit applies and the log is written (`taskCommands.ts:36-43` does not test `archived`). Keep this. |
| Outgoing completed/deleted | Task absent from `tasks` → skip credit, still write the log (same guard). Keep. `finalizeTask` is a separate problem — see B3. |
| Two rapid switches | Each switch credits `trunc(now − started_at)` since the previous `started_at` and resets it, so per-segment credit sums exactly; `Σ trunc(e_i) ≤ workSecs` (A1). Intermediate logs are legitimate slice logs. |
| Negative elapsed | `elapsedTimerSecs` already returns `max(0, …)`; keep. |
| Long pause then switch | `paused` stays true; nothing calls `completeTimer`; on resume `ends_at = now + paused_remaining` so the expiry check cannot trip. |
| `remainder === 0` inside the window (sub-second left) | Treat as the expired branch (credit full, cycle +1, `timer = null`) instead of today's silent `timer = null` without a cycle increment (`:69-71`). Otherwise the cycle silently loses a pomodoro. |
| Same task id | No-op in the engine (`:32`); `active_task` unchanged. Whether this counts as a new occupancy is B7. |

### A8. "A timer is already running" and the shared predicate (`#173` Q8)

Current guards:

| Path | Site | Behaviour |
|---|---|---|
| `AppState.startTaskWork` | `src/state/AppStateContext.tsx:286` | throws `"A timer is already running"` for **any** timer |
| `TodoContext.startPomodoro` | `src/state/TodoContext.tsx:235` | throws for any timer |
| `TodaySurface.handleStartFocus` | `src/components/TodaySurface.tsx:142-144` | inline notice, no throw |
| `TaskInspector` Start | `src/components/ProjectManager/TaskInspector.tsx:202-222` | **no guard**; calls `app.startWork()` → `ensureActiveTask` → `data.startWorkTimer()`, whose engine has no guard and overwrites the timer (`timerCommands.ts:63`) |
| `TimerPanel` Start | `src/components/TimerPanel.tsx:568-577` | rendered only when `!timer` |
| `TaskPanel` row | `src/components/TaskPanel.tsx:323-326` | `setActiveTask` only; no guard; engine switch applies |
| `StateSyncBridge` | `src/state/StateSyncBridge.tsx:198-267,335-347` | PM linking only; never starts timers |

**Recommended single predicate**, in `src/lib/engine/core.ts` because both the engine and React need it and it is pure:

```ts
export type WorkStartOccupation = "free" | "join" | "blocked";
export function workStartOccupation(timer: ActiveTimer | null): WorkStartOccupation
// null -> "free"; kind === "Work" -> "join"; otherwise -> "blocked"
export function windowStartedAt(timer: ActiveTimer): string   // timer.window_started_at ?? derived
export function isWorkWindowLive(timer: ActiveTimer | null, now: Date): boolean
// kind === "Work" && (paused || Date.parse(ends_at) > now.getTime())
```
`#173` must state that `TaskInspector` is also a start path and that it currently does not set the active task when it creates the backend task (`TaskInspector.tsx:205-222`): the `if (!appId)` branch never calls `app.setActiveTask(created.id)`, so `startWork()` either adopts the currently active task or throws `"Select a task first"` (`AppStateContext.tsx:253-260`). That is a latent bug the frozen contract has to cover because `#174` lists inspector Start as a path.

### A9. Does `startWorkTimer` need to change? (`#173` Q9)

**No — joining is `setActiveTask` only.** Minimal API:

```ts
// src/state/AppStateContext.tsx
const startTaskWork = async (id: string): Promise<"started" | "joined"> => {
  const timer = stateRef.current?.timer ?? null;
  switch (workStartOccupation(timer)) {
    case "blocked": throw new EngineError("A break is running");
    case "join":    await data.setActiveTask(id); /* engine credits + hands over */ return "joined";
    case "free":    await data.setActiveTask(id); await data.startWorkTimer(); return "started";
  }
};
```
- `#173` req 8 ("starting work while a break timer is live still refuses") is expressed by `"blocked"`.
- `startWorkTimer` should still gain a defensive guard (`if (next.timer) throw new EngineError("A timer is already running")`) so the inspector path cannot silently restart a live window; the progression caller only invokes it when `after.timer === null` (`AppStateContext.tsx:152-164`), so the guard is safe.
- `ensureActiveTask` (`:253-260`) keeps its role for the timer-page Start (`startWork`), which is not a join path.

### A10. Every work-start path (`#174` Q10)

| Path | Entry | Reaches backend via | PM write of that start |
|---|---|---|---|
| Timer page Start | `TimerPanel.tsx:568-577` → `startWork` (`AppStateContext.tsx:261`) | `ensureActiveTask` → `data.setActiveTask?` → `data.startWorkTimer` | none |
| Inspector Start | `TaskInspector.tsx:202-227` | `app.createTask` (create branch, no `setActiveTask`) or `app.setActiveTask(appId)` → `app.startWork()` | `updateTask({ appTaskId })` at `:212-214` (write-ahead, different call) |
| Today focus | `TodaySurface.tsx:141-162` | optional `createTask` → `updateTask({ appTaskId })` → `startTaskWork(appTaskId)` | `updateTask({ appTaskId })` at `:153` |
| To-do promotion | `TodoContext.tsx:232-251` | optional `app.createTask` → `commitTodos({ currentTaskId })` → `startTaskWork` | none (PM row is created asynchronously by the bridge, `StateSyncBridge.tsx:183-196`) |
| TaskPanel row | `TaskPanel.tsx:323-326` | `AppState.setActiveTask` → `data.setActiveTask` (`AppStateContext.tsx:252`) | none |
| Bridge auto-link | `StateSyncBridge.tsx:336-347` | none (PM only) | `updateTask({ appTaskId })` |
| PM `createTask` restore | `ProjectManagerContext.tsx:583-596` | `app.setActiveTask(activeBefore)` after creating | — (edge: this can move `active_task` while a Work window is live) |

Two facts matter for the enforcement design: (i) only the **timer** identifies an occupant (`appState.timer.task_id` when `kind === "Work"`); `active_task` alone is also mutated by selection and by `getState`, and during a break it means "next up". (ii) To-do promotion's PM row may not exist yet when the to-do start runs, so a per-call-site PM write cannot cover it.

### A11. One enforcement point (`#174` Q11, `#175` Q15)

**Recommendation: a single `StateSyncBridge` observer + a pure PM-domain helper + functional `updateTask`.**

Why not the call sites: `TodoContext` has no PM task id at start time (`TodoContext.tsx:244-250`; the PM row is created by `StateSyncBridge.tsx:183-196`), and `AppStateContext` cannot import `usePM` — `ProjectManagerContext` already consumes `useAppState` (`ProjectManagerContext.tsx:582-596`), so that direction is circular. `StateSyncBridge` is the only component that sees both states (`StateSyncBridge.tsx:55-58`).

```ts
// new: src/lib/pm/workStart.ts (pure, colocated test)
export function applyWorkStart(task: PMTask, nowIso: string): PMTask;
// status: Backlog|Next -> "In Progress"; otherwise unchanged
// waiting: always -> null
// returns the same object when nothing changes (prevents no-op writes)

export function findPMTaskByAppTaskId(
  tasks: Readonly<Record<string, PMTask>>, appTaskId: string,
): PMTask | null;   // deterministic: lowest sortOrder, then createdAt, then id

export function workOccupantKey(timer: ActiveTimer | null): string | null;
// null unless kind === "Work": `${task_id}|${window_started_at ?? started_at}`
```

Observer contract (in `StateSyncBridge`, one effect):
1. Derive `nextKey = workOccupantKey(appState.timer)`.
2. If `nextKey === null || nextKey === lastOccupantKeyRef.current` → return; else store it.
3. `const pm = findPMTaskByAppTaskId(pmState.tasks, appState.timer.task_id)`; if absent, return (the metadata effect will create it; the effect re-runs when `pmState.tasks` changes).
4. `recordWorkStart(pm.id)`.

`recordWorkStart` must merge against the **latest persisted** task, not a render snapshot:

```ts
// ProjectManagerContext
recordWorkStart: (taskId: string, at?: string) => void;   // in PMContextShape (79-105)
const recordWorkStart = useCallback((taskId, at = now()) => {
  persist((prev) => {
    const t = prev.tasks[taskId];
    if (!t) return prev;
    const next = applyWorkStart(t, at);
    return next === t ? prev : { ...prev, tasks: { ...prev.tasks, [taskId]: next } };
  });
}, [persist]);
```

**Yes, a functional `persist` updater is sufficient — but only after `updateTask` is fixed.** Today `updateTask` reads `state.tasks[id]` from the render closure and precomputes `upd` before calling `persist` (`ProjectManagerContext.tsx:647-656`), so two writers in the same tick (e.g. inspector `{appTaskId}` + bridge status, or todo-row + status) can drop one patch. Move the read inside the updater:

```ts
const updateTask = (id, patch) => persist((prev) => {
  const t = prev.tasks[id]; if (!t) return prev;
  const normalized = hasOwn(patch, "dueDate") ? { ...patch, dueDate: normalizeTaskDueDate(patch.dueDate) } : patch;
  return { ...prev, tasks: { ...prev.tasks, [id]: { ...t, ...normalized, updatedAt: now() } } };
});
```

With that, all six writers compose: bridge estimate (`:124-133`), metadata (`:191-194`), progress (`:316-318`), Done (`:329-331`), title link (`:344-346`), and `recordWorkStart`. This does not make the writes *atomic* in one React commit, but it makes them commutative and loss-free, which is what `#174` req 4 can actually mean.

Effect dependencies must include `pmState.tasks`, `appState.timer.task_id`, `.kind`, `.window_started_at` and `recordWorkStart`. Guard against re-application with the `lastOccupantKeyRef`; without it, a manual status change while the task is still active would be re-advanced on the next PM render.

### A12. PM ↔ backend mapping, and observer vs call sites (`#174` Q12)

- Mapping field: `PMTask.appTaskId` (`src/state/types.ts:54`). Reverse lookup is a linear scan everywhere (`StateSyncBridge.tsx:131,258,286,327,343`; `TimerPanel.tsx:254-265`; `TaskPanel.tsx:74-77`); there is no index map. `findPMTaskByAppTaskId` should be the single helper (and a `useMemo` map in `TaskPanel`/`TimerPanel` may reuse it).
- Duplicate `appTaskId` values are prevented on the create path (`ProjectManagerContext.tsx:531-547`) but not globally; the helper must be deterministic (A11).
- **Recommendation:** one observer (bridge) over per-path calls. It covers every row of A10 including to-do promotion and TaskPanel row activation, requires no signature changes at call sites, and is the only place that sees both providers. Per-path calls would need a PM id in `TodoContext` that does not exist yet, and would add a fifth/sixth write site to keep in sync.
- Timing consequence to document: the status advance lands one render after the timer starts, and `pmState.tasks` may not yet contain the row for the first few hundred ms after to-do promotion. `#174` tests must await the PM board, not assert a synchronous write.

### A13. `pm_state` merge (`#174`/`#175` Q13)

- `mergeSingletonValue` (`src/lib/data/sync/merge.ts:697-740`): stamp-first change detection; true conflict resolved by later `updatedAt`, **remote wins exact ties** (`:724-732`). Applied to `pm_state` at `:1149` (and `:1081` on full wipe); push is the whole blob (`:1606-1614`).
- **Confirmed: whole-blob LWW, no per-task merge** (contrast `mergeTaskRow` for backend tasks, `:167-202`). Two clients editing *different* PM tasks inside the same window → one entire blob is discarded.
- Consequence for concurrent waiting toggles: a flag set on device A can be silently lost if device B pushes a later-stamped blob without it. That is identical to every other PM field (status, estimate, workedPomos) and is a pre-existing property, not something `#175` introduces.
- Nothing is required. Document it as a known limitation; do not add three-way merge for `waiting` (it would leak into `pmUpdatedAt`/pending-count semantics and the whole-blob contract).

### A14. Does `waiting` leak? (`#175` Q14)

- `plannerContext.ts`: explicit projection (`toPlannerTask` `:224-240`; `buildAccuracy` `:185-222`); **no leak** into the model prompt (`startOfDayWorkflow.ts:307` serialises the built context only).
- Goal evidence: explicit field picks (`src/lib/goals/evidence.ts:106-113,120-126`); deck export consumes title strings only (`src/lib/goals/deck/plan.ts:51,92-96`).
- `goalSetFile.ts`: only `format/version/tracker/goals` (`:33-38`, `:207-232`); tasks never serialised. Requirement 10 of `#175` is a regression guard only.
- `diffEngine.ts`: `clonePMTask` spreads the task (`:78-86`) so `TaskChange.before` *would* carry `waiting`, but `COMPARED_FIELDS` (`:61-71`) excludes it, so it never creates a diff; `applyTaskChange.proposedTaskPatch` (`src/lib/agent/applyTaskChange.ts:11-26`) builds an explicit patch, so an approved agent update cannot erase the flag.
- **Recommendation: no exclusion needed.** Optionally strip `waiting` in `clonePMTask` for hygiene; not required by any consumer.

### A15. `PMTask.waiting` required vs optional (`#175` Q15)

Counts (object literals that satisfy `PMTask` and are type-checked; `e2e/` is outside `tsconfig.json:23`, so it cannot fail the build):
- **Production: 4 literals** — `ProjectManagerContext.tsx:534` (spreads `linked`, safe), `:550` (exhaustive, **would fail**), `:651` (spreads `t`), `:879` (spreads `Record<string, any>`).
- **Tests: 26 would fail** — 25 typed fixture builders (`createdTask`×3, `pmTask`×5, `task`×10, `currentTask`, `makePMTask`, etc.) plus the inline `savePMState` literal at `ProjectManagerContext.test.tsx:519`. Two lookalikes are safe (`LinearIntegrationCard.test.tsx:213` spreads, `ProjectManagerContext.test.ts:91` is `unknown`).
- **Total: 33 literals, 27 would fail.**
- **Recommendation:** declare `waiting?: PMTaskWaiting | null` on the interface, but freeze the **normalized runtime invariant** as "always `PMTaskWaiting | null` after `normalizeState`". Reasons: 27 fixture edits across ~20 files would collide with three other lanes for no behavioural gain; the model already uses optional nullable fields (`dueDate?`, `estimatePomos?`, `appTaskId?`); stored pre-v10 blobs are valid without the field. Add a single accessor `waitingOf(task): PMTaskWaiting | null` for UI and ranking so no caller relies on the optionality. If the coordinator prefers compile-time strictness, the alternative is `waiting: PMTaskWaiting | null` plus the 27 mechanical edits — state the choice in the contract.

### A16. `#176` facts (Q16)

- `buildTodayTasks` consumers: only `buildTodayOverview` (`src/lib/today.ts:208`) and `today.test.ts`; `TodaySurface` imports `buildTodayOverview` (`TodaySurface.tsx:11-12,117`). No other production consumer. Pinning cannot affect any other surface.
- Filter today: `classifyDueScope` + `getDailyProjectionScope(scope, project, reference)` (`today.ts:79-83`), i.e. the #172 rule. Sort today: bucket → `dueKey ?? "9999-12-31"` → title (`:85-92`). `remainingPomodoros` sums `entry.remainingPomodoros` (`:94`).
- Agreement assertion: `src/lib/today.test.ts:223-244` asserts `remainingPomodoros ≈ daily.totalPomodoros` (`:241`), **exact id order `["overdue","today","flexible"]`** (`:242`), and the week end key (`:243`). Adding a waiting fixture to *that* input will break `:242` unless (a) the waiting task is one of those three ids or (b) the assertion is changed to compare a sorted set while order is asserted separately. Flag this explicitly for `#176`; the issue text does not.
- Active-fraction coupling: `TodaySurface` passes `computeActiveFractionComplete(timer, …)` as `activeWorkFraction` (`TodaySurface.tsx:116`, `src/lib/timer.ts:267-273`), and `collectEligibleProjectionTasks` adds it to `worked` (`timer.ts:100-103`), so `remainingPomodoros` depends on it. Because it divides by `timer.planned_secs`, a switch resets the fraction to 0 and inflates the active task's remaining count. See B4 — this directly affects `#176` req 8.
- Details selection refs (`TimerPanel.tsx:230-232,268-274,276-306,316-346`):
  - `selectTaskFromToday` sets `todayDetailsTaskId` and clears `autoSelectedTaskRef` (`:301-306`).
  - The link-following effect **returns early while `todayDetailsTaskId` is set** (`:331-338`), so an explicit Today selection is never re-pointed.
  - A task that becomes `Done` disappears from `buildTodayTasks` (it is filtered at `timer.ts:88`) but **stays in `pmState.tasks`**, so `inspectorTask` (`:269`) stays non-null and `TaskInspector` keeps rendering the Done task. `todayDetailsTaskId` is only cleared in `closeDetails` (`:293`). There is no effect that clears it on Done/archive/absence. `#176` req 9 needs a new effect; the natural place is after `:327`: if `todayDetailsTaskId` no longer resolves to a non-archived, non-Done task in `pmState.tasks`, clear it and close details when it was the only source.
- If the task vanishes from `pmState.tasks` entirely, `inspectorTask` is `null` and the aside shows `emptyDetailsMessage` (`:359,695`) while `canShowDetails` stays true via `todayDetailsTaskId` (`:274`).

### A17. Accessible-label pattern and theme tokens (`#176` Q17)

- `TaskPanel` row: `title` tooltip on the `<li>` (`TaskPanel.tsx:322`), visible `ACTIVE` text badge (`:334`), and the only dot is the **group** colour dot with `aria-hidden` plus adjacent label text (`:300-301`). No `aria-label` or `sr-only` in the file.
- Repo convention: decorative dots are `aria-hidden` and rely on adjacent text (`TodaySurface.tsx:60-61`; `GoalsPage.tsx:335-337`; `TasksBoardView.tsx:194-198,248-251`); non-text/meaning-bearing chips use `role="img" aria-label` **and** `title` (`GoogleCalendarIntegrationCard.tsx:437`); interactive swatches use `aria-label` (`HabitsPage.tsx:275`).
- **Recommendation** for the waiting dot: `role="img"` + `aria-label={`Waiting on ${type}`}` + `title` (so screen readers get the fact and mouse users get the wording), with `data-testid` for tests. Colour alone must not be the only signal — requirement 5 is satisfied by the label, and the row tooltip (`:308-316`) should also append a `Waiting on …` line.
- Theme: no `src/components/ui`; theming is a theme-relative palette, not `dark:` variants (`docs/THEME.md:3-5,28-33`; `src/index.css:8,74-80,106-112`). `[data-theme="light"]` mirrors violet 100-400/900/950 and amber 100-400/900/950; dark uses Tailwind defaults. Components emit a single stock utility. Safe existing pairs: `text-violet-300` + `bg-violet-400/15` (`AgentPanel.tsx:79,584`), `text-amber-300` + `bg-amber-500/10` (`TimerPanel.tsx:540,614`). Use those two pairs for the waiting pill and do not introduce `dark:` classes.

### A18. `#172` predicate and ranking inputs (`#177` Q18)

- Predicate: `isProjectWorkableOnDate(project: Partial<ProjectSchedule>, reference: Date): boolean` at **`src/lib/projectSchedule.ts:35-37`**; the shared due+schedule wrapper is `getDailyProjectionScope(scope, project, reference): "due" | "unscheduled" | null` at **`src/lib/timer.ts:139-148`** (delivered by `40f1db9`, used by `today.ts:79-83` and `buildProjectionBacklogs`).
- Priority rank precedent: `{ High: 0, Medium: 1, Low: 2 }`, missing priority `3` (`TaskPanel.tsx:80-84,93`). Reuse it verbatim so the ranking and the task panel agree; move it to the new module or export it rather than duplicating numbers.
- Reuse decisions: `parseDueDateKey` (`timer.ts:21-29`) yes; estimate floor of `1` (`timer.ts:105-106`) yes; missing project → `null` (`timer.ts:107`) yes; **do not** touch `collectEligibleProjectionTasks` (`timer.ts:76-122`) — its contract is the shared projection scope, and `today.ts:78` and `TimerPanel.tsx:376-384` depend on it.
- "Due soon": three viable options are in B5.

### A19. `currentOccupantId` shape (`#177` Q19)

The timer refers to a **backend** task id (`ActiveTimer.task_id`), while the ranking operates on `PMTask` and the exclusion test is naturally `task.id === currentOccupantId`. Accepting a backend id would force a reverse lookup inside a pure module that then needs the ambiguity rules of A12.

**Recommendation:** freeze `currentOccupantId: string | null` as a **PM task id**, and require the caller to resolve it with `findPMTaskByAppTaskId`. Optionally add `currentOccupantAppTaskId?: string | null` only if the sheet needs to also suppress the backend-only row; not needed now.

### A20. Observing the linker (`#178` Q20)

- The linker is opaque today: reservations live in `linkingTaskIdsRef` (`StateSyncBridge.tsx:71,204-218`), failures are swallowed to `console.warn` and the reservation is released (`:248-252`), and the effect only re-runs when `pmState.tasks`/`appState` change (`:267`). There is no promise, no state, and no failure surface. Releasing the reservation means a persistent failure is retried forever on every `pmState` change — the UI can never see it.
- **Recommendation (minimal, no reimplementation of create/link):** publish observable link state from the bridge through the PM context.
  ```ts
  // PMContextShape additions
  linkingTaskIds: ReadonlySet<string>;              // reserved or in-flight
  linkFailures: Readonly<Record<string, string>>;   // last failure per PM task id
  retryLink: (pmTaskId: string) => void;            // clears failure + reservation
  ```
  Bridge changes: replace the ref with `useState`, add/remove ids at `:218/:207/:251`, and record `err.message` in the `catch` at `:248-252`. The sheet renders `preparing…` while `!appTaskId && (linkingTaskIds.has(id) || !linkFailures[id])`, an error row plus Retry when `linkFailures[id]` exists, and selects through `startTaskWork` once `appTaskId` lands (the sheet re-renders from `pmState`).
- Rejected alternative: `awaitLink(pmTaskId, timeoutMs)` promise. It needs cancellation, a listener registry and a timeout even when the bridge is healthy, and duplicates what React state already gives. If the coordinator prefers a promise, it must still add the failure map, because the bridge retries forever and a promise would hang.

### A21. `active_task` / outgoing ownership on expiry (`#178` Q21) — options in B6

Facts: `startBreakTimer` uses `active_task` for its `task_id` (`timerCommands.ts:68-77`), so a break "owns" the task that was active at completion. During a break, `setActiveTask` only mutates `active_task` because the engine switch requires `kind === "Work"` (`taskCommands.ts:32`) — that is the existing "line up next" behaviour, and `runProgression` starts the next work timer from `after.active_task` when the break completes (`AppStateContext.tsx:159-163`). Owning options are in B6.

### A22. Sheet placement (`#178` Q22)

- There is **no `src/components/ui`** (no such directory). Existing overlay pattern, repeated inline: `fixed inset-0 z-50` + `role="dialog" aria-modal="true"` + `aria-labelledby`/`aria-label` (`GithubIntegrationCard.tsx:725`, `LinearIntegrationCard.tsx:477`, `ShortcutIntegrationCard.tsx:398`, `ProjectManagerPage.tsx:204,220`, `PetTrainingTagDialog.tsx:31-33`); z-40 for lighter panels (`SettingsPanel.tsx:227-228`). No focus trap exists anywhere.
- The details aside is a real layout column on desktop and a `max-md:fixed` drawer with its own scrim on mobile (`TimerPanel.tsx:652-700`), driven by `detailsOpen` (`:230`) and the refs in A16.
- **Recommendation: a separate overlay** rendered by `TimerPanel` at `:509` scope, modelled on `GithubIntegrationCard.tsx:725`, `z-50`, `role="dialog"`, `aria-modal="true"`, `Escape` to close. Placing the sheet inside the aside would couple it to `detailsOpen`/`closeDetails`/`canShowDetails` and disturb the selection refs the issue explicitly wants left alone; it would also be inaccessible on mobile when the drawer is closed.

### A23. Live log-insert bodies (`#179` Q23)

Only **three** live insert sites; all use explicit column lists and per-key `->>` extraction — no `jsonb_populate_record`/`jsonb_to_record` anywhere in `supabase/`:

| Function (live) | Live body | Insert |
|---|---|---|
| `public.persist_transition` | `20260802010000_staged_sync_rpc.sql:25-112` | `:79` |
| `public.complete_timer` | `20260802010000_staged_sync_rpc.sql:126-206` | `:163` |
| `public.apply_staged_sync_without_todos` (innermost; renamed at `20260811000000_todos.sql:55-58`) | `20260805000000_habit_completion_tombstone_guard.sql:14-285` | `:135-150` (`:138`) |

Call chain for staged sync: `public.apply_staged_sync` (`20261031000000:86-131`) → `private.apply_staged_sync` (`:6-84`) → `private.apply_staged_sync_without_goals` (`20261003000000:11-56`) → `private.apply_staged_sync_without_pets` (`20260811020000:40-89`) → `public.apply_staged_sync_without_todo_completions` (`20261105000000:6-105`) → `public.apply_staged_sync_without_todos` (insert). The wrappers only pass `p_log_upserts` positionally, so **only the three bodies above need redefinition**. `20260801020000:59,129` and `20260802010000:329`/`20260804000000:159` are dead versions.

- **`p_log_upserts` does not forward unknown fields.** Only `id, task_id, duration_minutes, finished_at, was_break, break_skipped` are read (`20260805000000:140-146`), and `on conflict (owner_id, id) do nothing` (`:148`). Client spreads the whole log (`src/lib/data/SupabaseDataAccess.ts:613`), so `work_window_id` travels in the body and is dropped.
- **`SupabaseDataAccess.validateLog` (`:229-237`) reconstructs an explicit object**, so the field would also be dropped on pull even if the column existed. Must be updated.
- Fixtures that pin the row shape: `e2e/helpers.ts:23` (seed spread insert, tolerant), `:64-69` (select `*`, strips only `id`/`owner`; a new column would flow into the app state shape and must be mapped), `integration/SupabaseDataAccess.integration.test.ts:177-184` (field-by-field, tolerant but must gain the field to prove it), `integration/localFirstSync.integration.test.ts:346-348` (per-seed field comparison — tolerant), `e2e/analytics.spec.ts:15` and `e2e/timer.spec.ts:41,79` (read logs from app state, tolerant).
- Merge: logs are an immutable union keyed by id (`merge.ts:308-336,1123`); push spreads the whole log (`:1560-1568`), so the field round-trips and never becomes a conflict axis. `CompletionRpcPayload.p_log` is a clone (`timerCompletions.ts:110-117`).

### A24. `work_window_id` format, optionality, attribution (`#179` Q24)

- **Format: the `window_started_at` ISO string verbatim.** It is the window's identity; a composite (`window:task`) would break requirement 2 ("two slices share the same id") and a derived hash is unnecessary. `Date#toISOString` is the only producer, so precision is uniform. Column type **`text`**, not `timestamptz`: Postgres normalises/round-trips timestamps (`+00:00` vs `Z`), which would make the pulled value differ from the staged/queued value and perturb `valuesEqual`-based pending detection and push acks.
- **Optional in `isLog`, no v11 bump.** Historical rows, break rows and rows from older clients are absent/`null`. Validate `(value.work_window_id === undefined || value.work_window_id === null || typeof value.work_window_id === "string")` (`staging/types.ts:259-269`).
- **Attribution:**
  - `appendLog` gains a trailing `workWindowId: string | null = null` (call sites: `taskCommands.ts:42`, `timerCommands.ts:94,134`, `sessionCommands.ts:51`).
  - Switch log and `stopWorkTimer` log → `windowStartedAt(timer)`.
  - `completeTimer` → `windowStartedAt(timer)` (no-switch completion still stamps, requirement 9).
  - `finalizeTask` if it starts logging (B3) → `windowStartedAt(timer)`.
  - `skipBreak` → `null` (break skip is not window work; keep it absent rather than inventing a value).
  - Break logs (`completeTimer` on a break) → `null`.
  - Old live timer without the field → `windowStartedAt()` falls back to a derived value (A3/A6) so a log always has an identity.

### A25. `timer_state` server-side validation (`#179` Q25)

- **None.** `timer_state.data jsonb not null` with no CHECK (`20260801000000_foundation.sql:33-37`); every RPC stores it verbatim (`20260802010000:106,146,265,361`; `20260805000000:74,170`); no migration inspects keys or strips unknown keys. The only structural read is the completion containment predicate (`20260802010000:151`).
- **No server change is required for `window_started_at`.** It persists automatically through `persist_transition`/`apply_staged_sync`, and old-shape expectations still match (A4). Client validators: staging `isTimer` (add optional check) and `SupabaseDataAccess.validateTimer` (`:403-409`, clones the whole object — no change).

---

## B. Open product decisions (options → consequences → recommendation)

### B1. What happens right after an expired-window switch?

`#173` req 9 says "the cycle increments exactly once, and no new timer opens", while the existing completion pipeline always starts a break (`AppStateContext.tsx:152-164`).

- **Option 1 — no timer at all.** Switch completes the window, increments the cycle, nulls the timer, sets `active_task`; no break starts. Consequence: the user silently loses the break; the next Start opens a fresh window; tests are simple and it matches the literal requirement.
- **Option 2 (recommended) — completion plus the normal break.** The switch completes the window and AppState runs the ordinary progression, so a break starts exactly as a natural completion would. Consequence: "no new timer" must be read as "no new *work* timer" in the contract; requires `startTaskWork` to surface "the join became a completion" so AppState can call `runProgression` with the finished timer, or to let the existing `tick` effect do it (it may already race).
- **Option 3 — refuse the switch and force reconciliation first.** The engine throws, the UI shows "window finished" and the normal completion path runs. Consequence: safest accounting but breaks the "switch in two clicks" promise.
- **Recommendation:** Option 2, and freeze the wording as "no new **work** timer opens; the standard post-completion break path still runs". This keeps one accounting path (`completeTimer` numbers) and matches today's UX.

### B2. Charging the last sub-second remainder

When `0 < remainder < 1` the new switch yields `planned_secs = 0` and `timer = null` with no cycle increment (today `taskCommands.ts:69-71`).

- **Option 1 (recommended)** — treat `remainder <= 0` as the expired branch: credit the outgoing slice, log it, `current_cycle_pomodoros += 1`, `timer = null`. Consequence: one extra cycle tick that the user did earn; no window is ever dropped.
- **Option 2** — keep the silent null; consequence: a pomodoro can vanish from the cycle at the boundary.
- **Recommendation:** Option 1; state in the contract that "a window always produces exactly one cycle increment, whether it completes, is switched at expiry, or has < 1s left". `stopWork` remains the only no-increment exit.



### B3. `finalizeTask` on a live Work window

`finalizeTask` currently nulls the timer with no credit and no log (`taskCommands.ts:112-133`, particularly `:120`). `#173` req 9 says "outgoing task archived **or completed** mid-window: the log is still written; credit is applied only if the task still exists".

- **Option 1 — credit + log on finalize (recommended).** Add `logId` to `finalizeTask` and reuse the stop algebra before archiving. Consequences: signature change across the engine, `DataAccess`, `StagedDataAccess`, `InMemoryDataAccess` and callers (`TaskPanel.tsx:340`, `AppStateContext.tsx:272`); unambiguous "task completed mid-window still banks its partial"; consistent with switch and stop.
- **Option 2 — keep the discard.** Then `#173` req 9 must be narrowed to "archived" only, and the contract must say completing a task discards the window remainder (today's behaviour). Consequence: the "Complete" button on the active row silently drops work that the same click would bank if it were a switch — surprising.
- **Option 3 — route the UI through `stopWork` before `finalizeTask`.** No engine change; two commands, two logs? (`stopWork` writes one log and nulls the timer, then finalize archives.) Consequence: clean accounting, but every caller of `finalizeTask` must be audited, and the engine invariant is still "finalize discards".
- **Recommendation:** Option 1. It is the only option that satisfies req 9 as written and it keeps one credit/log helper.

### B4. Is the progress ring / Today active fraction window-relative or segment-relative?

`TimerPanel` computes the ring from `timer.planned_secs` (`:237-247`), and `computeActiveFractionComplete` (`src/lib/timer.ts:267-273`) divides by `planned_secs`; after a switch `planned_secs` becomes the remainder, so the ring resets to 0 % and the Today "Np left" for the active task jumps up.

- **Option 1 (recommended) — window-relative.** `fraction = (workSecs − windowRemainingSecs)/workSecs`; for an unswitched window this is numerically identical to today, so no test churn outside switches. Consequence: the ring reflects "one window", the Today total stays stable across a switch, and `#176` req 8 becomes meaningful.
- **Option 2 — segment-relative.** Keep `planned_secs` as the denominator. Consequence: the ring restarts on every switch and the Today estimate fluctuates; visually contradicts the feature's premise.
- **Option 3 — ring window-relative, Today segment-relative (or vice versa).** Inconsistent numbers between two surfaces; not recommended.
- **Recommendation:** Option 1, implemented in `computeActiveFractionComplete` and `TimerPanel`'s `pct`/`activeWorkPlannedSecs`, with a pure test that the fraction is unchanged for a single-occupant window.

### B5. "Due soon" boundary for the next-up tier

- **Option 1 (recommended) — reuse `classifyDueScope`/`getLocalWeekWindow`** (`src/lib/timer.ts:123-137`, `:36-45`): next-up candidates are `due`/`unscheduled` scope computed against today, i.e. **this local week**. Consequence: no new knob, matches the Today/projection vocabulary, deterministic, and inherits the #172 project-schedule filter. Downside: "due soon" is up to 6 days away on a Sunday.
- **Option 2 — fixed N-day horizon** (e.g. due within 3 local days). Consequence: needs a constant or an input; a Sunday/Monday boundary shifts what "3 days" means; more product tuning later.
- **Option 3 — today/overdue only.** Consequence: on quiet days next-up collapses to whatever is high priority; the tier adds little.
- **Recommendation:** Option 1. If a horizon is wanted later it can be expressed as a narrower predicate without changing the module signature.

### B6. Selection while a break is running / the window expired with the sheet open

`#173` req 8 ("starting work while a break timer is live refuses") and `#178` req 9 ("the switch still applies and the break proceeds normally") conflict.

- **Option 1 (recommended) — two-step outcome:** if the timer is still a live Work window, join it (`startTaskWork`, plus `resumeTimer()` if paused). If it has become a break (or no timer), call `setActiveTask(id)` only, which is the existing "next up" semantics (`taskCommands.ts:32` skips the switch for breaks; `AppStateContext.tsx:159-163` starts work for `active_task` when the break ends), and show a short notice. Consequence: `#173`'s refusal is preserved, the break's `task_id` (the outgoing task) is untouched, and the next window opens on the chosen task. Requires the sheet to branch on `timer.kind`, not to call `startTaskWork` blindly.
- **Option 2 — widen `startTaskWork` to queue during a break.** Consequence: violates `#173` req 8 as written; one API and simpler sheet, but "starting work" and "choosing next" become indistinguishable.
- **Option 3 — refuse and tell the user to skip the break.** Consequence: deterministic but the sheet's promise ("switch in two clicks") fails exactly when the window rolled over.
- **Recommendation:** Option 1, with the contract stating that `active_task` is "current occupant while a Work window is live, otherwise next-up", and that a break's `timer.task_id` is never rewritten by a selection.

### B7. Does re-starting the already-active task clear `waiting`?

`#175` req 7: the flag may be set on the running occupant and "clears only when that task becomes an occupant again".

- **Option 1 (recommended)** — a new **segment** counts as occupancy: `workOccupantKey` changes on task change or new window, so start-work on the same task while a window is live is a no-op in the engine (`taskCommands.ts:32`) and therefore does **not** clear the flag. Consequence: `waiting` survives until the occupant actually changes; matches "the pill's × is the only way to clear a running task" (`#176`).
- **Option 2** — any `startTaskWork` call clears, even for the same task. Consequence: the pill's own "Waiting…" flow would clear itself if the user re-selects the current task; more surprising.
- **Recommendation:** Option 1, and state the occupant key in the contract so the sheet and the bridge cannot disagree.

### B8. What counts as "un-estimated" for the ranking tail

- **Option 1 (recommended, matches the existing collector)** — `estimate = pmTask.estimatePomos` if numeric, else backend `target_pomodoros`, else 0; `estimate <= 0` → un-estimated tail. Consequence: consistent with `collectEligibleProjectionTasks` (`timer.ts:92`); most tasks have a backend target so the tail is small.
- **Option 2 — strictly `estimatePomos` absent ⇒ tail.** Consequence: tasks created through quick-add (no estimate) but linked to a backend target land in the tail even though the app can count them; diverges from the Today/projection estimate.
- **Recommendation:** Option 1, documented as a deliberate divergence from "PM field only".

---

## Proposed frozen interfaces

### Timer model (`#173`)

```ts
// src/state/types.ts
export interface ActiveTimer {
  task_id: string;
  started_at: string;
  ends_at: string;
  kind: TimerKind;
  paused?: boolean;
  paused_remaining_secs?: number;
  planned_secs?: number;
  accumulated_secs?: number;
  /** Work-window identity. Absent on break timers and on timers created before staging v10. */
  window_started_at?: string;
}

// src/lib/engine/core.ts
export type WorkStartOccupation = "free" | "join" | "blocked";
export function workStartOccupation(timer: ActiveTimer | null): WorkStartOccupation;
export function windowStartedAt(timer: ActiveTimer): string;           // window_started_at ?? derive(started_at - accumulated)
export function windowRemainingSecs(timer: ActiveTimer, now: Date): number;  // clamped >= 0
export function isWorkWindowLive(timer: ActiveTimer | null, now: Date): boolean; // kind === "Work" && (paused || ends_at > now)

// command signatures (progress map removed from all of them)
startWorkTimer(state, now): EngineResult<ActiveTimer>                  // sets window_started_at = now.toISOString()
setActiveTask(state, taskId, now, logId): EngineResult<void>           // join / switch / expire
completeTimer(state, now, logId): EngineResult<AppStateData>
stopWorkTimer(state, now, logId): EngineResult<AppStateData>
finalizeTask(state, taskId, now, logId): EngineResult<Task>            // B3 option 1
resetAppState(state): EngineResult<AppStateData>

// src/lib/engine/index.ts: remove the pomodoroProgress re-exports (:13-18)
// delete src/lib/engine/pomodoroProgress.ts
```

### Staging (`#173`, `#179`)

```ts
// src/lib/data/staging/types.ts
export const STAGING_SCHEMA_VERSION = 10 as const;
schemaVersion: 10;                       // StagedOwnerRecord
// removed: StagedOwnerRecord.inProgressPomodoros (:140), isInProgressPomodoroMap (:236-243),
//          REQUIRED_FIELD_CHECKS entry (:626), v5->v6 install (:782-784)
// added: if (record.schemaVersion === 9) { drop field; backfill Work window_started_at; schemaVersion: 10 }
// isTimer: (value.window_started_at === undefined || typeof value.window_started_at === "string")
// isLog:   (value.work_window_id === undefined || value.work_window_id === null || typeof value.work_window_id === "string")
```

### PM domain (`#174`, `#175`)

```ts
// src/state/types.ts
export interface PMTaskWaiting { type: "agent" | "person"; since: string; }
export interface PMTask { /* ...existing... */ waiting?: PMTaskWaiting | null; }
//   runtime invariant after normalizeState: PMTask.waiting is always PMTaskWaiting | null
export function waitingOf(task: PMTask): PMTaskWaiting | null;   // module-level accessor

// src/lib/pm/workStart.ts (new, pure, colocated test)
export function applyWorkStart(task: PMTask, nowIso: string): PMTask;
export function findPMTaskByAppTaskId(
  tasks: Readonly<Record<string, PMTask>>, appTaskId: string,
): PMTask | null;
export function workOccupantKey(timer: ActiveTimer | null): string | null;
export function normalizeWaiting(value: unknown): PMTaskWaiting | null;

// src/state/ProjectManagerContext.tsx
recordWorkStart(taskId: string, at?: string): void;    // PMContextShape
// updateTask becomes functional over prev (A11)
// normalizeState (:849-898): waiting = (status === "Done" || isArchived) ? null : normalizeWaiting(task.waiting)
```

### Ranking (`#177`)

```ts
// src/lib/whatsNext.ts (new, pure; no Date.now, no I/O, no randomness)
export type PromotionTier = "top-pick" | "quick-win" | "next-up";
export interface RankedCandidate {
  task: PMTask; projectId: string | null; dueDate: string | null;
  dueKey: string | null; remainingPomodoros: number;
  tier: PromotionTier | null;                       // null = continuation
}
export interface WhatsNextResult { top: RankedCandidate[]; continuation: RankedCandidate[]; }
export function rankWhatsNext(input: {
  pmTasks: readonly PMTask[];
  backendTasks: Readonly<Record<string, Task>>;
  projects: Readonly<Record<string, Project>>;
  currentOccupantId: string | null;                 // PM task id (A19)
  reference: Date;
}): WhatsNextResult;
export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>>; // High 0 / Medium 1 / Low 2
```

### App / UI (`#173`, `#178`)

```ts
// src/state/AppStateContext.tsx
startTaskWork(id: string): Promise<"started" | "joined">;   // throws on a break
resumeTimer(): Promise<void>;                              // currently void (:300) — awaitable for the sheet

// src/state/ProjectManagerContext.tsx (linker observability, A20)
linkingTaskIds: ReadonlySet<string>;
linkFailures: Readonly<Record<string, string>>;
retryLink(pmTaskId: string): void;

// new component, presentational
export interface SwitchSheetProps {
  mode: "switch" | "waiting";
  result: WhatsNextResult;
  currentOccupantPmTaskId: string | null;
  linkStateOf: (pmTaskId: string) => "ready" | "preparing" | "failed";
  onSetWaiting: (type: "agent" | "person") => void;
  onSelect: (pmTaskId: string) => void;
  onClose: () => void;
}
```

### Logs / SQL (`#179`)

```ts
// src/state/types.ts
export interface PomodoroLogEntry {
  id: string; task_id: string; duration_minutes: number; finished_at: string;
  was_break: boolean; break_skipped: boolean;
  work_window_id?: string | null;          // ISO window_started_at of a Work window
}

// src/lib/engine/core.ts
appendLog(state, taskId, durationMinutes, finishedAt, wasBreak, logId,
          breakSkipped = false, workWindowId: string | null = null): void
```

```sql
-- supabase/migrations/<timestamp>_log_work_window_id.sql
alter table public.pomodoro_logs add column work_window_id text;   -- nullable, no backfill, no index

-- CREATE OR REPLACE the three live bodies only:
--   public.persist_transition                        (20260802010000:25-112)  -> add work_window_id to :79
--   public.complete_timer                            (20260802010000:126-206) -> add work_window_id to :163
--   public.apply_staged_sync_without_todos           (20260805000000:14-285)  -> add work_window_id to :138
-- values: nullif(v_log ->> 'work_window_id', '')::text
```

`SupabaseDataAccess.validateLog` (`:229-237`) must add
`work_window_id: typeof row.work_window_id === "string" ? row.work_window_id : null`.

---

## Lane plan (Q26)

`(A)` = #173 window model, `(B)` = #179 log identity, `(C)` = #174 status, `(D)` = #175 waiting, `(E)` = #176 presentation, `(F)` = #177 ranking, `(G)` = #178 sheet.

| Lane | Order | Issues | Primary files (disjoint from other lanes) |
|---|---|---|---|
| 1 | strict sequence | #173 → #179 | `src/state/types.ts` (timer/log types), `src/lib/engine/**` (`core`, `taskCommands`, `timerCommands`, `sessionCommands`, `stateCommands`, `index`, delete `pomodoroProgress`), `src/lib/data/staging/types.ts`, `LocalStagingStore.ts`, `StagedDataAccess.ts`, `InMemoryDataAccess.ts`, `src/lib/data/sync/{merge,timerCompletions}.ts`, `src/lib/data/SupabaseDataAccess.ts` (validateLog only), `supabase/migrations/<new>.sql`, `src/state/AppStateContext.tsx`, `src/state/TodoContext.tsx` (guard only) |
| 2 | strict sequence | #174 → #175 → #176 | `src/state/ProjectManagerContext.tsx`, new `src/lib/pm/workStart.ts`, `src/state/StateSyncBridge.tsx`, `src/components/ProjectManager/TaskInspector.tsx`, `src/components/TaskPanel.tsx`, `src/lib/today.ts`, `src/components/TodaySurface.tsx`, `src/components/TimerPanel.tsx` (pill/dot slots) |
| 3 | parallel from day 1 | #177 | new `src/lib/whatsNext.ts` + test only (imports `projectSchedule`, `timer`) |
| 4 | last, after 1–3 | #178 | `src/components/TimerPanel.tsx` (buttons/host), new sheet component + test, `e2e/timer.spec.ts`, plus the linker surface in `StateSyncBridge.tsx`/`ProjectManagerContext.tsx` |

Forbidden parallelisation / merge order:

- **#179 must not run concurrently with #173** — both rewrite `types.ts`, `core.ts`, `taskCommands.ts`, `timerCommands.ts`, `staging/types.ts`, `sync/merge.ts`, `sync/timerCompletions.ts` and the same engine tests. Merge order is `#173` then `#179`.
- **#174 and #175 must be sequential** — both edit `workStart.ts`, `ProjectManagerContext.tsx` (`recordWorkStart`, normalization), `StateSyncBridge.tsx` (the same effect), and the PM context tests. `#175` extends the helper `#174` creates. Merge `#174` → `#175`.
- **#176 after #175** — needs `PMTask.waiting` for `TodayTaskEntry`/`TaskPanel`; also edits `TimerPanel.test.tsx`, which `#173`/`#174`/`#178` all touch.
- **#178 last** — it needs the join API (`#173`), status (`#174`), waiting (`#175`, `#176`), ranking (`#177`) and edits `TimerPanel.tsx`/`TimerPanel.test.tsx`, the two most contended files.

Files touched by more than one issue (explicit flags):

- `src/state/types.ts` — #173, #175, #179.
- `src/lib/engine/core.ts` — #173, #179.
- `src/lib/engine/taskCommands.ts`, `timerCommands.ts` — #173, #179.
- `src/lib/data/staging/types.ts` — #173, #179.
- `src/lib/data/sync/merge.ts`, `sync/timerCompletions.ts` — #173, #179.
- `src/state/ProjectManagerContext.tsx` — #174, #175, #178.
- `src/state/StateSyncBridge.tsx` — #174, #175, #178.
- `src/state/AppStateContext.tsx` — #173, #178 (awaitable resume).
- `src/state/TodoContext.tsx` — #173 (guard), #174 (status expectations/tests only).
- `src/components/TimerPanel.tsx` — #173 (label), #176 (pill), #178 (buttons/sheet).
- `src/components/TimerPanel.test.tsx` — #173, #174, #176, #178.
- `src/components/TodaySurface.tsx` — #173 (guard/notice), #176 (pinning/dot).
- `src/components/TodaySurface.test.tsx` — #174, #176.
- `src/components/TaskPanel.tsx` — #176 only (but its `setActiveTask` row behaviour is #173's switch path).
- `src/lib/today.ts` / `today.test.ts` — #176; `today.test.ts` also needs a `#179` regression line.
- `src/lib/engine/engine.test.ts` — #173, #179.
- `src/lib/data/goalsFoundation.test.tsx` — #173 (v8 fixture pins `schemaVersion: 9` and `inProgressPomodoros`).
- `docs/THEME.md` untouched; no theme changes needed.

---

## Risks

1. **#173/#178 contradiction on break handoff.** `#173` req 8 refuses work starts on a break; `#178` req 9 wants the switch to apply after expiry. Freeze B6 before planning, or the sheet and engine will be built to different contracts.
2. **`#173` req 1 vs req 9 on `ends_at`.** Req 1 says pause/resume never change `ends_at`; the existing `resumeTimer` rewrites it (`sessionCommands.ts:37`) and req 9 depends on that. The contract must say "fixed while running; pause freezes it; resume rebuilds it from `paused_remaining_secs`".
3. **`finalizeTask` silently discards a live window** (`taskCommands.ts:120`). If B3 is not decided, `#173` req 9 cannot be met and the Complete button will keep dropping partial work.
4. **Active-fraction denominators change meaning on a switch** (`TimerPanel.tsx:237-247`, `timer.ts:267-273`, `TodaySurface.tsx:116`) → the ring resets and "Np left" moves. B4 decides whether that is a bug; `#176` req 8's "provably unchanged" assertion is only meaningful after B4 is fixed.
5. **Backfilling `window_started_at` turns a live timer into a "local-only generation".** This is supported (`SyncCoordinator.ts:322-341`) but it means an upgrade during a live window performs one extra `persist_transition` before the next completion, and if another tab holds a newer timer row the CAS loses and the local completion rolls back — the existing race, now reachable on upgrade. Tests should cover "upgrade mid-window, then complete".
6. **`setActiveTask` at expiry must not double-apply.** If the expired branch writes a log and increments the cycle while the `AppState` tick effect also calls `runProgression` with the same `finishedTimer`, two logs/credits are possible. The engine must null the timer in the same mutation (so `state.timer` no longer equals the captured timer and `StagedDataAccess.completeTimer`'s equality guard at `:282,297` rejects the second call).
7. **`updateTask` fix is load-bearing.** Without making it functional over `prev`, `recordWorkStart` can be clobbered by the inspector's `{ appTaskId }` write (`TaskInspector.tsx:212-214`) or by a bridge patch emitted in the same tick. The `#174` concurrency tests must fail before the fix.
8. **Observer re-application.** Without `lastOccupantKeyRef`, a manual status change on the active task is re-advanced on the next `pmState` render, and `waiting` would be cleared whenever the user sets it on the running task (violates `#175` req 7). The key must not include `paused` (resume must not look like a new occupancy).
9. **`work_window_id` will be silently dropped in three places unless all are changed:** the three SQL insert bodies, `SupabaseDataAccess.validateLog` (`:229-237`), and `e2e/helpers.ts:64-69` (the `select("*")` mapping). Missing any of them produces "field is there locally, null after pull" bugs.
10. **`pm_state` whole-blob LWW** silently loses a concurrent waiting toggle (A13). Document as accepted; do not build a merge.
11. **`remainingPomodoros` and the Today agreement assertion** are exact-order/exact-sum (`today.test.ts:241-242`). `#176` must either place its waiting fixture among the existing three ids or split the assertion; otherwise the pinned-order change looks like a regression.
12. **`TaskInspector` Start never sets the active task in its create branch** (`:205-222`) → `startWork()` can throw "Select a task first" or start the previously active task. `#174`/`#178` assumption "from every entry point" is false until this is fixed.
13. **`linkingTaskIds` is a ref** (`StateSyncBridge.tsx:71`) — exposing it as state re-renders the bridge on every link, which re-runs the estimate effect (`:97-180`) and the metadata effect (`:183-196`). They are guarded (`batchInFlightRef`, `pendingAppTaskLinksRef`), but this deserves a test that a link does not produce a second backend task.
14. **`skipBreak` logs a 0-minute break against `timer.task_id`** (`sessionCommands.ts:49-51`); do not stamp it with a window id, or the analytics/`buildTodayPomodoros` "no switch distinguishable from a deliberate stop" goal is inverted.
15. **Unknowns not inspected:** whether the native/desktop close dialog or `pendingCount` depends on timer shape beyond `staged_sync_rpc` (no matches found); and whether any external consumer reads `public.pomodoro_logs` columns positionally (only `select *` in e2e helpers was found).
