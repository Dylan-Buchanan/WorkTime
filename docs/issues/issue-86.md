## Title: Show task pomodoro progress on the timer page even when no pomodoro is active

## Tags

Complexity Classification: T1
Severity: Low
Reason: Single display-gating change in `src/components/TimerPanel.tsx` (line 630). The `activePomodoroSummary` memo already computes a correct `{ target, completed, remaining }` summary whenever a task is active, so the fix is relaxing the `timer &&` gate. No state, engine, data, or layout changes.
Needs research before implementation: No — the summary computation (lines 477-506) already returns non-null without a running timer, and engine timer commands leave `active_task` intact.

## Summary

On the pomodoro timer page, the "Focus progress" card (pomodoros completed / remaining / goal) is only rendered while a pomodoro is running. The same summary data is already computed whenever a task is active, so the card should also appear when no pomodoro is active.

## Steps to Reproduce Context

1. Open the timer page with a task selected/active (`state.active_task` set, e.g. via Todos or the Task Details flow) but no pomodoro running (`state.timer` is null).
2. Observe the timer page: the ring shows "READY" and the "Start Focus" button is shown, but no pomodoro progress (completed / remaining / goal) for the active task is displayed.
3. Start a pomodoro — the "Focus progress" card appears.
4. Stop the pomodoro early or let it complete (both return to no timer but leave `active_task` set) — the card disappears.

## Expected Behavior

- The "Focus progress" card (e.g. "Focus progress: 1p done · 1p left (goal 2p)") is shown on the timer page whenever a task is active and has a target, regardless of whether a pomodoro is currently running.
- When no task is active, the card continues to be hidden.

## Actual Behavior

- The "Focus progress" card is only rendered while a timer is running (`timer && activePomodoroSummary` at TimerPanel.tsx:630). When no pomodoro is active, even with an active task whose progress is known, the card is hidden.

## Requirements for completed issue

1. The timer page renders the pomodoro progress (completed, remaining, goal) for the active task whenever a task with a target is active, including when no pomodoro is running.
2. The card is still hidden when there is no active task with a target to show.
3. Behavior during an active pomodoro is unchanged, and `pnpm test:unit` passes with a test covering the no-timer display.

## Context

- Files:
  - `src/components/TimerPanel.tsx` — the only component change needed. `activePomodoroSummary` (lines 477-506) already computes `{ target, completed, remaining }` whenever `activeAppTaskId` is set (line 246: `timer?.task_id ?? state?.active_task ?? null`); the render gate at lines 630-636 (`timer && activePomodoroSummary`) is what hides it without a running timer.
  - `src/components/TimerPanel.test.tsx` — test infrastructure; the active-timer "goal 2p" assertion (line 222) is the template for a no-timer case.
  - `src/state/types.ts` (line 159) — `active_task: string | null` on `AppStateData`.
  - `src/lib/engine/timerCommands.ts` (lines 84, 104) — `completeTimer`/`stopWorkTimer` only null `timer`, leaving `active_task` set.
- Code Snippets:

```tsx
// src/components/TimerPanel.tsx:630 — gate that hides progress without a running timer
{timer && activePomodoroSummary && (
    <div className="w-full text-[11px] text-neutral-400 bg-neutral-900/50 border border-neutral-800 rounded-md px-3 py-2">
        Focus progress: <span className="text-neutral-200 font-medium">{formatPomodoroCount(activePomodoroSummary.completed)}</span> done ·
        <span className="text-neutral-200 font-medium"> {formatPomodoroCount(activePomodoroSummary.remaining)}</span> left
        <span className="text-neutral-600"> (goal {formatPomodoroCount(activePomodoroSummary.target)})</span>
    </div>
)}
```

```ts
// src/components/TimerPanel.tsx:246 — active task id resolves even without a timer
const activeAppTaskId = timer?.task_id ?? state?.active_task ?? null;
```

```ts
// src/lib/engine/timerCommands.ts:104 — stopWorkTimer keeps active_task intact
next.timer = null;
```

## Notes

- `activePomodoroSummary` already handles the no-timer case correctly: `activeFractionComplete` is 0 when no Work timer runs, so the card would show completed pomodoros and remaining against the goal without a running timer.
- The existing test at `src/components/TimerPanel.test.tsx:220-222` asserts "3p" and "goal 2p" while a timer is active; a no-timer test should assert the card renders from `state.active_task` + `completed_pomodoros` alone.