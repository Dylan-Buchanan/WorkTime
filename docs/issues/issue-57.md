## Title: Agentic planning assistant — approval-loop UI

## Tags

Complexity Classification: T3
Severity: Medium
Reason: New cross-file frontend subsystem. Blast Radius=3 (new agent panel + approval card components, a new agent state provider, changes to ProjectManagerPage and SettingsPanel for BYOK, plus tests — roughly 8-10 files cross-module), Uncertainty=3 (no existing agent infrastructure; proposal generation, working-copy/snapshot semantics, guardrail computation, and API key storage are significant unknowns), Behavior=4 (complex state management across the approval flow, applying one-click approvals to live PM state via createTask/updateTask/reorderTasks, rejection-driven re-plan, and security-adjacent BYOK key handling), Testing=2 (approval/revert flows mutate real PM data, high user impact if wrong; component tests follow existing patterns but working-copy correctness is hard to verify), Reversibility=2 (in-flight workflows are intentionally not persisted, but applied approvals mutate real project/task data and the snapshot-based revert mechanism must be built and proven correct). Total=14 → T3.
Needs research before implementation: Yes — how agent proposals are generated and the LLM API contract; working-copy semantics (where the pre-approval snapshot lives — new localStorage key vs the existing `worktime:staging:v1` store — how "approved changes locked in" interacts with ProjectManagerContext's staged-save/reload cycle, and what survives app close); whether each proposed change type (create/update/split/remove/reorder) maps onto existing PMContext operations or requires new ones (note: PM has archiveTask but no hard delete); how guardrail flags (date direction, estimate increase with rationale) are computed; whether the agent panel must be hidden on public routes and how the authenticated shell mount point is preserved.

## Summary

Add the floating agent panel and approval-card UI to the Project Manager: a bottom-right panel (visible when a project is selected) with a mode picker (Start of Day / End of Day / Chat) and a setup state when no API key is configured, plus one-at-a-time approval cards with before→after, change type, guardrail flags, 1-click approve/reject, a progress indicator, and a revert banner after completion.

## Steps to Reproduce Context

1. User opens the Project Manager (`/projects`) with a project selected → no agent button appears bottom-right.
2. (Once workflows exist) the agent proposes changes → no UI to approve/reject them.

## Expected Behavior

- Floating agent panel bottom-right in Project Manager when a project is selected; mode picker (Start of Day / End of Day / Chat); setup state when no API key configured.
- Approval cards with before→after, change type, guardrail flags (date direction, estimate increase with rationale), 1-click approve/reject, progress indicator, revert banner after completion.
- Rejection triggers a re-plan over the working copy (already-approved changes locked in); in-flight workflows are not persisted across app close, but the snapshot remains for manual revert.
- Agent proposes exactly one change per card (create / update / split / remove / reorder), each with before→after and rationale; approval is one click.

## Actual Behavior

No agent surface exists. `src/components/ProjectManager/ProjectManagerPage.tsx` renders the quick-add header, ProjectsSidebar, list/board views, TaskInspector, and DebugInfo but no agent panel; `src/components/SettingsPanel.tsx` has no BYOK section. The codebase has no LLM transport, no agent persistence keys, and no approval UI.

## Requirements for completed issue

1. Floating agent panel bottom-right in Project Manager when a project is selected; mode picker (Start of Day / End of Day / Chat); setup state when no API key configured.
2. Approval cards with before→after, change type, guardrail flags (date direction, estimate increase with rationale), 1-click approve/reject, progress indicator, revert banner after completion.
3. Rejection triggers a re-plan over the working copy (already-approved changes locked in); in-flight workflows are not persisted across app close, but the snapshot remains for manual revert.
4. Each card proposes exactly one change (create / update / split / remove / reorder), each with before→after and rationale; approval is one click.

## Context

- Files:
  - `src/components/ProjectManager/ProjectManagerPage.tsx` — where the agent panel mounts (bottom-right, near the TaskInspector/quick-add layout); `src/components/ProjectManager/TaskInspector.tsx` is the adjacent task surface.
  - `src/components/SettingsPanel.tsx` — where BYOK key entry/clearing lives.
  - `src/state/ProjectManagerContext.tsx` — mutation surface used to apply approvals: `createTask`, `updateTask`, `archiveTask`, `reorderTasks`, `moveTaskToStatus`, `quickAddParse`, `ensureProjectByName`.
  - `src/App.tsx` — `/projects` route inside `AuthenticatedShell`; `DataProvider`/`AppStateProvider`/`ProjectManagerProvider`/`StateSyncBridge` stay behind the authenticated shell; the panel must not render on public auth routes.
  - `src/components/SyncControls.test.tsx` — existing Vitest component-test pattern.
- Code Snippets:

```
// src/state/ProjectManagerContext.tsx
export function quickAddParse(input: string): { task: Partial<PMTask>; projectName?: string };
// Syntax: `title @project ^2024-01-01 #tag !high 3p`
```

## Notes

- The approval cards consume the proposal format from the diff-engine issue (`splitsFrom?`, `rationale?`, guardrail flags) and the BYOK/setup state from the LLM transport issue.
- This is dependency slice #6 of the agentic planning assistant split. Per the original design, Start-of-Day plan persistence and chat mode can proceed in parallel with this UI work.
