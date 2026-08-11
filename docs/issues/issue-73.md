## Title: Week overview page — per-day due pomodoro counts and week progress

## Tags

Complexity Classification: T2
Severity: Low
Reason: New authenticated route + TopNav link (src/App.tsx), a new page component (patterned on HabitsPage/AnalyticsPage), a new pure engine module for per-day aggregation/distribution, plus engine and component tests. Blast Radius=3 (5-6 files, cross-module: routing, components, lib engine, tests), Uncertainty=2 (depends on sibling issues for weekly projection semantics and per-project day-capacity that do not exist yet; overdue/zero-capacity-day edge cases are unknowns), Behavior=3 (complex aggregation/distribution logic, no data model or infra change), Testing=1 (pure-TS engine tests plus standard Vitest component tests), Reversibility=1 (new files/route only, no data consequences). Total=10 → T2.
Needs research before implementation: Yes
Research needed: The interface of the weekly projection module (which tasks count as due per day, overdue handling) and the per-project scheduling settings (what day-capacity/availability is exposed per day) must be defined before implementing the spread-unscheduled-tasks distribution; sequence this after (or coordinate with) issues 71 and 72.

## Summary

Add a new authenticated page that shows the week as a whole: per-day due pomodoro counts (e.g., Mon: 6, Tue: 4, Wed: 0), so the user can look ahead at the week and track how they are doing as the week progresses. Tasks without a due date are spread across the week's available days using the per-project scheduling settings.

## Steps to Reproduce Context

1. The only top-level pages are Timer (`/`), Projects (`/projects`), Analytics (`/analytics`), and Habits (`/habits`).
2. There is no way to view the week's due load at a glance or track week progress.
3. Tasks with no due date are not distributed across days anywhere in the app.

## Expected Behavior

- A new authenticated week page (route + nav link) shows per-day due pomodoro totals for the current week and tracks progress as the week progresses.
- Unscheduled (no-due-date) tasks are spread across the week's available days using per-project scheduling settings where available.

## Actual Behavior

- No week page exists. Routes in `src/App.tsx` (lines 41-49) cover only `/`, `/projects`, `/analytics`, `/habits`.
- `AnalyticsPage` `CapacityForecast` (lines 694-726) hardcodes Mon–Fri capacity from historical averages and is not a week planner.

## Requirements for completed issue

1. A week-overview page exists as a new authenticated route with navigation, showing per-day due pomodoro counts and progress through the week.
2. Unscheduled tasks are distributed across the week's available days (using per-project scheduling settings where available), with the distribution logic testable as pure TypeScript.

## Context

- Files:
  - `src/App.tsx` — authenticated route block (lines 41-49) and `TopNav` links (lines 107-110); new route + link go here.
  - `src/components/HabitsPage.tsx` / `src/components/AnalyticsPage.tsx` — full-page patterns to mirror (including `ErrorBoundary` wrapping precedent from `ProjectManagerPage`).
  - `src/state/types.ts` — `PMTask` (lines 27-48: dueDate, estimatePomos, projectId, status, isArchived) and `ProjectManagerState`.
  - `src/state/ProjectManagerContext.tsx` — `usePM()` access to tasks/projects.
  - `src/lib/engine/*.test.ts` — established pure-engine test pattern for the distribution logic.
- Code Snippets:

```
// src/App.tsx — authenticated route block where the new route is added (lines 41-49)
<Route element={<RequireAuth />}>
    <Route element={<AuthenticatedShell />}>
        <Route path="/" element={<MainLayout />} />
        <Route path="/projects" element={<ErrorBoundary><ProjectManagerPage /></ErrorBoundary>} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/habits" element={<HabitsPage />} />
    </Route>
</Route>
```

```
// src/state/types.ts — task fields the week view aggregates (lines 27-48)
export interface PMTask {
    id: string;
    title: string;
    projectId: string | null;
    status: TaskStatus;
    ...
    dueDate?: string; // ISO date
    estimatePomos?: number; // estimated pomodoros
    ...
}
```

## Notes

- Sequence after the weekly projection (issue-72) and per-project scheduling (issue-71) issues, since the spread-unscheduled-tasks logic depends on their semantics.
- Per AGENTS.md, keep the distribution logic pure (no wall-clock/network/random-ID dependencies in command inputs) and add Vitest coverage mirroring existing engine and component tests.
