## Title: Preserve per-task in-progress pomodoro so returning to a task resumes where it left off

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Cross-file behavior change touching core timer lifecycle semantics (`setActiveTask`, `startWorkTimer`, `finalizeTask`), a new client-side persisted data shape (per-task in-progress pomodoro state in the staging store), and ripples through the data access layer, sync/CAS journaling, and UI. The backend/supabase schema, RPCs, and the single-pomodoro-state engine invariant are explicitly unchanged, which keeps it under T4.
Needs research before implementation: Yes — (1) where the per-task in-progress pomodoro map should live (new staging-store key vs. extended state) while remaining unsynced; (2) how a resumed timer interacts with the timer-completion CAS journal (`timerGenerationKey`, `expectedTimerState`/`resultTimerState`) and load-time reconciliation; (3) semantics for finalize/archive/delete of a task holding stored in-progress pomodoro progress; (4) how the pure engine stays free of I/O/wall-clock/random inputs (stored state passed as command parameters).

## Summary

When a user switches away from a task mid-pomodoro to complete another task and then returns, their partial pomodoro progress on the first task is lost — a fresh pomodoro starts from zero. In-progress pomodoro state should be temporarily stored per task in the client so a user can resume that task's pomodoro from where they left off. Backend logic keeps maintaining a single shared pomodoro cycle across all tasks (no changes there).

## Steps to Reproduce Context

1. Start a work pomodoro on Task A and let it run partway (e.g., 10 of 25 minutes).
2. Switch active task to Task B and complete/finalize Task B.
3. Switch back to Task A and start a work timer.

## Expected Behavior

- Task A's partial pomodoro (the ~10 minutes already accrued) is preserved client-side, per task.
- When resuming Task A, the work timer resumes from the saved point rather than starting a fresh full pomodoro.
- Completing or finalizing other tasks does not disturb any other task's stored in-progress pomodoro.
- Users can check tasks off as completed during a working session without losing another task's pomodoro progress.

## Actual Behavior

- `setActiveTask` credits only an elapsed fraction to the old task's `completed_pomodoros` and reassigns the running timer's *remaining* time to the new task; no in-progress position is retained for the old task.
- Returning to Task A and starting a work timer creates a brand-new full-duration pomodoro from zero; the earlier elapsed minutes within that pomodoro slot are not recoverable.

## Requirements for completed issue

1. In-progress pomodoro state (elapsed portion within the current pomodoro for each task) is temporarily stored on the client, scoped per task.
2. Switching tasks mid-pomodoro saves the current task's pomodoro progress; re-selecting that task resumes its timer from the saved point instead of resetting.
3. Backend/logic that maintains the single shared pomodoro cycle state (`current_cycle_pomodoros`, logs, sync CAS machinery) is unchanged; server schema and sync payloads are unchanged.
4. Finalizing, archiving, or deleting a task cleanly discards its stored in-progress pomodoro without side effects on other tasks' progress or the running timer.
5. The engine remains a pure TypeScript source of truth with no I/O, wall-clock, or random-ID dependencies in command inputs; any stored state is passed as command parameters.
6. Unit tests cover save/resume/reset flows; existing engine tests that change semantics are updated.

## Context

- Files:
  - `src/lib/engine/timerCommands.ts` — `startWorkTimer` always creates a fresh full-duration Work timer; `completeTimer` credits `planned / workSecs` to `timer.task_id` and increments `current_cycle_pomodoros`; `stopWorkTimer` credits elapsed fraction.
  - `src/lib/engine/taskCommands.ts` — `setActiveTask` (lines 15–54): when switching tasks mid-work-timer it credits `clampFraction(elapsed / workSecs)` to the old task's `completed_pomodoros`, then moves the running timer to the new task with `planned_secs: remaining` — losing any notion of the first task's in-progress pomodoro slot. `finalizeTask` (line 74–87) clears the timer if it belongs to the finalized task.
  - `src/lib/engine/core.ts` — `AppStateData` shape: single `active_task`, single `current_cycle_pomodoros` (shared cycle counter), `timer: ActiveTimer | null`; `ActiveTimer` has `task_id`, `started_at`, `ends_at`, `paused_remaining_secs`, `planned_secs`, `accumulated_secs`.
  - `src/lib/data/staging/` — per-owner localStorage staging store (`worktime:staging:v1:*`), the approved client persistence layer for local app/PM state plus sync metadata; must stay frontend-owned and not moved server-side.
  - `src/lib/data/InMemoryDataAccess.ts`, `src/lib/data/StagedDataAccess.ts` — data access implementing `startWorkTimer`/`setActiveTask`/`completeTimer`.
  - `src/lib/data/sync/timerCompletions.ts` — timer-completion CAS journal (`timerGenerationKey`, `expectedTimerState`/`resultTimerState`) that a resumed timer must remain compatible with.
  - `src/state/types.ts` — `AppStateData`/`ActiveTimer` type definitions.
  - UI call sites: `src/components/TaskPanel.tsx` (`setActiveTask`, `finalizeTask`), `src/components/TimerPanel.tsx`, `src/state/ProjectManagerContext.tsx`.
- Code Snippets:

```ts
// src/lib/engine/taskCommands.ts — setActiveTask (current switch semantics)
if (elapsed > 0) {
    const workSecs = next.settings.work_minutes * 60;
    const oldTask = next.tasks[timer.task_id];
    if (oldTask && workSecs > 0) {
        oldTask.completed_pomodoros += clampFraction(elapsed / workSecs);
        ...
    }
    appendLog(next, timer.task_id, elapsed / 60, now, false, logId);
}

const remaining = planned - elapsed;
if (remaining > 0) {
    next.timer = {
        ...timer,
        task_id: taskId,
        planned_secs: remaining,   // remaining time transfers to the NEW task
        ...
```

```ts
// src/lib/engine/timerCommands.ts — startWorkTimer always starts fresh
const timer = makeTimer(taskId, "Work", next.settings.work_minutes * 60, now);
```

## Notes

- Client-side storage must respect repo guidance: only the per-owner staging store may hold this; it must not be synced via Tauri invoke/file paths or pushed server-side beyond existing staging metadata rules.
- Open design questions (needs research): storage location/format for the per-task map, interaction with the completion CAS journal on reload/reconcile, and whether fraction crediting on switch stays as-is once in-progress state exists.
