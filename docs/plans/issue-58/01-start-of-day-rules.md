# Task: Add pure Start-of-Day plan rules

## Classification

Type: T2: moderate pure-engine behavior
Reasoning: Adds focused validation and tests across two files. Blast Radius=1, Uncertainty=1, Behavior=3, Testing=1, Reversibility=1. Total=7.

## Goal

Reject planner output that violates Start-of-Day structural guardrails before it reaches the diff/approval layer.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/engine/startOfDay.ts` | create |
| `src/lib/engine/index.ts` | update |

## Step-by-Step Instructions

### 1. Define validation

**File:** `src/lib/engine/startOfDay.ts`

Create `validateStartOfDayPlan(input): StartOfDayPlanValidation` accepting current tasks, proposed tasks, and work budget. Validate unique/existing IDs, positive integer estimates, no split from worked tasks, split pieces no larger than four pomodoros, preservation/rollover of worked large tasks, no timer-owned Done transitions, and a non-empty budget-bounded ordered plan.

### 2. Export the module

**File:** `src/lib/engine/index.ts`

Export the validator and its public types.

## Edge Cases to Handle

- Fractional `workedPomos` greater than zero.
- Missing split sources, duplicate existing IDs, invalid estimates, and zero work budget.
- Existing Done tasks may remain Done but must not be newly transitioned.

## Related Files (read-only context)

- `src/lib/engine/diffEngine.ts`
- `src/lib/engine/plannerContext.ts`
- `src/state/types.ts`

