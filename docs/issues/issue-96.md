## Title: Timer gets stuck on "Transitioning..." when the final estimated pomodoro completes

## Tags

Complexity Classification: T3
Severity: High
Reason: Deep completion/progression state-machine bug in the local-first timer + sync path. The stuck "Transitioning..." means the timer object is still present at 0 remaining but progression never advanced, which points at `completeTimer` returning `applied: false` or the follow-up `startBreakTimer` failing silently while `timerCompleted` / pending-completion state prevents a retry. Diagnosis spans `AppStateContext` `runProgression`, `StagedDataAccess` `completeTimer`/`startBreakTimer`/`fetchState` CAS guards, the engine `timerCommands`, the sync reconciliation (`SyncCoordinator`, `timerCompletions`, `merge`) that can restore a completed timer, and the `StateSyncBridge` estimate mirroring. Blast Radius=3 (context, staged data access, engine, sync, PM bridge), Uncertainty=3 (exact trigger on the final estimated pomodoro is unconfirmed; the `timerCompleted` / pending-generation / race interactions are hard to trace), Behavior=3 (concurrency/CAS state management plus a possible missing "what happens after the final estimate" behavior), Testing=2 (timing/estimate boundary is hard to reproduce; the existing unit test uses `InMemoryDataAccess` and does not exercise `StagedDataAccess` + sync, and E2E lacks the final-estimate case), Reversibility=1 (code-only revert, though replayed pending completions may need cleanup). Total=12.
Needs research before implementation: Yes — Trace the exact failure path for a work timer whose `completed_pomodoros` reaches `target_pomodoros`: whether `completeTimer` returns `applied: false` (via `record.timerCompleted`, the already-journaled `generationKey`, or a CAS mismatch) and/or whether `startBreakTimer` throws "No active task" and is swallowed; establish whether the task/active task is cleared at the estimate boundary (no such code was found in the read paths); determine how sync reconciliation can restore a completed timer and re-arm `timerCompleted`; and define the intended behavior after the final estimated pomodoro.

## Summary

When a work pomodoro completes and it is the last one required by the task's estimate, the timer remains displayed as `Transitioning...` at `00:00` and never advances (no break starts and the UI never returns to `READY`). Completing a pomodoro that does not reach the estimate transitions normally, so the final estimated pomodoro appears to be the trigger.

## Steps to Reproduce Context

1. Create or select a task with a small estimate (for example, 1 pomodoro) so the next completed work timer reaches the estimate.
2. Start Focus and let the work timer run to completion (or seed/expire a work timer for the active task whose completion reaches the estimate).
3. Observe that the timer shows `Transitioning...` with `00:00` and no further transition occurs.
4. Compare with a task whose estimate is not reached by the completed pomodoro, where the app advances to the break timer.

## Expected Behavior

Completing a work pomodoro transitions to the next timer state (the auto-started break for a work timer) consistently, whether or not that pomodoro reaches the task's estimated count. The timer never remains permanently at `00:00` with the `Transitioning...` label.

## Actual Behavior

When the completed pomodoro is the final one in the task's estimate, the timer object stays present at `0` remaining and the panel is stuck showing `Transitioning...`; no break starts and nothing else happens. No user-visible error is shown, and there is no way to recover from the panel.

## Requirements for completed issue

1. Completing a work pomodoro that reaches the task's estimated count no longer leaves the timer stuck on `Transitioning...`; the timer advances to its next state.
2. The completion-to-next-timer transition behaves consistently whether or not the completed pomodoro reaches the estimate.
3. A failed or skipped automatic transition does not silently strand the timer at `00:00` — the user can recover and the state is not permanently wedged.
4. Regression coverage exists for completing the final estimated pomodoro through the production data path.

## Context

- Files:
  - `src/state/AppStateContext.tsx` — owns auto-progression (`runProgression`) and the expired-timer effect.
  - `src/components/TimerPanel.tsx` — renders the `Transitioning...` label.
  - `src/lib/engine/timerCommands.ts` — `completeTimer` / `startBreakTimer` engine commands.
  - `src/lib/data/StagedDataAccess.ts` — production `completeTimer` CAS guards, journal, `startBreakTimer`, and `fetchState` reconciliation.
  - `src/lib/data/sync/SyncCoordinator.ts`, `src/lib/data/sync/timerCompletions.ts`, `src/lib/data/sync/merge.ts` — completion replay and winner/loser reconciliation.
  - `src/state/StateSyncBridge.tsx` — mirrors worked pomodoros / estimates between PM metadata and backend tasks.
  - `src/components/TaskPanel.tsx` — the only caller of the manual `finalizeTask` ("Complete") button.
  - `src/state/AppStateContext.test.tsx`, `e2e/timer.spec.ts` — existing transition coverage.
- Code Snippets:
  - The stuck label is shown whenever a timer exists with zero remaining (`src/components/TimerPanel.tsx:604`):
    ```tsx
    {timer && ms === 0 && <span className="text-emerald-400 text-xs font-medium">Transitioning...</span>}
    ```
  - Auto-progression completes the timer and, only when no timer remains, starts the next one; failures are swallowed (`src/state/AppStateContext.tsx:151-164`):
    ```tsx
    if (!after.timer) {
        const kind = finishedTimer?.kind ?? reconciliation?.timer.kind;
        if (kind === "Work") {
            try {
                const started = await data.startBreakTimer();
                setState(started.state);
            } catch (err) { console.warn("Failed to auto-start break timer", err); }
        } else if (after.active_task) {
            ...
        }
    }
    ```
  - `startBreakTimer` requires an active task and derives the break kind from the cycle (`src/lib/engine/timerCommands.ts:68-78`):
    ```ts
    const taskId = requireActiveTask(next);
    const isLong = next.current_cycle_pomodoros >= next.settings.segment_length;
    if (isLong) next.current_cycle_pomodoros = 0;
    ```
  - `completeTimer` increments the task's completed count and clears the timer (`src/lib/engine/timerCommands.ts:96-105`):
    ```ts
    if (!wasBreak) {
        const task = next.tasks[timer.task_id];
        if (task) { ... task.completed_pomodoros += fraction; }
        next.current_cycle_pomodoros += 1;
    }
    next.timer = null;
    ```
  - Production completion is guarded and journaled (`src/lib/data/StagedDataAccess.ts:256-322`), e.g.:
    ```ts
    if (record.timerCompleted) {
        return { state: cloneAppState(record.state), value: cloneAppState(record.state), applied: false };
    }
    ```
  - `fetchState` only reconciles an expired timer when `timerCompleted` is false (`src/lib/data/StagedDataAccess.ts:222`):
    ```ts
    if (timer && !timer.paused && new Date(timer.ends_at).getTime() <= this.now().getTime() && !record.timerCompleted) {
    ```

## Notes

- No code was found that automatically finalizes/archives a task (or clears `active_task`) when `completed_pomodoros` reaches `target_pomodoros`; `finalizeTask` is only invoked from the manual "Complete" button in `src/components/TaskPanel.tsx:340`. This makes the exact relationship between "final estimated pomodoro" and the stuck state an open question for the research step.
- The existing unit test `auto-progresses an expired work timer into a break exactly once` uses `target_pomodoros: 1` with `InMemoryDataAccess`, which does not exercise the production `StagedDataAccess` CAS guards or the sync reconciliation, and the E2E test does not cover the final-estimate case.
- Commit history for context: `fd95e74` introduced auto-progression and replaced the manual "Complete" button with `Transitioning...`; `e43f03d` made the work→break auto-start conditional on the post-completion active task.
