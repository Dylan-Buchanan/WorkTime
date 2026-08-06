## Title: Agentic planning assistant — End-of-Day workflow

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Cross-file/cross-system feature in the new agentic planning subsystem. Blast Radius=4 (EOD workflow spans plan persistence read, diff-engine use, LLM transport, ProjectManagerContext reorder mutation, StateSyncBridge completed-state integration, and UI summary output — 10+ files, cross-system), Uncertainty=3 (depends on sibling issues not yet built — Start-of-Day persistence key/format, diff engine API, guardrails, context builder, LLM transport, approval-loop UI — so interfaces are unknown; EOD output semantics also need definition), Behavior=4 (data-driven complex workflow: diffs a persisted plan against completed state, LLM-generated reprioritization + tomorrow summary, plus state mutation via reorderTasks), Testing=2 (pure diff logic fits the `src/lib/engine` Vitest pattern, but LLM summary generation and reorder write-back integration are hard to test, with high user impact if priorities are corrupted), Reversibility=2 (reprioritization rewrites persistent sortOrder, so revert needs restore/coordination). Total=15 → T3.
Needs research before implementation: Yes — the Start-of-Day plan persistence key and serialized format (agent localStorage), the diff engine + guardrail API contract, the LLM transport interface and how EOD summaries are generated, how completed state is sourced (StateSyncBridge Done-marking timing), and the approval-loop UI surface where the tomorrow overview is presented.

## Summary

Add the End-of-Day wrap-up workflow: the agent diffs the stored Start-of-Day plan against what was actually completed, reprioritizes remaining tasks for tomorrow, and returns a summary of what tomorrow looks like.

## Steps to Reproduce Context

1. User ran Start of Day earlier (a stored plan exists in the agent localStorage key).
2. User opens the Project Manager and runs End of Day → no workflow exists today.

## Expected Behavior

- Diffs the stored Start-of-Day plan against completed state.
- Reprioritizes remaining tasks for tomorrow.
- Returns a tomorrow overview summary.
- The agent never proposes Done transitions (the timer flow owns that), though status values include Done for EOD output.

## Actual Behavior

No EOD workflow exists. The Project Manager exposes PM tasks with status/priority/dueDate/estimate/checklist/relatedTo, but all planning and reprioritization is manual. There is no stored Start-of-Day plan to diff against, no LLM transport, and no agent UI.

## Requirements for completed issue

1. Diffs the stored Start-of-Day plan against completed state.
2. Reprioritizes remaining tasks for tomorrow.
3. Returns a tomorrow overview summary.

## Context

- Files:
  - `src/state/StateSyncBridge.tsx` — auto-marks PM tasks Done when backend tasks complete (lines ~294–304); the EOD diff reads completed state from this derived status/workedPomos.
  - `src/state/types.ts` — `PMTask.status` can be `Done`; `sortOrder` is reprioritized via `reorderTasks`.
  - `src/state/ProjectManagerContext.tsx` — `reorderTasks` mutation for the reprioritization write-back.
  - `src/lib/engine/` — pure-module + Vitest pattern for the plan-diff logic.
- Code Snippets:

```
// src/state/StateSyncBridge.tsx — auto-Done when the backend task completes
if (backend.completed_at && pmTask.status !== "Done") {
    updateTaskRef.current(pmTask.id, { status: "Done" as TaskStatus });
}
```

## Notes

- This is dependency slice #8 of the agentic planning assistant split; requires the Start-of-Day workflow (which persists the plan), diff engine + guardrails, context builder, LLM transport, and approval-loop UI.
- The agent never proposes Done transitions (the timer flow owns that); status values include Done for EOD output only.
