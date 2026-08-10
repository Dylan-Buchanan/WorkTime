# Tests

## Test Strategy

- Unit-test the workflow decorator through the public `runStartOfDayWorkflow` seam with deterministic completion and clock mocks.
- Component-test the production panel callback wiring and accessible activity presentation.
- Preserve existing strict parser/retry tests unchanged to prove the instrumentation is non-invasive.

## Requirement Coverage

| Requirement / Acceptance Criteria | Test Coverage | Notes / Gaps |
| --- | --- | --- |
| Coarse phase stream | `startOfDayWorkflow.test.ts` phase-order assertion | Covers successful initial run |
| Per-attempt retry visibility | invalid-JSON workflow test | Covers attempt 1/2 and 2/2 feedback |
| Privacy-safe failure classification | workflow response-kind assertions | Raw content is absent by type/design |
| Initial and replan UI | `AgentApprovalContext.test.tsx` | Injected workflow seam |
| Accessible bounded log | panel component assertions | Cap can be tested with 21 synthetic events |

## New Tests

| Test File | Test Name | Test Type | Requirement / Risk Covered | Key Assertions |
| --- | --- | --- | --- | --- |
| `src/lib/agent/startOfDayWorkflow.test.ts` | emits retry diagnostics for invalid JSON | unit | reported user failure | outcomes, response kind, feedback, duration |
| `src/state/AgentApprovalContext.test.tsx` | renders and clears progress activity | component | visibility/accessibility | live region, details, clear |

## Modified Tests

| Test File | Existing Test Name | Change | Why It Must Change |
| --- | --- | --- | --- |
| `src/lib/agent/startOfDayWorkflow.test.ts` | persona workflow success | assert phases and attempts | covers telemetry contract |
| `src/state/AgentApprovalContext.test.tsx` | launches Start-of-Day | emit progress from mock | covers production callback wiring |

## Test Setup / Fixtures

| Fixture / Mock / Seed Data | Used By | Setup Details | Cleanup / Isolation |
| --- | --- | --- | --- |
| Queued completion client | workflow tests | valid and invalid response sequence | new mock per test |
| Injected monotonic clock | workflow tests | deterministic millisecond values | local closure |
| Injected panel workflow | component test | synchronously emits events before result | fresh mock |

## Test Data

| Data Shape | Valid Examples | Invalid / Boundary Examples |
| --- | --- | --- |
| LLM response | strict planner/writer JSON | empty, fenced JSON, prose, schema mismatch |
| Event log | 1–20 events | 21 events evicts oldest |

## Test Cases per Feature

### Feature: Retry telemetry

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Invalid then valid | first response fenced, second valid | planner request retries | both attempts visible | attempt numbers and response kinds |
| Both invalid | two prose responses | workflow rejects | terminal error retains location | two invalid planner events |

### Feature: Panel activity

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Generate | callback emits phase/attempt | click Generate | latest line updates | polite live region and details entries |
| Clear | log visible | click clear | progress UI disappears | no historical entries remain |

## Regression / Edge Coverage

- Existing `requestValidatedJson` contract and tests remain unchanged.
- Telemetry listener failure cannot fail a workflow.
- No task/model response content is stored in events.

## Test Execution

```powershell
pnpm exec vitest run src/lib/agent/startOfDayWorkflow.test.ts src/state/AgentApprovalContext.test.tsx
pnpm test:unit
```

## Not Covered / Deferred

- Live-provider latency and exact provider response formatting remain manual/provider-dependent.

