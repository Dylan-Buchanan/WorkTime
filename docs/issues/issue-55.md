## Title: Agentic planning assistant — diff engine & guardrail enforcement

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New pure diff/guardrail module in `src/lib/engine/` following the established `core.ts` pattern plus a Vitest suite, exported via `index.ts` and likely touching `src/state/types.ts` for the proposed output schema (`splitsFrom?`/`rationale?`). Blast Radius=2 (2-5 files: new module, test file, index export, types additions; no consumer wiring to the ProjectManagerContext mutation surface yet), Uncertainty=2 (issue well-specified but output schema shape, workedPomos input contract, and diff edge cases such as reorder-vs-update disambiguation and status handling have moderate unknowns), Behavior=3 (complex diff/reconciliation logic with guardrail enforcement, not a data model or infra change), Testing=1 (explicitly unit-tested pure module in the existing Vitest harness; deterministic inputs, moderate impact if wrong), Reversibility=1 (new isolated module, no data writes or migrations; simple revert). Total=9 → T2.
Needs research before implementation: Yes — confirm whether `splitsFrom`/`rationale` live on a new ProposedTask type or as optional fields on PMTask; define the pure module's input contract (how workedPomos and the current snapshot are passed in, whether ids/updatedAt are caller-supplied); nail down classification edge cases (update vs reorder vs status transition, archive-vs-delete for removals, and how the no-changes-needed result is represented).

## Summary

Add a pure, unit-tested module that diffs the model's target snapshot against current PM state into an ordered list of one-at-a-time changes (create / update / split / remove / reorder) and mechanically enforces the agent guardrails.

## Steps to Reproduce Context

1. (Once the agent exists) the Start-of-Day / End-of-Day workflows and chat proposals need a model target snapshot turned into approval cards.
2. Today all PM mutations are manual; there is no module that computes a change list from a target state and no guardrail enforcement.

## Expected Behavior

- Diffs the model's target snapshot against current state into an ordered change list classified as create / update / split / remove / reorder; array order of proposedTasks is the planned work order.
- Uses `splitsFrom` to group creates into explicit split cards; "remove" maps to `archiveTask`.
- Mechanically enforces guardrails: blocks splits of tasks with workedPomos > 0; requires non-empty rationale for estimate increases; flags forward due-date changes on the card.
- Detects the "no changes needed" case (valid completion, snapshot discarded).

## Actual Behavior

No diff engine or guardrail enforcement exists. The Project Manager exposes PM tasks with status/priority/dueDate/estimate/checklist/relatedTo, but all planning, splitting, and estimate-accuracy feedback is manual. The proposed output schema (`splitsFrom?`, `rationale?`, `Done` status for EOD output only, absence-of-id = removal) is not implemented anywhere.

## Requirements for completed issue

1. Pure module that diffs the model's target snapshot against current state into an ordered change list classified as create / update / split / remove / reorder, with array order of proposedTasks as the planned work order.
2. Uses `splitsFrom` to group creates into explicit split cards; "remove" maps to archiveTask.
3. Mechanically enforces guardrails: blocks splits of tasks with workedPomos > 0; requires non-empty rationale for estimate increases; flags forward due-date changes on the card.
4. Detects the "no changes needed" case (valid completion, snapshot discarded).

## Context

- Files:
  - `src/state/types.ts` — `PMTask` surface the diff operates on (id, title, status, priority, dueDate, estimatePomos, workedPomos, checklist, sortOrder, isArchived, appTaskId, relatedTo).
  - `src/state/ProjectManagerContext.tsx` — mutation surface the change list maps to: `createTask` (async; creates a backend AppState task and dedupes PM rows via appTaskId), `updateTask` (stamps updatedAt), `archiveTask` (sets isArchived), `reorderTasks`, `moveTaskToStatus`.
  - `src/state/StateSyncBridge.tsx` — `workedPomos` derivation (lines ~241–291) feeds the split-with-progress guardrail; auto-Done (lines ~294–304) means the agent never proposes Done transitions.
  - `src/lib/engine/` — pure-module + Vitest pattern (`core.ts`, `engine.test.ts`) to mirror.
- Code Snippets:

```
// src/state/types.ts — the PM task surface the diff operates on
export interface PMTask {
    id: string;
    title: string;
    projectId: string | null;
    status: TaskStatus;             // Backlog | Next | In Progress | Blocked | Done
    priority: TaskPriority;         // Low | Medium | High
    dueDate?: string;
    estimatePomos?: number;
    workedPomos?: number;           // derived from timer logs via appTaskId
    checklist: { id: string; title: string; done: boolean }[];
    sortOrder: number;
    isArchived: boolean;
    appTaskId?: string;             // linked timer task
    relatedTo: string[];            // prerequisite task ids
}
```

## Notes

- Proposed output schema: each `proposedTasks` item gains `splitsFrom?: string` (id of the original task it was split from) and `rationale?: string` (model-authored reason; required for estimate increases); status values include `Done` for EOD output but the agent never proposes `Done` transitions (the timer flow owns that); array order = planned work order; absence of a current task id in the array = removal (→ archive).
- Guardrail handling: all changes require approval anyway, so guardrails are enforced by (a) diff-engine mechanics (block/flag) and (b) card presentation (date-direction and estimate-increase flags with rationale visible) — presentation is owned by the approval-loop UI issue.
- This is dependency slice #3 of the agentic planning assistant split.
