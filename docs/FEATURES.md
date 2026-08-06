Summary: This repository implements a cross-platform Pomodoro-style time tracker with a Project Manager, task syncing, analytics, sounds, and Tauri-backed persistence and native integrations.

# WorkTime — Features & Workflows 🔧

## Overview

**WorkTime** is a Tauri + React + TypeScript desktop/web app for Pomodoro-style time tracking with integrated **Project Manager**, **Tasks**, **Analytics**, **Settings**, and **notifications/sounds**.

---

## Main UI pages & components 🔭

-   **Timer** — `src/components/TimerPanel.tsx` (main timer controls, start/pause/stop, task association)
-   **Task panel & sidebar** — `src/components/TaskPanel.tsx`, `src/components/ProjectManager/ProjectsSidebar.tsx` (quick add tasks, select active task)
-   **Project Manager** — `src/components/ProjectManager/*` (includes `ProjectManagerPage.tsx`, `TasksBoardView.tsx`, `TasksListView.tsx`, `TaskInspector.tsx`)
-   **Analytics** — `src/components/AnalyticsPage.tsx` (charts and metrics powered by `recharts`)
-   **Settings** — `src/components/SettingsPanel.tsx` (reset, preferences, agent BYOK key)
-   **Hooks & assets** — `src/hooks/useSounds.ts`, `src/assets/audio/`

---

## State & integration 🔗

-   Global app state & timer logic: `src/state/AppStateContext.tsx`
-   Project Manager state & APIs: `src/state/ProjectManagerContext.tsx`
-   Sync bridge: `src/state/StateSyncBridge.tsx` (propagates PM changes to persistence and task targets)
-   Native backend & persistence: `src-tauri/` (Rust `main.rs`, `lib.rs`, `tauri.conf.json`) — provides file persistence, native notifications and CLI-style commands

---

## Features (with implementation hints) 🧩

-   **Pomodoro timers** (start/pause/stop, session logging) — `TimerPanel.tsx`, `AppStateContext.tsx`
-   **Projects & Tasks management** (create, board/list views, edit metadata) — `ProjectManager/*`
-   **Task estimate & sync** between PM and underlying task store — `StateSyncBridge.tsx`, `ProjectManagerContext.tsx`
-   **Analytics & reports** (time distribution, trends, filters) — `AnalyticsPage.tsx`
-   **Settings & reset** — `SettingsPanel.tsx`
-   **Agent BYOK settings** — `src/lib/agent/` and `SettingsPanel.tsx`; the frontend-only key uses the intentional `worktime:agent:apiKey` localStorage exception, while the selected OpenAI/DeepSeek provider uses `worktime:agent:provider`. Both are entered/configured separately in PWA and Tauri.
-   **Sounds & notifications** — `useSounds.ts`, `@tauri-apps/plugin-notification`
-   **Dev sample data** — `dev-data/data.json`

---

## Primary user workflows 🔁

1. **Create a project & add tasks**
    - Open Project Manager → Create project (`ProjectManagerPage.tsx`) → Add tasks (board/list) → task appears in PM state and sidebar
2. **Start a focused session**
    - Select a task in the sidebar → Start timer (`TimerPanel.tsx`) → session completes and logs via Tauri persistence
3. **Sync estimates / keep metadata consistent**
    - Edit a task estimate → `StateSyncBridge.tsx` propagates change → backend persistence refreshed
4. **Inspect productivity**
    - Navigate to Analytics → apply filters → review charts and metrics (`AnalyticsPage.tsx`)
