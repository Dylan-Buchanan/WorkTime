# Research: LiftingTracker metric source integration (follow-up)

> **Superseded in part (post-research).** The #133 period/metric model was decided after this
> research: see `docs/plans/issue-133-decisions.md`. Period keys are now `LocalDateKey` boundaries
> of an anchored cadence grid (not `periodStart = lastDeckBuiltAt ?? createdAt`), and `metric.current`
> is written by the integration while the rest of the goal is written by the editor — under
> whole-row LWW that is a known clobber hazard recorded in the decisions document's forward hazards.
> Re-read both before implementing #143.

## Overview

Issue #143 wants a fifth `api-token` integration (`liftingtracker`) whose browser-local API key is used for a direct, pull-only aggregate fetch that auto-fills a goal metric's current value. The relevant integration plumbing exists today: a four-entry registry (`src/lib/integrations/registry.ts`), an id-branching Integrations page (`src/components/IntegrationsPage.tsx`), a per-route settings wiring point (`src/App.tsx` `AuthenticatedIntegrationsRoute`), and a browser-local secret-key module (`src/lib/agent/apiKey.ts`). However, the goals feature the issue builds on (#133 `GoalMetric`/`overridePinned`, #134 metric block, #138 chart series) is **not present in this working tree** — those types, modules, routes, and storage keys exist only as untracked issue/plan markdown under `docs/`. Research therefore separates (a) the integration surface that is real and extendable now from (b) the goal-metric contract that is only planned.

## Issue Context

- User/requested outcome: add a `liftingtracker` registry entry using the existing `api-token` flow, configured on `/integrations` with base URL, key, and default endpoint (key stored browser-local, never server-side, never in the staging store); let an individual goal's metric block opt into `Source: LiftingTracker`; auto-fill the metric value from per-period aggregates; type-to-pin an explicit override; degrade to last-known value with an "as of" stamp when the API is unreachable; feed the chart series; foreground fetches only.
- Current pain or bug: no LiftingTracker integration exists and metrics are manual-only. There is also no goals implementation at all in this tree, so "metrics are manual-only" is true only in the prospective sense (there is no metric block yet).
- Scope classification, if known: T3 (from issue header). The issue's own "Research Needed" items are: CORS contract for browser-direct fetch, the AGENTS.md localStorage exception for a new `worktime:liftingtracker:*` key, and a versioned aggregate contract.

## Current Behavior

### Integration registry and page

- `src/lib/integrations/registry.ts:1-12` defines `IntegrationAuthFlow = "oauth2" | "api-token"`, `IntegrationIcon = "calendar" | "github" | "shortcut" | "linear"`, and `IntegrationDefinition { id: string; name; description; icon; authFlow; isPlaceholder }`. `id` is an unconstrained `string`, so a new id is not a type error.
- `src/lib/integrations/registry.ts:14-47` contains exactly four entries — `google-calendar` and `github` (`oauth2`), `shortcut` and `linear` (`api-token`) — all `isPlaceholder: false`. There is no liftingtracker entry and no liftingtracker icon.
- `src/components/IntegrationsPage.tsx:14-19` maps each icon to a lucide component in `ICONS: Record<IntegrationIcon, LucideIcon>`; there is **no runtime fallback**. `src/components/IntegrationsPage.tsx:21-24` labels the two auth flows "OAuth 2.0" and "API token".
- `src/components/IntegrationsPage.tsx:26-33` page props are `{ integrations?, renderActions?, shortcut?, linear?, googleCalendar?, github? }`. There is no generic credentials/base-URL/endpoint prop.
- `src/components/IntegrationsPage.tsx:52-62` branches per id **and** per truthy prop: `shortcut` → `ShortcutIntegrationCard`, `linear` → `LinearIntegrationCard`, `google-calendar` → `GoogleCalendarIntegrationCard`, `github` → `GithubIntegrationCard`; anything else falls through to the generic `IntegrationCard` with `renderActions?.(integration)`.
- Generic `IntegrationCard` (`src/components/IntegrationsPage.tsx:69-119`) renders the icon, name, description, auth-flow label, and either a disabled "Connect" (placeholder), `actions`, or the text "Not connected". Consequence: a new registry entry rendered without a matching branch prop would appear as a static "API token / Not connected" card with no controls — user-visible but functionally inert (inference from the fallthrough at lines 60-61).

### Route wiring

- `src/App.tsx:88` registers `/integrations` inside `AuthenticatedShell` (line 80) under `RequireAuth`; `src/App.tsx:48-50` lazy-imports the page.
- `src/App.tsx:108-135` `AuthenticatedIntegrationsRoute` uses `useAuth()` and `usePM()`, constructs one `Supabase*DataAccess` per integration with `useMemo(..., [session?.user.id])`, derives `currentTasks`/`projects` from PM state, and passes one prop bundle per integration. There is no `renderActions` usage and no fifth prop.
- Every existing card loads its own settings in a mount `useEffect` from the injected data-access object: `ShortcutIntegrationCard.tsx:82-99`, `LinearIntegrationCard.tsx:86-103`, `GithubIntegrationCard.tsx:130-148`, `GoogleCalendarIntegrationCard.tsx:159-186`. There is **no** integration-settings context/provider and no cross-page cache; each mount re-reads.
- Existing cards never call a third-party API directly. They call Supabase tables/RPCs/Edge Functions: `ShortcutDataAccess.ts:143-172` (`loadSettings`), `:174-190` (RPC `save_shortcut_settings`), `:223-236` (Edge Function `shortcut-sync`); `LinearDataAccess.ts:182-289` mirrors this; `GitHubDataAccess.ts` and `GoogleCalendarDataAccess.ts` use their own RPC/Edge Function calls.

### Browser-local secret precedent

- `src/lib/agent/apiKey.ts:1-2` declares `AGENT_API_KEY_STORAGE_KEY = "worktime:agent:apiKey"` and `AGENT_PROVIDER_STORAGE_KEY = "worktime:agent:provider"`.
- Structure (all in `src/lib/agent/apiKey.ts`): injectable `StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">` (line 13), SSR-safe `defaultStorage()` in try/catch (17-23), module-level cache + listener `Set` (53-61), `getAgentApiKey` that re-reads storage and reconciles the cache on each call (64-68), `setAgentApiKey` that trims and delegates empty input to clear (71-80), `clearAgentApiKey` (83-86), `subscribeToAgentApiKey` returning an unsubscribe (88-91), and an isolated `createAgentApiKeyStore(storage)` factory (114-151).
- There is **no** `storage` DOM event listener: cross-surface changes are only reconciled lazily on the next `get`, and no listener fires for external writes. Writes/removes are not wrapped in try/catch (read errors are swallowed); `SettingsPanel.tsx:150-164` catches write failures for UI.
- Consumers: `SettingsPanel.tsx:26-40,121-166` (set/clear/subscribe), `ProjectManager/AgentPanel.tsx:211,257` (readiness gate), `llmTransport.ts:151-160` (`createStoredAgentClient` reads key + provider).
- Direct browser fetch precedent: `src/lib/agent/llmTransport.ts:29-33,50-53` accepts an injected `fetchImpl`, defaults to `globalThis.fetch` (114-115), validates base URL (55-76), sends `Authorization: Bearer <key>` (121-128), validates the JSON body shape (89-107), and throws `LLMTransportError` with optional `status`/`responseBody` (35-46). There is **no** `AbortController`/timeout anywhere under `src/`.

### Goals: absent from this tree

- `src/lib/goals/` does not exist; `src/state/GoalContext.tsx`, `src/components/GoalsPage.tsx`, `src/components/goals/`, and any `/goals` route do not exist. `src/lib` directories are only `agent, data, engine, habits, integrations, pets, platform, todos`.
- Repo-wide (`src`, `e2e`, `tests`, `integration`) `GoalMetric` = 0, `overridePinned` = 0, `goals_state_v1` = 0, `MetricBlock` = 0, `sparkline` = 0, `liftingtracker` = 0 matches. The only `goal` hits in `src/` are Pomodoro copy in `TimerPanel.tsx:638` and its tests.
- `src/lib/data/staging/types.ts:195` is still `STAGING_SCHEMA_VERSION = 8`; issue #133 plans a `8 → 9` bump. There are no `saveGoals`/`loadGoals` methods in `src/lib/data/DataAccess.ts`, and no `goal*` migration under `supabase/migrations/`.
- The planned model exists only in docs: `docs/issues/issue-133.md:50` defines one metric per goal as `{ label, target, current, unit, source: "manual" | "liftingtracker", overridePinned }` with `"liftingtracker"` unreachable until #143; `docs/issues/issue-134.md:28,43-44` defines the metric block and `goals_state_v1` as UI-only; `docs/issues/issue-135.md:27,29` defines the rolling period (`periodStart = lastDeckBuiltAt ?? createdAt`, open `periodEnd`) and the sparkline series; `docs/issues/issue-138.md:30,47` states the deck chart series carries this period's movement plus the sparkline, and that metric text is "manual values only until #143"; `docs/issues/issue-141.md:27` excludes metric `current` and `overridePinned` from export.
- The epic plan places #143 last: `docs/plans/goals-epic-parallel-workflow.md:687-700` ("Phase 14 — Follow-ups (#143, then #142) … Only start these after the v1 epic is in real use"), and `:69-72` makes a #143 research doc a prerequisite, referencing `docs/research/issue-143.md`. `docs/research/` exists but was empty before this document.

### CORS, CSP, and network configuration

- `src-tauri/tauri.conf.json:20-22` sets `"csp": null` — the Tauri webview applies no Content-Security-Policy, so no origin allowlist is enforced there.
- `vite.config.ts` defines no `server.proxy`; `public/_redirects` is only the Cloudflare Pages SPA fallback (`/* /index.html 200`). There is no `_headers` file.
- Browser configuration is limited by policy to `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL` (`AGENTS.md:14`, enforced in `src/lib/supabaseEnv.ts:31-54`). No third-party origin is configured anywhere.
- The only existing browser-direct third-party request is the agent transport (`llmTransport.ts`), which posts to a hard-coded provider base URL or arbitrary user-supplied URL. Edge Functions set permissive CORS on their own responses (`supabase/functions/linear-sync/handler.ts:4-8`, etc.) but that governs browser→Supabase calls, not browser→LiftingTracker.

### Caching, versioning, and degradation

- There is no HTTP/data cache library or TTL mechanism in the repo (`package.json:34-49` has no query/cache dependency). The staging store explicitly does not cache (`src/lib/data/staging/LocalStagingStore.ts:342-348`).
- Versioned-payload precedent exists only for surface-local records: staging `schemaVersion` parse/throw (`src/lib/data/staging/types.ts:643-675`), agent snapshot `version: 1` rejected by returning `null` (`src/lib/agent/snapshotStore.ts:11,68`), Start-of-Day plan `version: 1` rejected by returning `null` in parse and throwing on save (`src/lib/agent/startOfDayPlanStore.ts:16,84,102-103`). All Edge Function wire shapes are **unversioned** and mismatches map to `*_INVALID_RESPONSE` codes (e.g. `ShortcutDataAccess.ts:231-235`, `LinearDataAccess.ts:268-288`).
- No "as of"/`lastKnown`/`asOf`/stale-value UI precedent exists. The nearest patterns are "Last synced: Never" timestamps (`GithubIntegrationCard.tsx:73-77,431`; `ShortcutIntegrationCard.tsx:312`; `LinearIntegrationCard.tsx:345`), a persisted `GitHubRepoRow.isStale` flag (`GitHubDataAccess.ts:20-29`), and per-source partial errors on Google Calendar (`GoogleCalendarDataAccess.ts:23-29`).

## Relevant Files And Entry Points

- `src/lib/integrations/registry.ts:1-47` — registry types, icon union, four entries; the extension point for a fifth entry.
- `src/lib/integrations/registry.test.ts:5-23` — hard-codes the exact id array and the allowed icon/authFlow values; will fail on a fifth entry until updated.
- `src/components/IntegrationsPage.tsx:14-19` — `ICONS` record (new icon must be added here and to the union).
- `src/components/IntegrationsPage.tsx:26-33` — page prop bundle shape a LiftingTracker card would extend.
- `src/components/IntegrationsPage.tsx:52-62` — id branch chain; unchained ids fall through to the generic card.
- `src/components/IntegrationsPage.test.tsx:7-19` — default render asserts four names, two "OAuth 2.0", two "API token"; `:21-70` asserts bound-card replacement and the `renderActions` slot.
- `src/App.tsx:88` — `/integrations` route inside the authenticated shell.
- `src/App.tsx:108-135` — `AuthenticatedIntegrationsRoute`, where a fifth settings instance/prop would be constructed and passed.
- `src/lib/agent/apiKey.ts:1-2,13,17-33,53-91,114-151` — the browser-local secret module pattern (storage key, trim, in-memory cache, subscribers, isolated store).
- `src/lib/agent/llmTransport.ts:29-33,55-76,110-160` — injected-`fetchImpl` direct browser client, URL validation, Bearer auth, response-shape validation, typed errors.
- `AGENTS.md:14,16` — policy: no push/background sync, service-role keys server-only; the localStorage exception paragraph.
- `src/lib/data/staging/LocalStagingStore.ts:22` and `src/lib/data/staging/types.ts:195` — staging key prefix and current schema version 8.
- `src/state/HabitContext.tsx:39`, `src/state/PetContext.tsx:10`, `src/state/TodoContext.tsx:29`, `src/state/ProjectManagerContext.tsx:13`, `src/components/TaskPanel.tsx:9` — existing UI-only localStorage keys handled with per-module try/catch, not governed by the staging store.
- `src/lib/integrations/githubOAuthReturn.ts:2` — `worktime:githubOAuthState:v1` is a **sessionStorage** key, not localStorage.
- `src/lib/data/ShortcutDataAccess.ts:143-236` — the contrast pattern: settings in Supabase, secret column write-only for authenticated clients, sync via Edge Function.
- `supabase/migrations/20260812000000_shortcut_settings.sql:21-33` — column grants that keep the token unreadable by the browser (the pattern #143 deliberately does not follow).
- `docs/issues/issue-133.md:50`, `docs/issues/issue-134.md:28,43-44`, `docs/issues/issue-135.md:27,29`, `docs/issues/issue-138.md:30,47`, `docs/issues/issue-141.md:27` — planned goal metric/period/series/export contracts.
- `docs/plans/goals-epic-parallel-workflow.md:69-72,687-700` — sequencing: #143 is a post-epic follow-up with a prerequisite research doc.

## Data Flow Or Control Flow

### Current integration settings flow (what exists)

1. User navigates to `/integrations`; `RequireAuth` (`src/auth/RequireAuth.tsx:9-15`) redirects unauthenticated users and `AuthenticatedShell` mounts the provider stack (`src/App.tsx:137-176`).
2. `AuthenticatedIntegrationsRoute` (`src/App.tsx:108-135`) constructs `Supabase*DataAccess(supabase, session.user.id)` per integration and passes a prop bundle to `IntegrationsPage`.
3. `IntegrationsPage` maps the registry (`src/components/IntegrationsPage.tsx:52-62`); a matching id+prop renders the bound card, otherwise the generic card.
4. The card's mount effect calls `dataAccess.loadSettings()`; the data-access class issues a Supabase table select/RPC/Edge Function (`ShortcutDataAccess.ts:143-172`, etc.). Loading and error states are component-local (`ShortcutIntegrationCard.tsx:58-99`).
5. Connect/save/disconnect are explicit user actions that call the data-access methods; the secret never comes back to the browser on load (the select list omits the token column).
6. No global cache: remounting the route re-reads settings.

### Browser-local secret flow (the pattern a LiftingTracker key would follow)

1. `SettingsPanel` initializes from `getAgentApiKey()`/`getAgentProvider()` and subscribes to both (`SettingsPanel.tsx:26-40`).
2. Save trims and writes to `localStorage` under `worktime:agent:apiKey`, updates the module cache, and synchronously notifies subscribers (`apiKey.ts:71-80`, `58-61`).
3. Consumers read the key at call time (`llmTransport.ts:151-160`) and perform a direct browser `fetch` with a Bearer header and injected `fetchImpl` (`llmTransport.ts:110-149`).

### Prospective LiftingTracker flow (derived from the issue; **no code path exists**)

1. `/integrations` card writes base URL, key, and default endpoint to browser-local storage; the key uses the `worktime:<domain>:<key>` convention.
2. Opening the Goals page (planned #134 `GoalProvider`) and building a deck (#138 `buildDeckPlan`) would trigger per-period aggregate fetches for goals whose `metric.source === "liftingtracker"`.
3. The period key would come from #135's derivation (`periodStart = lastDeckBuiltAt ?? createdAt`, open `periodEnd`), which is not implemented.
4. The fetched aggregate would populate the metric's current value, be badge-rendered as "auto", and feed the #138 series; typed input would set `overridePinned` and badge "override".
5. On failure, the last-known value plus an "as of" stamp would render instead of an error or zero. Neither the storage location nor the retrieval path for that last-known value is defined by current code or docs.

## Important Contracts And Constraints

- Registry contract: `IntegrationDefinition.id` is a `string`, but `icon` must be a member of `IntegrationIcon` **and** present in `ICONS` (`IntegrationsPage.tsx:14-19`); `authFlow` must be one of the two labels. `registry.test.ts` enforces an exact id order and currently rejects any other icon value.
- Page contract: bound cards require **both** `id` match and a truthy prop; the generic fallback only renders `renderActions`, which `App.tsx` never supplies. A registry entry alone produces no controls.
- Route contract: card data-access instances are owner-scoped and memoized on `session?.user.id`; `session!` is safe only because the route sits behind `RequireAuth` (`App.tsx:108-135`).
- Local persistence policy (`AGENTS.md:14,16`): the staging store (`worktime:staging:v1:*`) is the only general app-data exception; the named scoped agent keys (`worktime:agent:projectSnapshot:v1`, `worktime:agent:startOfDayPlan:v1`) are the undo/End-of-Day exceptions; `pm_state_v1` and `sb-...-auth-token` stay outside the store. The paragraph does **not** literally name `worktime:agent:apiKey`/`provider`, even though `apiKey.ts:1-2` implements them, and it does not cover the UI-only `habit_state_v1`/`todo_state_v1`/`pet_state_v1`/`task_panel_sort_v1` keys (those are small UI state, not secrets). Issue #143:18 requires an explicit `worktime:liftingtracker:*` addition; the plan repeats it at `goals-epic-parallel-workflow.md:697`.
- Secret handling: existing server-side integrations keep tokens out of browser reads via column-level grants (`supabase/migrations/20260812000000_shortcut_settings.sql:21-33`; `20261026000000_linear_settings.sql:10-20`). A browser-local key deliberately breaks that guarantee; `AGENTS.md:14` still forbids service-role credentials in the client and push/background sync.
- Goal metric contract (planned, not implemented): one metric per goal, `{ label, target, current, unit, source, overridePinned }` (`docs/issues/issue-133.md:50`); #143 is expected to change no schema because `source: "liftingtracker"` and `overridePinned` are pre-typed. #141 excludes metric `current` and `overridePinned` from export (`docs/issues/issue-141.md:27`).
- Versioned-record convention: local persisted records carry an explicit numeric version and either reject (staging, `types.ts:643-675`) or silently ignore (agent snapshot/plan, returning `null`) mismatches. Edge Function wire payloads are unversioned; there is no `VERSION_MISMATCH`-style code today.
- Network/environment policy: no proxy, no allowed-origin list, `csp: null` in Tauri, Cloudflare serves only the SPA fallback; only the three `VITE_*` values are sanctioned. Any LiftingTracker base URL is user-supplied at runtime.

## Existing Tests And Validation

- `src/lib/integrations/registry.test.ts:5-23` — exact four ids, unique ids, non-empty name/description, icon/authFlow allowed values, no placeholders.
- `src/components/IntegrationsPage.test.tsx:7-19` — default render of all four names, no "Coming soon", "Not connected", exactly 2 "OAuth 2.0" and 2 "API token"; `:21-70` — bound Shortcut/Linear/GitHub workflows replace the generic card, and a fictional integration gets the `renderActions` slot.
- `src/lib/agent/agent.test.ts:25-41` — fake Map storage: trims, persists, exposes, clears a key; `:43-57` — provider persistence and base URLs; `:97-115` — stored client posts to a custom base URL with a Bearer header via injected `fetchImpl`.
- `src/components/SettingsPanel.test.tsx:157-191` — end-to-end key save/clear through the panel, plus storage-quota failure surfacing.
- Integration suites: `integration/shortcutSettings.integration.test.ts`, `integration/linearSettings.integration.test.ts`, `integration/githubSettings.integration.test.ts`, `integration/googleCalendarSettings.integration.test.ts`, plus API/sync suites; none cover a browser-local integration key.
- E2E: `e2e/analytics|auth|habits|pets-sync|project-manager|responsive|timer.spec.ts`. No integrations spec and no goals spec.
- Harness: `vitest.config.ts:11-18` (jsdom, `src/test/setup.ts`, includes `src/**/*.test.{ts,tsx}` and `supabase/functions/**/*.test.ts`); `src/test/setup.ts:35-39` clears localStorage and sessionStorage after each test.
- Static guards: `scripts/verify-platform-cleanup.mjs` (`test:platform`) asserts the slim Tauri shell and that `AGENTS.md`/`package.json` do not mention retired strings; it does **not** assert the localStorage exception list. No test enforces storage allowlists.
- Validation commands (`package.json:7-32`): `pnpm test:unit`, `pnpm lint:app`, `pnpm build`, `pnpm test:pwa`, `pnpm test:platform`, `pnpm test:integration` (destructive `supabase db reset`), `pnpm test:e2e`, `pnpm test:all`, `pnpm branch:check`.

## Risks, Edge Cases, And Unknowns

- **Premise mismatch (highest risk).** #143's classification reason says the registry and metric data model "already exist", and its steps say only `"manual"` is selectable — but in this tree there is no goals domain, no metric block, no `GoalMetric`, no `overridePinned`, and staging is still v8. The issue cannot be implemented as scoped until #133/#134 (at least) land; #138 is described as a benefit, not a blocker.
- **CORS cannot be resolved from this repository.** There is no LiftingTracker API definition, base URL, sample payload, or fixture anywhere. The repo only proves that browser-direct fetch is possible (agent transport) and that no CSP/proxy/origin allowlist exists. Whether LiftingTracker sends `Access-Control-Allow-Origin`/preflight support for an `Authorization` header must be verified against a real deployment. The Tauri production webview origin is `http://tauri.localhost` (`src/lib/integrations/githubOAuthReturn.ts:3`), and the browser PWA origin is the Cloudflare Pages domain — both would need to be acceptable to the server (or the server must allow `*`, which is compatible with a non-credentialed request carrying a Bearer header — inference, not proven in-repo).
- **AGENTS.md is doc-only enforcement.** `verify-platform-cleanup.mjs` does not check storage keys, so a missing/duplicated exception line can drift silently. The current paragraph also does not enumerate `worktime:agent:apiKey`/`provider`, which weakens the claim in #143:18 that AGENTS.md "enumerates the agent keys". Requirements should not assume a literal `worktime:agent:*` wildcard exists in the text.
- **Registry/page test brittleness.** `registry.test.ts:6-11` asserts the exact id array and `IntegrationsPage.test.tsx:12,17-18` asserts four names and two "API token" labels. A fifth entry will fail these tests until they are updated; that is the intended guard but easy to overlook.
- **Icon handling.** A new `IntegrationIcon` member requires an `ICONS` entry (TypeScript enforces the record) but an unknown runtime string yields `undefined` and a broken render at `IntegrationsPage.tsx:85` (inference).
- **Override semantics vs persisted/synced state (inference; product decision needed).** If the auto-filled aggregate is written into `Goal.metric.current`, that field lives in the synced goal record (staging + merge + `updatedAt`), so every fetch could dirty the row, trigger saves, and race the provider's hydrate/suppress/revision lifecycle described in `docs/issues/issue-134.md:38`. If the auto value is not persisted, the "last-known value" for degradation has no defined storage (browser-local cache? in-memory only?) and would be lost on reload. Neither the issue nor the docs choose one.
- **Cache key and fetch fan-out.** The issue specifies a cache keyed by `(goal, period)` so preview edits and deck build reuse one fetch, but there is no cache infrastructure in the repo and no precedent for cache-hit assertions. Multiple `liftingtracker` goals in one tracker imply multiple per-period requests on page open and deck build; no batching, rate-limit, or concurrency contract exists.
- **No timeout/cancellation precedent.** `llmTransport` has no `AbortController` or timeout; a hung LiftingTracker request would leave the metric in a loading state until the browser gives up (inference). Failure-path behavior ("degrade, never an error wall, never a silent zero") has no existing implementation to copy.
- **Version mismatch behavior is undefined for this contract.** The issue asks for a versioned aggregate response, but the repo has no versioned wire format and no version-mismatch error code. It is also undefined whether a version mismatch should degrade to last-known, show "no data yet", or surface an actionable error.
- **Aggregate semantics are undefined.** "PR" (absolute best vs period best), bodyweight trend shape (series vs delta), units, rounding, and whether the endpoint returns all aggregates or one are not specified in code or docs. A first period with no history must produce "no data yet", which is a distinct state from unreachable.
- **Cross-surface secret behavior.** The agent key module does not listen for `storage` events; a second tab/WebView changing the LiftingTracker key will not notify an already-mounted metric block until a get occurs. Copying the pattern inherits this limitation.
- **Unknowns not inspected:** whether any remote branch (`origin/epic/goals`) contains the goals implementation — this checkout has only `main`/`origin/main` and no goals commits in `git log`; whether `docs/research/issue-143.md` (referenced by the epic plan) exists elsewhere; and whether the LiftingTracker service is first-party to this user (which would change the CORS/policy analysis).

## Downstream Guidance

- Requirements should account for: the hard dependency on #133/#134 (and the optional #138 series) before any metric-block work; the distinction between the integration card/key work (independently shippable) and the goal-metric auto/override work (blocked on the goals domain); an explicit AGENTS.md edit with the exact key name in the same change as the key module; and a decision on where the auto value and last-known value live (persisted synced metric vs transient/local cache), because that choice determines whether #143 truly changes no schema.
- Planning should consider: sequencing the registry/page/route/key/client pieces so `pnpm test:unit src/lib/integrations` can pass independently of goals; updating `registry.test.ts` and `IntegrationsPage.test.tsx` alongside the registry entry; adding the icon to both the union and `ICONS`; injecting `fetchImpl` and an injected clock for "as of" stamps so unit tests can cover parsing, version mismatch, unreachable degradation, and cache hits without network; and using `pnpm lint:app`, `pnpm test:unit`, `pnpm build`, plus the relevant integration/e2e gates at the end. The CORS/contract spike must produce a recorded decision (endpoint shape, aggregate definitions, CORS answer) before implementation, as the epic plan requires.
- Do not include: server-side storage for this key, an Edge Function proxy, Tauri `invoke` data paths, background sync/polling, a provider-list refactor of `GoalMetric.source`, changes to Shortcut/Linear token storage, or opportunistic extraction of a shared localStorage helper — none are required by the issue and several conflict with `AGENTS.md:14-16`.
