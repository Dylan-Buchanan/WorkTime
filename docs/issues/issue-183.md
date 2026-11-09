# Title: Resume card with empty state

Part of #160. Depends on #180 and #181.

## Tags

Complexity Classification: T2
Classification Reason: One presentational card plus its test, inserted into `src/components/TimerPanel.tsx` above the action cluster, reading the #180 store and gated on #181's enter events. The work is mostly deriving visibility, weight and staleness from memo age, event reason and `dismissedAt`.

Severity: Medium
Severity Reason: Read-only display with a dismiss affordance. Breakage is distracting and hides useful context, but it cannot block timer use or lose data.

Needs research before implementation: No

## Summary

Render a compact resume card in the TimerPanel main column, directly above the action button cluster so it sits over Resume / Start Focus.

Two weights:

- Full weight after a real return (pause→resume, start after End focus, switch-in): where-I-am, next action, optional blocker, and the memo's age.
- A single dimmed line on break-end auto-start, and dimmed beyond a 2-hour age threshold.

When the last exit left no memo, show an empty state — "no note from your last exit" plus an inline add affordance. Dismiss hides the card until a new memo replaces it. The card clears when the task is finalized or archived.

The break-end case has no new memo because a natural pomodoro completion emits no leaving event; pairing the memo age with the log row of the pomodoro just finished is what makes staleness legible without adding a "did you do that?" state. The empty state is what repays the break gap accepted in #182.

## Steps to Reproduce Context

1. Pause a task, save a memo, resume it. There is no surface showing the memo.
2. Let a pomodoro complete into a break, then let the break end and work auto-start. There is again no surface, even if an old memo exists.
3. Reload the app while a memo exists for the active task. Nothing is shown anywhere.

## Requirements for completed issue

1. A card component rendered in `src/components/TimerPanel.tsx`'s main column, above the action button cluster (L619-688), so it sits directly over Resume / Start Focus.
2. The card is about `timer.task_id` when a Work timer exists, otherwise `active_task`, so the stopped-but-selected case still shows a card.
3. Full weight is shown only after a real return: `resume` (pause→resume), `start` after End focus, and `switch`-in, as reported by #181.
4. Break-end auto-start shows only the single dimmed line, even when a full memo exists.
5. The card dims beyond a 2-hour memo age.
6. When the last exit left no memo, the empty state shows "no note from your last exit" plus an inline add affordance.
7. Dismiss sets `dismissedAt` through #180 and hides the card until a new write clears it.
8. The card clears when the task is finalized (`finalizeTask`) or archived (`archiveTask`), and also when the linked PM task is archived or removed via `findPMTaskByAppTaskId`. PM archiving does not currently archive the app task, so this is a link check, not a state check.
9. No card on cold load, even with a live window; only after an enter event.
10. Long text truncates to one line with an expansion affordance.
11. The card is not an `aria-live` region (it appears routinely, not urgently).
12. The card must not collide with the existing `md:w-80` Task Details drawer, which occupies the same visual region on desktop.

## Expected Behavior

- Pause, save a memo, resume → full-weight card with where-I-am, next action, blocker (if any) and an age label such as "8 min ago".
- End focus then Start Focus → full-weight card for that task's memo, or the empty state if none exists.
- Switch into a task → full-weight card reflecting the incoming task's memo.
- Break ends and work auto-starts → one dimmed line, no full card.
- Memo older than two hours → card is dimmed.
- Dismiss → card disappears and stays gone after a reload.
- Task finalized, app task archived, or its PM link archived/removed → card does not render.
- Reload the app while a memo exists → no card until the next enter event.

## Actual Behavior

- No card exists; `worktime:resume:v1` has no reader in the UI.
- The TimerPanel main column contains only the timer, the action buttons, the focus-progress line, finish projections and `TodaySurface`.

### Testing

1. `pnpm test:unit` passes with a new `src/components/ResumeCard.test.tsx` and any additions to `src/components/TimerPanel.test.tsx`.
2. Store seeded with a memo for `timer.task_id` + a `resume` enter → full card renders the three fields and the age.
3. Store seeded + a `break-end` enter → only the dimmed single line renders.
4. No memo + a `start` enter → empty state renders with the add affordance.
5. Memo `savedAt` three hours ago → dimmed styling is applied (assert the class or `aria` marker, not a screenshot).
6. Dismiss → store dismiss called, card unmounted, and a subsequent render without a new memo keeps it hidden.
7. New memo written after dismissal (`dismissedAt` cleared) → card renders again.
8. `finalizeTask` and `archiveTask` for the card's task → card does not render.
9. Linked PM task archived → card does not render, and the app task itself is unaffected.
10. Cold mount with a live Work timer and an existing memo → nothing renders until an enter event.
11. Long `whereIAm` (140 chars) → single-line truncation with an expand control that reveals the full text.
12. Manual check in `pnpm dev` at desktop and mobile widths: the card sits above the buttons and does not fight the `md:w-80` drawer when Task Details opens.

## Issue Context

### New Files

`src/components/ResumeCard.tsx` — the card. Suggested props:

```ts
export interface ResumeCardProps {
    taskId: string;
    taskName: string;
    memo: ResumeNote | null;
    weight: "full" | "dimmed-line";
    /** When the current enter event happened, used for the age label and the 2h threshold. */
    enteredAt: string;
    onDismiss: () => void;
    onAdd: () => void;
}
```

`src/components/ResumeCard.test.tsx` — the tests listed above.

### Remove Files

None.

### Change Files

#### Main column insertion point

Code Source: `src/components/TimerPanel.tsx` lines 612-690

Code Description: The action cluster is a `div` containing the Waiting/Switch row (L613-618) and the primary buttons (L619-688). `activePomodoroSummary` (L690-696) and `finishProjections` (L697-699) follow it.

Code Change Description: Render `<ResumeCard />` immediately before the action cluster `div` so it sits over Resume / Start Focus. It is inside the main column, not the details `<aside>`.

#### Current selection the card resolves against

Code Source: `src/state/AppStateContext.tsx` (`AppContextShape`, L58-80)

Code Description: `state.timer` (with `task_id`), `state.active_task`, `pauseTimer`, `resumeTimer`, `stopWork`, and the new #181 subscription.

Code Change Description: The card reads `timer.task_id` first, falls back to `active_task`, and listens for enter events from #181 to decide whether to show anything at all.

#### Lifecycle clears

Code Source: `src/state/AppStateContext.tsx` lines 318-328

```ts
const finalizeTask = (id: string) => adoptResult(() => adoptTaskTransition(() => data.finalizeTask(id)));
const archiveTask = async (id: string) => {
    try {
        setError(null);
        const result = await data.archiveTask(id);
        setState(result.state);
    } catch (err: any) { ... }
};
```

Code Description: Both transitions are observed by the card through state changes; the card must stop rendering when the task becomes terminal.

Code Change Description: Clear the memo for the task when `finalizeTask` or `archiveTask` succeeds. Also clear when the PM link is archived/removed.

#### PM link check

Code Source: `src/lib/pm/workStart.ts` lines 10-15

```ts
export function findPMTaskByAppTaskId(tasks: Readonly<Record<string, PMTask>>, appTaskId: string): PMTask | null {
    const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    return Object.values(tasks)
        .filter((task) => task.appTaskId === appTaskId)
        .sort((a, b) => a.sortOrder - b.sortOrder || compareText(a.createdAt, b.createdAt) || compareText(b.id, a.id))[0] ?? null;
}
```

Code Description: Already imported by `TimerPanel.tsx`, resolves the PM task linked to an app task.

Code Change Description: Use the returned task's `isArchived` (and absence) to hide the card. Absence alone is not proof of removal, since a to-do promotion may not have created the row yet.

#### Desktop details drawer region

Code Source: `src/components/TimerPanel.tsx` lines 712-719

Code Description: The Task Details `<aside>` widens to `md:w-80` when `detailsOpen`, shrinking the main column.

Code Change Description: Ensure the card's width and padding behave in the shrunken main column and do not visually merge with the drawer edge.

## Notes

- Cross-tab: this key has no revision machinery. Read on mount and on enter events and accept cross-tab staleness (confirmed for this epic). Do not add a storage-event listener or a revision system.
- `dismissedAt` is cleared by any subsequent store write, which is what makes "dismissed then replaced" re-appear automatically.
- "No card on cold load" is intentional: the card is a response to an enter event, not a dashboard widget. It also means the End-of-Day brief must read the store directly rather than the card.
