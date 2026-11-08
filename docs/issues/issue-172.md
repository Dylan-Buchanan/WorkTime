# Title: Today estimate must exclude tasks from projects not workable today

## Tags

Complexity Classification: T2
Classification Reason: Fixes schedule semantics inside the shared projection/today eligibility layer and its two consumers (Today surface and the daily projected finish), with an intentional daily-versus-weekly split. Blast radius spans the pure library, the timer panel, and four existing test files that encode the current "daily backlog agrees with Today" invariant.

Severity: Medium
Severity Reason: The displayed daily estimate and Today "Np left" figure are wrong on any day a project is not workable, so the user is told to do work they have said they do not do that day. No data is lost or corrupted, and the existing finish-clock arithmetic avoids scheduling inside those windows, so the error is a misleading plan rather than a broken timer.

Needs research before implementation: No

## Summary

Project settings define which weekdays a project is workable (`workableDays`, defaulting to Monday-Friday). Those settings are currently used only to shape *when* the daily projected finish lands (skipping non-workable windows) and to spread undated work in the Week overview. They are never used to decide *whether* a task counts toward today.

As a result, on a Saturday a project configured to work Monday-Friday still contributes its tasks to the Today surface list and "Np left" total, and to the Daily projected finish estimate. The day's estimate should ignore all work from projects that are not workable today, letting the other in-scope tasks fill the day instead.

## Steps to Reproduce Context

1. Create a project and set its workable days to exclude Saturday and/or Sunday (Project sidebar weekday toggles in `src/components/ProjectManager/ProjectsSidebar.tsx:322-326`).
2. Add one task to that project with an estimate and no due date (or a due date of today).
3. Add a second task with an estimate to a different project that *is* workable today.
4. Open the timer page on a Saturday.
5. Observe the Today surface "N tasks · Np left" line and the Daily projected finish card.

## Requirements for completed issue

1. On any given day, tasks belonging to a project whose `workableDays` does not include that weekday are excluded from the Today surface task list and its `remainingPomodoros` / "Np left" figure.
2. The same exclusion applies to the Daily projected finish card, so its pomodoro total, chips, and finish time only reflect work that is actionable today.
3. Excluded work does not have to be replaced with anything new: the remaining in-scope work (due today, overdue, and undated tasks from workable projects) continues to fill the Today list and daily estimate using the existing rules.
4. The Weekly projected finish behaviour is unchanged, and the Week overview continues to spread undated work across remaining workable days.
5. Tasks with no project, or whose project no longer exists, keep their current behaviour and are not excluded by this rule.
6. The Today surface and the Daily projected finish continue to derive from a single shared eligibility definition so their totals cannot drift apart.
7. The reference date stays caller-supplied and deterministic, so the behaviour is testable without wall-clock dependencies.
8. Existing estimate rules are preserved: the 1-pomodoro floor for an unfinished task at or over estimate, the exclusion of archived / Done / backend-completed / no-estimate tasks, and fractional remaining pomodoros.

## Expected Behavior

- On Saturday, a Monday-Friday project's tasks do not appear in the Today list and are not counted in "Np left" or the Daily projected finish.
- If every task for today came from non-workable projects, the Today surface reports no tasks / 0p left and the daily estimate shows its no-work state rather than a finish time built from that work.
- Work from projects that are workable today (including no-project and undated tasks) is still listed and counted, so the day reflects what can actually be done.
- The Weekly projected finish and the Week overview keep their current behaviour.

## Actual Behavior

- The Today surface lists tasks from projects that are not workable on the current weekday and includes their remaining pomodoros in the "Np left" total.
- The Daily projected finish counts that same work, so the displayed finish time and "Due now / Flexible" chips describe work the user has configured not to do that day.

### Testing

- `pnpm test:unit` — add unit coverage in `src/lib/today.test.ts` for a Saturday reference date where one task belongs to a Mon-Fri project and one to a Sat-Sun project / undated task, asserting only the workable-project work remains in `tasks` and `remainingPomodoros`.
- Add unit coverage in `src/lib/timer.test.ts` for the daily backlog excluding non-workable-project work on the reference date while the weekly backlog is unchanged.
- Keep the existing "agrees with the daily projected-finish backlog" assertion in `src/lib/today.test.ts:201` passing, updated to include a non-workable project in the fixture.
- Add component coverage in `src/components/TodaySurface.test.tsx` and `src/components/TimerPanel.test.tsx` that the rendered Today chips and Daily projected finish no longer include the excluded project's pomodoros.
- Confirm weekday boundary handling: a project workable only on Saturday still counts on Saturday; a project with the default Mon-Fri set does not.
- Confirm the no-work empty state and the "future-due work remains outside this projection" disclosure still render correctly when exclusion empties the daily estimate.

## Issue Context

### New Files

None required.

### Remove Files

None.

### Change Files

#### Today task builder

Code Source: `src/lib/today.ts`
Code Description: `buildTodayTasks` selects eligible tasks whose due scope is `due` or `unscheduled` and sums `remainingPomodoros`; `buildTodayOverview` wraps it for the Today surface.
Code Change Description: Exclude tasks belonging to a project that is not workable on the reference date's weekday, for the daily/today path only.
Files Using: `src/components/TodaySurface.tsx:117`, `src/lib/today.test.ts`, `src/components/TodaySurface.test.tsx`

```ts
export function buildTodayTasks(input: BuildTodayTasksInput): TodayTaskList {
    const todayKey = toLocalDateKey(input.reference);
    const tasks = collectEligibleProjectionTasks(input)
        .filter((entry) => {
            const scope = classifyDueScope(entry.dueDate, input.reference);
            return scope === "due" || scope === "unscheduled";
        })
        .map((entry) => toTodayTask(entry, input.projects, todayKey))
        .sort(/* bucket, due key, title */);
    const remainingPomodoros = tasks.reduce((total, task) => total + task.remainingPomodoros, 0);
    return { tasks, remainingPomodoros };
}
```

#### Shared eligibility and daily backlog

Code Source: `src/lib/timer.ts`
Code Description: `collectEligibleProjectionTasks` is documented (lines 75-79) as the single definition of actionable work, shared by the projected-finish card and the Today surface; `buildProjectionBacklogs` classifies each task into the daily and weekly backlogs in one pass at lines 177-202.
Code Change Description: Apply the workable-today rule to the daily backlog only, while leaving the weekly backlog and the shared eligibility contract intact. `collectEligibleProjectionTasks` already receives `projects` and resolves missing projects to `projectId: null` at line 108.
Files Using: `src/components/TimerPanel.tsx:376-384`, `src/lib/today.ts:78`, `src/lib/today.test.ts`, `src/lib/timer.test.ts`

```ts
export interface ProjectionBacklogTask {
    dueDate?: string | null;
    remainingPomodoros: number;
    projectId: string | null;
}

export function buildProjectionBacklogs(tasks: ProjectionBacklogTask[], reference: Date): ProjectionBacklogs {
    const todayKey = toLocalDateKey(reference);
    const { endKey: weekEndKey } = getLocalWeekWindow(reference);
    for (const task of tasks) {
        const scope = dueScopeFor(parseDueDateKey(task.dueDate), todayKey, weekEndKey);
        if (scope === "unscheduled") {
            addToBacklog(daily, task, "unscheduled");
            addToBacklog(weekly, task, "unscheduled");
        } else if (scope === "due") {
            addToBacklog(daily, task, "due");
            addToBacklog(weekly, task, "due");
        } /* ... thisWeek, future ... */
    }
    return { daily, weekly };
}
```

#### Project schedule helper

Code Source: `src/lib/projectSchedule.ts`
Code Description: `normalizeProjectSchedule` returns a `ProjectSchedule` with `workableDays` defaulting to `DEFAULT_WORKABLE_DAYS = [1, 2, 3, 4, 5]`; `WorkableWeekday` is `0 | 1 | 2 | 3 | 4 | 5 | 6` (`src/state/types.ts:17`).
Code Change Description: Add a small shared predicate for "is this project workable on this date/weekday" so the Today builder and the daily backlog apply one definition instead of duplicating `getDay()` checks.
Files Using: `src/lib/timer.ts`, `src/lib/today.ts`, `src/lib/engine/weekOverview.ts:93-97`, `src/lib/projection.ts:71`

```ts
export function normalizeProjectSchedule(value: Partial<ProjectSchedule> | null | undefined): ProjectSchedule;
```

Weekday filtering already exists in two places that must stay consistent:

- `src/lib/projection.ts:76` — `if (!schedule.workableDays.includes(cursor.getDay() as any))`
- `src/lib/engine/weekOverview.ts:96` — filters days by `schedule.workableDays.includes(new Date(`${day.dateKey}T12:00:00`).getDay() as WorkableWeekday)`

#### Timer panel daily projection

Code Source: `src/components/TimerPanel.tsx`
Code Description: Builds `eligibleTasks` from `collectEligibleProjectionTasks` and passes them to `buildProjectionBacklogs`, then `createProjection(backlogs.daily, todayKey)` and `createProjection(backlogs.weekly, weekEndKey)` (lines 376-471). `ProjectionCard` renders the totals and chips.
Code Change Description: The daily card should reflect the workable-today exclusion while the weekly card keeps its current totals. The card's rules copy at lines 23-24 should be updated if the daily scope description changes.
Files Using: `src/components/TimerPanel.test.tsx`, `src/components/TodaySurface.tsx` (rendered below the card at line 644)

```ts
const DAILY_PROJECTED_FINISH_RULES = "Includes no due date and due today/overdue. Unfinished tasks at or over estimate count as 1p remaining. Excludes future-due, Done, archived, and no-estimate.";
```

### Notes

- Do not change timer/task semantics in `src/lib/engine/`.
- Do not add persistence, new settings, or a per-day override; the rule derives entirely from the existing `Project.workableDays`.
- `combinedProjectFinish` / `addProjectWorkableDuration` already skip non-workable windows (`src/lib/projection.ts:59-93`, `118-144`); this issue changes which tasks feed the estimate, not the clock arithmetic.
- Related prior research: `docs/research/flexible-pomodoros-in-today-finish-estimate.md` (records the current "project schedules shape the clock, not the total" contract at lines 63-64 that this issue deliberately moves).
