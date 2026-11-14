# Title: Present a completed occupant on the timer panel

## Tags

Complexity Classification: T2
Classification Reason: Presentation plus conditional action routing inside `TimerPanel`, with a new completion-state derivation shared by the chip badge and the primary action. It touches the chip, the action row, the `resumeTimer` path and the existing timer-panel tests, but nothing persisted and no provider.

Severity: Medium
Severity Reason: A wrong derivation either hides Resume or labels a live task as completed, which blocks the user from restarting the clock from the panel. The window and data survive, so it is recoverable, but the panel is the only place that explains a paused-on-completed-task state.

Needs research before implementation: Yes

### Research Needed

"Completed occupant" can come from three sources today, and the panel must present one state for all of them. Confirm these before implementing:

- How `TimerPanel` already derives task identity and linkage (`cardTaskId`, `cardTask`, `linkedTask`, `activeIsTodoTask`), so the completed check uses the same source as the badge and the action.
- Which condition should be authoritative: backend `completed_at`, a PM twin with `status === "Done"` or `isArchived`, or a flag exposed by the #211 controller.
- Whether `resumeTimer` needs a guard of its own or the panel should branch before calling it, including the case where the paused window's remaining time is already zero.
- Whether any other surface renders the same chip (mobile drawer, collapsed layout) and would need the badge for consistency.
- How the existing `TimerPanel.test.tsx` covers the paused/Resume button and the resume card, so those tests stay green.

## Summary

After #211, completing the occupant pauses the clock and commits the task. If the sheet is dismissed, the app is left with a paused timer on a finished task, and nothing on the timer panel says why. The panel currently shows a paused timer and a `Resume` button, which invites the user to keep working on a task that is already done.

The panel is also the safety net for a completed occupant that was never routed through the controller — a Done reached by a board move or a `TaskInspector` edit while the window is still running. In that case no pause ever happened, but the task is still finished.

This issue makes the panel present that state: a `Completed` badge on the task chip, a primary action of "Pick next" that opens the switch sheet instead of "Resume", and `Resume` on a completed occupant routing into the sheet rather than running the clock. It applies whether the state came from the controller or from a planning edit.

This is issue 4 of 5 and requires #210. It can proceed in parallel with #211, #212 and #214, but the "Pick next" action depends on the controller's sheet-opening API from #211.

## Steps to Reproduce Context

1. Start a work pomodoro on a PM-linked task.
2. Mark that task `Done` from the project board or through the `TaskInspector` while the window is still running.
3. Return to the timer panel.
4. Observe: the task chip shows no completion state, the clock keeps running on a finished task, and there is nothing inviting the user to pick something else.
5. Complete the occupant through the completion controller and dismiss the sheet instead.
6. Observe: the clock is paused on a completed task and the primary action is still `Resume`.

## Requirements for completed issue

1. The timer panel's task chip shows a `Completed` badge when the occupant has `completed_at` set or a linked PM twin that is `Done`/archived.
2. When the occupant is completed, the primary action becomes "Pick next", which opens the switch sheet (through the #211 controller) instead of resuming the clock.
3. If `Resume` is reachable for a completed occupant, it routes into the sheet rather than calling `resumeTimer`.
4. The badge and the action use one derivation, so they can never disagree.
5. The state applies whether the completion came from the controller or from a planning edit (board move or `TaskInspector` change) with the window still running.
6. Todo-owned tasks never gain the badge, so to-dos stay silently completed.
7. An occupant with no PM twin is handled: the badge is driven by `completed_at` alone.
8. The resume card stays absent for a completed occupant; the existing `completed_at === null` condition at `TimerPanel.tsx:263` keeps that test green.
9. `Start Focus` can never begin a window on a completed task after `active_task` was cleared.

## Expected Behavior

- A completed occupant on a running window shows `Completed` and `Pick next`; the clock keeps running until the user picks something or ends focus.
- A completed occupant on a paused window shows `Completed` and `Pick next`; nothing suggests resuming work on a finished task.
- Pressing the completed occupant's resume affordance opens the switch sheet.
- A todo-owned active task completes without any badge.
- An occupant with only `completed_at` and no PM twin still shows the badge.
- The resume card does not appear for a completed occupant.
- With `active_task` cleared, `Start Focus` starts from a free state rather than on the completed task.

## Actual Behavior

- The task chip (`src/components/TimerPanel.tsx:599-603`) renders only the task name, so completion is invisible.
- The action row (`src/components/TimerPanel.tsx:664-687`) shows `Pause`/`Resume` with no awareness of completion.
- `Resume` calls `resumeTimer()` unconditionally, so a completed occupant's window can be resumed indefinitely.

### Testing

- `pnpm test:unit` with new cases in `src/components/TimerPanel.test.tsx`:
  - occupant with `completed_at` and a running window → `Completed` badge plus `Pick next`; the clock is not paused by the badge itself.
  - occupant with `completed_at` and a paused window → `Completed` badge plus `Pick next`.
  - occupant whose PM twin is `Done` but whose backend task has no `completed_at` → badge shown.
  - occupant with no PM twin → badge driven by `completed_at`.
  - `Pick next` opens the switch sheet through the controller.
  - the completed occupant's resume affordance opens the sheet and never calls `resumeTimer`.
  - todo-owned active task → no badge.
  - the resume card does not render for a completed occupant.
  - `Start Focus` is not offered while a completed occupant's window is still present, and starting from a cleared `active_task` does not pick the completed task.
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/components/TimerPanel.tsx` — chip badge and primary action

Code Source: `src/components/TimerPanel.tsx:255-268` (task identity, `cardTask`, `waitingTask`), `:599-603` (task chip), `:664-687` (Pause/Resume/Start focus), `:262-267` (resume card gate)
Code Description: The chip renders the resolved task name; the action row branches on `timer`/`isPaused`; the resume card is gated on `cardTask.completed_at === null`.
Code Change Description: Derive a single `occupantCompleted` value, render the badge from it, and branch the primary action on it. Route the completed occupant's resume affordance to the sheet. Leave the `completed_at === null` resume-card gate untouched.

```tsx
{taskName && (
    <span className="px-2 py-1 rounded bg-neutral-800 text-[10px] max-w-55 truncate" title={taskName}>
        {taskName}
    </span>
)}
```

```tsx
{timer && isPaused && (
    <button
        className={ACTION_SECONDARY}
        onMouseEnter={() => play("hover")}
        onClick={() => {
            void resumeTimer().catch(() => {});
            play("pressSide");
        }}
    >
        Resume
    </button>
)}
```

```tsx
const showResumeCard = resumeMemo && lastEnter && cardTask && lastEnter.taskId === cardTask.id &&
    cardTask.completed_at === null && !cardTask.archived &&
    !findPMTaskByAppTaskId(pmState.tasks, cardTask.id)?.isArchived &&
    (cardMemo ? !cardMemo.dismissedAt : cardWeight === "full" &&
        state?.logs.some(log => log.task_id === cardTaskId && !log.was_break) &&
        !(emptyCardDismissal?.taskId === cardTask.id && emptyCardDismissal.at === lastEnter.at));
```

#### `src/components/TaskInspector.tsx` — completion source, no change expected

Code Source: `TaskInspector` (rendered inside the timer panel's details aside, `src/components/TimerPanel.tsx:777-779`)
Code Description: A planning edit here can set the occupant's PM status to `Done` while the window keeps running.
Code Change Description: None expected. It is listed so the implementation verifies the planning-edit path produces the badge without a pause.

#### `src/state/TaskCompletionContext.tsx` (from #211) — sheet-opening API

Code Source: `src/state/TaskCompletionContext.tsx` (added by #211)
Code Description: The controller exposes `completeTask` and the sheet-opening entry point.
Code Change Description: `Pick next` uses that entry point; this issue adds no new provider surface.

## Notes

- Dependencies: #210. The "Pick next" action depends on #211's sheet-opening API; the badge itself is independent and can be reviewed first.
- The badge is the only explanation of a paused-on-completed-task state, and the safety net for a Done reached without the controller.
- Deliberately out of scope: changing the sheet's content, any new completion command, and any behaviour for todo tasks beyond keeping them unbadged.
