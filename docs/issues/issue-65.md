## Title: To-dos — two-way pomodoro ↔ to-do integration

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Cross-system slice spanning a new pure engine module (`src/lib/todos/`), `AppStateContext` (a new task-completion subscription and `finalizeTask` hooking), `TodoContext`, the sync bridge, and the timer UI (TaskPanel/TimerPanel), plus stale-ref/timer/delete guards and reconcile-on-hydrate. Blast Radius=4 (10+ files across engine, two state contexts, sync bridge, UI), Uncertainty=3 (depends on unbuilt Issue C; race/idempotency side effects of the bidirectional loop and the new subscription's interaction with `runProgression`/reconciliation are unknown), Behavior=3 (complex bidirectional state management with concurrency guards; no infra/DB/security change), Testing=2 (idempotency, reconcile-on-hydrate, and timer-active-on-check-off races are hard to test; high user impact if task/to-do data gets corrupted), Reversibility=2 (auto-archived tasks and auto-checked-off to-dos persist in the staging/local store; revert needs data cleanup or reconcile). Total=14 → T3.
Needs research before implementation: Yes — the to-do data model from Issue C (where `estimate` and `currentTaskId` live, how occurrences/rolling work), how a task-completion subscription on `AppStateContext` fits the existing `runProgression`/`adoptResult`/reconciliation machinery without breaking same-tab vs cross-tab flows, and the exact guard/idempotency semantics for the two converging paths. See Notes.

## Summary

Link to-dos and pomodoro tasks in both directions. Each to-do carries an estimate (default 1 pomodoro) and a `currentTaskId`. "Start pomodoro" reuses the current occurrence's task if it exists, otherwise creates a fresh one with the estimate as target, then activates and starts the timer. Manual check-off archives the generated task (archive-if-exists) and rolls the to-do. Task completion (`finalizeTask`) reverse-looks-up the owning to-do, checks it off, and rolls it — the two flows converge. A reconcile-on-hydrate step heals offline/crash races by checking off any to-do whose linked task is already archived/completed.

## Steps to Reproduce Context

1. User creates a to-do and clicks "Start pomodoro" on it.
2. The user completes the generated task in the timer UI, or manually checks off the to-do mid-timer.
3. Today nothing links to-dos to timer tasks: `AppStateContext.finalizeTask`/`createTask`/`setActiveTask`/`startWork` operate only on the standalone task graph, and the to-do domain does not exist yet.

## Expected Behavior

- "Start pomodoro" reuses the current occurrence's linked task when one exists, otherwise creates a fresh task with the to-do's estimate as the target, then activates it and starts the work timer.
- Manual check-off archives the generated task if it exists (archive-if-exists) and rolls the to-do to its next occurrence.
- `finalizeTask` on a linked task reverse-looks-up the owning to-do, checks it off, and rolls it; the two flows converge and are idempotent (no double check-off/double archive).
- Reconcile-on-hydrate heals offline/crash races: any to-do whose linked task is already archived/completed is checked off.
- Guards: timer-active-on-check-off, stale `currentTaskId` refs, to-do deletion archives its linked task, and the TaskPanel/TimerPanel title-fallback collision (tasks named the same as PM/to-do titles) is resolved.

## Actual Behavior

`src/state/AppStateContext.tsx` exposes `finalizeTask(id)` (delegates to `data.finalizeTask(id)` and adopts the EngineResult state), `createTask`, `setActiveTask`, and `startWork`/`startBreak` with `ensureActiveTask`, all operating on the standalone task graph. `src/lib/engine/taskCommands.ts` `finalizeTask` sets `completed_at`, archives the task, and clears an active Work timer on that task. There is no to-do domain and no task-completion event surface to reverse-look-up an owning to-do.

## Requirements for completed issue

1. `currentTaskId` link on to-dos plus the start-pomodoro reuse-or-create/activate/start logic.
2. Two-way convergence: manual check-off archives the linked task and rolls; `finalizeTask` reverse-lookup checks off and rolls the owning to-do; both flows are idempotent. This requires a new task-completion subscription on `AppStateContext`.
3. All guards: timer-active-on-check-off, stale-ref handling, to-do deletion archiving its task, TaskPanel title-fallback collision resolution, and reconcile-on-hydrate for offline/crash races.

## Context

- Files:
  - `src/state/AppStateContext.tsx` — `finalizeTask` (line 233), `createTask` (lines 201–211), `setActiveTask` (line 213), `ensureActiveTask` (lines 214–221), `startWork`/`startBreak` (lines 222–223), `runProgression` (lines 98–153), and the notification entry point `ensureNotification`/`maybeNotifyTimerEnd` (lines 14–30, 84–96); the new task-completion subscription hooks in here.
  - `src/lib/engine/taskCommands.ts` — `finalizeTask` (lines 74–87: sets `completed_at`, archives, clears active Work timer, clears `active_task`) and `archiveTask` (lines 66–71); the reverse-lookup/check-off behavior is driven from here or the todos engine.
  - `src/components/TaskPanel.tsx` — the PM-title fallback mapping `pmTasksByTitle` (lines 30–51) and `decoratedTasks` merge (line 61) where the title-fallback collision with to-do-generated tasks appears.
  - `src/components/TimerPanel.tsx` — the same normalized-title fallback at line 64 (`byTitle`).
  - `src/state/StateSyncBridge.tsx` — backend task completion → PM auto-Done bridging, the model for task-completion side effects.
  - `src/lib/data/DataAccess.ts` — the DataAccess contract (`finalizeTask`, `createTask`, `setActiveTask`, `startWorkTimer`, ...) the integration flows through.
  - `src/lib/todos/` — Issue A's engine plus Issue B's TodoContext, where check-off/roll and reconcile-on-hydrate belong.
- Code Snippets:

```
// src/lib/engine/taskCommands.ts — finalize_task behavior the reverse-lookup reacts to
export function finalizeTask(state: AppStateData, taskId: string, now: Date): EngineResult<Task> {
    const next = cloneAppState(state);
    const timer = next.timer;
    if (timer?.task_id === taskId && timer.kind === "Work") next.timer = null;
    const task = taskOrThrow(next, taskId);
    if (task.completed_at === null) { task.target_pomodoros = Math.ceil(task.completed_pomodoros); task.completed_at = now.toISOString(); }
    task.archived = true;
    if (next.active_task === taskId) next.active_task = null;
    return { state: next, value: { ...task } };
}
```

## Notes

- Dependency slice #5 of the to-do list feature (issue #51); depends on Issue C (page + CRUD + rollover) so the to-do `estimate`/`currentTaskId` fields and occurrence state exist.
- Research needed before implementation: where `estimate`/`currentTaskId` live in the Issue B/C data model; how the new task-completion subscription on `AppStateContext` composes with `runProgression`/`adoptResult` and cross-tab revision handling; and the exact idempotency and guard rules for check-off → auto-archive vs `finalizeTask` → reverse-lookup check-off.
- Must not add Tauri `invoke` data paths; the two-way loop runs in the frontend data layer and pure engine.
