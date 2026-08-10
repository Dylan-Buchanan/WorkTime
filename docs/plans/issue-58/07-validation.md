# Validation

## Automated Checks

```powershell
pnpm test:unit
pnpm run build
pnpm test:platform
```

## Manual Verification Steps

1. Configure a BYOK key, select a project, choose Start of Day, and set a future work-until time.
    - Expected: generation enters approval review and all cards are approvable.

2. Approve/reject through completion and inspect the completion/revert state.
    - Expected: only approved/replanned changes apply and `worktime:agent:startOfDayPlan:v1` is written once review completes.

3. Include a task above four pomodoros with fractional worked progress.
    - Expected: it is never proposed as a split and is represented as remaining-work rollover.

## Build / Compilation

```powershell
pnpm run build
```

## Common Pitfalls

- Do not persist the plan before review completion or through the staging store.
- Do not let writer output alter IDs, status, priority, estimates, relations, or ordering.
- Do not use wall-clock or storage access from `src/lib/engine/`.
