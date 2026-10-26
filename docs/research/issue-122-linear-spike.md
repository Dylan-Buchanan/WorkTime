# Research: Spike — verify Linear GraphQL access and query shape

## Overview

WorkTime has three external integrations, all built the same way: an owner-scoped credential table, an authenticated Supabase Edge Function, a pure API client with an injected `fetch`, a frontend data-access class, and a per-integration card. Shortcut is the closest analogue because it is a personal-API-token integration, but its client is a GET-based REST client that cannot be reused for Linear.

No Linear code, query, dependency, or configuration exists anywhere in the repository. This document maps the existing contracts the spike's findings must satisfy, the exact places the findings will be consumed, and which of the issue's questions are answerable from code versus only from a live Linear workspace.

**Important:** the issue's required deliverable is `docs/research/linear-spike-findings.md`, containing facts *observed* against a real Linear workspace. That document does not exist, and no live workspace or API key was available during this research. This document is codebase research for the requirements/planning phases; it is **not** the findings document and does not satisfy the issue's completion criteria. See [Risks, Edge Cases, And Unknowns](#risks-edge-cases-and-unknowns).

## Issue Context

- User/requested outcome: a time-boxed spike that confirms, against a real Linear workspace, the API-key header form, the assigned-issues query, team-filter semantics, practical `first:` page size under the 10,000-point complexity ceiling, per-team workflow state names, and the `dueDate` shape — recorded in `docs/research/linear-spike-findings.md` with the verbatim query and no key material.
- Current pain or bug: there is no Linear access path at all. The auth header, pagination model, page size, error semantics, state names, and due-date serialization are all unknown, so the backend (#125) and frontend (#126) issues cannot be started without guessing.
- Scope classification, if known: T1 (per the issue). The parent feature (#122) spans #125 (T4 backend) and #126 (T2 frontend); this spike is the blocking research input for both.

## Current Behavior

### Repository inventory

- Seven Edge Functions exist: `invite-signup`, `shortcut-sync`, `google-calendar-auth`, `google-calendar`, `github-oauth-exchange`, `github-enumerate-repos`, and `github-sync` (`supabase/functions/`, `supabase/config.toml:385-404`). There is no `linear-sync`.
- No source file references Linear. Outside the three issue documents (`issue-124.md`, `issue-125.md`, `issue-126.md`), the only textual matches for `linear` are CSS `linear` timing functions and SVG `linearGradient` definitions. There is no Linear type, table, component, string, or environment variable.
- A search for `graphql` in every `*.ts` file returns zero matches. **No existing client sends a GraphQL request body or inspects a GraphQL `errors` array.**
- `docs/research/` existed but was empty before this document; earlier research documents (`agent-llm-transport.md`, `habit-context-provider.md`) were deleted in commit `e409f78`. There is no naming precedent to collide with, but there is also no existing findings document.

### The Shortcut precedent (the thing being mirrored)

- `fetchShortcutStories` performs two discovery GETs (`/api/v3/member`, `/api/v3/workflows`) and then paginated search GETs (`supabase/functions/shortcut-sync/shortcutApi.ts:179-202`).
- The API client is GET-only and authenticates with a custom `Shortcut-Token` header, not `Authorization` (`shortcutApi.ts:59-76`).
- Pagination follows a full `next` URL from the response body. `nextSearchUrl` requires the next URL to stay on the same origin and path and rejects revisits (`shortcutApi.ts:156-164`).
- Hard limits are `PAGE_SIZE = 250` and `MAX_PAGES = 4` (`shortcutApi.ts:3-4`). Exceeding them truncates silently; there is no `truncated` flag in the response.
- Archived stories are excluded twice: in the search query (`-is:archived`) and by an in-memory filter (`shortcutApi.ts:149`, `194-199`).
- Response validation is hand-written per field (`requiredString`, `requiredNumber`, `optionalString`, etc., `shortcutApi.ts:78-141`), and malformed payloads throw `SHORTCUT_INVALID_RESPONSE`.
- Status names are resolved from workflow ids via a `Map` assembled from the workflows response (`shortcutApi.ts:166-177`), with `"Unknown"` as fallback (`shortcutApi.ts:135`).
- Error mapping is HTTP-status based: `401 → SHORTCUT_TOKEN_INVALID`, `429 → SHORTCUT_RATE_LIMITED` (with `Retry-After` parsed as seconds or an HTTP date), other non-2xx `→ SHORTCUT_UPSTREAM_ERROR`, non-JSON `→ SHORTCUT_INVALID_RESPONSE` (`shortcutApi.ts:49-76`).
- The Edge Function verifies the caller's bearer JWT, derives the owner, loads the token with the service-role client, calls the fetcher, updates `last_synced_at` only after success, and returns `{ stories, synced_at }` (`supabase/functions/shortcut-sync/index.ts:15-68`).

### The GitHub precedent (REST, not GraphQL)

- `supabase/functions/_shared/githubApi.ts` is a non-Shortcut upstream client, but also GET-based REST with `Authorization: Bearer <token>` (`githubApi.ts:105-115`), page-number pagination, `PAGE_SIZE = 100`, `GITHUB_MAX_PAGES = 4` (`githubApi.ts:1-3`, `215-232`).
- It has no HTTP 200-with-`errors` handling; it only classifies status codes and JSON parse failures (`githubApi.ts:120-142`).
- `googleCalendarApi.ts` is the only client that sends an upstream `POST` with a JSON body (`/freeBusy`), and it inspects a nested per-calendar `errors` array on a successful response before trusting that calendar's data (`supabase/functions/google-calendar/googleCalendarApi.ts:265-286`). That is a REST-specific shape, not the GraphQL top-level `errors` array, but it is the nearest precedent for "200 response that contains errors".
- `github-sync` and `google-calendar` parse JSON **request** bodies (`full_name`, and `action`/parameters respectively) (`supabase/functions/github-sync/index.ts:31-42`, `supabase/functions/google-calendar/index.ts:71-73`). Neither sends a JSON body upstream, so neither is a GraphQL request precedent.

### Frontend behavior

- `integrationRegistry` contains exactly three entries — Google Calendar, GitHub, and Shortcut (`src/lib/integrations/registry.ts:14-39`). `IntegrationIcon` is a closed union of `"calendar" | "github" | "shortcut"` (`registry.ts:3`).
- `IntegrationsPage` maps the registry and renders a bespoke card via a ternary chain (`src/components/IntegrationsPage.tsx:48-56`); icons come from a closed `ICONS` record (`IntegrationsPage.tsx:13-17`). Anything not matched falls back to a generic card.
- `AuthenticatedIntegrationsRoute` constructs each data access per authenticated user and passes prop objects to the page (`src/App.tsx:107-127`). A `LinearDataAccess` would be constructed the same way.
- `SupabaseShortcutDataAccess` exposes `loadSettings`, `connect`, `updatePreferences`, `disconnect`, and `sync` (`src/lib/data/ShortcutDataAccess.ts:59-65`). Settings rows are read through the Data API with an explicit column list that excludes the token (`ShortcutDataAccess.ts:143-172`).
- Function errors are mapped from the response body's `code` against a closed allowlist; **any unrecognised code becomes `NETWORK_ERROR`** (`ShortcutDataAccess.ts:102-123`, `81-87`).
- `sync()` only forwards `stories` and `synced_at`, then validates each story with `isStory`, which checks `id`, `app_url`, `name`, `description`, `status_name`, `archived`, and `labels` only (`ShortcutDataAccess.ts:223-236`, `125-135`).
- The Shortcut card loads settings once, gates syncing on a "settings dirty" comparison, classifies the sync result into a preview, and creates tasks only after confirmation (`src/components/ShortcutIntegrationCard.tsx:175-230`, `76-80`).
- The classification engine produces a `ShortcutTaskProposal` with `status: "Backlog"`, hardcoded `priority: "Medium"`, `tags: [story_type]`, `links: [app_url]`, no checklist, and no relations (`src/lib/engine/shortcutClassification.ts:82-100`). Deduplication is URL-based only, across every task link (`shortcutClassification.ts:103-105`). There is no tag-based dedupe.

### Due-date contract

- `normalizeTaskDueDate` accepts only a leading `YYYY-MM-DD`, optionally followed by `T…`; date-times keep their source calendar date, and impossible dates are rejected (`src/lib/taskDueDate.ts:1-21`).
- It returns the date key, not the timestamp. `"2026-08-20T23:30:00-07:00"` yields `"2026-08-20"` (`src/lib/taskDueDate.test.ts:9-12`).
- A Linear `dueDate` is only usable if its serialized form starts with a valid `YYYY-MM-DD`; anything else is silently dropped from the proposal (`shortcutClassification.ts:86`, `92`).

### Secret-handling behavior

- Shortcut stores its token in plaintext in Postgres, protected only by column-level grants and RLS: `authenticated` may select non-secret columns and insert/update the token but may never select it back (`supabase/migrations/20260812000000_shortcut_settings.sql:21-33`); the service role can read it.
- Upserts go through an owner-derived RPC so PostgREST never needs table-level SELECT on the secret (`20260812000000_shortcut_settings.sql:57-100`), later relocated to the unexposed `private` schema with a public `SECURITY INVOKER` wrapper (`supabase/migrations/20260812050000_use_invoker_rpc_boundaries.sql:33`, `76`).
- `supabase/.env.example` contains only Google/GitHub OAuth server secrets and `SIGNUP_INVITE_CODE`; the root `.env.example` defines only the public `VITE_` values and explicitly forbids service-role keys, invite codes, or OAuth secrets in `VITE_` variables.
- `AGENTS.md` forbids Tauri `invoke` data paths, service-role keys in the browser, invite codes in the browser, and push/background sync. Integrations are on-demand user-triggered POSTs.

### Documentation-derived baseline (not observed; does not satisfy the issue)

Published Linear documentation states the following. These are useful priors for the spike, but the issue explicitly requires each claim to be observed against a real workspace:

- Endpoint `https://api.linear.app/graphql`; personal API keys use `Authorization: <API_KEY>` and OAuth uses `Authorization: Bearer <token>` ([Getting started](https://linear.app/developers/graphql)).
- GraphQL responses can partially succeed with HTTP 200 and a populated `errors` array ([Getting started](https://linear.app/developers/graphql#error-handling)).
- Relay pagination uses `first`/`after` with `pageInfo.hasNextPage` and `pageInfo.endCursor`; default page size is 50 ([Pagination](https://linear.app/developers/pagination)).
- A single query is capped at **10,000** complexity points; API-key callers get **2,500 requests/hour** and **3,000,000 complexity points/hour** per *user*, shared across that user's keys ([Rate limiting](https://linear.app/developers/rate-limiting)).
- Complexity is `0.1 × properties + 1 × objects`, with connections multiplying children by the `first:` value (default 50), rounded up ([Rate limiting](https://linear.app/developers/rate-limiting)).
- Rate limiting returns HTTP 429 with `errors[].extensions.code: "RATELIMITED"` and a `Retry-After` header ([Rate limiting](https://linear.app/developers/rate-limiting#handling-rate-limit-errors)).
- Archived resources are hidden by default and can be included with `includeArchived: true` ([Getting started](https://linear.app/developers/graphql#archived-resources)).
- Linear documents `viewer` for the authenticated user and `assignedIssues` on `User` ([Getting started](https://linear.app/developers/graphql#other-examples)).

## Relevant Files And Entry Points

- `supabase/functions/shortcut-sync/shortcutApi.ts:1-4` — `PAGE_SIZE`/`MAX_PAGES` constants that are Shortcut-specific and must not be copied to Linear.
- `supabase/functions/shortcut-sync/shortcutApi.ts:49-76` — `Retry-After` parsing, HTTP-status-to-error-code mapping, JSON parse failure handling.
- `supabase/functions/shortcut-sync/shortcutApi.ts:156-164` — URL-based cursor guard; there is no opaque-cursor guard anywhere.
- `supabase/functions/shortcut-sync/shortcutApi.ts:179-202` — discovery-then-paginate flow and where the missing Linear query would sit.
- `supabase/functions/shortcut-sync/index.ts:15-68` — JWT verification, owner derivation, service-role settings load, success-only `last_synced_at`, error-to-JSON mapping.
- `supabase/functions/_shared/githubApi.ts:51-143` — the clearest REST client template (headers, status mapping, page cap), but not a GraphQL template.
- `supabase/functions/google-calendar/googleCalendarApi.ts:265-286` — the only upstream `POST` JSON body and nested `errors`-array inspection in the repository.
- `supabase/functions/github-sync/index.ts:31-42` — JSON request-body parsing and unexpected-key rejection, useful shape for validating a `linear-sync` request.
- `src/lib/taskDueDate.ts:1-21` — the exact due-date contract the spike must verify against.
- `src/lib/engine/shortcutClassification.ts:20-33` — proposal fields the Linear payload must be able to populate.
- `src/lib/engine/shortcutClassification.ts:82-100` — fixed `Backlog`/`Medium` mapping and tag/link construction to depart from.
- `src/lib/engine/shortcutClassification.ts:102-133` — URL-only dedupe loop; the Linear frontend will replace this with tag-first dedupe.
- `src/lib/data/ShortcutDataAccess.ts:81-123` — closed error-code allowlist and `mapFunctionError` fallback to `NETWORK_ERROR`.
- `src/lib/data/ShortcutDataAccess.ts:223-236` — sync response validation pattern for `{ issues, states, synced_at, truncated }`.
- `src/lib/integrations/registry.ts:3`, `14-39` — closed `IntegrationIcon` union and registry entries.
- `src/components/IntegrationsPage.tsx:13-17`, `24-30`, `48-56` — icons, props, and card render branch.
- `src/App.tsx:107-127` — per-user data-access construction for the integrations route.
- `src/components/ShortcutIntegrationCard.tsx:76-80`, `175-230` — dirty-state gating, sync, preview, and partial-creation failure handling.
- `supabase/migrations/20260812000000_shortcut_settings.sql:8-100` — credential table, selective grants, RLS, owner-derived RPC.
- `supabase/migrations/20260812050000_use_invoker_rpc_boundaries.sql:33`, `76` — private definer / public invoker split.
- `supabase/config.toml:385-404` — function registration; `shortcut-sync` is the `verify_jwt = true` precedent.
- `supabase/README.md:60-93` — the Shortcut contract documentation the Linear section must mirror.
- `integration/shortcutApi.integration.test.ts:28-92` — injected-fetcher test pattern for auth, cursors, 401, and 429.
- `integration/shortcutSettings.integration.test.ts:10-118` — RLS/grant/secret-visibility test pattern.
- `integration/rpcPrivileges.integration.test.ts:83-90` — anonymous credential-write denial pattern.
- `tests/supabase/localSupabase.ts:26-46` — local user/client/admin fixture for integration tests.

## Data Flow Or Control Flow

### Existing Shortcut flow (the template)

1. User opens `/integrations`; `integrationRegistry` yields a Shortcut entry and `IntegrationsPage` renders `ShortcutIntegrationCard` with the per-user data access (`src/App.tsx:107-127`, `src/components/IntegrationsPage.tsx:48-56`).
2. Connect: the card calls `connect({ token, teamName, includedStatuses, defaultProjectId })`, which normalises preferences and calls the `save_shortcut_settings` RPC (`src/lib/data/ShortcutDataAccess.ts:174-190`).
3. The RPC is a public invoker wrapper over a private definer that upserts on `owner_id`; the token is written but never returned (`supabase/migrations/20260812000000_shortcut_settings.sql:60-100`, `20260812050000_use_invoker_rpc_boundaries.sql:33`).
4. Sync: the card calls `dataAccess.sync()`, which invokes `shortcut-sync` with `POST` (`src/lib/data/ShortcutDataAccess.ts:223-230`).
5. The function verifies the bearer JWT, derives the owner, loads `shortcut_token` and `team_name` through the service-role client, and returns 409 `SHORTCUT_NOT_CONFIGURED` if the row is missing or malformed (`supabase/functions/shortcut-sync/index.ts:24-47`).
6. `fetchShortcutStories` resolves the member and workflow states, then pages the search endpoint, mapping and filtering archived stories (`shortcutApi.ts:179-202`).
7. On success the function writes `last_synced_at` and returns `{ stories, synced_at }` (`index.ts:49-60`). On failure it returns `{ error, code, retry_after_seconds? }` with the mapped status (`index.ts:61-68`).
8. The frontend validates the payload shape, classifies stories against current tasks and included statuses, shows the preview, and only creates tasks after confirmation (`src/lib/data/ShortcutDataAccess.ts:231-236`, `src/components/ShortcutIntegrationCard.tsx:175-230`).

### Where Linear would enter (currently absent)

- A `linear-sync` function would need a new step 6: a `POST` to `https://api.linear.app/graphql` with a JSON body. `googleCalendarApi.ts` is the closest POST-with-JSON-body precedent, but no existing client posts GraphQL or checks a top-level `errors` array.
- Cursor handling would be string-based (`after: endCursor`) rather than URL-based; the existing `nextSearchUrl` guard has no analogue.
- A partial-success step would be required between HTTP success and payload validation: inspect `errors` before trusting `data`. Only the Google freeBusy path inspects a nested `errors` array today, and it throws instead of using partial data.
- The sync response would be `{ issues, states, synced_at, truncated }` (per #125), so the frontend validator and classification would diverge from `isStory`/`ShortcutStoryPayload`.

### Failure path (current, established behavior)

1. Transport failure, non-JSON, 401, 429, or other non-2xx is converted to a typed API error inside the pure client.
2. The Edge Function serialises `code` plus optional `retry_after_seconds`.
3. `mapFunctionError` reads `context.json()`, checks the code against a closed allowlist, and otherwise reports `NETWORK_ERROR` (`ShortcutDataAccess.ts:102-123`).
4. The card maps codes to user-facing messages, including a reconnect affordance for `*_TOKEN_INVALID` and a countdown for `*_RATE_LIMITED` (`src/components/ShortcutIntegrationCard.tsx:34-49`, `300-307`).

## Important Contracts And Constraints

- **Planned Linear response contract:** `{ issues, states, synced_at, truncated }`, with `states` being distinct state names discovered during the run (#125). Today's Shortcut contract is `{ stories, synced_at }` with no truncation signal.
- **Error contract:** stable codes plus optional `retry_after_seconds`; the frontend only understands codes in its allowlist, and anything else silently becomes `NETWORK_ERROR`. Linear's `LINEAR_TEAM_NOT_FOUND` and the other new codes must be added to that allowlist in #126.
- **Auth contract:** the Shortcut fetcher's `Shortcut-Token` header is not portable. The spike must record the exact header form that authenticated, and the backend must not blindly prepend `Bearer` to a personal API key.
- **Pagination/limit contract:** Shortcut's `PAGE_SIZE = 250` and `MAX_PAGES = 4` are arbitrary and Shortcut-specific; Linear's page size must be derived from the 10,000-point single-query ceiling and a chosen field set, and a page cap must surface as `truncated`.
- **Due-date contract:** `normalizeTaskDueDate` requires a leading `YYYY-MM-DD` that round-trips as a real UTC date. A Linear date-only value works only if serialized exactly in that form; an empty string or absent field must become "no due date", not an invalid one.
- **Proposal contract:** every imported issue must be representable as a `ShortcutTaskProposal`-shaped object — `title`, nullable `projectId`, `status` (`Backlog`), `priority` (`Low | Medium | High`), optional `dueDate`/`estimatePomos`, `description`, `tags`, `links`, `checklist`, `relatedTo` (`src/lib/engine/shortcutClassification.ts:20-33`, `src/state/types.ts:33-54`). Linear's priority scale has to collapse lossily into three values (#126 documents Urgent/High → High, None → Medium).
- **Dedupe contract:** the existing engine dedupes by normalised URL only. The Linear slice is planned to dedupe by a `linear:<identifier>` tag first, so tags must survive `createTask`/`PMTask` unchanged (a #126 requirement to verify, not a spike requirement).
- **Secret boundary:** tokens are plaintext at rest, protected by column grants and RLS; authenticated clients may never select them; RPCs are owner-derived and split into private definer + public invoker. No token may appear in an env file, log, screenshot, committed file, or `VITE_` variable.
- **Repository rules:** no Tauri `invoke` data paths; no background/push sync; integrations are user-triggered. `verify_jwt = true` is required for the new function.
- **Test topology:** unit tests run from `src/**` and `supabase/functions/**` under jsdom; integration tests run only from `integration/**` under Node and require the local Supabase stack (`vitest.config.ts`, `vitest.integration.config.ts`, `package.json` scripts).

## Existing Tests And Validation

- `integration/shortcutApi.integration.test.ts:28-92` — fake `fetcher` asserting request URLs and query parameters, page following, archived filtering, 401, 429 with `Retry-After`, and cursor-origin rejection. This is the closest harness for a `linearApi` test, but there is no GraphQL request-body or `errors`-array case.
- `integration/shortcutSettings.integration.test.ts:10-118` — owner upsert via RPC, preference update, non-secret column visibility, denial of `shortcut_token` select, admin read, `last_synced_at` spoof denial, and cross-owner isolation.
- `integration/googleCalendarApi.integration.test.ts:67-91` — injected-fetcher harness that routes a `POST /freeBusy` call and asserts interval shaping and event query parameters; it does not assert the request body or the nested-`errors` branch.
- `integration/rpcPrivileges.integration.test.ts:83-90` — anonymous `save_shortcut_settings` is denied; the Linear RPCs will need equivalent cases.
- `src/lib/taskDueDate.test.ts:4-20` — date-only, ISO timestamp, offset timestamp, blank/malformed/impossible date behavior.
- `src/lib/engine/shortcutClassification.test.ts:48-135` — URL normalisation, dedupe across tasks, status/archived counting, nullable field mapping, points→pomodoros, malformed deadline omission.
- `src/components/ShortcutIntegrationCard.test.tsx:64-180` — connect, save/disconnect, preview-then-create, preview removal, partial creation failure, invalid-token and rate-limit messaging.
- `src/components/IntegrationsPage.test.tsx:7-43` — every registered integration renders as implemented and bound cards replace the generic card.
- `src/lib/integrations/registry.test.ts:4-22` — registry ids, unique ids, required metadata, and the icon/auth-flow unions.
- Missing coverage: there is no fixture of a real Linear GraphQL response, no test that inspects a top-level GraphQL `errors` array (the Google freeBusy nested-errors branch is also untested), no test for opaque cursor loops or cross-page dedupe, no test for `truncated`, and no automated way to validate state-name discovery. The issue explicitly has no automated test; validation is manual against a real workspace.

## Risks, Edge Cases, And Unknowns

- **The deliverable cannot be produced from code alone.** No Linear token, workspace, or SDK is present, and no credentials were used or searched for. Every acceptance criterion in the issue is an empirical observation that remains unanswered. The documentation-derived baseline above is *not* evidence.
- **Auth header ambiguity:** the raw personal key vs `Bearer <token>`; a key pasted with a leading `Bearer ` may produce a confusing 401, and no existing code detects or normalizes that. Whether the backend should reject it locally is unresolved.
- **Query shape:** whether `viewer { id }` + `assignedIssues` returns exactly the UI's "assigned to me" set, and whether state names can be aliased into the same request (the backend needs them in the same run) is unverified. Whether the viewer id is needed at all, or `viewer.assignedIssues` alone suffices, is unverified.
- **Team filter semantics:** whether filtering is done by team key server-side (e.g. `team(key: "ENG")`), whether comparison is case-sensitive, and whether an unknown key yields `null`, an empty connection, or a GraphQL error — the backend plans to distinguish "unknown team" from "empty result", and that distinction is not provably available yet.
- **Page size and complexity:** the practical safe `first:` depends on the exact selected field set; the 10,000-point ceiling is per query, while 3,000,000 points/hour and 2,500 requests/hour are per user and shared with the user's other Linear tooling. A page size that passes one query can still exhaust an hourly budget over a full sync. The findings must show the complexity math, not just a number.
- **Partial success:** HTTP 200 with a populated `errors` array is documented but not observed here. Whether the returned partial `data` is usable, and whether an `errors`-only response can still have `data: null`, determines the error mapping. No current client has a precedent for treating partial data as usable.
- **Rate-limit detection:** whether `429` reliably carries both `extensions.code: "RATELIMITED"` and `Retry-After`, and whether an over-complexity query returns `429` or a GraphQL validation error, is unverified. The existing `Retry-After` parser handles seconds and HTTP dates only.
- **Cursor opacity and loops:** Linear cursors are opaque strings, not URLs. The existing guard cannot be reused; the backend must detect a revisited cursor and enforce a page cap. Whether Linear can legitimately return a repeated cursor or terminate with `hasNextPage: false` and a non-null `endCursor` is unverified.
- **State names:** per-team naming can differ; duplicate names across teams collapse under a name-based filter; archived states may or may not appear in `workflowStates`; the findings must record state names *per team* with the team key, not a flat deduped list.
- **Due date serialization:** `dueDate` is expected to be a date-only `TimelessDate`, but whether it is always `YYYY-MM-DD`, whether `null` is used for absent dates, and whether any timezone-adjacent value appears is unverified. `normalizeTaskDueDate` silently discards anything that does not match, so a wrong assumption produces missing due dates rather than an error.
- **Empty workspace:** whether no assigned issues yields `{ nodes: [], pageInfo: { hasNextPage: false } }` rather than an error is unverified, and #125/#126 depend on distinguishing "nothing assigned" from "nothing matched the filter".
- **`estimate` exclusion:** the backend must not request `estimate` at all. The spike must record that it was excluded, not merely omitted from the sample output.
- **Documentation collision:** the issue's required artifact is `docs/research/linear-spike-findings.md`; this document is deliberately named differently so it is not mistaken for completed findings. The `docs/research/` directory was empty before this file and remains untracked in git.
- **No secrets in evidence:** any token used during manual verification must not appear in the committed document, terminal transcripts pasted into it, screenshots, or a `VITE_` variable. A findings document produced during verification must be re-read before commit for this.

## Downstream Guidance

- Requirements should account for:
  - The spike's findings document is a hard dependency for #125 and #126, and must contain *observed* answers: the exact authenticated header form, the verbatim query, the per-team state-name list, the chosen `first:` with complexity reasoning, team-filter behavior for a good and an unknown key, the `dueDate` sample, the `Retry-After`/`RATELIMITED` observation, and an explicit statement that `estimate` was not requested.
  - The documentation-derived baseline in this document is a prior, not evidence. Requirements should not treat it as satisfying the spike.
  - The repository already fixes several constraints the findings must respect: `normalizeTaskDueDate`'s `YYYY-MM-DD` contract, the three-value priority ceiling, `Backlog` as the only target status, the closed frontend error-code allowlist, and the secret boundary (column grants + owner-derived RPCs).
  - The Linear backend introduces the repository's first GraphQL client and first top-level `errors`-array inspection, so the findings must explicitly state how partial success and validation errors should map to `LINEAR_INVALID_RESPONSE` vs `LINEAR_UPSTREAM_ERROR` vs `LINEAR_TEAM_NOT_FOUND`.
- Planning should consider:
  - The spike itself is out-of-band: no schema, function, or frontend file should change. The only committed artifact is the findings document (plus this research document).
  - Verification needs a real personal API key from Linear's Security & access settings and a workspace with at least one assigned issue, one empty-state check, and one deliberately unknown team key.
  - Backend planning should size `MAX_PAGES` and the page size together with a `truncated` flag, and should not copy Shortcut's 250/4 constants or its silent 1,000-item ceiling.
  - Frontend planning should not assume the sync payload shape until #125 fixes `issues`, `states`, and `truncated`; the `isStory` validator and `ShortcutSyncResult` are not reusable as-is.
  - Validation sequencing after implementation: `pnpm test:unit` for classification/card/registry, `pnpm test:integration` for the API client and RLS (requires `pnpm supabase:start`), and a manual `pnpm supabase:serve` pass for not-configured and successful syncs.
- Do not include:
  - Implementing any part of the Linear schema, Edge Function, data access, classification, card, or registry entry in the spike.
  - Storing a Linear token in source, tests, fixtures, logs, screenshots, `.env` files, or any `VITE_` variable; adding a Tauri `invoke` path; or adding background/push sync.
  - Reusing Shortcut's `Shortcut-Token` header, `nextSearchUrl` URL guard, 250/4 page policy, or `{ stories, synced_at }` response shape unchanged.
