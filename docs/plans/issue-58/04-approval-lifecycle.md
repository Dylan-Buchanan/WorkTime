# Task: Notify workflow completion

## Classification

Type: T1: focused state lifecycle extension
Reasoning: Adds an optional completion callback to one context and its tests. Blast Radius=1, Uncertainty=1, Behavior=3, Testing=1, Reversibility=1. Total=7.

## Goal

Allow a workflow to persist output after every proposed change has either been approved or removed through replanning.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/state/AgentApprovalContext.tsx` | update |
| `src/state/AgentApprovalContext.test.tsx` | update |

## Step-by-Step Instructions

### 1. Extend review input

**File:** `src/state/AgentApprovalContext.tsx`

Add optional `onComplete(input)` receiving project, mode, summary, and cloned approved changes. Retain it for the active review and call it exactly once for zero-change starts, final approval, or a rejection whose replan returns no work.

### 2. Cover lifecycle paths

**File:** `src/state/AgentApprovalContext.test.tsx`

Assert completion is called once with all approved changes and that failure is surfaced without undoing applied changes.

## Edge Cases to Handle

- React state closure timing on the final approval.
- Empty initial reviews and empty replans.
- Reset/revert must clear the retained callback.

## Related Files (read-only context)

- `src/lib/agent/applyTaskChange.ts`

