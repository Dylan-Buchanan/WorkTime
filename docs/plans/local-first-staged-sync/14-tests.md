# Tests

## Test Strategy

- Put the data-loss invariants in pure/unit coverage first: uninitialized stores cannot build/push a plan, acknowledged commits cannot clear later edits, full wipe excludes PM, and running timers block only the remote timer slice.
- Use integration tests for real Postgres/RPC/RLS/auth behavior, including client log IDs, server-side LWW predicates, transactional wipe, retry idempotency, and timer CAS. Use a dedicated local-only migration replay script for the historical backfill itself.
- Use React component/context tests for lifecycle event ownership, pending/status/error UI, PM suppress-once behavior, and bridge batching. Assert negative behavior (no remote/sync call) as well as visible state.
- Keep Playwright focused on user-observable staging-then-sync flows. Tauri close interception cannot run under browser E2E, so cover its frontend state machine with unit tests, Rust structure with `test:platform`, and the packaged binary manually.

## Requirement Coverage

| Requirement / Acceptance Criteria | Test Coverage | Notes / Gaps |
| --- | --- | --- |
| Local commands use per-owner staging with zero network | `src/lib/data/StagedDataAccess.test.ts` - command matrix and owner isolation | Inject throwing/counting sync remote; clear localStorage between/within cases |
| Pull -> merge -> push advances baseline and retries safely | `src/lib/data/sync/merge.test.ts`; `src/lib/data/sync/SyncCoordinator.test.ts`; `integration/localFirstSync.integration.test.ts` | Include ambiguous/repeated log push and revision-safe commit |
| Field-level task LWW | `src/lib/data/sync/merge.test.ts`; `integration/localFirstSync.integration.test.ts` | Pure test proves different-field preservation; integration proves server timestamp predicate |
| Whole-row settings/timer/PM LWW | same merge/integration files | Remote-wins timestamp ties are explicit |
| Log union/dedup/order | engine, merge, transport integration tests | IDs are client-generated; order `(finished_at,id)` |
| Tombstone DELETEs | merge and integration sync tests | Task tombstone timestamp vs newer remote row; log immutable delete |
| Transactional full wipe; PM survives | coordinator/RPC integration; `SettingsPanel` component test | Inject one invalid payload to prove rollback; assert PM row unchanged |
| Bootstrap guard | `LocalStagingStore`, merge, and coordinator unit suites plus integration regression | Highest-priority: failed/absent pull records zero remote writes, including PM null/default case |
| Running timer protection | `src/lib/data/sync/merge.test.ts` | Also assert task/log/settings/PM still merge; paused/expired timers adopt remote |
| Timer single-CAS winner | timer journal unit tests and existing `timerCompletionGuard.integration.test.ts` | Cover synced and locally-created generations plus retry |
| `updated_at` backfill/default/update | `scripts/verify-local-first-migration.mjs`; integration schema tests | Script uses partial local reset/migration-up and always restores full local schema |
| Sync button/status/pending/auth errors | `src/components/SyncControls.test.tsx` | Component test uses accessible labels/live regions |
| Focus/visibility/pagehide/banner | `src/state/SyncContext.test.tsx` | `pagehide` explicitly best effort; hidden visibility is negative case |
| Cross-tab refresh but no auto-sync | `src/state/SyncContext.test.tsx` | Matching storage key calls reload only |
| Tauri close dialog and slim shell | `src/state/TauriCloseContext.test.tsx`; `npm run test:platform` | Manual packaged-binary smoke remains necessary |
| AppState no command-following refresh/network | `src/state/AppStateContext.test.tsx` | Preserve local progression and notification fallback |
| PM immediate staging/suppress contract | `src/state/ProjectManagerContext.test.tsx` | No debounce, null seed, unmount flush, or duplicate focus pull |
| Bridge local N writes + one sync | `src/state/ProjectManagerContext.test.tsx` StateSyncBridge block | Preserve `pendingTargetsRef` across later edits/failure |
| Existing engine semantics | `src/lib/engine/engine.test.ts` | Update only for deterministic log IDs; all prior assertions remain |
| Browser flows sync before server assertion | `e2e/timer.spec.ts`; `e2e/project-manager.spec.ts` | Use shared `syncData` helper, not sleeps/debounce polling |
| PWA/platform gates | `npm run test:pwa`; `npm run test:platform` | Platform gate extended for close events; no background-sync additions |

## New Tests

| Test File | Test Name | Test Type | Requirement / Risk Covered | Key Assertions |
| --- | --- | --- | --- | --- |
| `src/lib/data/staging/LocalStagingStore.test.ts` | `keeps owner records isolated and observes localStorage.clear` | unit | owner isolation/bootstrap | distinct keys; clear returns uninitialized; no stale cache |
| same | `counts entity deltas without treating uninitialized empty as a wipe` | unit | pending/bootstrap | zero untouched; exact task/log/singleton counts; wipe counts once |
| `src/lib/data/StagedDataAccess.test.ts` | `executes every engine command locally` | unit | responsiveness/write boundary | throwing sync executor untouched; persisted state returned |
| same | `reset stages a wipe and preserves PM` | unit | reset scope | default app state; marker set; PM byte-equivalent |
| `src/lib/data/sync/merge.test.ts` | `merges different task fields and resolves same-field conflicts by timestamp` | unit | task field LWW | both independent values retained; newer/tie rules exact |
| same | `protects only a running local timer during pull` | unit | live timer | local timer slice retained; remote task/log/settings/PM merged |
| same | `unions logs by id and produces stable order` | unit | retry/order | one row per ID; finished_at/id ordering |
| same | `commit preserves edits after push plan revision` | regression | in-flight local edit | acknowledged old value cleared; newer value still pending |
| `src/lib/data/sync/timerCompletions.test.ts` | `records one completion per timer generation` | unit | local CAS | second completion false; one UUID/log/journal |
| same | `CAS loser removes only derived progress and keeps later edits` | unit | multi-device completion | losing log gone; remote progress adopted; unrelated field retained |
| `src/lib/data/sync/SyncCoordinator.test.ts` | `never writes before a successful bootstrap pull` | unit/regression | highest data-loss risk | every remote write spy zero on pull rejection |
| same | `retries whole sync once after session refresh` | unit | token refresh | refresh called once; pull restarted; pending retained on final failure |
| same | `coalesces triggers and leaves concurrent edits pending` | concurrency regression | retry/data loss | one in-flight push; later revision not acknowledged |
| `src/state/SyncContext.test.tsx` | `focus and visible visibility invoke sync while storage only reloads` | component | trigger ownership/cross-tab | reasons correct; hidden ignored; storage sync count unchanged |
| same | `pagehide is web-only best effort and pending-at-mount shows banner` | component | web backstop | bestEffort true; Tauri no handler; clean store no banner |
| `src/components/SyncControls.test.tsx` | `renders pending, progress, success, sync error, and auth error states` | component | sync UI | badge, disablement, live status, retry/action calls |
| `src/state/TauriCloseContext.test.tsx` | `syncs or skips before one approved close` | component | native close flow | approve before close; errors keep dialog; public path closes |
| `src/components/SettingsPanel.test.tsx` | `reset preserves PM and describes scoped deletion` | component/regression | PM survival | no `resetPM`; updated copy; app reset called once |
| `integration/localFirstSync.integration.test.ts` | `applies an idempotent staged batch under RLS` | integration | RPC/idempotency/LWW | caller owner only; retry no dup; stale timestamp rejected |
| same | `full wipe rolls back atomically and keeps PM` | integration | destructive safety | failed batch changes nothing; success defaults timer/settings and retains PM |
| `scripts/verify-local-first-migration.mjs` | local historical migration replay | integration script | backfill | task updated_at=created_at; JSONB timestamps within one migration window; trigger/defaults |

## Modified Tests

| Test File | Existing Test Name | Change | Why It Must Change |
| --- | --- | --- | --- |
| `src/lib/engine/engine.test.ts` | all log-producing command cases | pass fixed log UUIDs and assert IDs | engine requires deterministic client identity |
| `src/lib/data/InMemoryDataAccess.test.ts` | concurrent completion and hydration cases | add log-ID factory and extended sync seam assertions | fake must satisfy new DataAccess and CAS contracts |
| `src/state/AppStateContext.test.tsx` | load/create/progression cases | assert direct result adoption and revision reload, not refresh-after-command | commands are local now |
| `src/state/ProjectManagerContext.test.tsx` | hydration/persistence/StateSyncBridge cases | remove debounce expectations; assert immediate stage and one bridge sync | PM no longer pushes itself |
| `integration/SupabaseDataAccess.integration.test.ts` | aggregate round trip | exercise remote pull/push instead of command methods | Supabase class becomes sync transport |
| `integration/timerCompletionGuard.integration.test.ts` | two clients race | use journal/RPC transport payloads with fixed log IDs | retain single CAS winner under staged path |
| `e2e/helpers.ts` | `seedState`, `backendState` | seed log IDs/timestamps, strip transport metadata, add `syncData(page)` | domain type now requires IDs; server assertions require explicit sync |
| `e2e/timer.spec.ts` | both workflows | click/wait for sync before `backendState` | local interactions no longer write immediately |
| `e2e/project-manager.spec.ts` | create project/task | replace 750ms backend poll with sync helper then assert | debounce removed |
| `scripts/verify-platform-cleanup.mjs` | platform gate | require close handler/event names while retaining dependency/command bans | Tauri lifecycle feature is statically covered |
| `package.json` | `test:integration` | run local migration replay before Vitest integration suites | backfill must be tested at the migration boundary |

## Test Setup / Fixtures

| Fixture / Mock / Seed Data | Used By | Setup Details | Cleanup / Isolation |
| --- | --- | --- | --- |
| Fixed clock + UUID factories | engine/staging/merge/coordinator unit tests | ISO times one second apart; UUIDs with ordered suffixes | new instance per test; global localStorage cleanup exists |
| `FakeSyncRemote` | StagedDataAccess/coordinator/context tests | call log, deferred pull/push promises, injectable auth/CAS outcomes | reset spies and resolve deferred promises after each test |
| Two owner IDs | staging/store tests | valid distinct UUID strings | remove only `worktime:staging:v1:*` fixture keys/localStorage clear |
| Baseline/local/remote snapshot builder | merge/timer tests | explicit absent/versioned singleton rows and task timestamps | pure values; structuredClone before mutation assertions |
| Local Supabase throwaway user | integration/E2E | existing `createLocalUser`; RLS-authenticated client | existing `cleanup()` cascades owner rows |
| Historical pre-migration rows | migration replay script | reset local DB through `20260801020000`, create user/data, run `migration up --local` | `finally` performs full `db reset --local`; script refuses non-local URL |
| Tauri close adapter fake | close context tests | ordered `listen/emit/close` call log | unlisten on cleanup; no real Tauri global |

## Test Data

| Data Shape | Valid Examples | Invalid / Boundary Examples |
| --- | --- | --- |
| task conflict | base name A/target 2; local name B at `00:02`; remote target 3 at `00:03` | both change name; equal timestamps; remote deletion; newer tombstone |
| JSONB singleton | base/local/remote settings or PM with ordered timestamps | absent row; exact tie; invalid timestamp; local running timer override |
| logs | UUID IDs with same/different `finished_at` | duplicate ID retry; same time tie; tombstoned baseline; malformed missing ID |
| staging bootstrap | null baseline + untouched defaults; staged local task before pull | pull failure; localStorage clear; corrupt/unknown schema; owner mismatch |
| timer completion | exact expected timer and fixed completion log ID | second completion, CAS loser, local-only generation, later task edit |
| full wipe | tasks/logs/settings/timer + independent PM row | invalid settings causes rollback; retry; PM staged edit alongside wipe |

## Test Cases per Feature

### Feature: Bootstrap and retry-safe sync

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| First pull fails | uninitialized record with/without local task | call sync | error, no write | `initialized=false`; push/CAS spies zero; local task retained |
| First pull succeeds | server has rows; local has staged new task | call sync | remote and local merge, then push | pull first in call log; baseline set; both tasks present |
| Push response fails/ambiguous | initialized pending log | sync then retry | staged ID persists; server has one log | pending not cleared on failure; retry conflict does nothing |
| Edit during push | deferred push; stage newer settings | resolve push | old plan acknowledged only | newer settings still pending and visible |

### Feature: Lifecycle and UI

| Scenario | Preconditions | Action | Expected Outcome | Assertions |
| --- | --- | --- | --- | --- |
| Return to visible app | authenticated provider | focus/visibility-visible | full sync trigger | one coalesced `sync`; no direct `refreshPM`/remote pull elsewhere |
| Other tab syncs | matching staging storage event | dispatch event | local views reload | revision changes; `sync` call count unchanged |
| Leave web page | web with pending changes | `pagehide` | best-effort attempt | reason/pagehide flag; rejection swallowed; pending persists if unfinished |
| Native close with pending | Tauri adapter and registered handler | close event -> sync success | window closes once | dialog/actions, emit approve before close |

## Regression / Edge Coverage

- Public login/signup/reset routes never construct `LocalStagingStore`, pull authenticated data, or register an authenticated close handler.
- Existing notification plugin entry point and Web Notification fallback remain covered.
- `persist_transition` and `complete_timer` signatures and atomic rollback tests remain green.
- `api.max_rows=1000` coverage uses more than 500 and more than 1000 rows to prove page continuation.
- Reset removes app-state rows/defaults timer completion but leaves `pm_state` and local PM data unchanged.
- No service worker background sync, `SyncManager`, Tauri invoke, command macro, new Cargo dependency, service-role browser variable, or storage-event auto-sync appears.

## Test Execution

```powershell
# Fast data-safety and context coverage
pnpm exec vitest run src/lib/data/staging/LocalStagingStore.test.ts src/lib/data/StagedDataAccess.test.ts src/lib/data/sync/merge.test.ts src/lib/data/sync/timerCompletions.test.ts src/lib/data/sync/SyncCoordinator.test.ts src/state/SyncContext.test.tsx src/components/SyncControls.test.tsx src/state/TauriCloseContext.test.tsx src/state/AppStateContext.test.tsx src/state/ProjectManagerContext.test.tsx

# Requires local Supabase; the migration replay script must use --local and restore the latest schema
npm run test:integration

# Requires local Supabase and served invite function
npm run test:e2e

# Static/build gates
npm run test:platform
npm run test:pwa
```

## Not Covered / Deferred

- Browser and operating-system termination can kill `pagehide` or Tauri sync after the request begins. Correctness is the persisted pending state/banner, not guaranteed delivery; manually simulate abrupt termination during validation.
- Playwright cannot exercise the packaged Tauri window event. The frontend handshake is unit-tested, Rust structure is statically tested, and one manual MSI close smoke is required.
- Device clock skew is not automatically corrected in this issue. Tests lock the declared client-timestamp LWW and deterministic tie behavior.
