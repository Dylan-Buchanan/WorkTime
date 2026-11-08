# Title: Advance PM status to In Progress on every work-start path

## Tags

Complexity Classification: T3
Classification Reason: Cross-provider state change spanning the PM context, the app-state context, the todo context, the sync bridge and several components. The status write has to become an atomic patch rather than a render-closure patch, which touches a function with many call sites that already coexists with five bridge effects writing the same PM state.

Severity: Medium
Severity Reason: The board status silently goes stale for tasks the user is actively working, degrading trust in the PM board, and a mishandled write can drop a concurrent `appTaskId`/estimate patch. No logged work, timer data, auth or money is at risk and every bad outcome is manually correctable.

Needs research before implementation: No

## Summary

Starting the clock on a PM task is the strongest available signal that the task is underway, but nothing acts on it. The only code that writes `PMTask.status` is the status dropdown in `TaskInspector`.

This issue makes a work start advance `Backlog` and `Next` tasks to `In Progress`, from every entry point, in one place. `In Progress`, `Blocked` and `Done` are left alone: `Blocked` is explicitly not a work state (the waiting flag covers delegation), so starting work must not silently unblock a task.

Doing this centrally matters because the switch/waiting sheet (issue 6 in this series) starts work through the same path; the picker must not become a special case.

## Steps to Reproduce Context

1. Open the Project Manager and create a task with status `Backlog` (or `Next`).
2. Press the Start button in `TaskInspector` (or the Start button on the timer page, or focus it from the Today surface, or promote it from a to-do).
3. Observe the timer starts and the task keeps its `Backlog` status.

## Requirements for completed issue

1. Starting work on a PM task whose status is `Backlog` or `Next` sets its status to `In Progress`.
2. Starting work on a task that is already `In Progress`, `Blocked` or `Done` leaves its status unchanged.
3. The transition applies on every work-start path: the timer page Start button, the `TaskInspector` Start button, the Today surface focus action, to-do promotion, and the switch/waiting sheet.
4. The status write is committed atomically with any other PM write the same start performs (the `appTaskId` link, the to-do's `currentTaskId`, an estimate normalization), so no concurrent `StateSyncBridge` write can clobber it or be clobbered by it.
5. Moving off a task never downgrades its status.
6. A task started while `Blocked` keeps `Blocked`.
7. The behaviour is reachable from a single shared code path, so adding the sheet in a later issue requires no new status logic.

## Expected Behavior

- Starting work on a `Backlog` task moves it to `In Progress` in the board and list immediately, with an updated `updatedAt`.
- Starting work on a `Next` task moves it to `In Progress`.
- Starting work on a `Blocked` task leaves it `Blocked` and still starts the timer.
- Starting work on a `Done` task (or re-starting an already `In Progress` task) leaves the status alone.
- The change survives a sync round-trip and is visible after reload.

## Actual Behavior

- Status is untouched by every work-start path.
- `src/components/ProjectManager/TaskInspector.tsx:109` is the only writer of `PMTask.status` in the codebase.

### Testing

- `pnpm test:unit` — `src/state/ProjectManagerContext.test.tsx`: starting work from each entry point moves `Backlog`/`Next` to `In Progress` and leaves `In Progress`/`Blocked`/`Done` untouched.
- `src/components/TimerPanel.test.tsx` and `src/components/TodaySurface.test.tsx`: the board reflects the advanced status after a start.
- `src/state/TodoContext.test.tsx`: promotion writes `currentTaskId` and the status change in one commit.
- Concurrency coverage: a bridge estimate/progress patch issued in the same tick as the status change is not lost, and the status change does not clobber the bridge patch.
- Confirm the status change is staged/pushed through `pm_state` (visible after reload).

## Issue Context

### New Files

None required. If the transition is implemented as a pure helper, colocate it with the PM domain and add a colocated test.

### Remove Files

None.

### Change Files

#### The only current status writer

Code Source: `src/components/ProjectManager/TaskInspector.tsx`
Code Description: The status dropdown is the sole writer of `PMTask.status`.
Code Change Description: Leave it as the manual override; the automatic advance must not live here.

```tsx
<Select value={task.status} onValueChange={(v) => updateTask(task.id, { status: v as TaskStatus })}>
```

#### Work-start entry points

Code Source: `src/state/AppStateContext.tsx:283-294`
Code Description: `startTaskWork` is the shared path used by the Today surface and to-do promotion; it throws when a timer is running, then calls `data.setActiveTask(id)` and `data.startWorkTimer()`.

```ts
const startTaskWork = async (id: string) => {
    setError(null);
    if (stateRef.current?.timer) throw new Error("A timer is already running");
    await data.setActiveTask(id);
    const started = await data.startWorkTimer();
    setState(started.state);
};
```

Files Using: `src/components/TodaySurface.tsx:155`, `src/state/TodoContext.tsx:250`

Code Source: `src/components/ProjectManager/TaskInspector.tsx:202-227`
Code Description: The Start button creates or links the backend task, sets it active, then calls `app.startWork()`.
Code Change Description: This path must produce the same status advance.

Files Using: `src/components/TimerPanel.tsx:566-575` (timer page Start → `startWork`)

#### PM task patch write

Code Source: `src/state/ProjectManagerContext.tsx:647-656`
Code Description: `updateTask` builds the next task from the render-time `state.tasks[id]` and then persists through a functional updater, so a patch computed from a stale closure can drop a concurrent field change.

```ts
const updateTask = (id: string, patch: Partial<PMTask>) => {
    const t = state.tasks[id];
    if (!t) return;
    const normalizedPatch = Object.prototype.hasOwnProperty.call(patch, "dueDate") ? { ...patch, dueDate: normalizeTaskDueDate(patch.dueDate) } : patch;
    const upd: PMTask = { ...t, ...normalizedPatch, updatedAt: now() };
    persist((prev) => ({ ...prev, tasks: { ...prev.tasks, [id]: upd } }));
};
```

Code Change Description: The status advance must merge against the latest persisted task rather than a render snapshot, so it composes with concurrent bridge patches.

Files Using: `src/state/StateSyncBridge.tsx:126,191-194,317,330,345`

#### Concurrent PM writers in the bridge

Code Source: `src/state/StateSyncBridge.tsx`
Code Description: Five effects call `updateTaskRef.current(...)` from app-state changes: estimate propagation (`:126`), metadata/estimate backfill (`:191-194`), worked-pomodoros progress (`:317`), Done-on-backend-complete (`:330`), and title-based auto-link (`:345`).
Code Change Description: Verify the status advance cannot lose or be lost to these writes.

Files Using: `src/state/ProjectManagerContext.test.tsx:477` (`StateSyncBridge` suite)

#### To-do promotion

Code Source: `src/state/TodoContext.tsx:232-251`
Code Description: `startPomodoro` creates the backend task, writes `currentTaskId` through `commitTodos`, then calls `app.startTaskWork(task.id)`.
Code Change Description: The status advance must land in the same commit as `currentTaskId`, not a second render.

Files Using: `src/state/TodoContext.test.tsx`

## Notes

- PM state is the synced `pm_state` blob (`SyncedPMState` in `src/lib/data/DataAccess.ts:25`), so no database migration is involved.
- Do not add a new `TaskStatus` value and do not renegotiate `Blocked`; the waiting flag (issue 3 in this series) is the delegation signal.
