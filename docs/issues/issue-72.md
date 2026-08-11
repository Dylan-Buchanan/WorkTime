## Title: Weekly projection — include overdue, due-today, no-due, and due-this-week tasks

## Tags

Complexity Classification: T2
Severity: Low
Reason: Engine/UI change confined to the TimerPanel projection computation and a new week-window date-key helper (src/lib/timer.ts or a pure engine module), plus a small UI widget and unit tests. Blast Radius=2 (2-5 files), Uncertainty=2 (week-window derivation — ISO start semantics — and extract-vs-inline engine design), Behavior=3 (complex projection logic), Testing=1 (pure-function tests fit the existing engine-test setup), Reversibility=1. Total=9 → T2.
Needs research before implementation: No

## Summary

Add a weekly projection: include overdue tasks, tasks due today, tasks with no due date, and tasks due later this week (currently excluded by the daily `dueKey <= todayKey` filter), then project a finish date for that combined backlog.

## Steps to Reproduce Context

1. Have PM tasks due later this week (e.g., Wednesday/Friday) in addition to overdue and no-due-date tasks.
2. Note that the daily "Projected finish" card counts only no-due-date + due-today/overdue tasks.
3. Observe there is no way to see a projected finish date that includes this week's remaining due work.

## Expected Behavior

- A weekly projection surface shows a projected finish date computed from overdue + due-today + no-due-date + due-this-week tasks, with the existing Done/archived/no-estimate/zero-remaining exclusions applied.
- The daily projection is unchanged or clearly distinguished from the weekly projection so users understand what each includes.

## Actual Behavior

- The only projection is the daily one in TimerPanel.tsx (lines 154-293); future-due tasks including due-this-week are silently dropped by `const include = !dueKey || dueKey <= todayKey;` (line 205).
- There is no week-window date-key helper in `src/lib/timer.ts` and no weekly projection surface anywhere.

## Requirements for completed issue

1. A weekly projection exists that includes overdue, due-today, no-due-date, and due-this-week tasks and produces a projected finish date for that backlog.
2. The weekly projection is clearly distinguished from the daily "Projected finish" so users understand what each includes.

## Context

- Files:
  - `src/components/TimerPanel.tsx` — `finishProjection` (lines 154-293), inclusion filter (line 205), bucketing (lines 208-213), rendering (lines 454-482).
  - `src/lib/timer.ts` — `parseDueDateKey`/`toLocalDateKey` (lines 14-28); no week-window helper exists.
  - `src/state/types.ts` — existing "thisWeek" due-window vocabulary (line 88).
  - `src/state/ProjectManagerContext.tsx` — dueFilter handling (lines 787, 880).
- Code Snippets:

```
// src/components/TimerPanel.tsx — the filter that drops due-this-week tasks (lines 204-206)
const dueKey = parseDueDateKey(pmTask.dueDate);
const include = !dueKey || dueKey <= todayKey; // include tasks with no due date or due today/overdue
if (!include) return;
```

```
// src/state/types.ts — existing "thisWeek" window vocabulary to mirror (line 88)
dueFilter: "all" | "today" | "thisWeek" | "later" | "overdue";
```

## Notes

- Per AGENTS.md, extract the weekly computation as pure TypeScript with no wall-clock/network/random-ID dependencies in command inputs so it is unit-testable like the `src/lib/engine` tests.
- Related to the end-of-day (issue-70) and per-project scheduling (issue-71) issues; the week-overview page (issue-73) consumes this projection.
