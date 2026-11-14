# Title: Owner-safe task completion in the engine

## Tags

Complexity Classification: T1
Classification Reason: An additive engine command following the established five-layer pattern (`taskCommands.ts` → `engine/index.ts` → `DataAccess.ts` → `InMemory`/`StagedDataAccess` → `engine.test.ts`). It has no caller and no UI until #211 wires it, and its behaviour mirrors the proven tail of `finalizeTask`, so uncertainty and blast radius both stay low.

Severity: Low
Severity Reason: Nothing existing changes until #211 consumes it, and a wrong `completed_at`/`archived`/`active_task` combination is recoverable and directly comparable to `finalizeTask`'s tested behaviour. It is still the gate for #211, so it should land first and cleanly.

Needs research before implementation: No

## Summary

`finalizeTask` in `src/lib/engine/taskCommands.ts:73-89` ends the work window solely because the task is the occupant: when `timer.task_id === taskId` and the timer is a Work timer, it completes or stops it before clearing `completed_at`/`archived`. `finalizeDeferredTask` in `src/lib/engine/pendingFinalize.ts:16-23` refuses owners entirely, returning `"owner"` and changing nothing.

Neither command can express "commit this task while the window survives", which is exactly what #194 needs when the user marks the occupant Done and a task switch is still in flight. This issue adds that one command to the pure engine, with no UI and no wiring: mark the task complete and archived, clear `active_task`, and never read or write `state.timer`, so the running window and its remaining time stay intact for the eventual `setActiveTask`.

This is issue 1 of 5 and blocks #211. Issues #212, #213 and #214 can proceed in parallel once this lands.

## Steps to Reproduce Context

1. Start a work pomodoro on a PM-linked task so the task owns the Work window (`timer.kind === "Work"` and `timer.task_id` is the task's backend id).
2. Call `finalizeTask(state, taskId, now, logId)` for that task, as today's Complete paths do.
3. Observe: the window is stopped or completed, so the remaining time cannot be handed to another task.
4. Call `finalizeDeferredTask(state, taskId, now, logId)` for the same task instead.
5. Observe: it returns `"owner"` and leaves the task untouched, so the task cannot be committed at all while it owns the window.

## Requirements for completed issue

1. `completeTaskKeepingWindow(state, taskId, now)` exists in `src/lib/engine/taskCommands.ts` and is exported from the `src/lib/engine/index.ts` task-lifecycle group.
2. It sets `completed_at` to `now.toISOString()` only when it is `null`, sets `archived = true`, and clears `active_task` when it equals `taskId`.
3. It never reads or writes `state.timer`: the timer after the call is indistinguishable from the timer before it, asserted by identity/value in a test.
4. It is safe on any task. For a task that is not the window occupant the resulting task state matches today's non-owner `finalizeTask` outcome (same `completed_at`, `archived`, `active_task` handling) and no log or timer change occurs.
5. Idempotence: calling it twice does not re-stamp `completed_at`, does not throw, and leaves the task archived.
6. A missing task still throws through the existing `taskOrThrow` behaviour.
7. The command's contract states that `windowRemainingSecs(timer, now) <= 0` is the caller's responsibility, because a zero-length window cannot be handed over; the command itself does not guard or branch on it.
8. A data-layer wrapper is exposed as `completeTaskKeepingWindow(taskId)` on `DataAccess` and implemented in both `InMemoryDataAccess` and `StagedDataAccess` through their existing transition helpers.
9. `finalizeTask`, `finalizeDeferredTask`, `archiveTask` and the pending-finalize partition behaviour are unchanged.
10. Exactly one log for the window is still produced by the eventual `setActiveTask`, not by this command.
11. Unit tests in `src/lib/engine/engine.test.ts` cover the above, in the existing `task lifecycle commands` and `deferred finalize safety` style.

## Expected Behavior

- Completing the occupant through this command leaves the work window exactly as it was: same `task_id`, `planned_secs`, `accumulated_secs`, `started_at`, `ends_at`, `paused`, `paused_remaining_secs` and `window_started_at`.
- The task is marked `completed_at` (only if it was `null`) and `archived = true`, and `active_task` is cleared when it pointed at that task.
- A later `setActiveTask` for a different task appends one log for the elapsed portion of the window and rewrites the timer for the new task, exactly as it does today.
- The input state object is never mutated.

## Actual Behavior

- `finalizeTask` ends the window whenever the task is the occupant (`taskCommands.ts:77-83`), via `completeTimer` when the window is depleted or expired and via `stopWorkTimer` otherwise.
- `finalizeDeferredTask` returns `"owner"` and does nothing for the occupant (`pendingFinalize.ts:21`), so there is no path that both commits the task and preserves the window.
- There is no engine command that completes a task without consulting `state.timer`.

### Testing

- `pnpm test:unit` with new cases in `src/lib/engine/engine.test.ts`:
  - completing the occupant stamps `completed_at`, sets `archived`, clears `active_task`, and leaves `state.timer` unchanged (compare with `structuredClone` of the timer, and confirm `next.timer === state.timer` is not mutated).
  - no log is appended and `completed_pomodoros` is not incremented by this command.
  - calling it twice keeps the original `completed_at`, does not throw, and stays archived.
  - completing a non-occupant task matches the non-owner `finalizeTask` outcome for the same task, with the timer untouched.
  - a break timer (`timer.kind !== "Work"`) is untouched.
  - the input state is not mutated (`expect(state).toEqual(before)`), following the existing purity assertions.
  - unknown task id throws the existing "Task not found" error.
  - `completeTimer` is not reachable from this command: after completing the occupant and then switching with `setActiveTask`, exactly one log exists for the window and the timer carries the remainder.
- `pnpm test:unit` also covers the new data-layer wrapper in `src/lib/data/StagedDataAccess.test.ts` (command round-trip and staged-persistence behaviour).
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/lib/engine/taskCommands.ts` — new command beside `finalizeTask`

Code Source: `src/lib/engine/taskCommands.ts:73-89`
Code Description: `finalizeTask` clones state, ends the window when `timer?.task_id === taskId && timer.kind === "Work"`, then stamps `completed_at`, sets `archived = true`, and clears `active_task`. It is the only command that touches both the task and the window.
Code Change Description: Add `completeTaskKeepingWindow(state, taskId, now)` that performs only the task half. Do not import `completeTimer`/`stopWorkTimer` into it and do not read `next.timer`.

```ts
/** Rust: finalize_task */
export function finalizeTask(state: AppStateData, taskId: string, now: Date, logId: string): EngineResult<Task> {
    let next = cloneAppState(state);
    taskOrThrow(next, taskId);
    const timer = next.timer;
    if (timer?.task_id === taskId && timer.kind === "Work") {
        if (windowRemainingSecs(timer, now) <= 0 || (!timer.paused && now.getTime() >= Date.parse(timer.ends_at))) {
            next = completeTimer(next, now, logId).state;
        } else if (elapsedTimerSecs(timer, now) > 0) {
            next = stopWorkTimer(next, now, logId).state;
        } else next.timer = null;
    }
    const task = taskOrThrow(next, taskId);
    if (task.completed_at === null) task.completed_at = now.toISOString();
    task.archived = true;
    if (next.active_task === taskId) next.active_task = null;
    return { state: next, value: { ...task } };
}
```

Contract to document on the new command: the caller must already have established that the window is worth handing over (`windowRemainingSecs(timer, now) > 0`); the command neither checks nor repairs that.

#### `src/lib/engine/index.ts` — barrel export

Code Source: `src/lib/engine/index.ts:86-87`
Code Description: The task-lifecycle group exports `archiveTask`, `deleteTask`, `finalizeTask`, `setActiveTask`, `setTaskTarget` with a `Rust:` comment.
Code Change Description: Add `completeTaskKeepingWindow` to that export list and update the group comment.

```ts
// Task lifecycle: set_active_task, delete_task, archive_task, finalize_task, set_task_target.
export { archiveTask, deleteTask, finalizeTask, setActiveTask, setTaskTarget } from "./taskCommands";
```

#### `src/lib/data/DataAccess.ts` — interface method

Code Source: `src/lib/data/DataAccess.ts:126-131`
Code Description: The task-lifecycle section of the `DataAccess` interface.
Code Change Description: Declare `completeTaskKeepingWindow(taskId: string): Promise<EngineResult<Task>>` next to `finalizeTask`/`archiveTask`.

```ts
finalizeTask(taskId: string): Promise<EngineResult<Task>>;
finalizeDeferredTask(taskId: string): Promise<EngineResult<DeferredFinalizeOutcome>>;
archiveDeferredTask(taskId: string): Promise<EngineResult<DeferredFinalizeOutcome>>;
archiveTask(taskId: string): Promise<EngineResult<Task>>;
```

#### `src/lib/data/InMemoryDataAccess.ts` and `src/lib/data/StagedDataAccess.ts` — implementations

Code Source: `src/lib/data/InMemoryDataAccess.ts:267-270`, `src/lib/data/StagedDataAccess.ts:395-404`
Code Description: Both delegate to the engine with `this.now()` and `this.createLogId()`; the staged variant wraps calls in `this.transition(...)`.
Code Change Description: Add `completeTaskKeepingWindow` following the same pattern. The staged variant uses `this.transition`, and logging ids stay constructed by the existing helpers even though this command writes no log.

```ts
async finalizeTask(taskId: string) { return this.result(finalizeTask(this.store.state, taskId, this.now(), this.createLogId())); }
async archiveTask(taskId: string) { return this.result(archiveTask(this.store.state, taskId)); }
```

```ts
async finalizeTask(taskId: string) {
    return this.transition((state) => finalizeTask(state, taskId, this.now(), this.createLogId()));
}
async archiveTask(taskId: string) {
    return this.transition((state) => archiveTask(state, taskId));
}
```

#### `src/lib/engine/engine.test.ts` — behaviour tests

Code Source: `src/lib/engine/engine.test.ts:114-235` (`task lifecycle commands`), `:236-268` (`deferred finalize safety`)
Code Description: These suites build state with `stateWithTask()`/`task()`/`timer()` helpers, assert with `structuredClone` snapshots, and assert purity with `expect(state).toEqual(before)`.
Code Change Description: Add cases to these suites for the new command; no new helpers are required.

## Notes

- Dependencies: none. Blocks #211; #212, #213 and #214 can land in parallel once this is merged.
- Deliberately out of scope: any caller, any UI change, any change to `finalizeTask`, and any change to the pending-finalize queue. They belong to #211.
- The timer must remain "byte-identical" after the call. Implement it so the command never assigns `next.timer`, and assert it in the test rather than relying on the clone.
