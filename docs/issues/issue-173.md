# Title: Task-agnostic pomodoro window and retirement of `inProgressPomodoros`

## Tags

Complexity Classification: T4
Classification Reason: Changes the persisted timer model and the timer state machine, and deletes a persistence concept threaded through the pure engine, both `DataAccess` implementations, the staging store schema and validator, the sync merge, the completion journal, three React contexts and two UI components. Roughly 20 files and ~25 existing test assertions are in the blast radius, and the staging migration is forward-only.

Severity: High
Severity Reason: Rewrites the core accounting flow (task credit, `planned_secs`, `ends_at`) that the app exists for, and adding a timer field changes every timer generation key, so a mistake can double-count or drop completion credit through the journal/RPC replay path. The migration also discards the saved resume position. No security exposure and no loss of tasks, logs or settings, so not Critical.

Needs research before implementation: Yes

### Research Needed

Several edge cases in this issue have no defined resolution today, and the interaction between the new timer field and the existing sync RPC guards is untraced. Resolve these before implementation:

- Pin down the exact semantics for the enumerated edge cases: switch at `t=0`, switching an already-expired-but-unreconciled window, switching while paused, an outgoing task archived/completed mid-window, and two rapid switches.
- Decide whether break timers carry `window_started_at` at all, and whether the field is required or optional in `ActiveTimer` and in the staging `isTimer` validator (`src/lib/data/staging/types.ts:271-280`).
- Trace how an added `ActiveTimer` field interacts with the `data @> p_expected_timer` containment guard used by the sync RPCs (`supabase/migrations/20260801020000_transactional_writes.sql`, `supabase/migrations/20260802010000_staged_sync_rpc.sql`) for timers persisted before the change.
- Decide what happens to pending journal entries whose generation keys were derived from the old timer shape when a user upgrades mid-window (`src/lib/data/sync/timerCompletions.ts:87-107`).
- Specify what the v9 → v10 migration does to a *live* timer and how the discarded partial map is reconciled against `completed_pomodoros`.

## Summary

A Work pomodoro should be a wall-clock window that tasks occupy as tenants. Today, switching tasks while a Work timer is live recomputes the incoming task's duration from that task's own saved partial progress, so the window restarts and the total credited work is unbounded.

Concretely: with a 25-minute setting, working 5 minutes on task A and then switching to task B opens a fresh ~25-minute timer for B. One 30-minute span of wall-clock time therefore produces 1.2 credited pomodoros and 30 minutes of logs.

The window must instead survive a switch. The incoming occupant gets whatever is left of the window, the outgoing occupant keeps its credit and its log, and the window end time never moves. That conservation property — one window always equals `work_minutes` across all occupants — is what the rest of this epic depends on.

The per-task partial-progress map (`inProgressPomodoros`) exists only to support the current resume behaviour. Once the window owns the remainder, the concept is dead and should be deleted rather than left dormant.

## Steps to Reproduce Context

1. Set `work_minutes` to 25.
2. Create two tasks, A and B.
3. Set A active and start a Work timer.
4. Wait 5 minutes.
5. Switch the active task to B (TaskPanel row, or any other start path).
6. Observe: the timer restarts at ~25 minutes for B, while A keeps 0.2 credited pomodoros and a 5-minute log.
7. Observe: after B's timer completes, A and B together hold 1.2 credited pomodoros and 30 minutes of logs from a single 25-minute span.

## Requirements for completed issue

1. A Work timer is a fixed wall-clock window: `ends_at` is set when the window starts and is not changed by any switch, pause, resume, or task change within that window.
2. Switching occupants while a Work window is live credits the outgoing task exactly as it does today (capped fractional `completed_pomodoros` plus one log entry for the elapsed minutes) and opens the incoming task's segment from the window remainder: `planned_secs` is the remaining window seconds, `accumulated_secs` is 0, and `started_at` is now.
3. Conservation holds: for any single window, total credited pomodoros across all occupants never exceed `work_minutes`, and total logged work minutes never exceed `work_minutes`.
4. `ActiveTimer` carries `window_started_at`, set when a Work window starts and preserved across every switch, pause, and resume within that window. It is the window's identity.
5. The `inProgressPomodoros` concept no longer exists anywhere: not on `EngineResult`, not in any command signature, not in either `DataAccess` implementation, not in the staging record, not in the sync merge, and `pomodoroProgress.ts` is deleted.
6. The staging record schema advances from v9 to v10 with an in-memory migration that drops the field, matching the existing chain in `parseStagedOwnerRecord`. Records at v9 load successfully.
7. The timer's discard action is labelled "End focus" instead of "Stop Early" and keeps its current behaviour of discarding the window remainder.
8. Starting work on a task while a live Work window exists joins the window instead of throwing. Starting work while a break timer is live still refuses.
9. Edge cases behave as specified:
   - Switch at `t=0`: no log and no credit for the outgoing task; the incoming task receives the full window remainder.
   - Switch when the window has already expired but has not been reconciled: the outgoing task receives capped-full credit, the cycle increments exactly once, and no new timer opens. The pomodoro is not silently discarded.
   - Switch while paused: the timer stays paused, `paused_remaining_secs` is recomputed from the window remainder, and resume rebuilds `ends_at` from it.
   - Outgoing task archived or completed mid-window: the log is still written; credit is applied only if the task still exists.
   - Two rapid switches accumulate per-segment elapsed correctly.
   - Negative elapsed is clamped to zero.
   - A timer paused for a long time does not trip `completeTimer`'s expiry check after a switch.
10. Pending-completion replay still works after the timer shape change, and the loss of a saved partial map at migration costs only the resume position (credit already in `completed_pomodoros` is untouched).

## Expected Behavior

- A Work window has one start time and one end time, both fixed for its whole lifetime.
- Switching occupants inside the window keeps the same clock, same cycle progress and same end time.
- Each occupant is credited only for the slice it actually occupied.
- Starting work on a second task while a Work window is live joins that window rather than erroring.
- A break timer still cannot be joined by a work start.

## Actual Behavior

- Switching tasks restarts the timer at (nearly) a full `work_minutes` span, discarding the window remainder.
- Credited pomodoros and logged minutes from one wall-clock span can exceed `work_minutes`.
- Starting work on another task while a timer is live throws "A timer is already running" from `src/state/AppStateContext.tsx:286`, `src/state/TodoContext.tsx:235` and `src/components/TodaySurface.tsx:143`.
- A per-task partial-progress map is persisted in the staging record, merged on pull, and carried through every engine command signature.

### Testing

- `pnpm test:unit` — engine coverage in `src/lib/engine/engine.test.ts` for: switch at `t=0`, mid-window switch (window end unchanged, remainder split correctly), expired-window switch (single cycle increment, no new timer), paused switch, archived/completed outgoing task, two rapid switches, and negative-elapsed clamp. Replace the existing `inProgressPomodoros` assertions in that file.
- Unit coverage that conservation holds: total credit and total logged minutes for one window never exceed `work_minutes`.
- `src/lib/data/StagedDataAccess.test.ts` and `src/lib/data/InMemoryDataAccess.test.ts` — remove the map assertions and add coverage that a switch persists the window remainder.
- `src/lib/data/sync/merge.test.ts` — the full-wipe reset and pull-merge no longer carry the field.
- Staging migration test: a v9 record containing `inProgressPomodoros` parses as v10 with the field gone and everything else intact.
- `src/lib/data/sync/timerCompletions.test.ts` — generation keys and replay still round-trip with the new timer field.
- Component coverage in `src/components/TimerPanel.test.tsx` for the "End focus" label and for joining a live window from a second start path.

## Issue Context

### New Files

None.

### Remove Files

- `src/lib/engine/pomodoroProgress.ts` — the whole module (`InProgressPomodoroMap`, `cloneInProgressPomodoros`, `withoutInProgressPomodoro`, `resumablePomodoroElapsedSecs`, `pruneInProgressPomodoros`) exists only to support per-task partial resume, which the window remainder replaces.

### Change Files

#### `setActiveTask` switch path

Code Source: `src/lib/engine/taskCommands.ts`
Code Description: On a live Work timer with a different task, credits the outgoing task, appends its log, then derives the incoming task's duration from that task's saved partial progress and restarts the clock.
Code Change Description: Derive the incoming segment from the window remainder instead of the task's saved progress, and stop taking/returning a progress map.

```ts
export function setActiveTask(
    state: AppStateData,
    taskId: string,
    now: Date,
    logId: string,
    inProgressPomodoros: InProgressPomodoroMap = {},
): EngineResult<void> {
    const timer = next.timer;
    if (timer && timer.kind === "Work" && timer.task_id !== taskId) {
        const elapsed = elapsedTimerSecs(timer, now);
        // ... outgoing credit + appendLog ...
        const targetBase = resumablePomodoroElapsedSecs(progress, taskId, workSecs); // <- remove
        const remaining = workSecs - targetBase;
        if (remaining > 0) {
            next.timer = { ...timer, task_id: taskId, planned_secs: remaining, accumulated_secs: 0,
                started_at: now.toISOString(), ends_at: addSeconds(now, remaining),
                paused_remaining_secs: timer.paused ? remaining : 0 };
        } else next.timer = null;
    }
}
```

Files Using: `src/lib/data/StagedDataAccess.ts:260-263`, `src/lib/data/InMemoryDataAccess.ts:227`, `src/state/AppStateContext.tsx:252`

#### `EngineResult` and the five command signatures

Code Source: `src/lib/engine/core.ts:5-10`
Code Description: `EngineResult<T>` carries an optional `inProgressPomodoros` map, and `setActiveTask`, `deleteTask`, `archiveTask`, `finalizeTask` (`src/lib/engine/taskCommands.ts:20,79,96,112`), `startWorkTimer`, `completeTimer`, `stopWorkTimer` (`src/lib/engine/timerCommands.ts:39,81,116`) and `resetAppState` (`src/lib/engine/stateCommands.ts:63`) all accept or return it.
Code Change Description: Remove the field and every parameter; update the barrel exports in `src/lib/engine/index.ts:13-18`.

Files Using: `src/lib/data/InMemoryDataAccess.ts`, `src/lib/data/StagedDataAccess.ts`, `src/lib/data/sync/merge.ts:7`

#### `ActiveTimer`

Code Source: `src/state/types.ts:126-135`
Code Description: `task_id`, `started_at`, `ends_at`, `kind`, `paused?`, `paused_remaining_secs?`, `planned_secs?`, `accumulated_secs?`.
Code Change Description: Add `window_started_at` as the window identity, set by `makeTimer` in `src/lib/engine/timerCommands.ts:25-36` and preserved on every switch in `setActiveTask`. Update `isTimer` in `src/lib/data/staging/types.ts:271-280` and `isTimerSlice` at `:282-289` accordingly.

Files Using: `src/lib/engine/core.ts:63-76`, `src/lib/data/sync/timerCompletions.ts:87-107`

#### Staging schema v9 → v10

Code Source: `src/lib/data/staging/types.ts`
Code Description: `STAGING_SCHEMA_VERSION = 9` at `:215`, `schemaVersion: 9` on `StagedOwnerRecord` at `:133`, the owner-local `inProgressPomodoros` field at `:140`, its validator `isInProgressPomodoroMap` at `:236-243`, its `REQUIRED_FIELD_CHECKS` entry at `:626`, and the migration chain in `parseStagedOwnerRecord` at `:691-860` (v5 → v6 installs the field at `:782-784`).
Code Change Description: Accept v10, drop the field in a v9 → v10 migration step, remove the validator and the required-field entry, and update the doc comment at `:678-690`.

Files Using: `src/lib/data/staging/LocalStagingStore.ts`, `src/lib/data/StagedDataAccess.ts`

#### Data access implementations

Code Source: `src/lib/data/InMemoryDataAccess.ts`, `src/lib/data/StagedDataAccess.ts`
Code Description: `InMemoryDataAccess` holds the map on its store (`:69`), initialises it (`:131`), clones it (`:137`), adopts command results (`:189-190`) and passes it at every call site (`:227,232,255,262,269,274,275,280,284,458,478,509`). `StagedDataAccess.transition` threads it through every command (`:183-204`), and `completeTimer` reads/writes it (`:310,332`).
Code Change Description: Remove the store field, the threading in `transition`, and every argument.

Files Using: `src/lib/data/DataAccess.test.ts`, `src/lib/data/StagedDataAccess.test.ts`

#### Pull merge

Code Source: `src/lib/data/sync/merge.ts`
Code Description: Imports `pruneInProgressPomodoros` (`:7`), resets the map on a scoped full wipe (`:1097`), and prunes it against the merged tasks (`:1173`).
Code Change Description: Remove the import and both assignments.

Files Using: `src/lib/data/sync/merge.test.ts:507-517,1046-1059`

#### Work-start pre-checks

Code Source: `src/state/AppStateContext.tsx:283-294`, `src/state/TodoContext.tsx:232-251`, `src/components/TodaySurface.tsx:141-162`
Code Description: Each path refuses to start when `state.timer` is already set.
Code Change Description: Allow a Work window to be joined. The check must distinguish "live Work window, may join" from "break timer, must refuse".

Files Using: `src/state/AppStateContext.test.tsx`, `src/components/TodaySurface.test.tsx`

#### Discard label

Code Source: `src/components/TimerPanel.tsx:609-619`
Code Description: The work-discard button reads "Stop Early" and calls `stopWork`.
Code Change Description: Relabel to "End focus"; behaviour is unchanged.

Files Using: `src/components/TimerPanel.test.tsx`

## Notes

- Users with a saved partial map at migration lose the *resume position* only. Their credit is already in `completed_pomodoros`, and the next start is a full window. State this in the release notes.
- Do not change break-timer semantics beyond refusing to be joined.
- This issue is the base for the rest of the epic: the switch/waiting sheet (issue 6 in this series) and log window identity (issue 7 in this series) both build on `window_started_at`.
