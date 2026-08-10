# Tests

## Test Strategy

- Unit-test pure plan rules at boundary values and worked-progress cases.
- Unit-test plan serialization/corruption handling and two-persona orchestration through a mocked completion client.
- Extend approval/UI tests for completion persistence and the production launch path.
- Run the existing unit suite as the regression gate for engine, PM mutations, and agent guardrails.

## Requirement Coverage

| Requirement / Acceptance Criteria | Test Coverage | Notes / Gaps |
| --- | --- | --- |
| Two-persona pipeline with frozen structure | `startOfDayWorkflow.test.ts` | Mocked transport proves temperatures and merge restrictions |
| Split/checklist/rollover rules | `startOfDay.test.ts`, workflow prompt assertions | Semantic quality remains model-dependent |
| Persist final plan | `startOfDayPlanStore.test.ts`, approval completion test | Surface-local only |
| Split-with-progress | `startOfDay.test.ts` | Fractional progress included |
| Work-until bounded plan/UI launch | planner-context regression and panel test | Whole-pomodoro budget |

## New Tests

| Test File | Test Name | Test Type | Requirement / Risk Covered | Key Assertions |
| --- | --- | --- | --- | --- |
| `src/lib/engine/startOfDay.test.ts` | validates bounded plans and rejects unsafe splits | unit | plan rules | exact issues for thresholds/progress/budget |
| `src/lib/agent/startOfDayPlanStore.test.ts` | round trips and rejects corrupt records | unit | persistence | version/schema/deep clone |
| `src/lib/agent/startOfDayWorkflow.test.ts` | freezes writer structure | unit | personas | low/high temperature, unchanged estimates/order |

## Modified Tests

| Test File | Existing Test Name | Change | Why It Must Change |
| --- | --- | --- | --- |
| `src/state/AgentApprovalContext.test.tsx` | approval/rejection flows | add completion assertions and SOD launch | proves production lifecycle |
| `src/lib/data/staging/LocalStagingStore.test.ts` | agent key isolation | include plan key | prevents accidental sync |

## Test Setup / Fixtures

| Fixture / Mock / Seed Data | Used By | Setup Details | Cleanup / Isolation |
| --- | --- | --- | --- |
| Mock `ChatCompletionsClient` | workflow tests | queue planner/writer JSON | fresh mock per test |
| jsdom localStorage | store/context tests | clear before each | `localStorage.clear()` |
| InMemoryDataAccess project | panel tests | selected p1 with timer state | fresh instance |

## Test Data

| Data Shape | Valid Examples | Invalid / Boundary Examples |
| --- | --- | --- |
| Work window | future `17:00`, budget 8 | passed time, <1 pomo remaining |
| Split task | source 8p/0 worked, pieces 3p + 4p | source 8p/0.5 worked, piece 5p |
| Stored plan | version 1, ISO timestamps | wrong version, malformed task |

## Test Cases per Feature

### Feature: Plan validation

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Worked large task rolls over | 8p estimate, 1.5 worked | validate retained task | valid | no split issue |
| Worked task is split | same source | validate split proposal | invalid | worked-progress issue |

### Feature: Two-persona orchestration

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Writer changes copy | valid planner plan | run workflow | copy merged only | order/estimate/status unchanged |
| Writer changes identity | mismatched id/count | run workflow | rejected | descriptive error |

## Regression / Edge Coverage

- No Tauri invoke or server persistence path.
- Existing approval guardrails and snapshot/revert remain intact.
- Corrupt plan storage never crashes rendering.

## Test Execution

```powershell
pnpm test:unit
```

## Not Covered / Deferred

- Live-provider semantic quality and End-of-Day consumption are deferred to provider testing and issue #59.

