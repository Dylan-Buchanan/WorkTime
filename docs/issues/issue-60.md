## Title: Agentic planning assistant — chat mode

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Chat mode is a cross-system orchestration layer. Blast Radius=4 (new chat UI, LLM transport integration, context builder over ProjectManagerContext + HabitContext, proposal/diff + approval-card wiring, agent panel mode-picker integration, tests — 10+ files across UI, state, and an external LLM service), Uncertainty=3 (depends on five sibling issues — LLM transport, context builder, diff engine, snapshot/revert, approval-loop UI — whose interfaces don't exist yet in the repo; none of the agent panel, mode picker, or any chat/LLM code is present today), Behavior=4 (complex state management and API-handler logic: free-form chat → LLM round-trip → proposal diffing → approved mutations of real pomodoro tasks via createTask/quickAddParse), Testing=2 (interactive chat requires a mocked LLM and approval-flow tests, and breaking it creates wrong/duplicate tasks with real user impact), Reversibility=2 (approved proposals mutate app task data and PM metadata; undo depends on the sibling snapshot/revert machinery). Total=15 → T3.
Needs research before implementation: Yes — define the sibling-issue interfaces chat mode consumes (LLM transport API shape, context builder output format, diff-engine proposal schema, approval-card contract, and snapshot/revert API); how the mode picker in the agent panel selects chat mode; and whether project-scoped vs general task creation (with/without an active project) is resolved client-side or by the LLM.

## Summary

Add free-form chat mode to the agentic planning assistant: the user can discuss issues using project task and habit context, and the agent can propose task changes through the same approval-card machinery, including creating pomodoro tasks (project-scoped or general) reusing `quickAddParse`.

## Steps to Reproduce Context

1. User opens the Project Manager, selects a project, and picks Chat from the agent panel's mode picker.
2. Today there is no chat surface, no LLM transport, and no way to ask the app to draft task changes.

## Expected Behavior

- Free-form chat that can pull context from project tasks and habits.
- Proposes task changes through the same approval-card machinery.
- Can create pomodoro tasks (project-scoped or general) reusing `quickAddParse`.

## Actual Behavior

No chat mode exists. `src/state/ProjectManagerContext.tsx` exports `quickAddParse` and provides `createTask`, and `src/state/HabitContext.tsx` holds habits/completions state, but there is no chat UI, no LLM transport, and no agent panel.

## Requirements for completed issue

1. Free-form chat that can pull context from project tasks and habits.
2. Proposes task changes through the same approval-card machinery.
3. Creates pomodoro tasks (project-scoped or general) reusing `quickAddParse`.

## Context

- Files:
  - `src/state/ProjectManagerContext.tsx` — `quickAddParse` (syntax: `title @project ^2024-01-01 #tag !high 3p`) and `createTask` (async; creates a backend AppState task and dedupes PM rows via appTaskId) used to create pomodoro tasks.
  - `src/state/HabitContext.tsx` — `state.habits` / `state.completions` for habit context.
  - `src/state/types.ts` — `Habit`, `HabitCompletion`, `PMTask`, `Task` types.
  - `src/components/ProjectManager/ProjectManagerPage.tsx` — where the agent panel (with mode picker) mounts; the panel and approval-card machinery are built in the approval-loop UI issue.
  - `src/lib/engine/` — pure-module + Vitest pattern.
- Code Snippets:

```
// src/state/ProjectManagerContext.tsx
export function quickAddParse(input: string): { task: Partial<PMTask>; projectName?: string };
// Syntax: `title @project ^2024-01-01 #tag !high 3p`
```

## Notes

- This is dependency slice #9 of the agentic planning assistant split; per the original design it can proceed in parallel with the approval-loop UI work once the transport, context builder, diff engine, and snapshot/revert exist.
- PWA vs. Tauri localStorage separation applies to the API key and snapshot (entered/taken per surface).
