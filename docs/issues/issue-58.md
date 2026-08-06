## Title: Agentic planning assistant — Start-of-Day workflow

## Tags

Complexity Classification: T3
Severity: Medium
Reason: New cross-system feature spanning engine, state, and data layers. Blast Radius=4 (new pure-engine split/re-estimation modules, a new agent orchestration/persistence layer writing a new localStorage key, ProjectManagerContext mutation integration, and 10+ files across `src/lib/engine/`, `src/state/`, and `src/lib/data/`; PMTask fields estimatePomos/workedPomos/checklist and StateSyncBridge workedPomos derivation confirmed as touch points), Uncertainty=3 (explicitly depends on five sibling features — LLM transport + BYOK, context builder, diff engine + guardrails, snapshot/revert, approval-loop UI — whose interfaces do not yet exist, so the change surface is not fully traceable), Behavior=3 (complex orchestration: two-persona pipeline, per-piece re-estimation rather than even splitting, split-with-progress rule, rollover planning, plan persistence), Testing=2 (pure-engine parts are Vitest-testable via the established pattern, but end-to-end behavior involves non-deterministic LLM calls and unbuilt dependencies; high user impact if incorrect splits/plans are produced), Reversibility=2 (plan applies via approval-loop, but applied task splits/estimates require coordinated cleanup since snapshot/revert is a separate sibling issue). Total=14 → T3.
Needs research before implementation: Yes — the interfaces of the five sibling dependencies (LLM transport call contract, BYOK settings shape, context builder output format, diff engine/guardrails behavior, snapshot/revert capability, approval-loop UI handoff) must be defined first. Also research: how workedPomos reaches the engine and its rounding semantics for the split-with-progress rule; the exact shape/schema of the new agent localStorage key (outside the staging store); how the work-until window and task ordering integrate with existing PMTask/project data; whether the deterministic-planner schema validator belongs in the engine or the agent layer.

## Summary

Add the Start-of-Day planning workflow: a two-persona pipeline (deterministic planner + creative writer) produces an ordered day plan within the user-selected work-until window, proposes task creations/splits/estimates as approval cards, persists the final plan to the agent localStorage key for End-of-Day comparison, and applies the split-with-progress rule.

## Steps to Reproduce Context

1. User opens the Project Manager, selects a project, and runs Start of Day from the agent panel.
2. Today planning, splitting, and estimate adjustments are entirely manual — no workflow exists.

## Expected Behavior

- Two-persona pipeline: deterministic planner (low temperature, strict schema) produces the target snapshot; creative writer (higher temperature) rephrases titles/descriptions/checklists and the summary while structure is frozen by the validator.
- Ordering: split >4-pomo tasks (re-evaluating each new piece's estimate rather than splitting evenly); ≤4-pomo subtasks go into checklists (no estimates); single-task rollover planned for multi-day completion.
- Persists the final plan (to the agent localStorage key) for End-of-Day comparison.
- Split-with-progress rule: >4-pomo tasks with workedPomos > 0 are re-estimated for remaining work and planned for rollover, never split.
- Agent returns an ordered day plan within the user-selected work-until window, proposing task creations/splits/estimates as needed, each presented as an approval card.

## Actual Behavior

No agent workflow exists. The Project Manager exposes PM tasks with status/priority/dueDate/estimate/checklist/relatedTo, but all planning, splitting, and estimate-accuracy feedback is manual. The codebase has no LLM transport, no agent persistence keys, and no agent UI; `src-tauri` is a slim shell (opener + notification plugins only) with `npm run test:platform` enforcing no `invoke` commands, so the agent must be entirely frontend/fetch-based.

## Requirements for completed issue

1. Two-persona pipeline: deterministic planner (low temperature, strict schema) produces the target snapshot; creative writer (higher temperature) rephrases titles/descriptions/checklists and the summary while structure is frozen by the validator.
2. Ordering: split >4-pomo tasks (re-evaluating each new piece's estimate rather than splitting evenly); ≤4-pomo subtasks go into checklists (no estimates); single-task rollover planned for multi-day completion.
3. Persists the final plan (to the agent localStorage key) for End-of-Day comparison.
4. Split-with-progress rule: >4-pomo tasks with workedPomos > 0 are re-estimated for remaining work and planned for rollover, never split.

## Context

- Files:
  - `src/lib/engine/` — pure-module + Vitest pattern (`core.ts`, `engine.test.ts`) the agent engine should mirror.
  - `src/state/types.ts` — `PMTask.estimatePomos`, `workedPomos`, `checklist`, `status`, `sortOrder` are the fields the SOD plan operates on.
  - `src/state/StateSyncBridge.tsx` — `workedPomos`/`timeSpentMinutes` derived from linked backend `completed_pomodoros` (lines ~241–291) feeds the split-with-progress rule.
  - `src/state/ProjectManagerContext.tsx` — mutation surface the approved plan applies through: `createTask` (async; dedupes via appTaskId), `updateTask`, `archiveTask`, `reorderTasks`.
  - `src/lib/data/staging/LocalStagingStore.ts` — staging store conventions (`STAGING_STORAGE_PREFIX = "worktime:staging:v1:"`); the agent plan key is a new documented intentional exception outside the staging store per AGENTS.md.
- Code Snippets:

```
// src/state/StateSyncBridge.tsx — workedPomos is derived, not stored
let worked = backendTask.completed_pomodoros || 0;
// ...workedPomos + timeSpentMinutes patched onto the PM task
```

## Notes

- This is dependency slice #7 of the agentic planning assistant split; the five prior slices (LLM transport, context builder, diff engine + guardrails, snapshot/revert, approval-loop UI) must exist first.
- Known edge cases to design around: untimed completed tasks would poison accuracy stats (filter workedPomos > 0); auto-Done from StateSyncBridge can race agent status writes (last-write-wins, accept for v1).
