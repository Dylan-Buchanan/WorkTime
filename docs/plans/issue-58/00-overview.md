# Overview

> **Issue:** #58
> **Classification Type:** T3
> **Severity:** Medium

## Goal

Implement the Start-of-Day agent workflow so a selected project can be planned to a user-supplied work-until time through deterministic planner and structure-frozen writer passes, reviewed as guarded task changes, and persisted locally after review completion.

## Approach

Add pure Start-of-Day plan validation, a versioned surface-local plan store, and an agent orchestration module composing the existing context builder, strict LLM clients, writer merge, and diff engine. Extend the approval lifecycle with a completion callback, then wire a work-until control and run/error states into `AgentPanel`.

## Key Files

| File | Purpose |
| --- | --- |
| `src/lib/engine/startOfDay.ts` | Pure Start-of-Day structural and budget validation |
| `src/lib/agent/startOfDayWorkflow.ts` | Two-persona orchestration and prompts |
| `src/lib/agent/startOfDayPlanStore.ts` | Versioned local plan persistence |
| `src/state/AgentApprovalContext.tsx` | Review completion notification |
| `src/components/ProjectManager/AgentPanel.tsx` | Work-until UI and production launch path |

## Dependencies / Prerequisites

- Existing BYOK transport, planner/writer schemas, planner context, diff engine, approval cards, mutation adapter, and snapshot/revert support.
- `AppStateContext` supplies timer logs/settings; `ProjectManagerContext` supplies selected project state.

## Risks / Open Questions

- New split tasks do not have persisted IDs until approval; the stored record therefore keeps proposal identity/source metadata and approved change summaries instead of inventing IDs.
- The schema cannot prove that an LLM independently re-estimated pieces; prompts require it while pure validation enforces bounded positive integer estimates and the worked-progress no-split rule.

