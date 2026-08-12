# Tests

## Test Strategy

- Unit-test the browser adapter with injected Supabase mocks so secret selection and stable error mapping are explicit.
- Component-test the complete user workflow with a fake adapter and `createTask` callback.
- Reuse existing pure classification and integration tests rather than duplicating their backend behavior.

## Requirement Coverage

| Requirement / Acceptance Criteria | Test Coverage | Notes / Gaps |
| --- | --- | --- |
| Connect/settings/disconnect | `ShortcutIntegrationCard.test.tsx`, `ShortcutDataAccess.test.ts` | Team discovery is unavailable by backend contract |
| Preview before creation | `ShortcutIntegrationCard.test.tsx` | Asserts cancellation has no writes |
| Confirm through PM callback and summary | `ShortcutIntegrationCard.test.tsx` | Callback stands in for `usePM().createTask` |
| Error recovery | `ShortcutIntegrationCard.test.tsx`, `ShortcutDataAccess.test.ts` | Invalid token and rate-limit mapping |
| Registry no longer placeholder | `IntegrationsPage.test.tsx`, `registry.test.ts` | Existing placeholder counts updated |

## New Tests

| Test File | Test Name | Test Type | Requirement / Risk Covered | Key Assertions |
| --- | --- | --- | --- | --- |
| `src/lib/data/ShortcutDataAccess.test.ts` | loads only public fields and performs owner-scoped operations | unit | secret isolation | exact select, RPCs, delete owner filter |
| `src/lib/data/ShortcutDataAccess.test.ts` | maps structured and network function errors | unit | recovery | code and retry delay retained |
| `src/components/ShortcutIntegrationCard.test.tsx` | connects and saves settings | component | settings flow | adapter calls and connected controls |
| `src/components/ShortcutIntegrationCard.test.tsx` | previews, cancels, and confirms proposals | component | no pre-confirm writes | callback absent before confirm, proposal fields passed after |
| `src/components/ShortcutIntegrationCard.test.tsx` | surfaces invalid token and rate limiting | component | error recovery | reconnect and retry copy |
| `integration/shortcutSettings.integration.test.ts` | updates public preferences without replacing secret | integration | RPC authorization/secret isolation | owner fields change; admin-observed token is unchanged; absent/foreign rows unaffected |

## Modified Tests

| Test File | Existing Test Name | Change | Why It Must Change |
| --- | --- | --- | --- |
| `src/components/IntegrationsPage.test.tsx` | renders registry entries... | Expect two placeholders and implemented Shortcut fallback | Shortcut is no longer coming soon |
| `src/lib/integrations/registry.test.ts` | placeholder registry assertion | Expect only Google Calendar and GitHub placeholders | Registry contract changed |
| `integration/shortcutSettings.integration.test.ts` | owner settings storage | Exercise the public-preferences RPC and its missing-row/owner boundary | New database write path requires real RLS/RPC coverage |

## Test Setup / Fixtures

| Fixture / Mock / Seed Data | Used By | Setup Details | Cleanup / Isolation |
| --- | --- | --- | --- |
| Fake Shortcut adapter | component tests | configurable settings, stories, and errors | fresh object per test |
| Story payload and existing PM task | preview tests | duplicate URL, excluded status, one proposal | Vitest reset |
| Supabase fluent mocks | adapter tests | resolved `{data,error}` calls and function response contexts | fresh mocks per test |

## Test Data

| Data Shape | Valid Examples | Invalid / Boundary Examples |
| --- | --- | --- |
| Connection | token, `Data Thinkers`, three default statuses | blank token/team, empty status items |
| Sync | one new, one duplicate, one excluded | no proposals, invalid token, 429 |

## Test Cases per Feature

### Feature: Connection and settings

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Connect | no stored row | enter fields and submit | connected state | save RPC called; token input cleared |
| Edit | stored row | change team/exclusions and save | settings persisted without token | preferences RPC called only with public fields |
| Disconnect | stored row | click Disconnect | disconnected form returns | owner-scoped delete called; settings cleared |

### Feature: Preview and creation

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Cancel | sync returns proposals | close preview | no task changes | `createTask` not called |
| Confirm | sync returns proposals | confirm | tasks created and counts summarized | callback receives title/options; created count shown |
| Partial failure | multiple proposals | second callback rejects | partial result retained | created-so-far count and error shown; modal remains open |

## Regression / Edge Coverage

- Google Calendar and GitHub remain disabled placeholders.
- Empty/loading/error states are accessible and async buttons are disabled in flight.
- Existing classification tests continue to prove URL deduplication and status exclusion.

## Test Execution

```powershell
pnpm test:unit -- src/lib/data/ShortcutDataAccess.test.ts src/components/ShortcutIntegrationCard.test.tsx src/components/IntegrationsPage.test.tsx src/lib/integrations/registry.test.ts
pnpm test:integration -- integration/shortcutSettings.integration.test.ts
```

## Not Covered / Deferred

- Live Shortcut API credentials and workspace team discovery are not automated or stored.
