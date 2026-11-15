# Title: Keep timer page project group collapse state for the app session

## Tags

Complexity Classification: T1
Classification Reason: A single `useState` in `src/components/TaskPanel.tsx` is replaced by a module-level in-memory store with a subscription, following the proven `src/lib/pm/quickAddSession.ts` pattern (store + `useSyncExternalStore`, reset from the owner-keyed effect in `src/App.tsx`). Only two mount points consume it, both in `src/App.tsx`, and nothing is persisted, so the blast radius is small and fully mapped.

Severity: Low
Severity Reason: Cosmetic UI state only. No data, auth, sync, or timer semantics are affected; the failure mode is that collapsed project groups re-expand after a page switch.

Needs research before implementation: No

## Summary

The timer page (`/`, rendered by `MainLayout` in `src/App.tsx`) shows the task list from `src/components/TaskPanel.tsx`. That list groups tasks by project and renders one collapsible section per group, including a synthetic "No project" bucket for unassigned tasks.

The collapse state lives in component-local `useState`:

```ts
const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
```

Navigating to another page (`/projects`, `/analytics`, `/habits`, …) unmounts `MainLayout` and therefore `TaskPanel`, so every collapsed group re-expands on return. This issue keeps the per-project collapsed/expanded state in memory for the current app session — surviving page switches only — so it resets on reload/restart or when the signed-in owner changes.

## Steps to Reproduce Context

1. Open the timer page (`/`) and collapse two or three project groups in the Tasks panel.
2. Navigate to another page, e.g. Projects or Analytics.
3. Navigate back to the timer page. Every project group is expanded again and has to be re-collapsed.

## Requirements for completed issue

1. Collapsing or expanding a project group on the timer page is remembered for the rest of the app session.
2. The state survives navigating to any other route and back, in both page modes ("Timer" and "Quick add").
3. The state is memory-only: it is not written to `localStorage`, `Settings`, `pm_state_v1`, or the staging store, and it resets on a page reload or app restart.
4. The reset trigger is a change of the signed-in owner (sign-out / different user), matching how the Timer page mode and Quick add draft are reset. No manual reset control is added.
5. Both rendered `TaskPanel` instances (desktop sidebar and mobile "Tasks & Settings" drawer) read and write the same collapse state, so collapsing in one is reflected in the other.
6. The synthetic "No project" group (`"__no_project__"`) participates exactly like a real project group.
7. Toggling a group notifies subscribers so any mounted `TaskPanel` re-renders without a route change.
8. Existing timer page behavior is unchanged: group ordering, group labels/colors, item counts, the sort selector and its localStorage persistence (`TASK_SORT_LS_KEY`), quick add form visibility, and row actions.

## Expected Behavior

- A user collapses "Project A" and "Project B", visits Analytics, and returns to the timer page: "Project A" and "Project B" are still collapsed and every other group stays as it was.
- The same holds when the mobile drawer is closed and reopened.
- A reload or app restart starts with all groups expanded again.
- Signing out and signing in as another user does not inherit the previous user's collapse state.

## Actual Behavior

- `collapsedGroups` is component state, so it is discarded when `TaskPanel` unmounts on route change. Returning to the timer page shows all groups expanded.
- Nothing outside `TaskPanel` can read or preserve that state.

### Testing

1. Unit tests for the new store module: default is empty (all expanded), toggle round-trips a key, toggling twice restores the previous value, independent keys do not interfere, subscribers are notified on change and stop being notified after unsubscribe, reset clears every key, and the module never reads or writes browser storage (mirror `src/lib/pm/quickAddSession.test.ts`).
2. Component tests in `src/components/TaskPanel.test.tsx`: collapse a group, unmount, mount a fresh `TaskPanel`, and confirm the group is still collapsed; expand it again and confirm the empty state is preserved across a remount.
3. A shared-instance test: render two `TaskPanel` components at once and confirm collapsing a group in one collapses it in the other.
4. A reset test: set a collapsed group, call the store reset, and confirm a freshly mounted `TaskPanel` renders the group expanded.
5. Confirm the "No project" group's collapse state is remembered like any other group.
6. `pnpm test:unit` passes, plus `pnpm run build`.

## Issue Context

### New Files

A session store module for the timer page task-group collapse state, e.g. `src/lib/pm/taskGroupCollapseSession.ts` plus `taskGroupCollapseSession.test.ts`. Reusing/extending `src/lib/pm/quickAddSession.ts` is acceptable if it stays readable; the exact location is up to the implementer. The module needs at minimum:

- a read of the current collapsed map (`Record<string, boolean>` keyed by group key, i.e. project id or `"__no_project__"`);
- a toggle or set operation that writes a group key and publishes to subscribers;
- `subscribe…(listener): () => void`;
- a reset function that clears the map back to `{}` and publishes once.

Document on the module, as `quickAddSession.ts` does, that it is a plain in-memory store: it survives route navigation because the authenticated shell stays mounted, is discarded on reload, and must never be written to `localStorage`, `Settings`, or the staging store.

### Remove Files

None.

### Change Files

#### Timer page task list collapse state

Code Source: `src/components/TaskPanel.tsx`

Code Description: The list builds `groupedTasks` keyed by `entry.projectId` (with `"__no_project__"` for unassigned tasks) and keeps collapse state in local component state:

```ts
const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => ({
        ...prev,
        [groupKey]: !prev[groupKey],
    }));
}, []);
```

Rendered as `const collapsed = collapsedGroups[group.key] ?? false;` around lines 296-311.

Code Change Description: Replace the `useState` with `useSyncExternalStore` over the new store, reading the collapsed map and calling the store's toggle from `toggleGroup`. Keep the `?? false` default so unknown/absent keys render expanded. The group key source stays `pmTask?.projectId ?? "__no_project__"`.

```ts
// current
const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
// expected shape
const collapsedGroups = useSyncExternalStore(subscribeToGroupCollapseSession, getCollapsedGroups, getCollapsedGroups);
```

Files Using: `src/App.tsx` (both mount points), `src/components/TaskPanel.test.tsx`.

#### Session reset on owner change

Code Source: `src/App.tsx` (`AuthenticatedShell`, ~lines 157-161)

Code Description: The shell already resets surface-local session state when the signed-in identity changes:

```ts
const ownerId = session!.user.id;
// The Timer page mode and Quick add draft are surface-local. Keep them
// across route changes but drop them when the signed-in identity changes.
useEffect(() => {
    resetQuickAddSession();
}, [ownerId]);
```

Code Change Description: Also reset the new collapse store in this effect (or a sibling effect keyed on the same `ownerId`) so a different signed-in user never inherits the previous user's collapse state.

Files Using: `src/components/TaskPanel.tsx`.

#### TaskPanel mount points

Code Source: `src/App.tsx` (`MainLayout`, ~lines 260-302)

Code Description: `TaskPanel` is rendered twice: the desktop `<aside>` sidebar (line 263) and the mobile "Tasks & Settings" drawer (line 297). Both are inside the `/` route element, so a route change unmounts them.

Code Change Description: No structural change is expected — the shared store makes both instances agree. Do not add a per-instance prop or context that would split the state.

#### Reference pattern

Code Source: `src/lib/pm/quickAddSession.ts`

Code Description: Module-level state plus a `Set` of listeners, `publish()`, getters/setters, `subscribeToQuickAddSession`, and `resetQuickAddSession`. `TaskPanel.tsx` already consumes it via `useSyncExternalStore` (line 47).

Code Change Description: Follow this pattern exactly (naming, reset semantics, documentation comment) for the collapse store.

```ts
let timerPageMode: TimerPageMode = "timer";
const listeners = new Set<QuickAddSessionListener>();

export function subscribeToQuickAddSession(listener: QuickAddSessionListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
```

Files Using: `src/components/TaskPanel.tsx`, `src/components/TimerPanel.tsx`, `src/lib/pm/quickAddSession.test.ts`.

## Notes

- `AGENTS.md` restricts persistence to the staging store plus a fixed list of surface-local localStorage keys. This change adds no persistence at all, so no new exception entry is needed — but the collapse map must not be written to `localStorage` as a shortcut.
- The existing sort preference (`TASK_SORT_LS_KEY`) keeps its localStorage behavior; it is a separate, deliberately persisted preference and is out of scope here.
- Stale keys for deleted projects are harmless because the map is only read by current group keys and is cleared on owner change and reload.
