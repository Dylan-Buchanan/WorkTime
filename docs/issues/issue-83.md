## Title: Allow dragging tasks between board columns seamlessly

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Feature to make cross-column drag-and-drop on the board view work correctly. Blast radius is confined to `TasksBoardView.tsx` and the `moveTaskToStatus`/`reorderTasks` state methods in `ProjectManagerContext.tsx`. The gaps are precisely identified, but the `moveTaskToStatus` persistence side-effect (sibling `sortOrder` not saved) and the drop-index computation carry moderate uncertainty, and a wrong fix could scramble persisted ordering. Drag-and-drop is hard to unit-test, so verifying cross-column order persistence realistically needs E2E coverage.
Needs research before implementation: Yes
Reason: Confirm how the `persist` write path should save the recomputed sibling ordering after a cross-column move, decide how to pass the target drop index into `moveTaskToStatus` so a drop lands at the intended position (not always the end), and determine whether columns need to become droppable (`useDroppable`) to support dropping onto empty/column space.

## Summary

In the Project Manager board view, a user can only reorder a task within its current column, or change a task's column via the task status field. Dragging a task between columns should move it seamlessly to a target column at the intended drop position, with ordering persisted correctly.

## Steps to Reproduce Context

1. Open the Project Manager and switch to the Board view.
2. Drag a task card via its `⋮` handle toward a card in a different column.
3. Drop the task over the target column (either over a card or empty column space).
4. Observe the resulting column/status and ordering of the task, and reload to confirm persistence.

## Expected Behavior

Dragging a task from one column to another moves it to the target column at the drop position, updates the task status accordingly, and persists the resulting ordering of both source and target columns so the layout is stable after reload. Dropping onto empty column space (including empty columns) is also supported.

## Actual Behavior

Cross-column dragging is broken/incomplete:
- The board columns are not droppable, so dragging onto empty column space or an empty column has no drop target and is not registered.
- `moveTaskToStatus` recomputes sibling `sortOrder` values in place but the `persist` call only writes the moved task's `status`/`updatedAt` — the recomputed sibling ordering in the target column is never saved.
- The board never passes a target drop index to `moveTaskToStatus`, so cross-column drops always append to the end of the target column regardless of drop position.

As a result, users effectively can only reorder within a column or move tasks via the status field.

## Requirements for completed issue

1. A user can drag a task from one board column to another and have it appear in the target column at the intended drop position, with its status updated to the target column's status.
2. The resulting task ordering (source and target columns) is persisted so the board renders the same layout after a reload and across devices.
3. Dropping a task onto empty column space (including a completely empty column) moves the task into that column.
4. Within-column reordering continues to work unchanged.
5. Task semantics and ordering are covered by the relevant tests (unit where feasible, E2E for the cross-column drag interaction).

## Context

- Files:
  - `src/components/ProjectManager/TasksBoardView.tsx` — board columns, `DndContext`, `SortableContext`, `onDragEnd` cross-column handling.
  - `src/state/ProjectManagerContext.tsx` — `moveTaskToStatus` (lines 692-708) and `reorderTasks` (lines 679-691).
- Code Snippets:

  `src/components/ProjectManager/TasksBoardView.tsx` (`onDragEnd` — cross-column branch, no drop index passed, columns not droppable):
  ```tsx
  const onDragEnd = (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over) return;
      const [fromStatus, taskId] = active.id.toString().split(":");
      const [toStatus] = over.id.toString().split(":");
      const task = state.tasks[taskId];
      if (!task) return;
      if (fromStatus !== toStatus) {
          moveTaskToStatus(task.id, toStatus as TaskStatus);
      } else {
          const arr = tasksByStatus[fromStatus as TaskStatus];
          const oldIndex = arr.findIndex((t) => t.id === task.id);
          const newIndex = (over.data.current as any)?.sortable?.index ?? oldIndex;
          if (oldIndex !== newIndex) {
              const ordered = arrayMove(arr.map((t) => t.id), oldIndex, newIndex);
              reorderTasks(ordered, fromStatus as TaskStatus);
          }
      }
  };
  ```

  `src/state/ProjectManagerContext.tsx` (`moveTaskToStatus` — recomputes sibling order but only persists the moved task's status):
  ```tsx
  const moveTaskToStatus = (id: string, status: TaskStatus, index?: number) => {
      const t = state.tasks[id];
      if (!t) return;
      const siblings = Object.values(state.tasks)
          .filter((s) => s.status === status && s.id !== id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      if (index === undefined || index < 0 || index > siblings.length) index = siblings.length;
      siblings.splice(index, 0, t);
      siblings.forEach((s, i) => (s.sortOrder = i));
      persist((prev) => ({
          ...prev,
          tasks: {
              ...prev.tasks,
              [id]: { ...prev.tasks[id], status, updatedAt: now() },
          },
      }));
  };
  ```

  `src/state/ProjectManagerContext.tsx` (`reorderTasks` — functional persist that sets sortOrder by index; used for within-column reordering):
  ```tsx
  const reorderTasks = (idsInOrder: string[], withinStatus?: TaskStatus) => {
      persist((prev) => {
          const tasks = { ...prev.tasks };
          idsInOrder.forEach((id, idx) => {
              const t = tasks[id];
              if (!t) return;
              if (withinStatus && t.status !== withinStatus) return;
              t.sortOrder = idx;
              t.updatedAt = now();
          });
          return { ...prev, tasks };
      });
  };
  ```

  `src/components/ProjectManager/TasksBoardView.tsx` (column task list — `SortableContext` keyed as `"${status}:${taskId}"`):
  ```tsx
  <SortableContext items={tasks.map((t) => `${status}:${t.id}`)} strategy={verticalListSortingStrategy}>
  ```

## Notes

- The drag handle (`⋮`) with `{...attributes} {...listeners}` is the only pointer-drag surface on a task card; the rest of the card selects the task.
- Statuses are defined in `src/state/ProjectManagerContext.tsx` (`["Backlog", "Next", "In Progress", "Blocked", "Done"]`) and in `TasksBoardView.tsx` (`columns`).
- The user references "move tasks using the task status field" as the current cross-column workaround (the status selector in the task inspector/details), which this change would replace with direct dragging.