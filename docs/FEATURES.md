Summary: This repository implements a cross-platform Pomodoro-style time tracker with a Project Manager, task syncing, Goals, analytics, sounds, Supabase-backed data, and native integrations.

# WorkTime — Features & Workflows 🔧

## Overview

**WorkTime** is a Tauri + React + TypeScript desktop/web app for Pomodoro-style time tracking with integrated **Project Manager**, **Tasks**, **Goals**, **Analytics**, **Settings**, and **notifications/sounds**.

---

## Main UI pages & components 🔭

-   **Timer** — `src/components/TimerPanel.tsx` (main timer controls, start/pause/stop, task association)
-   **Task panel & sidebar** — `src/components/TaskPanel.tsx`, `src/components/ProjectManager/ProjectsSidebar.tsx` (quick add tasks, select active task)
-   **Project Manager** — `src/components/ProjectManager/*` (includes `ProjectManagerPage.tsx`, `TasksBoardView.tsx`, `TasksListView.tsx`, `TaskInspector.tsx`)
-   **Analytics** — `src/components/AnalyticsPage.tsx` (charts and metrics powered by `recharts`)
-   **Goals** — `src/components/GoalsPage.tsx`, `src/components/goals/*` (trackers, period check-ins, deck preview, PowerPoint and goal-set exports)
-   **Settings** — `src/components/SettingsPanel.tsx` (reset, preferences, agent BYOK key)
-   **Hooks & assets** — `src/hooks/useSounds.ts`, `src/assets/audio/`

---

## State & integration 🔗

-   Global app state & timer logic: `src/state/AppStateContext.tsx`
-   Project Manager state & APIs: `src/state/ProjectManagerContext.tsx`
-   Sync bridge: `src/state/StateSyncBridge.tsx` (propagates PM changes to persistence and task targets)
-   Application data: frontend-owned staging and Supabase sync through `src/lib/data/`, including goal trackers, goals, and check-ins; duplicate check-ins for the same goal and period reconcile, and the latest built-period marker never moves backwards
-   Native shell: `src-tauri/` (Rust `main.rs`, `lib.rs`, `tauri.conf.json`) — only the opener and notification plugins; no native application-data path

---

## Features (with implementation hints) 🧩

-   **Pomodoro timers** (start/pause/stop, session logging) — `TimerPanel.tsx`, `AppStateContext.tsx`
-   **Projects & Tasks management** (create, board/list views, edit metadata) — `ProjectManager/*`
-   **Task estimate & sync** between PM and underlying task store — `StateSyncBridge.tsx`, `ProjectManagerContext.tsx`
-   **Analytics & reports** (time distribution, trends, filters) — `AnalyticsPage.tsx`
-   **Settings & reset** — `SettingsPanel.tsx`
-   **Agent BYOK settings** — `src/lib/agent/` and `SettingsPanel.tsx`; the frontend-only key uses the intentional `worktime:agent:apiKey` localStorage exception, while the selected OpenAI/DeepSeek provider uses `worktime:agent:provider`. Both are entered/configured separately in PWA and Tauri.
-   **Agent workflow undo snapshot** — `worktime:agent:projectSnapshot:v1` is an intentional surface-local localStorage exception outside the synced staging store. It keeps only the latest selected-project pre-workflow task snapshot for manual revert; deployed PWA and Tauri surfaces retain separate copies by origin.
-   **Sounds & notifications** — `useSounds.ts`, `@tauri-apps/plugin-notification`
-   **Dev sample data** — `dev-data/data.json`

---

## Primary user workflows 🔁

1. **Create a project & add tasks**
    - Open Project Manager → Create project (`ProjectManagerPage.tsx`) → Add tasks (board/list) → task appears in PM state and sidebar
2. **Start a focused session**
    - Select a task in the sidebar → Start timer (`TimerPanel.tsx`) → session completes and logs through frontend staging and Supabase sync
3. **Sync estimates / keep metadata consistent**
    - Edit a task estimate → `StateSyncBridge.tsx` propagates change → staged data and Supabase sync updated
4. **Inspect productivity**
    - Navigate to Analytics → apply filters → review charts and metrics (`AnalyticsPage.tsx`)

---

## Goals

-   **Trackers & cadence** — Group goals in a named tracker with a purpose, color, and every-n-weeks or monthly-weekday cadence. Periods follow an anchored local-date grid. Archive and reactivate trackers while keeping their goals and history; goals can be active, achieved, or dropped.
-   **Period check-ins** — Use the wizard to record an On track / At risk / Blocked status pill, Did, Current, Planned items with optional due dates, focus, and a miss reason. “Did not do” compares earlier planned items with the current Did entries rather than adding a separate completion field.
-   **Project evidence** — Link a goal to a project to review completed-task suggestions with accept/reject checkboxes and a period hours rollup. Accepted evidence task IDs are saved with the check-in. Evidence is best effort: only tasks finalized through the timer are visible. In Progress task titles can prefill an empty Current field for the open period; manual edits freeze the prefill until an explicit Refresh suggestions action.
-   **Review decks** — Build a deck for the most recent completed period and preview it in the app. Reorder goal recaps, hide slides, edit text and speaker notes, or promote recaps to the appendix; thin-content warnings help identify gaps. Preview edits stay in memory for that deck build.
-   **PowerPoint export** — Download a `.pptx` with editable text, chart images, and speaker notes including suggested speaking seconds. The tracker is marked built only after download initiation succeeds. Export generation loads on demand in the browser/webview. Installed WebView2 download and editable text in PowerPoint were human-verified on 2026-11-01.
-   **Portable goal sets** — Export tracker and goal definitions to a dated `goals-<tracker>-<YYYY-MM-DD>.json` download, then review an import before creating it. Every import creates a new tracker and fresh goal IDs; it never merges or replaces existing trackers. Project links missing locally are cleared. Check-in history, evidence selections, build markers, and current metric progress are not transferred.

---

## Waiting and task switching

-   **Fixed work window** — A Work pomodoro is a fixed wall-clock window. Switching to another task mid-window hands the remainder to the new task instead of restarting the timer; starting work on another task joins a live window, while a break still refuses. The per-task partial-progress resume map is retired. The discard button is now labelled “End focus”.
-   **Automatic In Progress** — Starting work on a Backlog or Next task moves it to In Progress from every start path.
-   **Waiting state** — A task can be marked Waiting on an agent or a person from the TaskInspector Waiting toggle. Waiting is separate from status, and clears when the task is marked Done, archived, or becomes the active task.
-   **Waiting indicators** — The timer pill shows a WAITING · AGENT / PERSON badge with an × to clear it. Task lists and Today show waiting dots, and waiting tasks are pinned to the top of Today.
-   **What's next** — A ranking suggests a top pick, a quick win, and next-up tasks, with other options listed below.
-   **Switch and Waiting… sheet** — The timer page's Switch and Waiting… buttons open an overlay sheet that hands the running window to another task in two clicks.
-   **Window-aware logs** — Pomodoro logs carry a `work_window_id` (migration `20261108000000_log_work_window_id.sql`), and the Today pomodoro summary counts windows rather than log rows.
-   **Upgrade note** — Users with a saved partial-pomodoro resume position lose only that resume position on upgrade (staging schema v10). Pomodoros already credited are untouched. The Today summary now counts a switched window as one pomodoro.
