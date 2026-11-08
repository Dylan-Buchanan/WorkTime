# Title: Switch/Waiting sheet with live-clock handoff

## Tags

Complexity Classification: T3
Classification Reason: Adds a new task-selection sheet and two timer-page actions, then wires selection through the window-join path, PM status advancement, the waiting flag, paused-window resume and the sync bridge's linker. Spans UI, state and sync layers, with several explicitly open edge cases.

Severity: Medium
Severity Reason: Affects the highest-traffic surface (the timer page) and can misassign the running task, skip a status advance, or drop banked progress. Failures are visible, the clock keeps running, and existing stop/undo paths let the user recover with at most one partial pomodoro lost. No security or destructive-migration exposure.

Needs research before implementation: Yes

### Research Needed

- Confirm the exact APIs landed by the preceding issues in this series: the window join path and `window_started_at`, `PMTask.waiting`, the status-advance helper, and the ranking module's function signature and tier output.
- Determine how the `StateSyncBridge` linker can be awaited or observed for one specific unlinked candidate, and how a linkage failure should surface in the sheet (`src/state/StateSyncBridge.tsx:198-267`).
- Define the `active_task` / outgoing-task ownership rule when a break timer already owns the outgoing task and the window expires while the sheet is open.
- Confirm whether the sheet belongs inside `TimerPanel`'s details aside or as a separate overlay, so the existing auto-select refs (`todayDetailsTaskId`, `autoSelectedTaskRef` at `src/components/TimerPanel.tsx:300-345`) are not disturbed.

## Summary

When a task stalls mid-pomodoro, the user needs to hand the running clock to another task in two clicks, without stopping the timer and without losing the window.

This issue adds a switch/waiting sheet to the timer page. It is deliberately generic — the waiting feature does not own reusable machinery — so pomodoro-end, break-end and idle-Today reuse can be added later without rework.

The sheet is only offered while a live Work window exists. It shows the promoted cards from the ranking module, keeps the clock running, and hands the window over through the existing join path.

## Steps to Reproduce Context

1. Start a work timer on a task.
2. Look for a way to move the running clock to a different task without stopping the timer.
3. Observe: the only options are stopping the timer, or switching through the task panel, which discards the window remainder.

## Requirements for completed issue

1. The timer page shows two buttons, both only while a live Work window exists: **Waiting…** and **Switch**.
2. **Waiting…** marks the current task waiting and then opens the sheet with the Agent/Person control at the top.
3. **Switch** opens the same sheet without setting the flag.
4. The sheet shows the three promoted cards plus a collapsible "Other options" continuation list, with a section header per tier rather than a per-card reason.
5. Cards carry title, project dot, remaining pomodoros, due date, priority and status.
6. The clock keeps running throughout, with no live-clock display in the overlay.
7. Selecting a task hands the window over through the join path, resumes a paused window, and advances status.
8. Cancelling leaves the task waiting and the timer running; the pill's `×` undoes the flag.
9. Edge cases behave as specified:
   - Window expires while the sheet is open: the switch still applies and the break proceeds normally, with a defined rule for `active_task` when a break timer already owns the outgoing task.
   - Unlinked candidate: await the existing `StateSyncBridge` reconciler and show a brief "preparing…" state instead of reimplementing create/link; surface a failure if linkage never lands.
   - Paused window plus selection: the window resumes.
   - Follow-up with banked progress: the current window wins and its partial stays banked.
   - Only one task and no window: both buttons are hidden, and `TaskPanel` remains the place to pick work.
10. No keyboard shortcut, no global hotkey, and no notification.

## Expected Behavior

- With a live work window, both buttons are visible; with no window, neither is.
- Pressing **Switch** opens a sheet listing three promoted options and a collapsible continuation list, while the timer keeps counting down.
- Choosing an option moves the running clock to that task without changing the window end time.
- Pressing **Waiting…** sets the waiting flag, opens the same sheet with the type control at the top, and leaves the clock running if the sheet is dismissed.
- Dismissing the sheet does not stop the timer or clear the waiting flag.
- A candidate with no backend task shows "preparing…" and then becomes selectable once the bridge links it.

## Actual Behavior

- There is no switch or waiting affordance on the timer page.
- Moving the clock to another task requires the task panel or a stop/start, which discards the window remainder.

### Testing

- `pnpm test:unit` — `src/components/TimerPanel.test.tsx`: both buttons appear only with a live Work window; the sheet opens with the right header mode; the timer keeps running while the sheet is open; selection hands over without changing `ends_at`; cancel leaves the timer running.
- Sheet component coverage: tier section headers, the collapsible continuation list, card contents, and the empty state.
- Paused window: selecting resumes the window.
- Expiry-while-open: the switch applies and the break proceeds; `active_task` ownership matches the defined rule.
- Unlinked candidate: "preparing…" appears, then resolves once the bridge links; a permanent failure surfaces an error instead of hanging.
- `pnpm test:e2e` — one end-to-end pass: start work, open the sheet, switch, and confirm the same window continues on the new task.

## Issue Context

### New Files

- A new sheet component under `src/components/` with a colocated test. It is presentational plus a selection callback; ranking, joining and status logic stay in their existing modules.

### Remove Files

None.

### Change Files

#### Timer page actions

Code Source: `src/components/TimerPanel.tsx`
Code Description: Pulls `{ state, startWork, skipBreak, remainingMs, error, pauseTimer, resumeTimer, isPaused, tick }` from `useAppState` at `:223`; the timer badge is at `:347-355`; the action buttons are at `:539-631`; the details-panel selection refs are at `:300-345`.
Code Change Description: Add the **Waiting…** and **Switch** buttons (visible only with a live Work window), host or open the sheet, and keep the existing selection refs coherent when the sheet changes the active task.

Files Using: `src/components/TimerPanel.test.tsx`

#### Window join path

Code Source: `src/state/AppStateContext.tsx:283-294`
Code Description: `startTaskWork` throws when any timer is running, then calls `data.setActiveTask(id)` and `data.startWorkTimer()`.
Code Change Description: The sheet's selection must go through the same path that joins a live Work window, and must resume a paused window rather than starting a new one.

Files Using: `src/components/TodaySurface.tsx:155`, `src/state/TodoContext.tsx:250`

#### Waiting flag write

Code Source: `src/state/ProjectManagerContext.tsx:647-656`
Code Description: `updateTask` persists a PM task patch.
Code Change Description: **Waiting…** sets the flag on the current occupant; cancelling leaves it set.

Files Using: `src/components/ProjectManager/TaskInspector.tsx`

#### Linker await surface

Code Source: `src/state/StateSyncBridge.tsx:198-267`
Code Description: Auto-creates backend tasks for unlinked PM entries, reserving ids in `linkingTaskIdsRef` and persisting `appTaskId` through `data.savePMState`; a title-based auto-link also exists at `:335-347`.
Code Change Description: Provide a way for the sheet to observe that a specific candidate has become linked (and to surface failure) without reimplementing create/link.

Files Using: `src/state/ProjectManagerContext.test.tsx:477`

#### Ranking consumption

Code Source: the pure ranking module added by issue 5 in this series
Code Description: Returns a top three (one per tier) plus a continuation list, with the reference date injected.
Code Change Description: Render its output as the sheet's sections. No ranking logic belongs in the component.

Files Using: `src/components/TimerPanel.tsx`

## Notes

- Depends on issue 1 (window join + `window_started_at`), issue 2 (status advance), issue 3 (`PMTask.waiting`), issue 4 (waiting badge and pill `×`) and issue 5 (ranking module).
- Keep the sheet generic: no pomodoro-end, break-end or idle-Today behaviour in this issue, but do not design anything that blocks adding them later.
- Do not add a live countdown inside the overlay.
