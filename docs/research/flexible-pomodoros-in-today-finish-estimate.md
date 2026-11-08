# Research: Flexible pomodoros in the today finish estimate

## Overview

The "Daily projected finish" card turns a daily backlog of remaining pomodoros into a finish time, and that backlog includes work with no due date. Undated ("flexible") tasks are classified as `unscheduled` and added to both the daily and weekly backlogs, so their pomodoros are part of the finish estimate and are also surfaced as a `Flexible · Np` chip on the card. This document records where that inclusion happens, which tasks can fall out of it, and how the same flexible work is treated differently by the Week overview surface.

## Issue Context

- User/requested outcome: answer whether flexible pomodoros are included in the today finish estimate (existing behaviour question).
- Current pain or bug: None reported. No defect, failing test, or mismatch has been identified; the request is a behaviour check.
- Scope classification, if known: Unknown (single-surface behaviour question; no issue number, branch, or diff supplied).

## Current Behavior

- Work with no due date is classified `unscheduled` by `dueScopeFor` (`src/lib/timer.ts:124-129`) and added to **both** the daily and weekly backlogs (`src/lib/timer.ts:186-188`).
- `addToBacklog` always increments `totalPomodoros` in addition to the category-specific counter and the per-project map, so flexible work contributes to the total that produces the finish time (`src/lib/timer.ts:165-171`).
- The projected-finish card builds its finish time from `backlog.totalPomodoros` (`src/components/TimerPanel.tsx:387`, `src/components/TimerPanel.tsx:397-432`), and invokes the same builder for `backlogs.daily` (today key) and `backlogs.weekly` (week-end key) (`src/components/TimerPanel.tsx:468-471`).
- The card renders `Due now · Np`, `Flexible · Np`, and `Later this week · Np` chips from the category counters (`src/components/TimerPanel.tsx:168-170`); the flexible chip only appears when `unscheduledPomodoros > EPSILON` (`src/components/TimerPanel.tsx:169`, `EPSILON = 1e-3` at `src/lib/timer.ts:3`).
- The card's own rules copy states the daily projection "Includes no due date and due today/overdue", and the weekly copy includes no-due-date work as well (`src/components/TimerPanel.tsx:23-24`).
- The Today surface, rendered directly below the card (`src/components/TimerPanel.tsx:644`), reports `remainingPomodoros` from `buildTodayTasks`, which also keeps the flexible bucket (`src/lib/today.ts:72-95`), so the Today "Np left" count includes flexible work too.
- Flexible tasks are excluded before the projection when they have no estimate: `collectEligibleProjectionTasks` skips tasks whose `estimatePomos`/backend `target_pomodoros` is non-finite or `<= EPSILON` (`src/lib/timer.ts:93-94`). This matches the card copy's "Excludes … no-estimate" (`src/components/TimerPanel.tsx:23-24`).
- Archived tasks, PM tasks with `status === "Done"`, and tasks whose linked backend task has `completed_at` are also excluded (`src/lib/timer.ts:88-92`).
- Remaining flexible work uses `estimate - worked`, floored at `1` pomodoro for an unfinished task at or over estimate, so it can never reach zero while the task is open (`src/lib/timer.ts:106-107`).
- Inference: all flexible pomodoros are counted in full for **today** by the daily backlog; project schedules change when the finish time lands rather than whether the work counts (`src/lib/timer.ts:186-188`, `src/lib/projection.ts:118-144`).
- The Week overview surface treats the same flexible quantity differently: it spreads it one pomodoro at a time across the remaining workable days of each task's project, falling back to today only when no workable day remains (`src/lib/engine/weekOverview.ts:91-108`), and labels it "Flexible … spread by project schedule" (`src/components/WeekOverviewPage.tsx:68`, `src/components/WeekOverviewPage.tsx:120`).

## Relevant Files And Entry Points

- `src/lib/timer.ts:80` - `collectEligibleProjectionTasks`, the single definition of which PM tasks carry actionable work; both the finish estimate and the Today surface read it.
- `src/lib/timer.ts:52` - `DueScope` type (`due | unscheduled | thisWeek | future`) that names the flexible bucket.
- `src/lib/timer.ts:165` - `addToBacklog`, which folds each bucket into `totalPomodoros` and `remainingByProject`.
- `src/lib/timer.ts:177` - `buildProjectionBacklogs`, the decision point for what counts in the daily versus weekly projection.
- `src/lib/timer.ts:204` - `formatPomodoroCount`, which decides how fractional flexible counts render (`1.5p` style).
- `src/components/TimerPanel.tsx:360` - the projection `useMemo` that gathers settings, tasks, timer state, and builds both projections.
- `src/components/TimerPanel.tsx:386` - `createProjection`, where pomodoros become work/break milliseconds and then a finish `Date`.
- `src/components/TimerPanel.tsx:56` - `ProjectionCard`, the rendered card including the `Finish by` label and scope chips.
- `src/components/TimerPanel.tsx:641` - mount point of `ProjectionSwitcher` above `TodaySurface`.
- `src/lib/projection.ts:26` - `addProjectedDuration`, the end-of-day cutoff arithmetic used for no-project (unassigned) flexible work.
- `src/lib/projection.ts:118` - `combinedProjectFinish`, the project-window arithmetic used for project-assigned work.
- `src/lib/projectSchedule.ts:20` - `normalizeProjectSchedule`; defaults are Mon-Fri, 09:00-17:00 (`src/lib/projectSchedule.ts:3-5`).
- `src/lib/today.ts:72` - `buildTodayTasks`, which produces the flexible bucket and the Today surface's `remainingPomodoros`.
- `src/lib/engine/weekOverview.ts:91` - the alternative flexible-work balancing used by the Week overview page.
- `src/components/WeekOverviewPage.tsx:68` - the "Flexible … spread by project schedule" summary card.
- `src/components/TodaySurface.tsx:117` - consumes `buildTodayOverview` and lists the flexible tasks under the Tasks group.

## Data Flow Or Control Flow

1. `TimerPanel` reads `state.settings` (`work_minutes`, short/long break minutes, `segment_length`, `end_of_day`), `state.tasks`, and `pmState.tasks/projects` inside the projection memo (`src/components/TimerPanel.tsx:361-380`).
2. `collectEligibleProjectionTasks` filters archived/Done/backend-complete/no-estimate tasks and computes `remainingPomodoros`, including the running work timer's elapsed fraction (`src/lib/timer.ts:80-122`).
3. `buildProjectionBacklogs` classifies each remaining task by due date; `unscheduled` is added to the daily **and** weekly backlog, `due`/overdue to both, `thisWeek` to weekly only, `future` to neither (`src/lib/timer.ts:183-199`).
4. `createProjection` converts `backlog.totalPomodoros` into elapsed milliseconds: work time per pomodoro plus interleaved short/long breaks by `segment_length`, while subtracting the remaining fraction of a running work timer and adding its already-elapsed ms (`src/components/TimerPanel.tsx:397-432`).
5. The finish time is the later of `combinedProjectFinish` over project workloads allocated proportionally by `remainingByProject` (`src/components/TimerPanel.tsx:434-437`, `src/lib/projection.ts:118-144`) and `addProjectedDuration` for the no-project share using the `end_of_day` cutoff (`src/components/TimerPanel.tsx:438-442`, `src/lib/projection.ts:26-50`).
6. `extendsPastWindow` compares the finish's local date key against today/week-end and drives the "May spill into tomorrow/next week" banner (`src/components/TimerPanel.tsx:443-444`, `src/components/TimerPanel.tsx:172-176`).
7. The card renders scope counts, the finish label, focus/break/total minutes, and the three chips (`src/components/TimerPanel.tsx:118-178`); `TodaySurface` renders below it from the same eligibility rules.
8. Empty/failure path: when `totalPomodoros <= EPSILON` the card returns the no-work state, choosing "all caught up" versus a "future-due work remains outside this projection" message from `excludedFuturePomodoros` (`src/components/TimerPanel.tsx:81-114`).

## Important Contracts And Constraints

- Single eligibility source: `src/lib/timer.ts:75-79` documents that the projected-finish card and the Today surface must both build from `collectEligibleProjectionTasks` so their scope cannot drift; `src/lib/today.test.ts:201-219` enforces the agreement.
- The `unscheduled` bucket is shared by three user-visible outputs: the daily finish time, the `Flexible · Np` chip, and the Today surface's `Np left`. Changing `src/lib/timer.ts:186-188` moves all three.
- The unfinished-at-or-over-estimate floor of `1` pomodoro is required for both due and flexible tasks (`src/lib/timer.ts:106-107`; asserted at `src/lib/today.test.ts:170-180` and `src/components/TimerPanel.test.tsx:213-257`).
- Estimate-less tasks are intentionally out of scope and the card copy says so (`src/components/TimerPanel.tsx:23-24`); this is enforced at `src/lib/timer.ts:93-94`, not merely documented.
- Project schedules shape the clock, not the total: `normalizeProjectSchedule` defaults to Mon-Fri 09:00-17:00 (`src/lib/projectSchedule.ts:3-5`, `src/lib/projectSchedule.ts:20-33`), and `combinedProjectFinish` skips non-workable time (`src/lib/projection.ts:118-144`).
- No-project flexible work is scheduled with `addProjectedDuration`, which skips past the local `end_of_day` cutoff and resumes at the next local midnight rather than at a work-start time (`src/lib/projection.ts:26-50`).
- The pure helpers take an explicit reference date (`src/lib/timer.ts:173-177`); `TimerPanel` supplies "now". Timer/task semantics are owned by the pure engine and must not change as a side effect of projection work.
- Fractional remaining work is expected and formatted by `formatPomodoroCount` (`src/lib/timer.ts:204-210`), so sums are not assumed to be integers.

## Existing Tests And Validation

- `src/lib/timer.test.ts:159-179` - `buildProjectionBacklogs` asserts undated work adds `3` to `daily.totalPomodoros`, `daily.unscheduledPomodoros`, and the weekly backlog. This is the direct proof that flexible work is inside the daily total used for the finish estimate.
- `src/lib/today.test.ts:104-122` - flexible tasks are retained with bucket `"flexible"` and counted in `remainingPomodoros`.
- `src/lib/today.test.ts:201-219` - "agrees with the daily projected-finish backlog": `buildTodayTasks(...).remainingPomodoros` equals `daily.totalPomodoros` for a fixture that includes a flexible task.
- `src/lib/today.test.ts:124-140` - excludes archived, Done, backend-completed, and no-estimate tasks.
- `src/components/TimerPanel.test.tsx:167-211` - projected-finish copy, empty state versus future-due disclosure, `Due now · 1p`, and the weekly `Later this week · 2p` chip.
- `src/components/TimerPanel.test.tsx:213-257` - an over-estimate unfinished task stays projected as `Due now · 1p`, exercising the remaining-work floor.
- `src/components/TimerPanel.test.tsx:281-289` - the Today surface renders below the projected-finish card.
- `src/components/WeekOverviewPage.test.tsx:26-47` - daily due and flexible pomodoro counts with calendar progress.
- `src/lib/engine/weekOverview.test.ts:60-110` - balancing of unscheduled pomodoros across workable days.
- `src/lib/projection.test.ts:15-80` - end-of-day skipping, midnight resume, and project-window finish arithmetic.
- Missing coverage: no unit test asserts the `Flexible · Np` chip in the projected-finish card, and no Playwright spec under `e2e/` references the projected finish or `Flexible`. Validation commands per repo guidance: `pnpm test:unit`, then `pnpm test:e2e` if a browser-level assertion is added.

## Risks, Edge Cases, And Unknowns

- Today-versus-week divergence: the finish estimate assumes every flexible pomodoro is done today, while the Week overview spreads the same work across remaining days. Both are visible in the app, and no doc or test states that the divergence is intended.
- Silent exclusion: a flexible task with no `estimatePomos` and no backend `target_pomodoros` contributes nothing to the estimate (`src/lib/timer.ts:93-94`). A user auditing "flexible pomodoros" may not expect that.
- Inference (not directly tested): unassigned flexible work that spills past `end_of_day` resumes at local midnight (`src/lib/projection.ts:34-46`), so the displayed `Finish by` time can be a next-day ~00:00 value rather than a work-start time.
- Inference: project-assigned flexible work on a non-workable day pushes the finish to the next workable window (`src/lib/projection.ts:59-67`, `src/lib/projection.ts:100-110`), which can flip the `dayLabel` and raise the spill banner even though the work was counted for today.
- Inference: `assignedWorkloads` allocates the aggregate duration by each project's share of remaining pomodoros (`src/components/TimerPanel.tsx:434-436`), so the model does not sequence due work before flexible work; it assumes a proportional blend.
- Active-timer interaction: a running work timer is handled by subtracting its remaining fraction and adding its elapsed ms (`src/components/TimerPanel.tsx:401-415`), with `planned_secs` falling back to `work_minutes` (`src/lib/timer.ts:253-259`). The combination of an active timer and flexible work is only covered indirectly.
- Unknown: whether the product intent is "count flexible work today" or "balance it like the Week overview". Code does not decide this, and there is no prior research or feature note in `docs/`.
- Unknown: whether any consumer outside `TimerPanel` and the week engine reads `unscheduledPomodoros`; codebase search found only those.
- Uninspected: whether mobile/desktop layouts differ in how the chips or card are exposed; the same `ProjectionCard` is used for both, but no layout-specific test was found.

## Downstream Guidance

- Requirements should account for: the existing inclusion of `unscheduled` work in the daily total, the no-estimate exclusion, the `1p` floor for unfinished over-estimate tasks, and the fact that the `Flexible` chip, the finish time, and the Today `Np left` figure are three views of one backlog.
- Planning should consider: treating `src/lib/timer.ts:177-202` as the single behaviour switch; preserving `collectEligibleProjectionTasks` as the shared eligibility contract (`src/lib/timer.ts:75-79`); covering the `Flexible · Np` chip and the daily/weekly totals in unit tests, since current coverage checks the pure backlog but not the rendered chip; and confirming product intent on today-counting versus week-balancing before changing anything.
- Do not include: opportunistic refactors of `ProjectionCard`/`TodaySurface`, changes to timer or task semantics, new persistence, or e2e tests unrelated to the finish estimate.
