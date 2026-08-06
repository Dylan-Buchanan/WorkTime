## Title: Agentic planning assistant — context builder & accuracy statistics

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New standalone pure module (e.g., `src/lib/engine/plannerContext.ts` style) with no existing consumers — grep confirms no agent/planner code exists yet. It reads existing, well-understood inputs (`ProjectManagerState.tasks`, `selectedProjectIds`, `PomodoroLogEntry[]`, `Settings`, `estimatePomos`/`workedPomos` derived in StateSyncBridge) and follows the established pure-module + Vitest pattern (`src/lib/engine/core.ts`, `src/lib/analytics.ts`). Blast Radius=2 (new module + test file, possible additive type in `src/state/types.ts`, no existing code modified), Uncertainty=2 (ratio definition and interface shape unanchored by a consumer; needs `now` injection for purity), Behavior=3 (filtering, work-until→pomodoro budget conversion, 90-day mean/median aggregation with priority/tag grouping and workedPomos>0 filter), Testing=1 (deterministic unit tests via `npm run test:unit`, standard pattern), Reversibility=1 (purely additive, trivially removable). Total=9 → T2.
Needs research before implementation: No — the codebase context covers the data shapes and derivation paths; open items (exact estimate-vs-actual ratio semantics, output shape, `now` parameterization) are design decisions for the requirements/planning phase rather than further codebase research.

## Summary

Add a pure, unit-tested module that builds the planner input for the agentic planning assistant from PM state, logs, and settings: non-archived tasks of the selected project, current date/time, a user-selected work-until window converted to a pomodoro budget, and 90-day estimate-accuracy aggregates. Raw completed tasks are never sent to the model — only aggregates.

## Steps to Reproduce Context

1. (Once the agent exists) the Start-of-Day / End-of-Day / chat workflows need a planner prompt input describing the selected project's tasks and work budget.
2. Today the Project Manager exposes the raw PM state but no module derives an agent-ready context or accuracy statistics.

## Expected Behavior

- Builds planner input from PM state + logs + settings: non-archived tasks of the selected project across all statuses, current date/time, user-selected work-until time converted to a pomodoro budget, and accuracy aggregates over the last 90 days (mean/median estimate-vs-actual ratio, sample count, optionally by priority/tag) filtered to tasks with workedPomos > 0.
- Raw completed tasks are never sent to the model; only aggregates.

## Actual Behavior

No agent context builder exists. `src/state/types.ts` defines all input types (`PMTask`, `Task`, `PomodoroLogEntry`, `Settings`, `Habit`), and `src/state/StateSyncBridge.tsx` (lines ~241–291) derives `workedPomos`/`timeSpentMinutes` from linked backend `completed_pomodoros`, but nothing aggregates accuracy or builds an LLM prompt context.

## Requirements for completed issue

1. Pure module (mirroring the `src/lib/engine/` pattern) that builds planner input from PM state + logs + settings: non-archived tasks of the selected project across all statuses, current date/time, user-selected work-until time converted to a pomodoro budget.
2. Accuracy aggregates over the last 90 days (mean/median estimate-vs-actual ratio, sample count, optionally by priority/tag) filtered to tasks with workedPomos > 0.
3. Raw completed tasks are never sent to the model; only aggregates.

## Context

- Files:
  - `src/state/types.ts` — `PMTask` (status, priority, dueDate, estimatePomos, workedPomos, timeSpentMinutes, checklist, relatedTo, appTaskId) and `ProjectManagerState`; also `Task`/`PomodoroLogEntry`/`Habit`/`Settings` types consumed by the builder.
  - `src/state/StateSyncBridge.tsx` — `workedPomos`/`timeSpentMinutes` are derived from linked backend `completed_pomodoros` (lines ~241–291); tasks never linked/worked have workedPomos 0 (the aggregate filter).
  - `src/state/ProjectManagerContext.tsx` — `state.ui.selectedProjectIds` selects the active project.
  - `src/lib/engine/` — pure-module + Vitest pattern (`core.ts`, `engine.test.ts`) to mirror; per AGENTS.md pure modules have no I/O, network, wall-clock, or random-ID dependencies in command inputs.
  - `src/lib/analytics.ts` — existing aggregation-style computation pattern.
- Code Snippets:

```
// src/state/StateSyncBridge.tsx — workedPomos is derived, not stored
let worked = backendTask.completed_pomodoros || 0;
// ...workedPomos + timeSpentMinutes patched onto the PM task;
// tasks never linked/worked have workedPomos 0
```

## Notes

- This is dependency slice #2 of the agentic planning assistant split. Sibling issues: LLM transport + BYOK, diff engine + guardrails, snapshot/revert, approval-loop UI, Start-of-Day workflow, End-of-Day workflow, chat mode.
- The work-until → pomodoro budget conversion should accept an injected `now` to stay pure and deterministic under Vitest.
