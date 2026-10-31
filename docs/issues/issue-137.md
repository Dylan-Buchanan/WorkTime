# Title: Goal → project link with aligned evidence buckets

## Tags

Complexity Classification: T3
Classification Reason: Cross-domain read path (PM tasks/projects + backend task completion timestamps + pomodoro logs) feeding wizard prefill UI, with accepted-suggestion persistence and broken-link handling. Uncertainty is moderate: completion evidence is best-effort by explicit decision, and the join has known gaps that must degrade gracefully.

Severity: Low
Severity Reason: Enhancement; read-only consumption of existing PM data, no changes to the PM domain.

Needs research before implementation: No

## Summary

An optional single-project link on each goal. When linked, the check-in wizard's **did** bucket offers that period's completed tasks as checkboxes the user accepts or rejects, a folded hours summary ("9 tasks done · 14h") appears, and **current** prefills from In Progress tasks. When unlinked, all three buckets stay typed. This is what makes both users' work trackers a review-and-confirm flow while their life trackers stay type-it-yourself — one engine, no fork.

Scope decision (already made): completion evidence is a **best-effort join** on the backend `Task.completed_at` via `PMTask.appTaskId`, with documented gaps. No `completedAt` field is added to `PMTask` in this issue.

## Steps to Reproduce Context

1. Open the check-in wizard (#136) for a goal with a project link — the did/current buckets are plain text; no task suggestions appear.
2. Inspect `src/state/types.ts` (~L13–54): `PMTask` has **no** `completedAt`; the only completion timestamp is the linked backend `Task.completed_at` (~L1–10), set by `finalizeTask` in `src/lib/engine/taskCommands.ts`.
3. Inspect `src/lib/analytics.ts` `filterLogs` (~L27–63): pomodoro logs carry `task_id` (backend Task id), duration, and `finished_at` — hours are aggregatable for an arbitrary window today.

## Expected Behavior

- A goal can optionally reference exactly one project (selector in the goal edit form; absent from quick-add; goals never *require* a project).
- In the wizard, for a linked goal, the did bucket lists the period's completed tasks for that project as checkbox suggestions (task titles only); hours logged in the period appear as a folded summary; current prefills from the project's In Progress tasks.
- Accept/reject is explicit; accepted task IDs persist to `GoalCheckIn.evidenceTaskIds` for traceability.
- Prefill is editable and **does not silently re-sync after the user touches it** — first manual edit freezes the bucket.
- Auto data lands inside the goal's recap, never as a separate highlights slide.
- Deleted projects/tasks degrade gracefully: broken project links show as unlinked-with-note rather than errors; deleted tasks leave stale `evidenceTaskIds` that render nothing.
- Known evidence gaps are surfaced honestly in the UI copy or docs: tasks never finalized through the timer and tasks whose backend row was deleted are invisible to the did suggestions.

## Actual Behavior

No relationship exists between goals and PM projects/tasks. All buckets are typed by hand.

## Requirements for completed issue

1. `projectId` selector on the goal edit form (the field already exists from #133).
2. Pure selector module (suggested `src/lib/goals/evidence.ts`): given `projects`, PM `tasks`, backend tasks, `logs`, the goal, and the period window — return completed-task suggestions (title + completed-at + accepted flag), the hours rollup, and In Progress prefill candidates. Injected `now`, no I/O, fully unit-testable.
3. Completed-in-window detection: `PMTask.status === "Done"` **and** linked `Task.completed_at` within the period window, scoped to `pmTask.projectId === goal.projectId`.
4. Hours rollup: sum non-break `PomodoroLogEntry.duration_minutes` where `finished_at` is in-window and the log's `task_id` maps (via `appTaskId`) to a task in the linked project — reuse the `filterLogs` / `projectByAppTask` join pattern from `src/lib/analytics.ts` and `src/lib/today.ts`.
5. Wizard integration: checkbox suggestions in did, folded hours summary, In Progress prefill for current, accept/reject writing `evidenceTaskIds`.
6. Freeze-on-touch semantics for prefilled buckets; a refresh action can deliberately re-sync if the user requests it.
7. Broken-link handling: project deleted → goal renders unlinked with a note; task deleted → accepted ID silently no-ops.

### Testing

- `evidence.test.ts`: completed-task detection including the two gap cases (never-finalized Done task, deleted backend row), window boundaries, hours aggregation excluding breaks and other projects, In Progress prefill ordering.
- Wizard tests: suggestions render for linked goals only, accept/reject updates `evidenceTaskIds`, freeze-on-touch, refresh action re-syncs, broken project link note.
- Cross-check: a linked goal with zero matching tasks behaves identically to an unlinked goal.

## Context

Code Source: `src/state/types.ts`
Code Description: `PMTask` (~L13–54) — `status`, `projectId`, `appTaskId`, `title`, `isArchived`; `Task` (~L1–10) — `completed_at`; `PomodoroLogEntry` (~L102–109) — `task_id`, `duration_minutes`, `finished_at`, `was_break`.

Code Source: `src/lib/analytics.ts`
Code Description: `filterLogs` (~L27–63) — the existing arbitrary-window log filter and the `projectByAppTask` mapping pattern to copy.

Code Source: `src/lib/today.ts`
Code Description: `buildTodayPomodoros` (~L160–189) — the `titleByAppTask` bridge from backend log `task_id` to PM task title.

Code Source: `src/components/ProjectManager/TasksBoardView.tsx` (~L9)
Code Description: The canonical status set `["Backlog","Next","In Progress","Blocked","Done"]`.

```ts
// The join at the heart of this issue:
// PMTask.appTaskId -> backend Task.id -> Task.completed_at in window
// PomodoroLogEntry.task_id -> backend Task.id -> PMTask (via appTaskId) -> projectId
```

## Notes

- Depends on #133, #134, #136.
- The period window arrives as #135's `LocalDateKey` pair, while `Task.completed_at` and `PomodoroLogEntry.finished_at` are ISO instants. The selector must convert the date-key window to instants once, at the boundary (local day start), and use that for both the completed-task and hours filters — otherwise "this period" silently includes or drops a day depending on the machine's timezone.
- Explicitly out of scope (rejected or deferred): adding `completedAt` to `PMTask`; activity diffs (Backlog → In Progress → Done) — **unbuildable today**, there is no task history/audit table anywhere in the repo; multi-project pooling per goal.
- "Goal→project creation prompt when a work goal has no project" remains a possible later polish; not required here.
