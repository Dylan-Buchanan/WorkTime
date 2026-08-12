# Tests

## Test Strategy

- Use local-Supabase integration tests for grants, constraints, RLS, and owner isolation.
- Use deterministic mocked-fetch tests for API mapping, cursor pagination, 401, 429, malformed pagination, and network failures.
- Keep real Shortcut tokens out of test fixtures and environment files.

## Requirement Coverage

| Requirement / Acceptance Criteria | Test Coverage | Notes / Gaps |
| --- | --- | --- |
| Per-owner settings singleton and RLS | `integration/shortcutSettings.integration.test.ts` | Real local Postgres/Auth |
| Token not readable from browser | `integration/shortcutSettings.integration.test.ts` | Asserts column permission denial |
| Member, workflow, pagination, slim payload | `integration/shortcutApi.integration.test.ts` | Mocked official v3 shapes |
| Distinct 401 and 429 | `integration/shortcutApi.integration.test.ts` | Asserts typed status/code and retry delay |
| Successful last-sync update | Handler + settings integration coverage | Full invocation remains a manual/local function check |

## New Tests

| Test File | Test Name | Test Type | Requirement / Risk Covered | Key Assertions |
| --- | --- | --- | --- | --- |
| `integration/shortcutSettings.integration.test.ts` | owner can store config without reading token | integration | secret exposure | public columns readable; token SELECT denied |
| `integration/shortcutSettings.integration.test.ts` | enforces owner isolation | integration | RLS | other owner sees no row; spoof insert fails |
| `integration/shortcutApi.integration.test.ts` | paginates and maps workflow states | unit-style integration | external contract | next followed, slim fields and status names returned |
| `integration/shortcutApi.integration.test.ts` | distinguishes unauthorized and rate limited | unit-style integration | UI recovery | 401/429 stable typed errors |

## Modified Tests

None.

## Test Setup / Fixtures

| Fixture / Mock / Seed Data | Used By | Setup Details | Cleanup / Isolation |
| --- | --- | --- | --- |
| `createLocalUser()` | settings tests | Two signed-in local users | Delete users in `afterEach`/`finally` |
| injected `fetch` stub | API tests | Route responses by URL | New stub per test |

## Test Data

| Data Shape | Valid Examples | Invalid / Boundary Examples |
| --- | --- | --- |
| settings | token, `Data Thinkers`, excluded statuses | whitespace token/team, foreign owner |
| search result | story with labels and mapped state | unknown state, null optionals, four pages |
| pagination | same-origin `/api/v3/search/stories?...` | repeated or foreign-origin `next` |

## Regression / Edge Coverage

- Token column stays absent from authenticated SELECT grants.
- Timestamp advances only after the upstream fetch succeeds.
- Pagination cannot turn an upstream cursor into arbitrary outbound HTTP.

## Test Execution

```powershell
pnpm test:integration
```

## Not Covered / Deferred

- Live Shortcut API behavior is not exercised because no workspace credential may be committed.
- Full Edge-runtime invocation requires `pnpm supabase:serve` and is manually smoke-tested locally.
