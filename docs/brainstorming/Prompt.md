I have a pomodoro app that I run on my windows PC. I want to add an agentic workflow that looks through my tasks for the day and returns the order in which I should work on things and specifically the work I should get done. Similarly at the end of the day I want to run a flow that follows up and compares the state of things at the start of the day to the end of the day and then prepares things for tomorrow. These workflows are started manually by the user. Your task is to ask me clarifying questions so I can understand more specifically what I want this new feature to do and how to do it.

Task Definition:

- id: string - Unique identifier
- title: string - Task title displayed in lists and inspectors
- projectId: string | null - Reference to associated project, null for tasks without project assignment
- status: TaskStatus - Current workflow status ("Backlog" - not critical, "Next" - should work on next, "In Progress" - currently being worked on, "Blocked" - something preventing progress that the user has no control over, "Done" - completed task)
- priority: TaskPriority - Importance level ("Low", "Medium", "High")
- dueDate?: string - Optional due date in ISO date format (YYYY-MM-DD)
- estimatePomos?: number - Optional estimated pomodoro sessions for completion
- timeSpentMinutes: number - Total accumulated time spent in minutes
- workedPomos?: number - Pomodoros completed based on timer log calculations (time spent / 25 minutes)
- lastWorkedAt?: string - ISO timestamp of most recent work session
- description?: string - Optional markdown-formatted notes and details
- tags: string[] - Array of string tags for categorization and filtering
- links: string[] - Array of URL strings for related resources
- checklist: { id: string; title: string; done: boolean }[] - Array of subtasks with completion tracking
- sortOrder: number - Numeric value determining display order in lists
- isArchived: boolean - Flag for archiving tasks from active views
- createdAt: string - ISO timestamp of task creation
- updatedAt: string - ISO timestamp of last modification
- appTaskId?: string - Optional reference to linked basic Task for timer integration
- relatedTo: string[] - Array of task IDs that must be done before this task

Core Objectives:

1. Removing indecision at the start of the day
2. Mitigating friction with mid-day context switching
3. Preventing under-scoping work inside a pomodoro
4. Allowing the agent to learn from time estimate accuracy to improve accuracy in future estimates

Ideal Outcome:

1. Fewer unfinished tasks
2. Fewer task switches (bouncing between different tasks when a task isn't completed)
3. Clearer sense of progress and understanding of what to do next at the end of a day

Scope for the Agent:

1. A combination of throughput and deep progress is ideal. I want to balance easy wins and larger tasks so that I don't get behind on either front
2. Communicate back and forth with the user so that any changes or additions are approved by the user
3. Agent Actions: Add tasks, modify task due dates, modify task checklists, split a task into multiple tasks (requires removing a task and adding new ones. Removing a task in any other context is not allowed), modify task estimates, and prioritize tasks
4. Removing tasks is also allowed in the case that a task is no longer relevant or needed
5. If the user disagrees, it should be a 1 click disagreement
6. The agent should reason in pomodoros (25 minute units)
7. A single task can rollover to the next day but should be planned for multi-day completion. A task should be split into multiple tasks otherwise
8. The scope the agent should focus on will only be within the project selected by the user
9. Any task that is greater than 4 pomodoros should be split into multiple tasks. 4 pomodoros and below and the checklist should be used instead for subtasks. Checklist subtasks do not need time estimates. The agent should re-evaluate the estimated time for each new task instead of focusing on splitting the original estimate evenly.
10. The agent can pull tasks from all task statuses

Input:

1. All tasks for the current project with their current states and metadata
2. Current date and time
3. User selection of the time of day to work till

Output:

- JSON schema:

```json
{
    "proposedTasks": [
        {
            "id": "string",
            "title": "string",
            "description": "string",
            "dueDate": "string (ISO date format YYYY-MM-DD) | null",
            "estimatePomos": "number | null",
            "checklist": [
                {
                    "id": "string",
                    "title": "string",
                    "done": "boolean"
                }
            ],
            "priority": "Low | Medium | High",
            "status": "Backlog | Next | In Progress | Blocked | Done"
        }
    ],
    "summary": "string"
}
```

Where:

Agent UX:

The agent should proposed one change at a time to the user. An example of one change would be the creation of a task, the splitting up of a task, or the removal of a task. The user can either approve or reject the change. If approved, the agent will then propose the next change until the workflow is complete. If rejected, the agent will propose an alternative change until the workflow is complete. There should be a snapshot created at before the workflow is initiated so that the user can revert back to the original state if they are unhappy with the final result.

Hard Guardrails:

1. Never change due dates forward without explicit user approval
2. Never increase task estimates without explaining why to the user
3. The agent does NOT need to make any changes if the tasks are already planned out well
4. Tasks that are already being worked on (>0 pomodoros worked) should not be split.

End of Day Workflow:

1. It should comapre planned tasks vs. completed tasks
2. The agent should re-evaluate the remaining tasks for tomorrow and reprioritize them based on what was learned today or change them to better fit tomorrow
3. On top of proposing tasks for tomorrow, the agent should return an overview of what tomorrow will look like as a nice summary

LLM Integration:

1. Inference will run locally using llama-cpp
2. My PC has 16GB of VRAM and 32 GB. All LLMs will be hand picked and downloaded by me stored as GGUFs at `C:\Users\dylan\Desktop\Coding\LLMs`
3. All outputs will be strict JSON schema
4. The tasks will typically only be around 5-30 tasks per project at once however completed tasks could scale to thousands. Since completed tasks are only used for estimate accuracy training signals, only the last 90 days of completed tasks need to be considered by the agent
5. Determinism is preferred for the output, but creativity is also needed for task splitting and rephrasing task titles. Splitting these two personas is a requirement for ensuring I can get the most out of this workflow

Other Information:

1. Tasks are flat text (no types)
2. All tasks have the ability for soft deadlines but can be open ended
3. Tasks have a "related to" field that links them to other tasks. The agent should treat this as "the task that must be done before this task can be done"
4. I am planning on the UI to interact with this agent to be available when a project is selected. The user can then choose to run the "start of day" or "end of day" workflows from there.
5. There are no time constraints on runtime for an agent
6. Project state is the set of tasks and their current statuses with metadata
7. Checklist items are just subtasks
8. This is not an automated workflow in that the agent will run everyday by itself, but rather one initiated by the user when they choose to do so
9. The training signal to use is estimated pomodoros vs. actual pomodoros worked

I do not plan on releasing this app, I am only using it for myself so I can specify everything to my needs. I made it using Tauri. I imagine I would use llama-cpp to run a model feeding in information from my tasks and current project states. I am thinking this agentic workflow will be "per project" meaning it the LLM will be focused on the specific project I choose.

Here is an overview of my app currently:
Implements a cross-platform Pomodoro-style time tracker with a Project Manager, task syncing, analytics, sounds, and Tauri-backed persistence and native integrations.

# WorkTime — Features & Workflows 🔧

## Overview

**WorkTime** is a Tauri + React + TypeScript desktop/web app for Pomodoro-style time tracking with integrated **Project Manager**, **Tasks**, **Analytics**, **Settings**, and **notifications/sounds**.

---

## Main UI pages & components 🔭

- **Timer** — `src/components/TimerPanel.tsx` (main timer controls, start/pause/stop, task association)
- **Task panel & sidebar** — `src/components/TaskPanel.tsx`, `src/components/ProjectManager/ProjectsSidebar.tsx` (quick add tasks, select active task)
- **Project Manager** — `src/components/ProjectManager/*` (includes `ProjectManagerPage.tsx`, `TasksBoardView.tsx`, `TasksListView.tsx`, `TaskInspector.tsx`)
- **Analytics** — `src/components/AnalyticsPage.tsx` (charts and metrics powered by `recharts`)
- **Settings** — `src/components/SettingsPanel.tsx` (reset, preferences)
- **Hooks & assets** — `src/hooks/useSounds.ts`, `src/assets/audio/`

---

## State & integration 🔗

- Global app state & timer logic: `src/state/AppStateContext.tsx`
- Project Manager state & APIs: `src/state/ProjectManagerContext.tsx`
- Sync bridge: `src/state/StateSyncBridge.tsx` (propagates PM changes to persistence and task targets)
- Native backend & persistence: `src-tauri/` (Rust `main.rs`, `lib.rs`, `tauri.conf.json`) — provides file persistence, native notifications and CLI-style commands

---

## Features (with implementation hints) 🧩

- **Pomodoro timers** (start/pause/stop, session logging) — `TimerPanel.tsx`, `AppStateContext.tsx`
- **Projects & Tasks management** (create, board/list views, edit metadata) — `ProjectManager/*`
- **Task estimate & sync** between PM and underlying task store — `StateSyncBridge.tsx`, `ProjectManagerContext.tsx`
- **Analytics & reports** (time distribution, trends, filters) — `AnalyticsPage.tsx`
- **Settings & reset** — `SettingsPanel.tsx`
- **Sounds & notifications** — `useSounds.ts`, `@tauri-apps/plugin-notification`
- **Dev sample data** — `dev-data/data.json`

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
