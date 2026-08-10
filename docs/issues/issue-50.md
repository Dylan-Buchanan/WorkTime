## Title: Remember the selected task sort option across app restarts

## Tags

Complexity Classification: T1
Severity: Low
Reason: Frontend-only change to persist the TaskPanel sort dropdown selection. The selected sort option lives only in component-local React state in `TaskPanel.tsx` and resets to `"default"` on every app launch. No data model, sync, or backend changes are involved. The open question is only where the preference should be stored given the persistence boundaries in AGENTS.md.
Needs research before implementation: Yes - confirm the intended storage location per AGENTS.md. The app has two existing precedents: a UI-only `pm_state_v1` localStorage key (per-device, not synced) and the per-owner staging store (`worktime:staging:v1:*`). The `pm_state_v1` UI-preference pattern used for the Project Manager's own `ui.sort` is the likely fit, but the decision should be confirmed before implementation.

## Summary

The task list sidebar (TaskPanel) has a "Sort" dropdown, but the selected option is kept only in component-local state, so it resets to "Default" every time the app is closed and reopened. The app should remember which task sorting option the user had selected and restore it on the next launch.

## Steps to Reproduce Context

1. Open the app (Tauri desktop app or PWA) and go to the main app view with the task sidebar.
2. Use the "Sort" dropdown in the Tasks panel (TaskPanel) to select an option other than "Default", e.g. "Importance" or "Due date".
3. Close the app and reopen it.

## Expected Behavior

When the app is reopened, the Tasks panel should show the task list sorted by the option the user had previously selected. The selection should persist across app restarts.

## Actual Behavior

The "Sort" dropdown resets to "Default" every time the app is reopened, and tasks are shown in default order regardless of the previously selected sort option.

## Requirements for completed issue

1. If the user selects a task sorting option in the Tasks panel, that selection persists across app restarts and is restored when the app is next opened.
2. The persisted selection survives the Tauri desktop app being closed and reopened, and the PWA being closed and reopened.
3. An invalid or missing persisted value falls back to the default sort behavior without errors.

## Context

- Files:
  - `src/components/TaskPanel.tsx`
  - `src/App.tsx`
  - `src/state/ProjectManagerContext.tsx` (existing UI-preference persistence precedent, `pm_state_v1`)
  - `src/lib/data/staging/LocalStagingStore.ts` (per-owner localStorage staging store)
  - `src/state/types.ts` (Project Manager's separate `ui.sort` type)

- Code Snippets:

  TaskPanel holds the sort selection only in component-local state (never persisted):

  ```tsx
  // src/components/TaskPanel.tsx (line 14)
  const [sortOption, setSortOption] = useState<"default" | "project" | "priority" | "dueDate" | "estimateAsc" | "estimateDesc">("default");
  ```

  ```tsx
  // src/components/TaskPanel.tsx (lines 209-220)
  <select
      value={sortOption}
      onChange={(e) => setSortOption(e.target.value as any)}
      className="flex-1 bg-neutral-800/60 border border-neutral-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
  >
      <option value="default">Default</option>
      <option value="project">Project</option>
      <option value="priority">Importance</option>
      <option value="dueDate">Due date</option>
      <option value="estimateAsc">Estimate (asc)</option>
      <option value="estimateDesc">Estimate (desc)</option>
  </select>
  ```

  TaskPanel is rendered in the app sidebar:

  ```tsx
  // src/App.tsx (line 121)
  <aside className="w-72 border-r border-neutral-800 p-3 flex flex-col gap-6 overflow-y-auto bg-neutral-900/30 backdrop-blur-sm"><TaskPanel /><SettingsPanel /></aside>
  ```

  The Project Manager already persists its own separate sort selection (`ProjectManagerState.ui.sort`, type `"manual" | "due" | "priority" | "updated"` in `src/state/types.ts`) via the `pm_state_v1` localStorage key, which is a per-device UI-only preference not synced through the staging store:

  ```ts
  // src/state/ProjectManagerContext.tsx (lines 16, 715-719)
  const LS_KEY = "pm_state_v1";
  // ...
  const setFilters = (patch: Partial<ProjectManagerState["ui"]>) =>
      persist((prev) => ({
          ...prev,
          ui: { ...prev.ui, ...patch },
      }));
  ```

## Notes

- AGENTS.md states: "The per-owner localStorage staging store (`worktime:staging:v1:*`, implemented in `src/lib/data/staging/`) is the only general application-data persistence exception" and "Everything under `pm_state_v1` (UI-only) and the GoTrue `sb-...-auth-token` key remains outside the staging store." The TaskPanel sort is a UI-only preference, so it should follow the same boundary rules as `pm_state_v1`.
- The Project Manager's `ui.sort` is a separate, unrelated sort control; this issue is specifically about the TaskPanel "Sort" dropdown.
