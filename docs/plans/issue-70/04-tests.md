# Tests

## Test Strategy

- Unit-test settings parsing and pure calendar projection boundaries.
- Test local staging v4-to-v5 migration and remote legacy normalization.
- Use component tests for editing and visible projected-date integration.

## Requirement Coverage

| Requirement / Acceptance Criteria | Test Coverage | Notes / Gaps |
| --- | --- | --- |
| Configurable persisted cutoff | settings, staging, Supabase, SettingsPanel tests | Whole-row merge already has coverage |
| Projection stops/resumes at cutoff | projection unit tests and TimerPanel test | Local timezone is controlled by the test process |

## New Tests

| Test File | Test Name | Test Type | Requirement / Risk Covered | Key Assertions |
| --- | --- | --- | --- | --- |
| `src/lib/settings.test.ts` | legacy normalization and validation | unit | rolling data compatibility | default injected; bad times rejected |
| `src/lib/projection.test.ts` | same-day, rollover, multi-day, midnight | unit | boundary math | exact local finish date/time |

## Modified Tests

| Test File | Existing Test Name | Change | Why It Must Change |
| --- | --- | --- | --- |
| `src/lib/engine/engine.test.ts` | defaults | include cutoff | exact object assertion |
| `src/lib/data/staging/LocalStagingStore.test.ts` | migration/roundtrip | expect schema v5 and cutoff backfill | storage compatibility |
| `src/lib/data/SupabaseDataAccess.test.ts` | pull transport | add legacy settings pull | remote compatibility |
| `src/components/SettingsPanel.test.tsx` | settings | save time input | user edit path |
| `src/components/TimerPanel.test.tsx` | projected finish | fake clock cutoff rollover | UI integration |

## Test Setup / Fixtures

Use fake timers for projection UI time, explicit local `Date` constructors for pure tests, and existing data-provider wrappers for components.

## Test Execution

```powershell
pnpm test:unit
```

## Not Covered / Deferred

- Per-project work hours and configurable start-of-day remain issue 71 scope.
