# Validation

## Automated Checks

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run src/lib/agent/startOfDayWorkflow.test.ts src/state/AgentApprovalContext.test.tsx
pnpm test:unit
pnpm build
pnpm test:platform
git diff --check
```

## Manual Verification Steps

1. Generate a Start-of-Day plan with a configured provider.
    - Expected: phases advance and every LLM attempt reports role, model, attempt, duration, and outcome.

2. Expand Details after an invalid response or retry.
    - Expected: failure kind and validation feedback are visible, while raw task/model content is absent.

3. Reject an approval card.
    - Expected: replan activity appends to the same log and is labeled as replan work.

4. Clear the activity log.
    - Expected: the stepper, live line, and details disclosure disappear until another event arrives.

## Build / Compilation

```powershell
pnpm build
```

## Common Pitfalls

- Do not classify a transport success as schema-valid without telemetry validation.
- Do not let `onProgress` exceptions propagate into the workflow.
- Do not include raw completion content in event objects or UI logs.
