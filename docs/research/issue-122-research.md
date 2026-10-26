# Research: Spike — verify Linear GraphQL access and query shape

> Scope note: this document is the codebase research handoff for issue #124. It is **not** the issue's deliverable. The issue requires an empirically observed findings document at `docs/research/linear-spike-findings.md`; that file must be produced from a live Linear workspace and must not be replaced by this research.

## Overview

WorkTime already has a complete Shortcut integration vertical slice — Postgres credential table, authenticated Edge Function, pure API client, frontend data access, classification engine, card, and integration registry entry — and no Linear code at all. Issue #124 is a document-only spike: it must establish Linear's authentication header form, query shape, pagination, page size, state names, team-filter semantics, and `dueDate` shape against a real workspace before #125 (backend) and #126 (frontend) can be planned. The codebase matters here because it already fixes the contracts the findings have to satisfy (response shape, error codes, due-date normalization, proposal fields) and because the existing Shortcut client is the thing the spike must prove cannot be copied header-for-header.

## Issue Context

- User/requested outcome: a reviewable findings document that answers every open question in #124, including a verbatim GraphQL query string and the exact header form that authenticated it, a state-name-per-team list from a real workspace, the practical `first:` page size with complexity reasoning, whether the team filter is server-side and how an unknown key behaves, and whether `dueDate` satisfies `normalizeTaskDueDate`.
- Current pain or bug: no Linear code, query string, state list, pagination model, page-size policy, or error semantics exist in the repository, so a backend built now would guess at all of them. A wrong guess (for example a name-based status filter that matches no state names) produces a sync that reports "0 new" while looking healthy.
- Scope classification, if known: **T1** — one new research document plus out-of-band manual verification, no source/schema/runtime changes.
- Parent request: #122. Downstream: #125 (backend, blocked by this spike) and #126 (frontend, depends on #125 and this spike).

## Current Behavior

- **No Linear code exists.** A case-insensitive repository search for `linear` returns only the issue documents (`docs/issues/issue-124.md`, `issue-125.md`, `issue-126.md`) and unrelated SVG gradient strings. `supabase/functions/` contains `shortcut-sync`, `github-oauth-exchange`, `github-enumerate-repos`, `github-sync`, `google-calendar-auth`, `google-calendar`, `invite-signup`, and `_shared`.
- **The integration registry is a closed, tested list of three entries.** `integrationRegistry` contains Google Calendar, GitHub, and Shortcut only; `IntegrationIcon` is a closed union `"calendar" | "github" | "shortcut"` (`src/lib/integrations/registry.ts:3`), and `registry.test.ts` asserts the exact id list and that every icon is one of those three (`src/lib/integrations/registry.test.ts:6-19`). Adding Linear therefore requires touching a test as well as the union — but that is #126's work, not this spike's.
- **There is no `docs/research/` directory.** `docs/` currently holds `FEATURES.md` and six issue files (`issue-110.md`, then `issue-124.md` through `issue-128.md`). All of `docs/` is git-tracked (`git ls-files docs`), so anything written into `docs/research/` is committed by default.
- **The Shortcut client sends a custom header, not `Authorization`.** `shortcutJson` performs a `GET` with `{ Accept: "application/json", "Shortcut-Token": token }` (`supabase/functions/shortcut-sync/shortcutApi.ts:59-76`). There is no outbound `Authorization` usage anywhere in the Shortcut path.
- **Shortcut pagination follows an absolute `next` URL and guards origin/path.** `PAGE_SIZE = 250`, `MAX_PAGES = 4` (`shortcutApi.ts:3-4`); `nextSearchUrl` rejects non-string cursors, URLs whose origin or path differ from `https://api.app.shortcut.com/api/v3/search/stories`, and URLs already visited (`shortcutApi.ts:156-164`). The loop stops at four pages regardless of remaining results (`shortcutApi.ts:191-200`).
- **Shortcut truncation is silent.** When `MAX_PAGES` is reached the loop sets `url = null` without recording that more results existed, so the function returns at most 1,000 stories with no `truncated` signal. #125 explicitly replaces this with an explicit page cap plus a `truncated` flag.
- **Shortcut resolves identity and state names through two extra REST calls.** `fetchShortcutStories` calls `/api/v3/member` for `mention_name`, validates it against `/^[A-Za-z0-9._-]+$/`, calls `/api/v3/workflows` to build a `workflow_state_id → name` map, then searches with `team:"<name>" owner:<mention> -is:archived` (`shortcutApi.ts:147-201`). The client also re-filters `story.archived` after mapping (`shortcutApi.ts:195-198`).
- **The Edge Function authenticates the caller with `Authorization: Bearer <Supabase JWT>`.** `bearerToken` regex-extracts the Supabase JWT from the inbound request (`supabase/functions/shortcut-sync/index.ts:15-18`), verifies it with the service-role client (`index.ts:33-37`), loads the per-owner settings row including the third-party token (`index.ts:39-47`), and maps domain errors to `{ error, code }` plus optional `retry_after_seconds` (`index.ts:61-68`).
- **The frontend invokes the function with no explicit auth header.** `SupabaseShortcutDataAccess.sync()` calls `client.functions.invoke("shortcut-sync", { method: "POST" })` (`src/lib/data/ShortcutDataAccess.ts:223-236`); supabase-js supplies the user's JWT. The token is submitted once through the save/connect RPC (`ShortcutDataAccess.ts:174-190`) and is never selectable back into the browser; reads are service-role only.
- **The frontend validates the response at runtime and allow-lists error codes.** `isStory` checks `id`, `app_url`, `name`, `description`, `status_name`, `archived`, and `labels` (`ShortcutDataAccess.ts:125-135`); `mapFunctionError` only accepts codes in `FUNCTION_ERROR_CODES` and falls back to `NETWORK_ERROR` (`ShortcutDataAccess.ts:81-123`).
- **Classification is a pure function with fixed target fields.** Every Shortcut story becomes `status: "Backlog"`, `priority: "Medium"`, `tags: [story.story_type]`, `links: [story.app_url]`, `checklist: []`, `relatedTo: []`, with `dueDate` only when `normalizeTaskDueDate` succeeds and `estimatePomos` only when the source estimate is non-null (`src/lib/engine/shortcutClassification.ts:82-100`). #126 keeps `Backlog` and drops estimates entirely, so the Linear payload does not need `estimate`.
- **No test anywhere calls a live third-party API.** `integration/shortcutApi.integration.test.ts` runs the pure client with an injected `fetcher` (`integration/shortcutApi.integration.test.ts:28-92`); the settings tests run against local Supabase. This is consistent with #124 having no automated test.
- **Vendor documentation is not observation.** The issue's Testing section requires every claim to be seen directly. Published Linear documentation and the published schema are useful baselines (recorded below) but cannot satisfy that requirement.

## Relevant Files And Entry Points

- `supabase/functions/shortcut-sync/shortcutApi.ts:1-4` — endpoint constants, `PAGE_SIZE = 250`, `MAX_PAGES = 4`; the values the Linear client must not inherit.
- `supabase/functions/shortcut-sync/shortcutApi.ts:23-37` — `ShortcutErrorCode` union, `ShortcutApiError` with `status`, `code`, `retryAfterSeconds`; the error shape `LinearApiError` is meant to mirror.
- `supabase/functions/shortcut-sync/shortcutApi.ts:49-76` — `retryAfterSeconds` (numeric and HTTP-date parsing) and `shortcutJson` (`401` → token invalid, `429` → rate limited, other non-OK → upstream error, unparseable body → invalid response).
- `supabase/functions/shortcut-sync/shortcutApi.ts:156-164` — `nextSearchUrl`; the URL/visited guard that has no direct Linear analogue because Relay cursors are opaque strings.
- `supabase/functions/shortcut-sync/shortcutApi.ts:179-201` — `fetchShortcutStories`; identity resolution, state-name map, paginated fetch, archived filter, silent page cap.
- `supabase/functions/shortcut-sync/index.ts:15-68` — inbound bearer extraction, service-role client, owner-scoped settings read, `last_synced_at` write, error-to-JSON mapping.
- `supabase/config.toml:388-389` — `[functions.shortcut-sync] verify_jwt = true`; #125 adds the Linear equivalent.
- `src/lib/data/ShortcutDataAccess.ts:36-44` — frontend error-code union including transport fallbacks (`INVALID_SETTINGS`, `NETWORK_ERROR`, `UNKNOWN_ERROR`).
- `src/lib/data/ShortcutDataAccess.ts:81-123` — `FUNCTION_ERROR_CODES` allow-list and `mapFunctionError`; the mapper #126 says to reproduce with `LINEAR_*` codes.
- `src/lib/data/ShortcutDataAccess.ts:223-236` — `sync()` invocation and response validation.
- `src/lib/taskDueDate.ts:1-21` — the only accepted due-date shape; `normalizeTaskDueDate` (called from `ProjectManagerContext.tsx:533,556,615,650,884`).
- `src/lib/engine/shortcutClassification.ts:5-33` — `ShortcutStoryPayload` and `ShortcutTaskProposal`; the field set the Linear query must be able to populate.
- `src/lib/engine/shortcutClassification.ts:82-100` — proposal construction, due-date/estimate optionality, fixed status and priority.
- `src/lib/engine/shortcutClassification.ts:102-133` — dedupe-by-link and status-filter loop; #126 replaces the URL check with a tag-first check and removes the archived counter.
- `src/lib/integrations/registry.ts:1-39` — `IntegrationAuthFlow`, closed `IntegrationIcon` union, three-entry registry.
- `src/lib/integrations/registry.test.ts:4-19` — exact id list and closed-union assertions that Linear wiring must update.
- `src/state/types.ts:13-14,33-54` — `TaskStatus = "Backlog" | ...`, `TaskPriority = "Low" | "Medium" | "High"`, and `PMTask` (`dueDate?: string`, `tags`, `links`).
- `supabase/README.md:60-93` — the Shortcut contract as documented: RPCs, selectable columns, response `{ stories, synced_at }`, deploy command, no-secrets rule.
- `supabase/functions/google-calendar/googleCalendarApi.ts:278-286` — nearest existing precedent for a per-item `errors` array: it escalates any partial error to a hard `409` rather than using partial data.

## Data Flow Or Control Flow

Current Shortcut path, which the findings must eventually reproduce with Linear-specific steps:

1. User presses Sync in the Shortcut card. `SupabaseShortcutDataAccess.sync()` invokes the `shortcut-sync` function with no explicit headers (`ShortcutDataAccess.ts:223-236`).
2. supabase-js attaches the user's Supabase JWT as `Authorization: Bearer <jwt>`. The Edge Function extracts and verifies it, then derives `owner_id` from `auth.getUser` (`shortcut-sync/index.ts:15-37`).
3. The function reads `shortcut_settings` with the service-role client (`index.ts:39-47`). The third-party token is never selectable by an authenticated browser client (see the column grants documented in `supabase/README.md:60-83`).
4. `fetchShortcutStories` resolves the member and workflow-state map, then pages through the search endpoint up to four times (`shortcutApi.ts:179-201`).
5. Stories are mapped to a slim payload, archived items are dropped, and the function writes `last_synced_at` and returns `{ stories, synced_at }` (`index.ts:49-60`).
6. The frontend validates the payload, classifies it into proposals, shows a preview, and creates tasks through the existing PM path (`ShortcutDataAccess.ts:223-236`, `shortcutClassification.ts:102-133`).

Where the Linear path must diverge (per the issue and #125):

- **Transport**: `POST https://api.linear.app/graphql` with a JSON body `{ query, variables }`, not a `GET` with query params.
- **Outbound auth**: Linear expects the raw personal API key in `Authorization: <API_KEY>`; OAuth uses `Authorization: Bearer <token>`. This outbound header is a different direction from the inbound `Authorization: Bearer <Supabase JWT>` parsed at `shortcut-sync/index.ts:15-18`; the two must not be conflated in the Edge Function or in manual verification.
- **Pagination**: Relay `pageInfo.hasNextPage` / `pageInfo.endCursor`; the client must reject an empty/non-string cursor and a cursor that repeats, but cannot reuse the Shortcut origin/path guard because there is no `next` URL.
- **Identity and states**: a single GraphQL document can resolve `viewer { id }`, the assigned issues, and the state names; there is no separate `/workflows` equivalent to call.
- **Errors**: `response.ok` is not sufficient — a `200` can carry an `errors` array, potentially alongside partial `data`.
- **Truncation**: `MAX_PAGES` must produce an explicit `truncated: true`, not Shortcut's silent ceiling.

For the spike itself, this flow does not exist yet: verification happens out-of-band against `api.linear.app`, not through the app.

## Important Contracts And Constraints

- **Due-date contract**: `normalizeTaskDueDate` accepts a leading `YYYY-MM-DD` that is either the whole string or followed by `T…`, then round-trips the date key through `new Date("<key>T00:00:00.000Z")` and `toISOString().slice(0,10)` (`src/lib/taskDueDate.ts:1-21`). Tests pin `"2026-08-20"` → `"2026-08-20"`, `"2026-08-20T00:00:00Z"` → `"2026-08-20"`, `"2026-08-20T23:30:00-07:00"` → `"2026-08-20"`, and reject `" "`, `"August 20, 2026"`, `"2026-08-20Trash"`, `"2026-02-30T12:00:00Z"`, and `null` (`src/lib/taskDueDate.test.ts:4-20`). A date-only `YYYY-MM-DD` is the safest shape; anything without a two-digit month/day or with an impossible calendar date is discarded. `null` must be omitted from the proposal rather than passed through.
- **Proposal contract**: `ShortcutTaskProposal` requires `title`, `projectId`, `status`, `priority`, `description`, `tags`, `links`, `checklist`, `relatedTo`, with optional `dueDate` and `estimatePomos` (`src/lib/engine/shortcutClassification.ts:21-33`). `status` is always `"Backlog"` and `priority` is constrained to `Low | Medium | High` (`src/state/types.ts:13-14`; #126 maps Linear's five priorities onto these three, which is known to be lossy).
- **Payload fields**: the query must supply enough for title, description, URL, due date, priority, state name, and identifier. #126 additionally requires `linear:<identifier>` as the first (dedupe) tag, with URL comparison second and the URL slug normalized away.
- **Downstream response contract (#125/#126)**: `{ issues, states, synced_at, truncated }`, with `states` carrying the discovered state names that make a name-based filter usable across teams. Error codes: `LINEAR_NOT_CONFIGURED`, `LINEAR_TOKEN_INVALID`, `LINEAR_RATE_LIMITED`, `LINEAR_TEAM_NOT_FOUND`, `LINEAR_INVALID_RESPONSE`, `LINEAR_UPSTREAM_ERROR`, plus `retry_after_seconds` on rate limits. `LINEAR_TEAM_NOT_FOUND` must stay distinct from a legitimately empty result — which is exactly what the spike's unknown-team-key experiment decides (see Risks).
- **`estimate` is intentionally out of scope**: #124 says the field must not be requested at all, and #126 says imported tasks never carry an estimate. The findings document should record the exclusion explicitly, so a later implementer does not add it while "completing" the query.
- **Secrets policy**: no Linear token in any committed file, log, screenshot, or `VITE_` variable. `AGENTS.md:14` restricts browser config to `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_APP_URL`. `.gitignore` only covers `.env`, `.env.*` (except `.env.example`), `*.local`, and `supabase/.env.local` (`.gitignore:13,33-35,48-50`) — it does **not** exclude `docs/`, so a key pasted into the findings document would be committed. The existing model keeps the token in Postgres, readable only by the service role (`supabase/README.md:83,93`).
- **Vendor baseline (documentation and published schema, not observed in this workspace)** — recorded only so the spike knows what to test:
  - Endpoint `https://api.linear.app/graphql`; personal API key uses `Authorization: <API_KEY>`, OAuth uses `Authorization: Bearer <ACCESS_TOKEN>`; keys are created under Settings → Security & access.
  - Complexity: each object 1 point, each property 0.1 point, connections multiply their children by the pagination argument (default 50), rounded up; maximum **10,000 points per single query**; API-key callers get **3,000,000 points/hour** and **2,500 requests/hour**, both scoped to the authenticated **user**, so quota is shared with the user's other Linear tooling. Responses expose `X-Complexity`, `X-RateLimit-Complexity-*`, and `X-RateLimit-Requests-*`.
  - Rate limiting returns HTTP `429` with an `errors` entry whose `extensions.code` is `RATELIMITED`, plus `Retry-After` in seconds. GraphQL can also return HTTP `200` with a populated `errors` array and partial `data`.
  - Archived resources are excluded unless `includeArchived: true`.
  - Published schema facts (fetched 2026-10-26 from `linear/linear` `packages/sdk/src/schema.graphql`): `Query.viewer: User!`; `Query.team(id: String!): Team!`; `Query.teams(...)` returns a `TeamConnection`; `Team.key: String!`; `IssueFilter.assignee: NullableUserFilter` with `UserFilter.isMe: BooleanComparator`; `IssueFilter.team: TeamFilter` with `TeamFilter.key: StringComparator`; `Issue.dueDate: TimelessDate`; `Issue.identifier`, `priority`, `priorityLabel`, `state`, `team`, `url` exist; `PageInfo` has nullable `endCursor` and non-null `hasNextPage`. The `TimelessDate` scalar is documented as ISO 8601 and accepts input shortcuts such as `2021`.
  - A schema-derived observation worth testing rather than assuming: `team(id:)` takes only an id and is non-null (so a bad id likely errors), whereas `issues(filter: { team: { key: { eq: "ENG" } } })` filters server-side by key (so an unknown key likely yields an empty set). Only observation can say which path Linear actually uses and whether an unknown key is distinguishable from "no assigned issues".

## Existing Tests And Validation

- `integration/shortcutApi.integration.test.ts:28-60` — identity resolution, state-name mapping, `next`-cursor following, archived filtering, and the exact search query/page-size/detail parameters.
- `integration/shortcutApi.integration.test.ts:62-69` — `401` maps to `SHORTCUT_TOKEN_INVALID`.
- `integration/shortcutApi.integration.test.ts:71-78` — `429` plus `Retry-After: 17` maps to `SHORTCUT_RATE_LIMITED` with `retryAfterSeconds: 17`.
- `integration/shortcutApi.integration.test.ts:80-92` — a cursor that leaves the endpoint is rejected as `SHORTCUT_INVALID_RESPONSE`.
- `src/lib/taskDueDate.test.ts:4-20` — the accept/reject matrix for the due-date contract.
- `src/lib/engine/shortcutClassification.test.ts:115-125` — timestamp deadline normalizes to a date key; malformed deadline is omitted from the proposal.
- `src/lib/engine/shortcutClassification.test.ts:92-113` — null estimate/deadline mapping and fixed `Backlog`/`Medium` proposal fields.
- `src/lib/integrations/registry.test.ts:4-19` — registry id list and closed icon/auth-flow unions.
- `supabase/functions/google-calendar/googleCalendarApi.ts:278-286` — the only existing handling of a per-item `errors` array; it throws, so there is no partial-success precedent to copy.
- No test exercises a live Linear workspace, and #124 deliberately has no automated test. Validation for the spike is the manual checklist in the issue: assigned-set equality with the Linear UI, known-good and unknown team keys, an empty workspace, a failing/partial query where `errors` is inspected separately from `response.ok`, a `dueDate` sample, and a final diff review for key material.
- Repo commands that could run around a future implementation (`pnpm test:unit`, `pnpm test:integration`, `pnpm lint:supabase`, `pnpm build`) are not required for a document-only change; `pnpm test:integration` and `pnpm lint:supabase` additionally require the local Docker/Supabase stack.

## Risks, Edge Cases, And Unknowns

- **Team-key distinguishability is the highest-risk unknown.** If the implemented filter is `issues(filter: { team: { key: { eq } } })`, an unknown key returns an empty issue set that is indistinguishable from "no assigned issues", and #125's `LINEAR_TEAM_NOT_FOUND` cannot be produced without a separate `teams(filter: { key: { eq } })` lookup. If `team(id: "ENG")` resolves keys and is non-null, an unknown key may instead produce a GraphQL error. The spike must record both the known-good and deliberately unknown key responses (status, body, whether `errors` is present) and say which lookup supports the distinction. It must also test case sensitivity, since #125 requires case-insensitive comparison.
- **Whether partial data is usable is undecided.** The issue asks whether Linear ever returns `200` with populated `errors` and partial data. If yes, #125 needs a policy; the nearest existing precedent (`googleCalendarApi.ts:278-286`) rejects partial results rather than using them. The findings should capture the exact body and state whether `data.issues.nodes` is present and trustworthy.
- **Page size and complexity are only estimated until `X-Complexity` is read.** Using the documented formula and a candidate field set (`id`, `identifier`, `title`, `description`, `url`, `dueDate`, `priority`, `priorityLabel`, `state { id name }`, `team { id key }`, `pageInfo`), each issue costs about `1 + 0.8 + 1.2 + 1.2 = 4.2` points, so `first: 250` ≈ **1,050 points**, `first: 1,000` ≈ **4,200**, and `first: 2,000` ≈ **8,400** — near the 10,000 ceiling. This suggests 250 (the Shortcut value) leaves roughly 9× headroom and that the ceiling only binds near 2,000 for this field set, but the server's `X-Complexity` header is authoritative and the maximum accepted `first` value must be observed. A rejected-too-complex query's status/body/headers are also worth capturing, because it may be a `400` rather than a `429`.
- **Rate limits are per user, not per key.** If confirmed, a shared user quota means WorkTime sync competes with the user's other Linear integrations, and the `Retry-After` parser at `shortcutApi.ts:49-57` is only usable if Linear sends that header (numeric or HTTP-date). Capture the headers on a real `429` rather than trusting the documentation.
- **`dueDate` may be null or may arrive in a shape the normalizer rejects.** `Issue.dueDate` is a nullable `TimelessDate`; the findings must show a real non-null sample and a null sample, and state whether the value is date-only. `normalizeTaskDueDate` rejects an impossible date such as `2026-02-30`, so a "looks like ISO" value is not enough evidence.
- **Archived behavior is inherited by assumption.** Linear hides archived issues by default, which is why #126 drops `skippedArchived`. The spike should confirm the default query contains no archived issues so the frontend counter removal is justified.
- **A pasted key with a leading `Bearer ` is a real hazard.** Linear documents `Bearer` only for OAuth access tokens, so a personal key stored with that prefix is not the raw-key form and is expected to fail. #125 requires a clear report instead of sending it. The spike should record the exact `401` body for a raw key used as a Bearer token and whether it differs from a revoked-key `401`, otherwise the backend cannot tell the two apart.
- **Cursor reuse/opacity must be characterised.** The Shortcut guard compares full URLs; Linear cursors are opaque and may repeat or be empty at the end. The findings should record `endCursor` and `hasNextPage` on the last page and whether a cursor is stable across identical requests, since #125 must reject a revisited cursor without a URL to compare.
- **Secret leakage channels are broader than `.env`.** The findings document is committed under `docs/`, screenshots are often committed alongside research, and terminal output/shell history can retain the key. `.gitignore` does not protect `docs/`, and a `VITE_` variable would ship the key to the browser. The document should record the verification method and redact the key, org id, viewer id, and workspace URL rather than include raw responses verbatim.
- **Documentation is not evidence.** The vendor baseline above is useful for constructing the experiment, but the issue's completion criteria require direct observation. The findings should mark each claim as observed (with method/date/workspace shape) or documented, so #125 does not inherit an unverified assumption.
- **The findings document does not exist yet.** `docs/research/` has to be created, and #125/#126 both name `docs/research/linear-spike-findings.md` as a hard prerequisite.

## Downstream Guidance

- Requirements should account for:
  - A hard dependency on `docs/research/linear-spike-findings.md`; #125 and #126 must not start until it exists.
  - Each finding mapping to a concrete downstream value: verbatim query string and header form → `linearApi.ts`; state-name-per-team list → `states` in the sync response and the status-filter hints; page size and `X-Complexity` → `PAGE_SIZE`/`MAX_PAGES`/`truncated`; unknown-team behavior → whether `LINEAR_TEAM_NOT_FOUND` needs a separate lookup; `dueDate` sample → `normalizeTaskDueDate` compatibility; no-`estimate` decision → proposal shape.
  - The findings must say how "assigned to me" was compared against the Linear UI (filter used, UI view, date/time), because the requirement is set equality, not just a plausible-looking query.
  - The empty-workspace and failing-query observations must record status, `errors`, `data`, and headers separately, since the point is to distinguish "no results" from "failure".
  - The document needs a redaction statement confirming no key material appears, and should avoid org/viewer identifiers and full workspace URLs.
- Planning should consider:
  - The spike is document-only: no source edits, no schema/migration, no new dependency, and no committed scratch script. Manual verification can use a throwaway request outside the repository (or a script under `%TEMP%`) with the key supplied only through an untracked local shell variable.
  - The review step is a repository diff/status check plus a scan of the diff and rendered document for the pasted key value, not a test suite run. There is no automated test to add for this issue.
  - Sequencing is #124 → #125 → #126. #126 also depends on #125's contract, so the spike's response-shape decisions (`issues`, `states`, `truncated`) are load-bearing for both.
  - The findings should be specific enough that the backend author can paste the query verbatim and reproduce the same result set without re-deriving aliases, variables, or filter syntax.
- Do not include:
  - Implementing `linearApi.ts`, the `linear_settings` migration, the `linear-sync` function, `LinearDataAccess`, `linearClassification`, the registry entry, or the card — all of that belongs to #125/#126.
  - Reusing the Shortcut `Shortcut-Token` header or `next`-URL pagination, requesting `estimate`, adding a `VITE_` key, or adding a live Linear API test to CI.
  - Treating vendor documentation, schema inspection, or this research document as a substitute for the observed findings.
