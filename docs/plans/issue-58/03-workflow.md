# Task: Compose the two-persona workflow

## Classification

Type: T2: cross-module orchestration
Reasoning: Composes stable engine and agent contracts in one new production module plus exports. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Build planner context, request/validate a deterministic plan, run a creative wording pass without structural mutation, and produce approval changes plus a completion persistence callback.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/agent/startOfDayWorkflow.ts` | create |
| `src/lib/agent/index.ts` | update |

## Step-by-Step Instructions

### 1. Define workflow inputs/results

**File:** `src/lib/agent/startOfDayWorkflow.ts`

Add `runStartOfDayWorkflow(input): Promise<StartOfDayWorkflowResult>` with injected `now`, client/model overrides for tests, PM state, logs, settings, work-until, and optional rejection feedback.

### 2. Compose planner and writer passes

Build the safe context, send explicit Start-of-Day rules at low temperature, validate output, send the structural plan to the writer at higher temperature, merge only title/description/checklist by stable position/ID, revalidate, and diff against current project tasks. Fail if writer identity/count changes or blocked changes remain.

### 3. Support replanning and final persistence

Expose helpers that rerun against the approval loop's working tasks with rejected-change feedback and save the final plan only when the review completes.

## Edge Cases to Handle

- Invalid/passed work-until time or zero whole-pomodoro budget.
- Writer task count/identity drift.
- Planner output that results in blocked guardrails or no tasks.
- Provider-specific default model selection.

## Related Files (read-only context)

- `src/lib/agent/agentClient.ts`
- `src/lib/agent/outputSchemas.ts`
- `src/lib/agent/llmTransport.ts`
- `src/lib/engine/diffEngine.ts`

