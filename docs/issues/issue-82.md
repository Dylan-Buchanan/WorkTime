## Title: Fix project view scroll bar styling to match the rest of the app

## Tags

Complexity Classification: T0
Severity: Low
Reason: A purely presentational CSS change. The project view scroll containers simply lack the shared `app-scrollbar` class already used across the rest of the app, so they fall back to default browser scrollbars. Reusing an existing pattern means no behavior, data, or test impact; uncertainty is low and rollback is trivial.
Needs research before implementation: No

## Summary

The scroll bars in the Project Manager view do not use the shared custom scrollbar styling (`app-scrollbar`) that the rest of the app applies, so they render with the default browser scrollbar instead of the consistent custom look (thin, rounded, indigo-on-hover). The fix is to apply the `app-scrollbar` class to the project view's scroll containers.

## Steps to Reproduce Context

1. Open the Project Manager view (either List or Board).
2. Scroll through the task list, board columns, or the projects sidebar so a scroll bar is visible.
3. Compare the scroll bar appearance against other scrollable panels (e.g., the Tasks panel on the main screen, the Task Inspector, or the Week Overview page).

## Expected Behavior

Scroll bars in the project view should match the custom `app-scrollbar` styling used throughout the rest of the app: thin width, rounded track/thumb, neutral coloring, and the indigo hover tint.

## Actual Behavior

Scroll bars in the project view use the default browser styling because the scroll containers are missing the `app-scrollbar` class, making them visually inconsistent with the rest of the app.

## Requirements for completed issue

1. The project view scroll containers render with the same custom scrollbar styling as the rest of the app (the `app-scrollbar` style defined in `src/index.css`).
2. The scrollbar styling applies consistently in both List and Board views and in the projects sidebar.
3. No functional behavior of the project view is changed.

## Context

- Files:
  - `src/index.css` (lines 13-49) — defines the shared `.app-scrollbar` / `.habit-scroll` custom scrollbar styles.
  - `src/components/ProjectManager/ProjectManagerPage.tsx` (line 168) — list view scroll container.
  - `src/components/ProjectManager/TasksBoardView.tsx` (lines 60, 79) — board horizontal and column vertical scroll containers.
  - `src/components/ProjectManager/ProjectsSidebar.tsx` (line 399) — project list scroll container.
- Code Snippets:

  `src/index.css` (the shared style to reuse):
  ```css
  .app-scrollbar {
      scrollbar-width: thin;
      scrollbar-color: color-mix(in oklab, var(--color-neutral-600) 65%, transparent) color-mix(in oklab, var(--color-neutral-950) 45%, transparent);
  }
  .app-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
  .app-scrollbar::-webkit-scrollbar-track { background: color-mix(in oklab, var(--color-neutral-950) 45%, transparent); border-radius: 9999px; }
  .app-scrollbar::-webkit-scrollbar-thumb { background: color-mix(in oklab, var(--color-neutral-600) 65%, transparent); border: 2px solid transparent; background-clip: padding-box; border-radius: 9999px; }
  .app-scrollbar::-webkit-scrollbar-thumb:hover { background: color-mix(in oklab, var(--color-indigo-500) 75%, var(--color-neutral-600)); border: 2px solid transparent; background-clip: padding-box; }
  ```

  `src/components/ProjectManager/ProjectManagerPage.tsx` (list view scroll container, missing `app-scrollbar`):
  ```tsx
  <div className="flex-1 overflow-auto">
      <TasksListView />
  </div>
  ```

  `src/components/ProjectManager/TasksBoardView.tsx` (board scroll containers, missing `app-scrollbar`):
  ```tsx
  <div className="flex gap-3 h-full overflow-x-auto pb-2">
  ...
  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
  ```

  `src/components/ProjectManager/ProjectsSidebar.tsx` (project list scroll container, missing `app-scrollbar`):
  ```tsx
  <div className="flex-1 overflow-y-auto pr-1 space-y-1 text-xs">
  ```

  For contrast, other panels already apply the class, e.g. `src/components/ProjectManager/TaskInspector.tsx`:
  ```tsx
  <div className="flex-1 min-h-0 app-scrollbar overflow-y-auto px-4 py-4 space-y-5">
  ```

## Notes

- Only the scroll containers listed above appear to be missing the class. All other `overflow-*` containers in the Project Manager use either `app-scrollbar` or an explicit inline scrollbar style (see `ProjectsSidebar.tsx:104`, which is a separate dropdown menu and is already styled).