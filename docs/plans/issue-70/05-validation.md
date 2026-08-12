# Validation

## Automated Checks

```powershell
pnpm test:unit
pnpm run build
```

## Manual Verification Steps

1. Set End of day in Settings and save.
    - Expected: the value persists after reload/sync.
2. Create enough due-today or unscheduled estimated work to cross the cutoff.
    - Expected: Projected finish moves to a later local date and resumes from midnight.

## Build / Compilation

```powershell
pnpm run build
```

## Common Pitfalls

- Do not add a database column; settings are JSONB.
- Do not add a start-of-day setting or fixed 24-hour date arithmetic.
