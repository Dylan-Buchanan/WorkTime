# Title: Waiting presentation across timer and lists

## Tags

Complexity Classification: T3
Classification Reason: Spans the timer pill, task-panel rows, the Today surface and the pure Today builder, and depends on the new persisted `PMTask.waiting` flag. Cross-module UI plus an ordering change in a pure list builder that already has agreement assertions against the projection backlog.

Severity: Medium
Severity Reason: No data loss or security exposure, but the Today surface is the user's daily plan; a wrong `remainingPomodoros` total or a non-deterministic pinned order quietly undermines trust in that plan. A stuck badge or a dangling details selection is a recoverable UX defect.

Needs research before implementation: Yes

### Research Needed

- Confirm `buildTodayTasks` is consumed only by the Today surface and its tests (`src/lib/today.ts:76-95` → `src/components/TodaySurface.tsx:117-127`), so pinning cannot perturb the projected-finish backlog assertions in `src/lib/today.test.ts:201` or the changes open issue #172 makes to the same filter/sort.
- Confirm how the existing details-panel selection refs (`todayDetailsTaskId`, `autoSelectedTaskRef` in `src/components/TimerPanel.tsx:300-345`) behave when a badged task disappears because it became `Done`.
- Confirm the accessible-label pattern used by existing dot/badge treatments in `src/components/TaskPanel.tsx:334` and the timer pill so the new dot matches it.

## Summary

Waiting is only useful if it is visible and cheap to undo. This issue adds three surfaces for the flag introduced by the previous issue:

- The timer pill states *why* the clock is on something else, with a clear action.
- Task-panel rows and Today entries get a dot so a stalled task is recognisable in a list.
- Today pins waiting tasks to the top so the return path is obvious, while still counting them in the existing "Np left" total.

The clear action on the pill is necessary because "clear on next start" cannot fire for a task that is already running.

## Steps to Reproduce Context

1. Mark a task waiting on an agent (previous issue).
2. Start a work timer on that task.
3. Observe the timer pill, the task-panel row and the Today entry: all look identical to a non-waiting task.
4. Observe there is no way to clear the flag from the timer page.

## Requirements for completed issue

1. The timer pill renders `WAITING · AGENT` in violet or `WAITING · PERSON` in amber when the active task is waiting, alongside (not instead of) the existing kind/`PAUSED` badge.
2. The pill's hover title shows elapsed wait time computed from `waiting.since`, with no live/interval timer, and degrades to a days-scale wording when `since` is far in the past.
3. A `×` on the pill clears the flag without disturbing the clock, including while the timer is paused.
4. Task-panel rows and Today list entries show a dot-only treatment for waiting tasks.
5. The dot carries an accessible label; colour alone is not the signal.
6. Waiting tasks are pinned to the top of the Today surface and remain counted in the existing "Np left" total. There is no separate "Waiting on" group and waiting tasks are not excluded from Today.
7. The pinned ordering is deterministic: waiting tasks first, then the existing bucket → due → title sort.
8. `remainingPomodoros` is provably unchanged by pinning (a pure-builder assertion, not a visual check).
9. A task marked `Done` while its badge is visible disappears from the list without leaving a dangling details selection.

## Expected Behavior

- The timer pill states `WAITING · AGENT` or `WAITING · PERSON` for a waiting active task, on both a running and a paused timer.
- Hovering the pill reports how long the task has been waiting.
- Clicking `×` on the pill removes the flag immediately; a paused timer stays paused with the same remaining time.
- Waiting tasks appear at the top of Today with a labelled dot, and the "Np left" figure is the same as before the pin.
- Waiting tasks also show a dot in the task panel.

## Actual Behavior

- No waiting surface exists on the timer pill, in task-panel rows, or on the Today surface.
- Today ordering is purely bucket → due → title (`src/lib/today.ts:84-91`).

### Testing

- `pnpm test:unit` — `src/lib/today.test.ts`: pinning keeps `remainingPomodoros` identical to the unpinned result, and the pinned order is waiting-first then bucket → due → title. Include a waiting task in the fixture that also exercises the existing daily-backlog agreement assertion at `:201`.
- `src/components/TimerPanel.test.tsx`: both badge variants render; the badge renders while paused; the hover title is present; `×` clears the flag and leaves the clock untouched.
- `src/components/TaskPanel.test.tsx`: the dot renders with an accessible label.
- `src/components/TodaySurface.test.tsx`: waiting tasks are pinned, still counted in "Np left", and no dangling selection occurs when a badged task becomes `Done`.
- Days-scale hover wording: a `since` several days in the past produces the degraded copy.

## Issue Context

### New Files

None required. A small shared waiting-badge/dot component is acceptable if it keeps the three surfaces consistent.

### Remove Files

None.

### Change Files

#### Timer pill

Code Source: `src/components/TimerPanel.tsx:347-355`
Code Description: A single badge span shows `PAUSED` or the timer kind; the work-discard button sits at `:609-619`.

```tsx
const kindBadge = timer ? (
    <span className={`px-2 py-1 rounded text-[10px] font-medium tracking-wide ${timer.kind === "Work" ? "bg-indigo-600/20 text-indigo-300" : "bg-emerald-600/20 text-emerald-300"} ${isPaused ? "animate-pulse" : ""}`}>
        {isPaused ? "PAUSED" : timer.kind.toUpperCase()}
    </span>
) : null;
```

Code Change Description: Add the waiting badge (violet for agent, amber for person) with a hover title and a `×` clear action, driven by the active task's `waiting` value.

Files Using: `src/components/TimerPanel.test.tsx`

#### Task-panel rows

Code Source: `src/components/TaskPanel.tsx:306-350`
Code Description: Each row renders the name, progress, and an `ACTIVE` badge at `:334`.
Code Change Description: Add the dot-only waiting treatment with an accessible label.

Files Using: `src/components/TaskPanel.test.tsx`

#### Today list builder

Code Source: `src/lib/today.ts:76-95`
Code Description: `buildTodayTasks` filters eligible tasks by due scope and sorts by `BUCKET_ORDER` then `dueKey` then `title`; `remainingPomodoros` is summed at `:93`. `TodayTaskEntry` is at `:12-26` and `toTodayTask` at `:43-70`.

```ts
export function buildTodayTasks(input: BuildTodayTasksInput): TodayTaskList {
    const tasks = collectEligibleProjectionTasks(input)
        .filter(/* due scope: due | unscheduled */)
        .map((entry) => toTodayTask(entry, input.projects, todayKey))
        .sort((left, right) => { /* bucket, dueKey, title */ });
    const remainingPomodoros = tasks.reduce((total, task) => total + task.remainingPomodoros, 0);
    return { tasks, remainingPomodoros };
}
```

Code Change Description: Carry the waiting state onto `TodayTaskEntry` and sort waiting first, leaving the filter and the `remainingPomodoros` sum unchanged.

Files Using: `src/components/TodaySurface.tsx:117-127,164,186`, `src/lib/today.test.ts`

#### Today surface

Code Source: `src/components/TodaySurface.tsx:110-190`
Code Description: Builds the overview, renders the `N tasks · Np left` chip at `:186`, and the entry list below it.
Code Change Description: Render the waiting dot on entries and keep the pinned order; no separate group heading.

Files Using: `src/components/TodaySurface.test.tsx`

## Notes

- Do not add a live ticking timer for the wait duration; the hover title is a point-in-time computation.
- Pinning is a presentation concern only. It must not change which tasks are in scope, which open issue #172 changes.
- Depends on `PMTask.waiting` (issue 3 in this series).
