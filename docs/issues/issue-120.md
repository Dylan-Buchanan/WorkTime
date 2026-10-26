# Title: Today View Overhaul — see today's tasks, habits, and pomodoros on the timer page

## Tags

Complexity Classification: T2
Classification Reason: Additive frontend feature on the authenticated timer route. It aggregates three domains that already exist and are already loaded in the tree — PM/backend tasks (`usePM`, `useAppState`), habits (`useHabits`), and pomodoro logs (`state.logs`) — and adds limited write paths (toggle a habit, select a task, start focus). No data model, schema, RLS, sync, or routing change is required, but the work spans several files and needs a small amount of new pure logic plus component tests.

Severity: Medium
Severity Reason: The timer page is the primary screen and the change is highly visible, but it is additive and read-mostly. The only writes reuse existing context actions, so there is no data-loss path and the feature reverts by removing the new surface.

Needs research before implementation: No

## Summary

The timer page answers "when will I finish today?" but not "what does today actually consist of?". To see the day's work the user currently has to visit three separate pages: the timer's task sidebar for backend tasks (which carries no due dates), `/projects` for due dates and estimates, `/habits` for habit check-ins, and `/analytics` for today's completed pomodoros.

The request is to add one collapsible **Today** surface to the main pomodoro timer page that shows today's tasks, today's habits, and today's pomodoros in one place. Only today is in scope for now, and the existing projected-finish card stays where it is.

Scope decisions already agreed:

- **Placement** — an inline collapsible card in the timer's centre column, directly below the existing projected-finish card.
- **Tasks** — project-manager tasks that are due today or overdue, plus tasks with no due date (the same inclusion set the daily projection already uses). To-dos are out of scope for this view.
- **Interactivity** — quick actions only: check/uncheck a habit, select a task, start focus on a task. Pomodoro history is read-only.
- **Projected finish** — the existing daily/weekly card is kept as-is and remains above the new surface.

## Steps to Reproduce Context

1. Sign in and land on `/` (Timer). `MainLayout` (`src/App.tsx:209`) renders a `w-72` sidebar with `TaskPanel` + `SettingsPanel` and a centred `TimerPanel` in the main column.
2. The centre column shows, in order: the timer ring, the start/pause/stop/skip controls, the active task's focus progress, and the "Daily projected finish" / "Weekly projected finish" card (`src/components/TimerPanel.tsx:513-646`).
3. Notice the page never lists *which* tasks are due today. The sidebar lists backend timer tasks, which have no due-date field (`src/state/types.ts:1`).
4. To see what is due today, navigate to `/projects`; to check in on habits, navigate to `/habits`; to see today's completed pomodoros, navigate to `/analytics`.
5. On viewports under 1024px the sidebar is behind a "Tasks & Settings" drawer, so the task context is not visible at all while the timer is on screen.

## Expected Behavior

- The timer page presents a single **Today** surface that can be collapsed and expanded.
- In its collapsed state it still communicates the day at a glance (for example a count of remaining tasks, habits checked, and pomodoros completed) without displacing the timer ring.
- Expanded, it lists three groups:
  - **Tasks** — the project-manager tasks in scope for today: due today, overdue (rolled forward), and undated/flexible work. Each entry identifies its project and its remaining pomodoros against its estimate, and marks the task that is currently running.
  - **Habits** — the habits that are due in the current period, with their completion state for today and an obvious way to check or uncheck one.
  - **Pomodoros** — the day's completed focus work: how many pomodoros and how much focus time, plus the individual sessions that produced them.
- Quick actions work from the list: toggling a habit updates its completion, selecting a task selects it in the project manager and opens the existing task details panel, and starting focus on a task begins a work timer for that task.
- The surface shows today only. It does not offer date navigation.
- The list agrees with the projected-finish card: any task counted by the daily projection is represented in the list, and vice versa.
- Each group has a clear empty state rather than collapsing to nothing.
- The surface is usable on desktop and on the mobile timer layout, is reachable by keyboard, and exposes its expanded state to assistive technology.
- The existing projected-finish card keeps its current behaviour and position.

## Actual Behavior

- Today's tasks, habits, and pomodoros are only visible across three separate pages, so there is no single answer to "what is left today".
- The projected-finish card reports pomodoro totals for today but not the tasks that make up the total.
- The timer sidebar lists backend tasks without due dates, so it cannot show what is due today.
- Today's completed pomodoros appear only as an aggregate count on the analytics page (`"Completed Pomodoros"`, `src/components/AnalyticsPage.tsx:341-346`).
- Habit state is only editable on `/habits`; nothing on the timer page reflects it.

## Requirements for completed issue

1. A single **Today** surface exists on the timer page (`/`), below the projected-finish card, and can be collapsed and expanded.
2. The collapsed state still conveys the day's state at a glance without requiring the user to expand it, and the default state does not push the timer controls off screen.
3. The expanded state lists today's tasks: PM tasks that are due today, overdue, or undated. Archived tasks, `Done` tasks, completed backend tasks, and tasks without an estimate are excluded.
4. Each task entry shows the project (or an explicit "no project" indication), remaining pomodoros against the task's estimate, and whether it is the active task.
5. Checking or unchecking a habit from the surface persists through the existing habit context and is reflected on `/habits`.
6. The surface reports today's pomodoros — count and focus minutes — together with the individual sessions, labelled with the task they belong to.
7. Selecting a task from the surface selects it in the project manager and opens the existing task details panel.
8. Starting focus from a task in the surface starts a work timer for that task (and does not silently do nothing when a timer is already running — that state is communicated).
9. The task list and the daily projected-finish card use one shared notion of "in scope for today", so they never disagree.
10. Desktop and sub-1024px layouts both remain usable, including when the surface is expanded on a short viewport.
11. No new data-layer, sync, schema, or persistence surface is introduced.

### Testing

1. Unit-test the today aggregation as pure functions with an injected reference date: due-today, overdue, undated/flexible classification; exclusion of archived, `Done`, completed, and no-estimate tasks; remaining-pomodoro arithmetic including a partially completed active timer; today's pomodoros filtered by local `finished_at` date and excluding breaks; habit buckets for daily, weekly, and monthly frequencies; completed vs incomplete habits.
2. Extend `src/components/TimerPanel.test.tsx` to cover the surface rendering beside the projected-finish card, and add a dedicated component test for expand/collapse, the three groups, habit toggling, task selection, start-focus, and empty states. Note the existing test wrapper omits `HabitProvider`, so it needs the provider added.
3. Confirm the existing projection tests in `src/components/TimerPanel.test.tsx` and `src/lib/timer.test.ts` still pass unchanged, proving the extraction kept projection output identical.
4. Manual check in `pnpm dev` at a desktop width and a narrow width: collapse/expand, check a habit and see it on `/habits`, select a task and see the details panel open, start focus from a row, and confirm behaviour while a timer is already running.
5. Run `pnpm test:unit` and `pnpm run build`.

## Context

### Timer page shell

Code Source: `src/App.tsx:209-223`
Code Description: `MainLayout` is the `/` route. Desktop renders the sidebar plus a scrollable `<main>` that hosts `TimerPanel`; below 1024px it renders a drawer and a padded scrollable `<main>`.

```tsx
const MainLayout: React.FC = () => {
    const isDesktop = useMediaQuery("(min-width: 1024px)");
    // ...
    if (isDesktop) {
        return (
            <div className="flex h-full">
                <aside className="... w-72 ..."><TaskPanel /><SettingsPanel /></aside>
                <main className="flex-1 flex min-w-0 min-h-0 overflow-y-auto"><TimerPanel /></main>
            </div>
        );
    }
    return (
        <div className="flex h-full flex-col">
            {/* "Tasks & Settings" drawer */}
            <main className="flex-1 flex p-4 min-h-0 overflow-y-auto"><TimerPanel /></main>
        </div>
    );
};
```

### Mount point in the timer panel

Code Source: `src/components/TimerPanel.tsx:508-514` and `:644-646`
Code Description: `TimerPanel` renders a centred `max-w-md` column inside a full-height flex row. The projected-finish card is the last item in that column; a new surface belongs immediately after it. The outer wrapper uses `justify-center`, which will clip the top of taller content once the page scrolls, so that needs attention when the surface is expanded.

```tsx
return (
    <div className="w-full min-h-full flex">
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 text-center select-none relative">
            <div className="flex flex-col items-center gap-6 max-w-md w-full">
                {/* ring, controls, active focus progress */}
                {finishProjections && (
                    <ProjectionSwitcher projections={finishProjections} />
                )}
```

### The "in scope for today" rule that already exists

Code Source: `src/lib/timer.ts:89-114`
Code Description: `buildProjectionBacklogs` buckets task workload into due-now (due today or overdue), flexible (no due date), later-this-week, and excluded-future. The daily projection is this function's `daily` backlog, so a today list needs the same classification to stay consistent.

```ts
export function buildProjectionBacklogs(tasks: ProjectionBacklogTask[], reference: Date): ProjectionBacklogs {
    const todayKey = toLocalDateKey(reference);
    const { endKey: weekEndKey } = getLocalWeekWindow(reference);
    for (const task of tasks) {
        if (!Number.isFinite(task.remainingPomodoros) || task.remainingPomodoros <= EPSILON) continue;
        const dueKey = parseDueDateKey(task.dueDate);
        if (!dueKey) { addToBacklog(daily, task, "unscheduled"); addToBacklog(weekly, task, "unscheduled"); }
        else if (dueKey <= todayKey) { addToBacklog(daily, task, "due"); addToBacklog(weekly, task, "due"); }
        // ...
    }
    return { daily, weekly };
}
```

### Task eligibility, currently inline

Code Source: `src/components/TimerPanel.tsx:363-385`
Code Description: The projection builds its eligible task list inline. This is the only place that decides which PM tasks are actionable today, and it is not exported or tested directly. A today list needs the same rules, and the two must not drift apart.

```tsx
pmTasks.forEach((pmTask) => {
    if (pmTask.isArchived) return;
    if (pmTask.status === "Done") return;
    const backendTask = pmTask.appTaskId ? backendTasks[pmTask.appTaskId] : undefined;
    if (backendTask?.completed_at) return;
    const estimate = typeof pmTask.estimatePomos === "number" ? pmTask.estimatePomos : (backendTask?.target_pomodoros ?? 0);
    if (!Number.isFinite(estimate) || estimate <= EPSILON) return;
    let worked = backendTask?.completed_pomodoros ?? 0;
    if (pmTask.workedPomos !== undefined) worked = Math.max(worked, pmTask.workedPomos);
    // active partial fraction added here ...
    const remaining = estimate - worked > EPSILON ? estimate - worked : 1;
    eligibleTasks.push({ dueDate: pmTask.dueDate, remainingPomodoros: remaining, projectId });
});
```

### Task model

Code Source: `src/state/types.ts:33-60`
Code Description: `PMTask` is the only task model carrying a schedule; `dueDate` is the sole due-date field used for today-ness, and `appTaskId` links it to the backend timer task that a focus session actually runs against.

```ts
export interface PMTask {
    id: string;
    title: string;
    projectId: string | null;
    status: TaskStatus;      // "Backlog" | "Next" | "In Progress" | "Blocked" | "Done"
    priority: TaskPriority;
    dueDate?: string;
    estimatePomos?: number;
    timeSpentMinutes: number;
    workedPomos?: number;
    appTaskId?: string;
    // ...
}
```

### Habits

Code Source: `src/state/types.ts:135-155`, `src/lib/habits/calendar.ts`, `src/lib/habits/windows.ts:172-178`
Code Description: Habits are bucketed by frequency. `getBucketKey(now, frequency)` yields the bucket that "today" means for a habit (local date for daily, current week for weekly, first of month for monthly), and `isHabitCompleted` answers whether that bucket is checked. `useHabits()` (`src/state/HabitContext.tsx:373`) exposes `checkCompletion` / `uncheckCompletion`.

```ts
export function isHabitCompleted(
    completions: readonly Pick<HabitCompletion, "habitId" | "bucket">[],
    habitId: string,
    bucket: string,
): boolean {
    return completions.some((completion) => completion.habitId === habitId && completion.bucket === bucket);
}
```

### Pomodoro logs

Code Source: `src/state/types.ts:102-109`, `src/lib/analytics.ts:117-140`
Code Description: Completed focus work is recorded as `PomodoroLogEntry` rows. "Today's pomodoros" is already defined as non-break entries whose local `finished_at` date is today, which is the rule the analytics page uses.

```ts
export interface PomodoroLogEntry {
    id: string;
    task_id: string;
    duration_minutes: number;
    finished_at: string;
    was_break: boolean;
    break_skipped: boolean;
}
```

### Starting focus on a task

Code Source: `src/state/AppStateContext.tsx:283-294`
Code Description: `startTaskWork(id)` sets the active task and starts a work timer in one call. It throws `"A timer is already running"` when one is active, so the surface must handle that state rather than failing silently.

### Disclosure pattern to follow

Code Source: `src/components/SettingsPanel.tsx:54-59`
Code Description: There is no shared collapsible primitive in the app; the established pattern is a button with `aria-expanded` / `aria-controls` toggling a region. Panels elsewhere use `rounded-lg border border-neutral-800 bg-neutral-900/60 p-3`.

```tsx
<button type="button" onClick={() => toggleSection(section)} aria-expanded={open} aria-controls={id}>
    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    ...
</button>
{open && <div id={id}>...</div>}
```

### Relevant tests today

- `src/components/TimerPanel.test.tsx` — task-details drawer and daily/weekly projection behaviour. Its `wrap()` helper (`:71-89`) mounts `AppStateProvider` + `ProjectManagerProvider` only, with no `HabitProvider`.
- `src/lib/timer.test.ts` — date-key helpers and `buildProjectionBacklogs` categorisation.
- `src/lib/habits/habits.test.ts` — bucket math, windows, visibility, checkability.
- `src/lib/analytics.test.ts` — today/week pomodoro counts.
- `src/lib/engine/weekOverview.test.ts` — overdue work landing on today.

## Notes

- **Open question — habit frequencies.** Weekly and monthly habits have no "due today" concept; the natural reading is that they appear using their current bucket and are labelled with their frequency so the state is not misread. Worth confirming during implementation.
- **Open question — pomodoro granularity.** "Pomodoros for the day" could be a count plus sessions, a per-task breakdown, or both. The requirement above asks for count, minutes, and the session list; a per-task roll-up may be preferable if it reads better.
- **Open question — collapsed-state persistence.** Whether the expanded state should survive a reload is undecided. Nothing in this issue requires storage; if it is wanted, the existing per-owner staging store is the only sanctioned place and must not become a new key without discussion.
- Related but separate: issue #119 proposes a merged calendar view in the Week tab. That is a different surface; this issue is today-only and lives on the timer page.
- Prior art inside the app for a similar pattern: `PetScheduleDeck` collapses completed items into a summary strip, and `TimerPanel`'s task-details aside already implements the desktop width / mobile overlay split.
