# Task: Add workflow progress events and measuring client

## Classification

Type: T2: moderate orchestration instrumentation
Reasoning: Adds retry-aware telemetry to one workflow module and its tests without changing transport or agent-client contracts. Blast Radius=2, Uncertainty=1, Behavior=3, Testing=2, Reversibility=1. Total=9.

## Goal

Emit coarse phases and detailed LLM-attempt events that identify retry count, role, model, duration, and privacy-safe validation outcome.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/agent/startOfDayWorkflow.ts` | update |
| `src/lib/agent/index.ts` | update |
| `src/lib/agent/startOfDayWorkflow.test.ts` | update |

## Step-by-Step Instructions

### 1. Define the event contract

**File:** `src/lib/agent/startOfDayWorkflow.ts`

Add `StartOfDayPhase`, `StartOfDayProgressEvent`, `StartOfDayLlmOutcome`, and `StartOfDayResponseKind` types. Extend `StartOfDayWorkflowInput` with optional `onProgress` and injectable `monotonicNow` for deterministic duration tests. Mark events as `initial` or `replan` based on rejection feedback.

### 2. Decorate LLM attempts

**File:** `src/lib/agent/startOfDayWorkflow.ts`

Wrap planner and writer clients separately. Increment an attempt counter per `complete()` call, time the request, and validate returned content against the role schema only to classify telemetry. Emit `valid`, `invalid`, or `transport-error` and classify invalid bodies as `empty`, `markdown-fence`, `non-json`, or `schema-mismatch`. Extract only validation feedback added by the retry helper; never emit raw content. Swallow progress-listener exceptions.

### 3. Emit phases

Emit `building-context`, `planning`, `validating-plan`, `writing`, `validating-copy`, `diffing`, and `completed` at their actual orchestration boundaries.

### 4. Test retry diagnostics

**File:** `src/lib/agent/startOfDayWorkflow.test.ts`

Assert phase order, low/high persona attempts, deterministic durations, invalid JSON retry classification, feedback on the second attempt, and transport-error observation.

## Edge Cases to Handle

- Listener throws, transport rejects, response is empty/fenced/non-JSON/schema-invalid, or validation retries exhaust.
- Replan events must be identified without changing the replan contract.
- Duration must be non-negative even if an injected clock moves backward.

## Related Files (read-only context)

- `src/lib/agent/agentClient.ts`
- `src/lib/agent/outputSchemas.ts`
- `src/lib/agent/llmTransport.ts`

