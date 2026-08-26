## Title: Shortcut story import does not populate the task due date consistently with the task details page

## Tags

Complexity Classification: T2
Severity: Medium
Reason: A real defect in the Shortcut import → PM task data flow plus a consistency invariant across the task due-date displays. The due date is carried from the Shortcut story `deadline` into a task proposal and into `createTask`, but the created task's due date and the task details page are observed to disagree for imported stories. Blast radius spans the proposal builder, the PM create path, and the due-date display components, and the exact mechanism that drops the value (date-format normalization vs. a dropped field in a create/sync sequence) needs confirmation before implementing.
Needs research before implementation: Yes, confirm why the same `task.dueDate` renders in one location but is empty in the task details page — for example whether the value can arrive in a non-`YYYY-MM-DD` form that the `<input type="date">` rejects, or whether a specific create/patch sequence loses the value — and where the "always agree" invariant should be enforced.

## Summary

When importing Shortcut stories into WorkTime tasks, the due date appears on the task (and in the import preview), but is not filled out on the task details page. The due date shown on a task and the due date on the task details page should always match.

## Steps to Reproduce Context

1. Connect and sync a Shortcut account with stories that have a deadline set.
2. Confirm the import preview shows the story deadline as a task "Due" date.
3. Confirm the import and open the created task on the task details page.
4. Observe that the due date controls/field is empty even though a due date is displayed on the task elsewhere.

## Expected Behavior

- Importing a Shortcut story with a deadline creates a task whose due date matches that deadline.
- The "always agree" invariant holds: if a due date is displayed for a task in any view (list, board, import, etc.), it is also present on that task's details page, and vice versa.

## Actual Behavior

- The created Shortcut task shows the expected due date in one place (for example the task card / import) but the task details page does not have that due date filled in.
- Because the two surfaces are read from the same `PMTask.dueDate` field, this indicates the value is being lost or mis-formatted on the create/persist path for imported stories rather than simply being displayed differently.

## Requirements for completed issue

1. Importing a Shortcut story that has a deadline produces a task whose due date is set to that deadline.
2. The task details page reflects the due date that is displayed on the task in the list/board and preview views.
3. Any time a due date is shown for a task in one surface it is also shown in the others (the due date is a single consistent value, not duplicated or mis-formatted).

## Context

- Files:
  - `src/lib/engine/shortcutClassification.ts` — `buildShortcutTaskProposal` maps `story.deadline` to `proposal.dueDate`.
  - `src/components/ShortcutIntegrationCard.tsx` — passes the proposal (including `dueDate`) to `createTask`; the preview shows `Due {proposal.dueDate}`.
  - `src/state/ProjectManagerContext.tsx` — `createTask` applies `dueDate` to the PM task and the linked-task patch path.
  - `src/components/ProjectManager/TaskInspector.tsx` — the task details page, reads/edits `task.dueDate`.
  - `src/components/ProjectManager/TasksBoardView.tsx` and `src/components/ProjectManager/TasksListView.tsx` — render `task.dueDate`.
  - `src/state/types.ts` — `PMTask.dueDate?: string` (ISO date).

- Code Snippets:
  - `src/lib/engine/shortcutClassification.ts`:
    ```ts
    ...(story.deadline !== null ? { dueDate: story.deadline } : {}),
    ```
  - `src/components/ProjectManager/TaskInspector.tsx`:
    ```tsx
    <input type="date" value={task.dueDate || ""} onChange={(e) => updateTask(task.id, { dueDate: e.target.value || undefined })} />
    ```
  - `src/components/ProjectManager/TasksBoardView.tsx`:
    ```tsx
    {task.dueDate && <span>...{task.dueDate.slice(5)}</span>}
    ```

## Notes

Unknown: the exact root cause is not confirmed. The list/board chips and the task details input read the same `PMTask.dueDate` field, so the discrepancy likely stems from the value being stored in a form the `<input type="date">` rejects, or from a specific creation/sync sequence dropping the value for imported stories. Confirmation is needed before implementing.
