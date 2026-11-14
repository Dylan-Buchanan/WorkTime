# Title: Completion controller and single switch sheet host

## Tags

Complexity Classification: T3
Classification Reason: Introduces a new provider in the authenticated provider graph, relocates the single `SwitchSheet` out of `TimerPanel`, and reroutes three completion entry points onto a five-branch decision table that sequences pause, memo hold, engine commit and sheet presentation. It sits directly on the timer lifecycle, the PM task model and the resume-memo hold contract at once.

Severity: High
Severity Reason: This is the behaviour change #194 asks for. A wrong branch either ends a valid work window, commits an occupant twice, or opens the sheet over a half-applied state, and the failure modes are silent because the clock keeps running.

Needs research before implementation: Yes

### Research Needed

The controller has to sequence an existing set of async commands without duplicating them, and the ordering guarantee (memo hold covering both the pause and the commit) depends on hooks that already exist. Confirm these before implementing:

- What `pauseTimer`, `resumeTimer({ handoff: true })` and `adoptResult`/`adoptTaskTransition` in `src/state/AppStateContext.tsx` guarantee about revision refreshes landing mid-command, and how `pauseEpisodeRef` interacts with a pause the controller starts itself.
- How `holdMemoPresentation` in `src/state/ResumeMemoContext.tsx` stacks and releases, so the controller can hold across pause + commit + sheet lifetime without leaking a hold.
- How `useWindowHandoff` in `src/hooks/useWindowHandoff.ts` resumes a paused owner (`resumeTimer({ handoff: true })`) and what it expects the sheet's starting state to be.
- How `SwitchSheet`'s props (`mode`, `result`, `notice`, `error`, `linkStateOf`) are currently supplied from `TimerPanel`, so the host can supply them without regressing the waiting flow.
- Where the provider must sit in `src/App.tsx:159-194` to be above the route shell but still inside `AppStateProvider`, `ProjectManagerProvider` and `ResumeMemoProvider`.
- How `pendingFinalizeTaskIds` and `requestFinalize` are consumed by the sidebar, so the occupant never enters that queue and the todo path keeps working.

## Summary

Today there are three completion entry points with three copies of the same modal logic: the sidebar active-row Complete button in `src/components/TaskPanel.tsx:341-352` calls `finalizeTask(t.id)` directly, `TodaySurface.handleCompleteTask` in `src/components/TodaySurface.tsx:198-208` sets the PM task to `Done` and then awaits `requestFinalize(appTaskId)`, and the sheet itself is mounted inside `TimerPanel` (`src/components/TimerPanel.tsx:786`) with local `sheet` state at `:270`.

Completing the occupant therefore ends the window, and there is no single place that can answer "is a switch in flight". This issue adds one provider above the authenticated route shell that exposes `completeTask(pmTaskId)`, owns the decision table, and owns the single `SwitchSheet` mount. Switch and Waiting route into it, and both the sidebar row and the Today surface call it. The todo path keeps `requestFinalize`.

Owning the sheet in one place is also what makes the ordering guarantee possible: the memo hold must span both the pause and the completion commit, so no memo can present under or after the sheet.

This is issue 2 of 5 and requires #210. Issues #212, #213 and #214 can proceed in parallel once #210 lands.

## Steps to Reproduce Context

1. Start a work pomodoro on a PM-linked task with time remaining on the window.
2. Press Complete on that task from the sidebar active row, or from the Today surface.
3. Observe: the work window is ended, so the remaining time is lost and no switch offer appears.
4. Open the switch sheet from the timer panel and press Escape.
5. Observe: the sheet closes with no durable task state, and the three entry points share no notion of a switch being in flight.

## Requirements for completed issue

1. A provider mounted inside the authenticated provider graph but above `TopNav`/`Outlet` (`src/App.tsx:175-179`), exposing `completeTask(pmTaskId)`.
2. The decision table is implemented exactly as specified:
   1. Not the window occupant → today's `finalizeTask` behaviour.
   2. Occupant with `windowRemainingSecs(timer, now) <= 0` → `finalizeTask` plus progression.
   3. Occupant with at least one workable candidate → pause, hold memo presentation, owner-safe commit (`completeTaskKeepingWindow` from #210), open the sheet.
   4. Occupant with tasks but none workable → as (3) plus a notice explaining why nothing is offered.
   5. Occupant with nothing else at all → `finalizeTask` plus progression, with no sheet.
3. The provider is the only place that mounts `SwitchSheet`; the mount and the local `sheet` state are removed from `TimerPanel.tsx`.
4. The existing Switch and Waiting entry points in `TimerPanel` open the sheet through the controller rather than through local state.
5. The sidebar active-row Complete (`TaskPanel.tsx:341-352`) and `TodaySurface.handleCompleteTask` (`TodaySurface.tsx:198-208`) call `completeTask` instead of `finalizeTask`/`requestFinalize`.
6. The todo completion path continues to use `requestFinalize`, unaffected.
7. The memo hold taken by the controller covers the pause and the completion commit, and is released only when the sheet closes, so the ordering guarantee holds.
8. The controller never enqueues `pendingFinalize` for the occupant: the pending-finalize queue is not used on any branch.
9. The pause step is idempotent — a task that is already paused completes without an error or a second pause command.
10. When a break is running (`workStartOccupation === "blocked"`), completing the task performs only the completion, with no sheet.
11. An occupant with no linked PM task (`waitingTask === null`, so `currentOccupantId` is `null`) is handled without throwing and without opening an empty sheet.
12. If the commit fails after a successful pause, the timer stays paused, the error is surfaced, and no sheet is opened over the half-applied state.
13. Double invocation and an in-flight switch remain safe when a revision refresh lands between steps.

## Expected Behavior

- Completing the active task while the window has time left pauses the clock, commits the task, and offers a switch instead of ending the window.
- Choosing a next task from the sheet hands the paused window and its remaining time to that task, producing one log for the window.
- Dismissing the sheet leaves the clock paused on a completed task, with no cleanup needed because the commit is already durable.
- Completing a task that is not the occupant behaves exactly as it does today.
- Completing the occupant when the window is already depleted, or when there is genuinely nothing else to do, ends the window as it does today.
- Completing during a break completes the task without opening the sheet.
- Switching from the timer panel and completing from the sidebar or Today surface share one code path, so they cannot disagree.

## Actual Behavior

- `finalizeTask` ends the window whenever the task owns it (`src/lib/engine/taskCommands.ts:77-83`), and both completion entry points route through it or through `requestFinalize`, which defers to `pendingFinalizeRef` for the occupant.
- The `SwitchSheet` is mounted inside `TimerPanel` with local state, so it only exists on the timer route and is invisible to the other completion paths.
- No component knows whether a switch is in flight, so memo presentation is only held while the sheet is mounted, not across the pause and commit that precede it.

### Testing

- `pnpm test:unit` with new cases for the provider:
  - each of the five branches produces the specified command sequence (finalize vs pause+commit+sheet) for a synthetic state.
  - branch 3 keeps the window: after `completeTask`, `state.timer` is still the same window, paused, and the task is `completed_at`/`archived`.
  - branch 2 and branch 5 end the window and run progression.
  - a paused occupant completes without a second pause command.
  - a break timer completes the task only, with no sheet opened.
  - an occupant with no PM twin does not throw and does not open an empty sheet.
  - a failing commit leaves the timer paused, surfaces the error, and leaves the sheet closed.
  - two rapid `completeTask` calls for the same id produce one commit.
  - the pending-finalize queue never receives the occupant on any branch.
- `src/components/TimerPanel.test.tsx` and `src/components/TaskPanel`-level tests: the sheet opens through the controller and the sidebar button calls the controller.
- `src/components/TodaySurface` tests: `handleCompleteTask` routes through the controller while the todo path still uses `requestFinalize`.
- `pnpm test:unit` for the resume-memo hold: the hold is taken before the pause resolves and released on sheet close.
- `pnpm run build` passes.

## Issue Context

### New Files

#### `src/state/TaskCompletionContext.tsx` — the controller and sheet host

Purpose: own `completeTask(pmTaskId)`, the decision table, and the single `SwitchSheet` mount. Exported as `TaskCompletionProvider` plus `useTaskCompletion()` (and an optional variant for surfaces that may render outside the provider).

```ts
export interface TaskCompletionContextValue {
    /** Commit a PM task, preserving the running work window when a switch is offered. */
    completeTask: (pmTaskId: string) => Promise<void>;
    /** Open the sheet directly (Switch / Waiting entry points). */
    openSwitchSheet: (mode: "switch" | "waiting") => void;
    /** True while a completion/switch sequence is in flight. */
    busy: boolean;
}
```

### Change Files

#### `src/App.tsx` — provider placement and single host

Code Source: `src/App.tsx:159-194`
Code Description: `DataProvider > SyncProvider > AppStateProvider > ProjectManagerProvider > AgentApprovalProvider > Habit/Goal/Todo/Toast/Pet/PetActivity/CalendarBusy/PetReminder/ResumeMemoProvider > StateSyncBridge + TopNav/Outlet`.
Code Change Description: Mount `TaskCompletionProvider` inside the providers it consumes and above the `TopNav`/`Outlet` shell, so the sheet can render over any route.

```tsx
<StateSyncBridge />
<div className="flex flex-col h-screen overflow-hidden bg-neutral-950 text-neutral-200 text-xs">
    <TopNav />
    <UnsyncedBanner />
    <div className="flex-1 min-h-0"><Outlet /></div>
</div>
```

#### `src/components/TimerPanel.tsx` — remove the local sheet

Code Source: `src/components/TimerPanel.tsx:270-283` (sheet state, `openSheet`, `closeSheet`), `:786-798` (mount)
Code Description: `sheet` state, `openSheet`/`closeSheet`, `useWindowHandoff` and the `SwitchSheet` mount all live in the timer panel; `waitingTask` is derived from the timer through `findPMTaskByAppTaskId`.
Code Change Description: Delete the local sheet state and mount, and call the controller for Switch and Waiting. `waitingTask`/`waiting` remain for the Waiting badge.

```tsx
const [sheet, setSheet] = useState<{ mode: "switch" | "waiting"; reference: Date; occupantId: string | null } | null>(null);
const handoff = useWindowHandoff(() => setSheet(null), sheet ?? undefined);
```

#### `src/components/TaskPanel.tsx` — active-row Complete

Code Source: `src/components/TaskPanel.tsx:340-352`
Code Description: The active row renders a Complete button that calls `finalizeTask(t.id)` and plays the completion sound.
Code Change Description: Resolve the row's PM task and call `completeTask(pmTaskId)`; keep the sound and keep the button's visibility condition.

```tsx
{active && !t.completed_at && (
    <button
        onMouseEnter={() => play("hover")}
        onClick={(e) => {
            e.stopPropagation();
            finalizeTask(t.id);
            play("completeTask");
        }}
        className="rounded bg-emerald-600 px-2.5 py-1 text-[10px] text-white transition hover:bg-emerald-500 active:bg-emerald-700"
    >
        Complete
    </button>
)}
```

#### `src/components/TodaySurface.tsx` — completion entry point

Code Source: `src/components/TodaySurface.tsx:198-208`
Code Description: `handleCompleteTask` sets the PM task `Done`, plays the sound, then awaits `requestFinalize(appTaskId)` and reports a notice on failure.
Code Change Description: Call `completeTask(task.id)` after the `Done` status update, keeping the notice/error handling.

```tsx
const handleCompleteTask = async (task: TodayTaskEntry) => {
    updateTask(task.id, { status: "Done" });
    play("completeTask");
    const appTaskId = task.appTaskId;
    if (!appTaskId || !state?.tasks?.[appTaskId]) return;
    try {
        await requestFinalize(appTaskId);
    } catch {
        setNotice(`Couldn't finish “${task.title}” on the timer.`);
    }
};
```

#### `src/components/SwitchSheet.tsx` — unchanged props, new owner

Code Source: `src/components/SwitchSheet.tsx:8-22`
Code Description: The sheet already accepts `mode`, `result`, `notice`, `error`, `busyTaskId`, link state callbacks, `onSelect` and `onClose`, so it can be hosted anywhere.
Code Change Description: Expect no change here beyond #214's overlay work; the controller supplies the same props the timer panel supplies today.

#### `src/hooks/useWindowHandoff.ts` — reused by the controller

Code Source: `src/hooks/useWindowHandoff.ts:47-77`
Code Description: `join` resumes a paused owner with `resumeTimer({ handoff: true })` before starting the new task, and calls `onSuccess` only when the operation token is still current.
Code Change Description: Reuse it from the host instead of duplicating the join logic; verify the paused-by-controller starting state resumes cleanly.

## Notes

- Dependencies: #210 (owner-safe commit) must land first. #212 supplies the branch 4 explanation, #213 the completed-occupant presentation, #214 the overlay ordering; all three are optional for this issue's own tests to pass.
- The dismissal path needs no cleanup because the commit is already durable; the paused window simply waits.
- Deliberately out of scope: the "nothing workable" classifier (#212), the completed-occupant badge and action verbs (#213), and z-order/Escape work (#214).
