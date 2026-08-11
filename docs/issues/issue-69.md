## Title: "Projected finish" — make the daily projection's inclusions/exclusions explicit

## Tags

Complexity Classification: T1
Severity: Medium
Reason: Confined to the `finishProjection` useMemo (src/components/TimerPanel.tsx lines 154-293) and its card rendering (lines 454-482), plus at most a small helper in src/lib/timer.ts and new Vitest coverage. Blast Radius=1, Uncertainty=1, Behavior=2 (display/aggregation logic), Testing=1, Reversibility=1. Total=6 → T1.
Needs research before implementation: No

## Summary

The "Projected finish" card is confusing because it silently includes only tasks with no due date or due today/overdue, and silently drops tasks due in the future (plus Done, archived, no-estimate, and zero-remaining tasks). The card does not communicate these rules, so the projected finish time — and the "You're all caught up" empty state — can mislead users.

## Steps to Reproduce Context

1. Have Project Manager tasks with remaining estimates, some due today/overdue, some with no due date, and some due later this week.
2. Open the timer page and look at the "Projected finish" card and its breakdown line.
3. Observe that the card only ever shows "Due today/overdue: Np" and "No due date: Np" totals, with no indication that future-due tasks are excluded from the count.
4. If the only remaining tasks are due in the future, observe the card shows "You're all caught up for today. Great work!" even though work remains.

## Expected Behavior

- The card clearly communicates which tasks are counted (no due date OR due today/overdue) and which are excluded (future-due, Done, archived, no estimate, zero remaining), so a user is never misled about whether future-due work was included.
- The "all caught up" empty state is only shown when it is accurate, or is adjusted to disclose remaining future-due work.

## Actual Behavior

- The projection filter `const include = !dueKey || dueKey <= todayKey;` (TimerPanel.tsx line 205) silently drops every future-due task before counting.
- The breakdown (lines 470-473) only surfaces the two included buckets, and the empty state (lines 476-479) says "You're all caught up for today. Great work!" when `totalRemaining <= EPSILON` — even when future-due work is the only reason nothing was counted.

## Requirements for completed issue

1. The "Projected finish" card communicates what is and is not included in the projection (included: no-due-date + due-today/overdue; excluded: future-due, Done, archived, no-estimate, zero-remaining), so users understand the scope of the projected finish time.
2. The "all caught up" state is not shown when remaining work exists but was excluded by the inclusion rules (or it explicitly discloses that remaining work was excluded).

## Context

- Files:
  - `src/components/TimerPanel.tsx` — `FinishProjection` type (lines 8-27); `finishProjection` useMemo (lines 154-293), inclusion filter (line 205), bucketing (lines 208-213), continuous finish computation (lines 270-272); card rendering (lines 454-482).
  - `src/lib/timer.ts` — `parseDueDateKey` (lines 20-28), `toLocalDateKey` (lines 14-18), `formatPomodoroCount`, `formatDurationMinutes`.
- Code Snippets:

```
// src/components/TimerPanel.tsx — the silent exclusion (lines 204-206)
const dueKey = parseDueDateKey(pmTask.dueDate);
const include = !dueKey || dueKey <= todayKey; // include tasks with no due date or due today/overdue
if (!include) return;
```

```
// src/components/TimerPanel.tsx — the breakdown only surfaces the two included buckets (lines 470-473)
{finishProjection.dueTodayPomodoros > EPSILON && <span>Due today/overdue: {formatPomodoroCount(finishProjection.dueTodayPomodoros)}</span>}
{finishProjection.unscheduledPomodoros > EPSILON && <span>No due date: {formatPomodoroCount(finishProjection.unscheduledPomodoros)}</span>}
```

## Notes

- Precursor to the weekly projection (issue-72): making the daily inclusion semantics explicit and correct first avoids compounding confusion.
- The misleading "all caught up" empty state (lines 476-479) is the highest-impact symptom: a user with only future-due work sees a false success state.
