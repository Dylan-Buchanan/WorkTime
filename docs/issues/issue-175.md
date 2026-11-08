# Title: `PMTask.waiting` as an orthogonal task fact

## Tags

Complexity Classification: T3
Classification Reason: Adds a persisted field to the synced `PMTask` model, changes the task coercion pass in the PM context, and enforces two cross-cutting invariants (clear on Done/archive, clear when a task becomes the active occupant) across every start path, plus new inspector UI. Touches types, the PM context, the inspector, and several test fixtures.

Severity: Medium
Severity Reason: No data loss, security or concurrency risk. The failure mode is a lingering or wrongly-cleared "waiting" indicator that misleads the user about why the clock is on another task, and malformed values being silently dropped. Recoverable by toggling the flag.

Needs research before implementation: Yes

### Research Needed

- Enumerate the authoritative "task becomes the active occupant" paths and choose the single enforcement point. "Occupant" only becomes a real concept once the window model (issue 1 in this series) lands, and today there is no such concept in the codebase.
- Confirm how the whole-blob last-write-wins merge of `pm_state` (`mergeSingletonValue` in `src/lib/data/sync/merge.ts:1149`) interacts with the "must survive sync merge" requirement, given two clients could toggle the flag concurrently.
- Confirm whether `waiting` must be excluded from the planner/agent context (`src/lib/engine/plannerContext.ts`), the diff engine (`src/lib/engine/diffEngine.ts`), and goal evidence task projections, or whether it is purely presentational.

## Summary

A task can be stalled because it is waiting on someone else — an agent or a person. That is a fact about the task, not a timer action, and it is independent of status: a task can be `In Progress` *and* waiting, or `Blocked` *and* waiting.

This issue adds `waiting` to `PMTask` as an orthogonal, nullable fact with a type and a start time. Keeping it out of the status enum means `Blocked` does not have to be renegotiated, and `since` gives waiting duration for free without a second timestamp field.

The flag is introduced through the synced `pm_state` blob, so no database migration is needed.

## Steps to Reproduce Context

1. Open a task in `TaskInspector` and look for any way to record that it is waiting on an agent or a person.
2. Observe: there is no such field, no toggle, and no badge.
3. Observe: the only way to express "not actionable right now" is the `Blocked` status, which conflates a dependency block with delegation.

## Requirements for completed issue

1. `PMTask` has `waiting: { type: "agent" | "person"; since: string } | null`.
2. Task normalization in `ProjectManagerContext` coerces the field: a missing, malformed, or unknown-type value becomes `null`, and an unparseable `since` collapses the whole flag to `null`.
3. The same normalization pass clears the flag when the task is `Done` or archived, so a badge can never outlive its task.
4. The flag is cleared whenever the task becomes the active occupant of a window, on every start path.
5. `TaskInspector` offers a Waiting toggle with an Agent/Person segmented control and a clear action.
6. The flag survives reload, a sync merge, break screens, and idle periods.
7. Setting the flag on the currently running occupant is allowed; it clears only when that task becomes an occupant again.
8. Clearing is irreversible by design — no audit trail of a completed wait is kept.
9. `Blocked` and waiting coexist without either implying the other.
10. The flag does not leak into goal-set export/import.
11. The type vocabulary stays the fixed pair `agent` / `person`; there is no free-text "waiting on whom" and no additional status value.

## Expected Behavior

- A task can be marked waiting on an agent or a person from the inspector, with the wait start recorded.
- The flag is present in the synced PM state and returns intact after a reload or pull.
- A task that becomes `Done` or archived while waiting loses the flag automatically.
- A task that becomes the active work occupant loses the flag automatically.
- A malformed stored value (bad type, bad `since`, unknown shape) is normalized to "not waiting" instead of breaking the task.
- Exporting a goal set and importing it produces fresh IDs and carries no `waiting` data.

## Actual Behavior

- `PMTask` has no waiting concept (`src/state/types.ts:35-56`).
- The task coercion in `normalizeState` spreads the raw stored object (`src/state/ProjectManagerContext.tsx:880`), so any unknown field would pass through unvalidated and unnormalized.
- `TaskInspector` has no waiting control.

### Testing

- `pnpm test:unit` — `src/state/ProjectManagerContext.test.tsx` / `src/state/ProjectManagerContext.test.ts`: normalization of missing, `null`, valid `agent`/`person`, unknown type, malformed object, and unparseable `since`; clearing on `Done` and on `isArchived`.
- Round-trip: set the flag, persist, reload, assert it is intact; run a pull merge and assert it survives.
- Clearing on every start path: timer page Start, inspector Start, Today focus, to-do promotion, and the sheet.
- Coexistence: a `Blocked` task with `waiting` set keeps both; a waiting task started while `Blocked` keeps `Blocked`.
- `src/lib/goals/goalSetFile.test.ts`: a goal-set export/import round-trip carries no `waiting` data.
- Component coverage in `src/components/ProjectManager/TaskInspector.test.tsx` (or the existing inspector harness) for the toggle, the segmented control, and the clear action.

## Issue Context

### New Files

None required. If the normalization is extracted as a pure helper, colocate it with the PM domain with a colocated test.

### Remove Files

None.

### Change Files

#### `PMTask` type

Code Source: `src/state/types.ts:35-56`
Code Description: The PM task shape: `id`, `title`, `projectId`, `status`, `priority`, `dueDate?`, `estimatePomos?`, `timeSpentMinutes`, `workedPomos?`, `lastWorkedAt?`, `description?`, `tags`, `links`, `checklist`, `sortOrder`, `isArchived`, `createdAt`, `updatedAt`, `appTaskId?`, `relatedTo`.
Code Change Description: Add `waiting`. Document that it is orthogonal to `status`.

```ts
export type TaskStatus = "Backlog" | "Next" | "In Progress" | "Blocked" | "Done"; // unchanged

export interface PMTaskWaiting {
    type: "agent" | "person";
    /** ISO timestamp when the wait started. Drives the waiting-duration display. */
    since: string;
}

// on PMTask:
waiting: PMTaskWaiting | null;
```

#### Task coercion

Code Source: `src/state/ProjectManagerContext.tsx:849-897`
Code Description: The per-task normalization block, ending with the `tasks[id] = { ...task, projectId, status, priority, dueDate, tags, links, checklist, sortOrder, isArchived, timeSpentMinutes, workedPomos, estimatePomos, createdAt, updatedAt, relatedTo }` assignment at `:879-896`. The leading `...task` spread currently lets unvalidated fields through.
Code Change Description: Normalize `waiting` alongside the other fields, and clear it when the normalized status is `Done` or `isArchived` is true.

Files Using: `src/lib/data/DataAccess.ts:25` (`SyncedPMState`), `src/state/ProjectManagerContext.test.ts`

#### Inspector controls

Code Source: `src/components/ProjectManager/TaskInspector.tsx:96-120`
Code Description: The header block holding the title, project select, status select (`:109`) and priority select.
Code Change Description: Add a Waiting toggle with an Agent/Person segmented control and a clear action, following the existing `Select`/button styling.

Files Using: `src/components/TimerPanel.tsx` (renders `TaskInspector` in its details panel)

#### Activation clearing

Code Source: `src/state/AppStateContext.tsx:283-294` and the other work-start paths
Code Description: Work starts go through `startTaskWork` (timer page Start, Today surface, to-do promotion) or `TaskInspector`'s Start button (`:202-227`).
Code Change Description: Clear `waiting` on the task that becomes the active occupant, using the single enforcement point chosen during research.

Files Using: `src/state/StateSyncBridge.tsx:335-347` (auto-link on active task), `src/components/TodaySurface.tsx:141-162`, `src/state/TodoContext.tsx:232-251`

## Notes

- No database migration: `pm_state` is a single synced JSONB value (`src/lib/data/staging/types.ts:73`, merged whole at `src/lib/data/sync/merge.ts:1149`).
- `src/lib/goals/goalSetFile.ts` only carries goals, trackers and check-ins, so the "must not leak into goal-set export" requirement is a regression guard, not new plumbing.
- This issue must land before the ranking module (issue 5 in this series) and the switch/waiting sheet (issue 6 in this series).
