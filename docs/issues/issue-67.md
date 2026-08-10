## Title: Improve UI flow and responsiveness for mobile devices and small windows

## Tags

Complexity Classification: T2
Severity: High
Reason: Broad cross-cutting responsive UI refactor spanning 14+ files across all authenticated routes (shell, nav, timer, task, settings, project manager and its sub-views, analytics, habits, sync controls). No data, infra, or business-logic impact, but requires new interaction states (collapsible sidebars/drawers, touch handling) and viewport-level verification.
Needs research before implementation: No

## Summary

The application is not designed mobile-first. Almost every authenticated view uses fixed-width sidebars arranged in horizontal flex rows with no responsive breakpoints, so on mobile viewports and small windows the UI is cramped, overflows, or hides entire panels. The layout must be reworked so the timer, projects, analytics, and habits views remain usable at narrow widths.

## Steps to Reproduce Context

1. Open the app in a browser at a narrow viewport (e.g., ~375px wide) or resize a Tauri window to a small size.
2. Visit the Timer route (`/`).
3. Visit the Projects route (`/projects`).
4. Visit the Analytics (`/analytics`) and Habits (`/habits`) routes.

## Expected Behavior

- All routes remain usable at mobile and small-window widths without horizontal page overflow.
- Fixed sidebars collapse or become accessible drawers on small screens; no essential panel is hidden without an alternative way to open it.
- The navigation bar wraps or collapses gracefully instead of overflowing.
- Interactive controls are large enough to be touch-friendly and usable without hover.

## Actual Behavior

- **Timer route:** `MainLayout` renders a fixed `w-72` (288px) task/settings sidebar beside the timer (`App.tsx`), consuming most of a mobile viewport and leaving little room for the timer. The timer's own `w-72 h-72` progress ring and its `w-80` task-details slide-over add more fixed width.
- **Nav bar:** `TopNav` places 4 nav links plus sync controls and a sign-out button in one horizontal row (`App.tsx`), which overflows and crowds a narrow window.
- **Projects route:** `ProjectManagerPage` uses three columns — a fixed `w-64` ProjectsSidebar, the task list/board, and a `w-80` TaskInspector that is only `hidden xl:block`. Below the xl breakpoint the inspector disappears with no toggle/drawer to reopen it, and the `w-64` sidebar still consumes most of a mobile width. The top quick-add/toggle bar also crowds narrow widths.
- **Analytics route:** tables use minimum column widths (`min-w-[100px]`/`min-w-[120px]`) that overflow horizontally without a containing scroll wrapper.
- **General:** Dense inline layouts with `text-[10px]`/`text-[11px]` text and small hover-dependent controls appear throughout `TaskPanel`, `SettingsPanel`, and the board views. Only 6 responsive breakpoints exist in the entire codebase (all in Analytics, Habits, and the auth layout).

## Requirements for completed issue

1. All authenticated views (Timer, Projects, Analytics, Habits) render and function without horizontal page overflow at mobile and small-window widths.
2. Fixed-width sidebars/panels either adapt to narrow widths or collapse behind accessible toggles/drawers; no panel that is hidden on small screens is unreachable without an alternative way to open it.
3. The top navigation bar wraps or collapses gracefully on narrow viewports so all destinations remain reachable.
4. Primary interactive controls are usable without hover and sized appropriately for touch (larger hit targets, no reliance on `onMouseEnter` alone for core actions).
5. Existing functionality, timer/task semantics, and the current engine behavior remain unchanged.

## Context

- Files:
  - `src/App.tsx` — `AuthenticatedShell` (`h-screen` shell), `TopNav`, and `MainLayout` with the fixed `w-72` sidebar + timer layout.
  - `src/components/TimerPanel.tsx` — fixed `w-72 h-72` ring, `w-80` task-details slide-over, hover-dependent controls.
  - `src/components/TaskPanel.tsx` and `src/components/SettingsPanel.tsx` — dense tiny-text, hover-dependent layouts.
  - `src/components/ProjectManager/ProjectManagerPage.tsx` — three-column layout, `hidden xl:block` inspector, crowded top bar.
  - `src/components/ProjectManager/ProjectsSidebar.tsx`, `TasksBoardView.tsx`, `TaskInspector.tsx`, `AgentPanel.tsx` — sidebar/board/drawer behavior.
  - `src/components/AnalyticsPage.tsx` — tables with `min-w-[100px]`/`min-w-[120px]` columns.
  - `src/components/HabitsPage.tsx` — some `md` breakpoints, overflow-x habit grids.
  - `src/components/SyncControls.tsx` — modals with fixed widths.
  - `src/components/auth/AuthPageLayout.tsx` — already reasonably responsive (`max-w-md`, `sm:p-8`).
  - `tailwind.config.js` — default breakpoints, no custom configuration.

- Code Snippets:
  - `src/App.tsx` `MainLayout` (lines 119-124): fixed sidebar next to timer in a horizontal flex row with no responsive breakpoint.
    ```tsx
    const MainLayout: React.FC = () => (
        <div className="flex h-full">
            <aside className="w-72 border-r border-neutral-800 p-3 flex flex-col gap-6 overflow-y-auto bg-neutral-900/30 backdrop-blur-sm"><TaskPanel /><SettingsPanel /></aside>
            <main className="flex-1 flex items-center justify-center p-4 min-h-0"><TimerPanel /></main>
        </div>
    );
    ```
  - `src/components/ProjectManager/ProjectManagerPage.tsx` (lines 112-131): fixed sidebar and inspector columns, with the inspector only shown at `xl`.
    ```tsx
    <div className="flex flex-1 min-h-0">
        <div className="w-64 border-r border-neutral-800 p-2 flex flex-col"><ProjectsSidebar /></div>
        <div className="flex-1 min-w-0 p-2 overflow-hidden">{/* list/board */}</div>
        <div className="w-80 border-l border-neutral-800 p-2 hidden xl:block"><TaskInspector /></div>
    </div>
    ```
  - `src/App.tsx` `TopNav` (lines 104-116): single horizontal row of nav links plus `ml-auto` sync/sign-out controls.

## Notes

- The app is a Windows Tauri desktop app whose webview shares the same responsive React UI with the browser PWA, so fixes apply to both surfaces.
- There are no screenshot/visual tests today; verifying responsive behavior will likely require viewport-level checks rather than existing unit tests.
