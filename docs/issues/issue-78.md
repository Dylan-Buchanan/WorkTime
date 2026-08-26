## Title: Task details panel does not fill the full right-side vertical space and needs a UI makeover

## Tags

Complexity Classification: T1
Severity: Medium
Reason: The bug is a purely visual layout issue (right-side panel not filling the vertical space) plus a UI makeover request, confined to `src/components/TimerPanel.tsx` and `src/components/ProjectManager/TaskInspector.tsx` (2 files, no test for TaskInspector; TimerPanel has an existing test). The suspected root cause is already identified (`min-h-full` vs `h-full` in the height chain); the makeover scope is subjective but stays within the panel. Blast Radius=2, Uncertainty=1, Behavior=1, Testing=2, Reversibility=1. Total=7, mapping to T1 (5–8).
Needs research before implementation: No

## Summary

The right-side "Task Details" panel does not render correctly — the panel fails to fill the full right-side vertical space. The task panel also needs a UI makeover.

## Steps to Reproduce Context

1. Launch the app and navigate to the Timer page.
2. Select a task (or start a timer task) so the "Task Details" button appears.
3. Click "Task Details" to open the right-side panel.
4. Observe the panel's height relative to the full right-side vertical space.

## Expected Behavior

The task details panel should fill the entire right-side vertical space (from below the header to the bottom of the viewport), with its internal content sections and footer (Created/Updated/Archive Task) laid out cleanly within that full height.

## Actual Behavior

The panel does not fill the full right-side vertical space — it stops short vertically, leaving empty space or an inconsistent panel height. The panel content styling also appears incomplete/rough, which is why a UI makeover is desired as well.

## Requirements for completed issue

1. The task details panel fills the full right-side vertical space (and the internal scrollable body scrolls within the full-height panel).
2. The task details panel whitespace and layout look intentional and consistent (the makeover across the panel's header, sections, and footer).
3. Existing timer/task behavior, state updates, and tests are preserved (no data or behavioral regressions).

## Context

- Files: `src/components/TimerPanel.tsx`, `src/components/ProjectManager/TaskInspector.tsx`
- Code Snippets:

Panel container in `src/components/TimerPanel.tsx` (lines 653–694) — the `<aside>` uses `md:h-full` while the TimerPanel root uses `min-h-full`:

```tsx
<aside
    className={
        "overflow-hidden bg-neutral-950/95 backdrop-blur " +
        "md:relative md:z-auto md:h-full md:translate-x-0 md:transition-[width] md:duration-200 md:ease-out " +
        (detailsOpen ? "md:w-80 md:border-l md:border-neutral-800 " : "md:w-0 md:pointer-events-none ") +
        "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[min(20rem,100vw)] max-md:shadow-2xl max-md:transition-transform max-md:duration-200 max-md:ease-out " +
        (detailsOpen ? "max-md:translate-x-0" : "max-md:translate-x-full max-md:pointer-events-none")
    }
    id="timer-task-details-panel"
    aria-hidden={!detailsOpen}
>
    {detailsOpen && (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 text-[11px] uppercase tracking-wide">
                <span className="font-medium text-neutral-300">Task details</span>
                {/* ... */}
            </div>
            {unassigned && (/* banner */)}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {inspectorTask ? (
                    <TaskInspector key={inspectorTask.id} />
                ) : (
                    <div className="h-full flex items-center justify-center px-6 text-[11px] text-neutral-500">{emptyDetailsMessage}</div>
                )}
            </div>
        </div>
    )}
</aside>
```

TaskInspector root layout in `src/components/ProjectManager/TaskInspector.tsx` (lines 86–87, 249, 257):

```tsx
<div className="flex flex-col h-full text-xs">
    {/* header section */}
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* When / Estimate & Time / Details / Checklist sections */}
    </div>
    <div className="p-3 border-t border-neutral-800 text-[10px] flex flex-wrap gap-2 items-center">
        {/* Created / Updated / Archive Task */}
    </div>
</div>
```

Height chain in `src/App.tsx` (lines 95, 98, 155, 157):

```tsx
<div className="flex flex-col h-screen overflow-hidden bg-neutral-950 ...">
    <TopNav />
    <UnsyncedBanner />
    <div className="flex-1 min-h-0"><Outlet /></div>
</div>
// MainLayout (desktop):
<div className="flex h-full">
    <aside ...>...</aside>
    <main className="flex-1 flex p-4 min-h-0 overflow-y-auto"><TimerPanel /></main>
</div>
```

The TimerPanel root in `src/components/TimerPanel.tsx` (line 511) uses `min-h-full` rather than `h-full`, which is the suspected source of the vertical-fill issue:

```tsx
<div className="w-full min-h-full flex m-auto">
```

## Notes

- No test exists for `TaskInspector`; `src/components/TimerPanel.test.tsx` covers the timer panel. Verification is largely visual/manual plus `pnpm run build` and unit/smoke checks.
- Screenshot from the original report shows the right-side panel with the "TASK DETAILS" header, closed without filling the right column's full height.
