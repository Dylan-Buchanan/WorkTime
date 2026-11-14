# Research: Add Linear Estimation Support And Audit Current Estimate Mappings

## Overview

WorkTime already has a complete estimate pipeline for Shortcut imports: the `shortcut-sync` Edge Function passes a nullable numeric `estimate` through, `src/lib/engine/shortcutClassification.ts` converts points to pomodoros with a module-private lookup table plus identity fallback, `buildShortcutTaskProposal` conditionally sets `estimatePomos`, the Shortcut preview renders `"N pomodoros"`, and `createTask` persists the proposal value (falling back to the app task's `target_pomodoros`). The Linear pipeline is the same shape but deliberately stops before estimates: the GraphQL query does not request `estimate`, the payload mirror has no field, `LinearTaskProposal` has no `estimatePomos`, the preview renders only priority/due date/tag, and `createTask` therefore applies its default. This issue closes that gap by mirroring the Shortcut pipeline, while confirming that the existing Shortcut points→pomodoros table is the intended single source of truth.

## Issue Context

- User/requested outcome: Linear imports should carry the issue's effort estimate, converted exactly like Shortcut points, so Today/Week pomodoro totals and daily load are accurate. The Shortcut `{{0:1, 1:3, 2:5, 3:8, 5:12}}` table plus identity fallback is confirmed as the intended mapping and documented as the single source of truth. Unestimated Linear issues keep today's behaviour (`createTask` default). Dedupe, status filtering, priority mapping, tags, links, due-date normalization and empty-result messaging stay unchanged.
- Current pain or bug: `LINEAR_SYNC_QUERY` selects no `estimate` (`supabase/functions/linear-sync/linearApi.ts:13`), `LinearIssuePayload` has no estimate (`:28-37` and the engine mirror `src/lib/engine/linearClassification.ts:5-14`), `LinearTaskProposal` omits `estimatePomos` and its doc comment asserts Linear exposes none (`src/lib/engine/linearClassification.ts:16-34`), the preview renders no pomodoro count (`src/components/LinearIntegrationCard.tsx:566-570`), and `confirmPreview` carries a comment saying proposals carry no estimate (`:227-233`). Every imported Linear task gets `createTask`'s default target.
- Scope classification, if known: T2 (issue-declared). Narrow vertical slice mirroring an existing, fully-read Shortcut pipeline; roughly ten files; no schema, permission, or data-format change; `PMTask.estimatePomos` already exists (`src/state/types.ts:49`).
- Research decisions the issue asks to settle: conversion coupling (import `shortcutPointsToPomodoros` vs export/rename the table), Linear `estimate: 0` semantics, non-table/fractional values, and `isIssue` tolerance of a missing field. Also confirm the Shortcut table needs no value changes.

## Current Behavior

### Shortcut estimate pipeline (working reference)

- The `shortcut-sync` client is REST, not GraphQL: it requests the search endpoint with `detail=full` (`supabase/functions/shortcut-sync/shortcutApi.ts:147-154`), so `estimate` arrives without being named in a field list. It is typed `estimate: number | null` (`:13`) and mapped with `optionalNumber` (`:103-108`, applied at `:132`), which returns `null` for `null`/`undefined` and throws `invalidResponse()` (502, `SHORTCUT_INVALID_RESPONSE`) for a non-number or non-finite value. Fractional numbers are not rejected.
- `SHORTCUT_POINTS_TO_POMODOROS` is a module-private, non-exported `const` (`src/lib/engine/shortcutClassification.ts:54-60`). `shortcutPointsToPomodoros` is exported (`:62-67`), returns `TABLE[points] ?? points`, and performs no finite/integer/positive validation: `0→1`, `1→3`, `2→5`, `3→8`, `5→12`, while `4→4`, `13→13`, `4.5→4.5`, `NaN→NaN`.
- `ShortcutTaskProposal` includes `estimatePomos?: number` (`:27`). `buildShortcutTaskProposal` conditionally spreads it with a strict null check: `...(story.estimate !== null ? { estimatePomos: shortcutPointsToPomodoros(story.estimate) } : {})` (`:93`). A `null` estimate yields an object with **no** `estimatePomos` key; a non-null estimate is stored unrounded.
- The Shortcut preview conditionally renders `{proposal.estimatePomos !== undefined && <span>{proposal.estimatePomos} pomodoros</span>}` between priority and due date (`src/components/ShortcutIntegrationCard.tsx:485-489`; the estimate span is line 487). No pluralization and no rounding; value `1` would render "1 pomodoros".
- `confirmPreview` forwards the proposal minus `title` straight to `createTask` (`src/components/ShortcutIntegrationCard.tsx:196-206`), so `estimatePomos` reaches the PM layer unchanged.
- `shortcutPointsToPomodoros` is published from the engine barrel (`src/lib/engine/index.ts:39`) alongside `buildShortcutTaskProposal`, `classifyShortcutStories`, `normalizeShortcutUrl` (`:35-40`), with a separate type-export block (`:41-47`).
- A prior research document already records this mapping and its time equivalents: `docs/research/shortcut-points-to-time-mapping.md:15-40`. It notes the identity fallback (line 25), the `null` omission (line 26), the `"<n> pomodoros"` preview (line 27), the `work_minutes` scaling (lines 28-39), and that unsupported/non-integer values are untested (line 78).

### Linear estimate pipeline (gap)

- `LINEAR_SYNC_QUERY` issue selection is `nodes { id identifier title description url dueDate priority state { name } }` (`supabase/functions/linear-sync/linearApi.ts:6-25`, selection on `:13`). The word `estimate` does not appear in the file's query or payload.
- `mapIssue` (`:145-160`) validates `priority` as an integer 0–4 and `state` as a record, then rebuilds the payload from the eight checked fields. It uses `requiredString` (`:64-67`) and `nullableString` (`:69-72`); `nullableString` allows only `null` or `string`, so `undefined` throws `invalidResponse()` (502, `LINEAR_INVALID_RESPONSE`, message "Linear returned an invalid response").
- `fetchLinearIssues` (`:162-218`) dedupes issues by `id` (`:200`), collects state names, returns `{ issues, states, truncated }`; `handler.ts` spreads it into `{ issues, states, truncated, synced_at }` (`supabase/functions/linear-sync/handler.ts:64`) and never reads the request body.
- The frontend mirror has no estimate: `LinearIssuePayload` (`src/lib/engine/linearClassification.ts:5-14`), and `LinearTaskProposal` (`:23-34`) lists only `title, projectId, status, priority, dueDate?, description, tags, links, checklist, relatedTo`. Its doc comment (`:16-22`) states: "Linear does not expose an estimate in the sync payload, so `estimatePomos` is never set here. `createTask` still assigns its own fallback estimate to the persisted timer/PM task today; this proposal deliberately carries none."
- `buildLinearTaskProposal` (`:103-121`) conditionally spreads only `dueDate`; no estimate path exists.
- `LinearIntegrationCard` imports `classifyLinearIssues`, `describeLinearEmptyResult`, `LinearClassificationResult` and `LinearTaskProposal` directly from the engine submodule (`src/components/LinearIntegrationCard.tsx:9-14`). `ProposalPreview` renders priority, `Due <date>` and `proposal.tags[0]` (`:566-570`). `confirmPreview` destructures `title` and forwards the rest with the comment at `:227-233`, so today no estimate is ever passed.
- `onProjectChange` spreads the existing proposal (`{ ...proposal, projectId }`, `:386-391`), so any future `estimatePomos` on a proposal is preserved when the user changes the project.

### Runtime guard behaviour

- `isIssue` (`src/lib/data/LinearDataAccess.ts:158-174`) validates `id`, non-blank `identifier`, `title`, `description`, `url` as strings, `dueDate` null-or-string, integer `priority` 0–4, and `state.name` as a string. It never rejects unknown properties, so an added payload field is currently ignored rather than failing validation, and a present but malformed `estimate` is likewise not validated today.
- `sync()` (`:260-289`) invokes `linear-sync` with `{ method: "POST" }`, maps transport/function errors through `mapFunctionError` (`:135-156`), and rejects the whole response with `LINEAR_INVALID_RESPONSE` if `issues` is not an array of `isIssue`-passing objects, `states` is not a string array, `truncated` is not boolean, or `synced_at` is not a string.
- For contrast, the Shortcut guard `isStory` (`src/lib/data/ShortcutDataAccess.ts:125-135`) validates only `id`, `app_url`, `name`, `description`, `status_name`, `archived`, and `labels`; it does not validate `estimate` at all. The Linear guard is already stricter than the Shortcut guard for the fields it covers.

### Estimate consumption and normalization after creation

- `ProjectManagerContext.createTask` (`src/state/ProjectManagerContext.tsx:622-686`) reads `opts.estimatePomos` (`:624`); if absent and `timeSpentMinutes > 0`, derives `Math.max(1, Math.round(minutes / work_minutes))` (`:625-628`); if still not a finite positive number it uses `1` (`:629-631`); the app task is created with `Math.max(1, Math.floor(target))` (`:632`). The PM row then persists the raw `opts.estimatePomos` when defined, else `created.target_pomodoros` (`:642` and `:683`). There is no `CreateTaskOptions` type; the signature is `Partial<PMTask>` (`:94`, and the card prop at `LinearIntegrationCard.tsx:20`).
- The engine normalizes the backend target again: `stateCommands.createTask` writes `target_pomodoros: normalizePositiveInteger(...)` (`src/lib/engine/stateCommands.ts:30-50`), and `normalizePositiveInteger = Math.max(1, Math.trunc(value))` (`src/lib/engine/core.ts:129-131`). Custom week/todo creation paths also floor: `StateSyncBridge.tsx:271` uses `Math.max(1, pmTask.estimatePomos || 1)`; `TodaySurface.tsx:220` uses `Math.max(1, Math.floor(task.estimatePomos))`.
- PM state is normalized on every server snapshot application: `normalizeState` (`src/state/ProjectManagerContext.tsx:890`) computes `estimatePomos` as `Math.max(1, Math.round(Number(raw)))`, `undefined` when non-finite (`:934-940`), called from `applyServerState` (`:256-257`). `src/state/ProjectManagerContext.test.ts:147-164` pins the clamp: `0.4 → 1`.
- `StateSyncBridge` propagates linked tasks: `collectPropagationTargets` skips PM tasks without a numeric `estimatePomos` (`src/state/StateSyncBridge.tsx:36-51`), computes `desired = Math.max(1, Math.round(pmTask.estimatePomos))` (`:41-43`), writes `{ estimatePomos: target.desired }` back onto the PM task whenever `desired !== estimatePomos` (`:158-161`), and pushes `desired` to `data.setTaskTarget` (`:162-176`). Backend and PM estimates are therefore actively reconciled to a rounded integer for app-linked tasks.
- Display and scheduling consumers treat the PM value as pomodoros, not points: `src/lib/timer.ts:93-118` keeps fractional remainders (`estimatedRemaining > EPSILON ? ... : 1`), totals accumulate them (`:177-199`); `src/lib/today.ts:90,120,166` passes estimate/remaining through; `src/lib/whatsNext.ts:36-43,53-60` keeps fractions and treats zero/absent as un-estimated (`whatsNext.test.ts:391-400`); `weekOverview.ts:29-37` rounds up with `Math.ceil`; `formatPomodoroCount` renders `Math.round` or one decimal (`timer.ts:219-225`).
- Strict integer assumptions exist outside totals: `TaskInspector` rounds and clamps to `minEstimate = 1` when committing an edit (`src/components/ProjectManager/TaskInspector.tsx:33,63-86`), `GoogleCalendarTaskSection` refuses to schedule with "Set a whole-pomodoro estimate before scheduling." (`src/components/ProjectManager/GoogleCalendarTaskSection.tsx:136-142`, with stored-link validation at `src/lib/data/GoogleCalendarDataAccess.ts:187`), and Start-of-Day/agent validation rejects non-integer estimates (`src/lib/engine/startOfDay.ts:104-106`, `src/lib/agent/startOfDayPlanStore.ts:59-70`, `src/lib/agent/outputSchemas.ts:44`).

## Relevant Files And Entry Points

- `supabase/functions/linear-sync/linearApi.ts:6` — `LINEAR_SYNC_QUERY`; issue selection on `:13` must gain `estimate`.
- `supabase/functions/linear-sync/linearApi.ts:28` — Deno `LinearIssuePayload`; note it is a separate declaration from the frontend mirror.
- `supabase/functions/linear-sync/linearApi.ts:103` — `mapIssue`; where the new nullable numeric validation belongs.
- `supabase/functions/linear-sync/linearApi.ts:64` / `:69` — `requiredString` / `nullableString` helpers and the `invalidResponse` convention (`:56-58`).
- `supabase/functions/shortcut-sync/shortcutApi.ts:103` — `optionalNumber` precedent (`null`/`undefined` → `null`, non-finite → `invalidResponse()`).
- `supabase/functions/linear-sync/handler.ts:64` — success body `{ ...result, synced_at }`; passes estimates to the browser unchanged, no change expected.
- `src/lib/engine/shortcutClassification.ts:54` — module-private `SHORTCUT_POINTS_TO_POMODOROS` table (the confirmed mapping).
- `src/lib/engine/shortcutClassification.ts:63` — exported `shortcutPointsToPomodoros` with identity fallback.
- `src/lib/engine/shortcutClassification.ts:93` — the conditional-spread shape to mirror (`!== null`, no rounding).
- `src/lib/engine/linearClassification.ts:5` — frontend `LinearIssuePayload` mirror to extend.
- `src/lib/engine/linearClassification.ts:16` — stale "Linear does not expose an estimate" doc comment on `LinearTaskProposal`.
- `src/lib/engine/linearClassification.ts:23` — `LinearTaskProposal` needs `estimatePomos?: number`.
- `src/lib/engine/linearClassification.ts:103` — `buildLinearTaskProposal`; proposal construction point.
- `src/lib/engine/index.ts:35` / `:48` — Shortcut and Linear barrel blocks; conventions for any new/changed export.
- `src/lib/data/LinearDataAccess.ts:158` — `isIssue` runtime guard.
- `src/lib/data/LinearDataAccess.ts:260` — `sync()` response validation and error code `LINEAR_INVALID_RESPONSE`.
- `src/components/LinearIntegrationCard.tsx:221` — `confirmPreview` (stale comment at `:227-233`).
- `src/components/LinearIntegrationCard.tsx:528` — `ProposalPreview`; metadata row at `:566-570`.
- `src/components/ShortcutIntegrationCard.tsx:487` — reference render for `"N pomodoros"`.
- `src/state/ProjectManagerContext.tsx:622` — `createTask`; `:934-940` estimate normalization; `:181` quick-add `3p` parse.
- `src/state/StateSyncBridge.tsx:36` — PM↔backend target reconciliation (round, min 1).
- `supabase/README.md:120` — states the query "does not request `estimate`".
- `supabase/README.md:126` — states "No estimate is returned" in the per-issue payload list.

## Data Flow Or Control Flow

### Linear sync → import (current)

1. User clicks "Sync now"; `LinearIntegrationCard.syncNow` calls `dataAccess.sync()` (`src/components/LinearIntegrationCard.tsx:198-219`).
2. `SupabaseLinearDataAccess.sync` invokes the `linear-sync` Edge Function with an authenticated POST (`src/lib/data/LinearDataAccess.ts:260-267`).
3. `handler.ts` verifies the JWT, loads `linear_token`/`team_key` from `linear_settings`, and calls `fetchLinearIssues` (`supabase/functions/linear-sync/handler.ts:24-55`).
4. `fetchLinearIssues` posts `LINEAR_SYNC_QUERY` with GraphQL variables, walks up to `LINEAR_MAX_PAGES` pages, validates each issue node through `mapIssue`, and returns `{ issues, states, truncated }` (`linearApi.ts:162-218`).
5. `handler.ts` stamps `last_synced_at` and returns `{ issues, states, truncated, synced_at }` (`:56-64`).
6. The browser guard `isIssue` validates every issue; malformed responses become `LINEAR_INVALID_RESPONSE` (`LinearDataAccess.ts:274-282`).
7. `syncNow` calls `classifyLinearIssues({ issues, currentTasks, includedStatuses, defaultProjectId })` (`LinearIntegrationCard.tsx:208-213`).
8. `classifyLinearIssues` skips already-imported tags/URLs, skips excluded statuses, and calls `buildLinearTaskProposal` for each survivor (`src/lib/engine/linearClassification.ts:146-188`).
9. The preview modal maps each proposal to `ProposalPreview` (`LinearIntegrationCard.tsx:497-509`), which renders priority, due date, and the identity tag (`:566-570`).
10. "Create N tasks" calls `confirmPreview`, which forwards each proposal minus `title` to `createTask` (`:221-234`).
11. `createTask` derives the app target (`Math.max(1, Math.floor(estimatePomos))`, else `1`), persists the raw proposal `estimatePomos` on the PM row (or `created.target_pomodoros` when absent), and the app engine truncates the target to a positive integer (`ProjectManagerContext.tsx:624-642`, `stateCommands.ts:30-50`, `core.ts:129-131`).
12. Post-creation, `StateSyncBridge` rounds the PM estimate to a min-1 integer and reconciles it with the backend target (`StateSyncBridge.tsx:41-51,158-176`); `normalizeState` does the same on snapshot load (`ProjectManagerContext.tsx:934-940`).

### Shortcut sync → import (contrast, unchanged)

1. `shortcut-sync` fetches search results with `detail=full` and maps `estimate` via `optionalNumber` (`shortcutApi.ts:147-154,132`).
2. `classifyShortcutStories` filters and builds proposals (`shortcutClassification.ts:102-133`).
3. `buildShortcutTaskProposal` maps a non-null estimate through `shortcutPointsToPomodoros` and conditionally adds the key (`:82-100`).
4. The preview renders `"N pomodoros"` (`ShortcutIntegrationCard.tsx:487`); `confirmPreview` forwards the proposal to `createTask` (`:196-206`).
5. `createTask` and downstream normalization behave exactly as in step 11–12 above.

### Failure path (today)

- A malformed Linear response (e.g. `priority: 7`, or a non-JSON body) throws `LinearApiError` 502 `LINEAR_INVALID_RESPONSE` in the function (`linearApi.ts:145-149`, `:195-202` test table) or `LinearIntegrationError` `LINEAR_INVALID_RESPONSE` in the browser (`LinearDataAccess.ts:274-281`). There is no partial import: the whole sync fails and the card shows the error via `recordError` (`LinearIntegrationCard.tsx:105-108`). The same all-or-nothing behaviour would apply to a malformed `estimate`.

## Important Contracts And Constraints

- **Estimate unit.** `PMTask.estimatePomos` is a pomodoro count (`src/state/types.ts:49`), not Linear points and not minutes. One pomodoro is `settings.work_minutes` (default 25; `src/lib/engine/core.ts:17-24` per the prior mapping doc). The conversion happens only in the frontend engine; the Edge Function must expose raw provider values.
- **Single source of truth for conversion.** The Shortcut table `{0:1, 1:3, 2:5, 3:8, 5:12}` and identity fallback are the mapping to reuse; the issue's audit half expects no value changes (`docs/research/shortcut-points-to-time-mapping.md:15-26`).
- **Three independent payload declarations.** Deno `LinearIssuePayload` (`linearApi.ts:28-37`), the frontend mirror (`linearClassification.ts:5-14`), and the runtime guard (`LinearDataAccess.ts:158-174`). There is no generated/shared type, so all three must be edited together. The engine mirror is exported from the barrel (`index.ts:61`) and imported by the data access (`LinearDataAccess.ts:2`).
- **Deploy-order compatibility.** Requirement 5 exists because the frontend can deploy before the function: the browser type/guard must treat `estimate` as optional. Conversely, because `isIssue` ignores unknown properties, an already-deployed browser tolerates the new function field today, so the change is forward-compatible in both directions as long as the field is optional in the browser type.
- **Omission vs explicit null.** Requirement 8 says `null`/absent must produce no `estimatePomos`. The Shortcut precedent is the strict `estimate !== null` conditional spread (`shortcutClassification.ts:93`), which drops the key entirely rather than setting `undefined`. A truthiness check would incorrectly drop `0`, so the existing pattern matters.
- **Zero is not "unestimated".** The Shortcut table maps `0→1`; `whatsNext` treats a PM estimate of `0` as un-estimated (`src/lib/whatsNext.ts:36-43`, test `whatsNext.test.ts:391-400`); `normalizeState` rewrites `0` to `1` (`ProjectManagerContext.tsx:934-940`, test `:147-164`); `createTask` clamps non-positive targets to `1` (`:629-631`). `0 → 1` is therefore the only representation of an explicit zero estimate that survives the app's own invariants.
- **Integer expectation downstream.** PM normalization (`Math.round`, min 1), `StateSyncBridge` (`Math.round`, min 1), `TaskInspector` (`Math.round`, min 1), Start-of-Day validation (`Number.isInteger && >= 1`), and Google Calendar scheduling (`Number.isInteger && > 0`) all assume whole pomodoros. Only `createTask`'s backend target uses `Math.floor`/`Math.trunc`.
- **Preview formatting parity.** Linear's metadata row order is priority → due date → tag (`LinearIntegrationCard.tsx:566-570`), while Shortcut's is priority → estimate → due date (`ShortcutIntegrationCard.tsx:485-489`). Requirement 9 says "matching the Shortcut preview's formatting", which in the reference is `{value} pomodoros` with a `!== undefined` guard (no pluralization).
- **Stale documentation contract.** `supabase/README.md:120` says the query "does not request `estimate`" and `:126` says "No estimate is returned"; both become false once the function changes. The issue's change-file list does not mention this file. (`README.md:120` also references `docs/research/issue-122-linear-spike.md`, which does not exist — a pre-existing stale pointer, not caused by this issue.)
- **Unchanged surfaces.** Dedupe by `linear:<IDENTIFIER>` tag then normalized URL (`linearClassification.ts:164-185`), status-name filtering, `linearPriorityToTaskPriority` (`:66-78`), the identity tag (`:81-83`), links, `normalizeTaskDueDate` (`:107`), and `describeLinearEmptyResult` (`:127-144`) are all independent of the estimate and must not change. Gmail-style summary counters, the modal truncation notice, and partial-creation recovery (`LinearIntegrationCard.tsx:221-256`) are likewise unaffected.
- **Engine purity and import conventions.** `src/lib/engine/` is pure (no I/O/network/wall-clock/random; `AGENTS.md:8`). Engine modules already import each other (`taskCommands.ts` imports `timerCommands`/`core`, `plannerContext.ts` imports `busyIntervals`), and `linearClassification.ts` already imports a non-engine helper (`../taskDueDate`), so a Linear→Shortcut engine import introduces no new purity or layering problem and no cycle with `index.ts` (the barrel imports both modules; neither imports the barrel).
- **Barrel conventions.** `src/lib/engine/index.ts` groups one module per block: value exports first, then a separate `export type` block, alphabetically sorted. Linear's value block is `:48-56`, type block `:57-63`. Integration cards import engine submodules directly, not through the barrel, so a new barrel export is documentation cleanliness rather than a functional requirement.
- **Function contracts.** `linear-sync` keeps gateway JWT verification and an independent JWT check (`supabase/config.toml:391-392`, `handler.ts:28-40`); the request body is never read; upstream error text is never returned; a new field must not change the error-code allowlist (`LinearDataAccess.ts:88-95`) or the success envelope (`{ issues, states, truncated, synced_at }`). No migration is involved.

## Existing Tests And Validation

- `src/lib/engine/shortcutClassification.test.ts:127-135` — `it.each` pins the five table conversions (`0→1, 1→3, 2→5, 3→8, 5→12`).
- `src/lib/engine/shortcutClassification.test.ts:115-119` — builder-level check that `estimate: 5` becomes `estimatePomos: 12`.
- `src/lib/engine/shortcutClassification.test.ts:92-113` — `estimate: null` path: exact object equality with no `estimatePomos` and no `dueDate` keys.
- `src/lib/engine/linearClassification.test.ts:33-45` — typed fixture helper `issue(identifier, overrides: Partial<LinearIssuePayload>)`; adding a required field to the engine payload type forces this base object to be updated (compile-time signal).
- `src/lib/engine/linearClassification.test.ts:131-153` — "builds a Backlog proposal with a tag-first identity and no estimate": exact `toEqual` object (`:140-151`) plus `expect(proposal).not.toHaveProperty("estimatePomos")` (`:152`). The exact-equality object also pins the full proposal field set.
- `src/lib/engine/linearClassification.test.ts:116-129` — priority mapping table and out-of-range fallback, both unaffected but adjacent.
- `src/lib/data/LinearDataAccess.test.ts:25-34` — `issue` fixture with no estimate; `:129-145` asserts a successful sync (`toEqual({ issues: [issue], ... })`, so an estimate added to the fixture would need the guard to accept it); `:147-156` rejects a payload missing `truncated`; `:158-168` rejects `priority: 7`. There is no direct `isIssue` test (it is private) and no test for unknown/extra properties, so omission tolerance is currently only implied by the fixture lacking the key.
- `src/components/LinearIntegrationCard.test.tsx:30-39` — untyped `newIssue` fixture with no estimate; `:119-152` preview/confirm flow, ending with `expect(options).not.toHaveProperty("estimatePomos")` (`:148-149`); `:241-261` partial-creation failure. There is no DOM assertion of a pomodoro label anywhere. The Shortcut card test (`ShortcutIntegrationCard.test.tsx:35,125-132`) asserts `estimatePomos: 8` in `createTask` options but also never asserts the rendered "N pomodoros" span.
- `integration/linearApi.integration.test.ts:32-55` — stub-fetcher test that pins the exact query (`toBe(LINEAR_SYNC_QUERY)`, `:39`), asserts `expect(body.query).not.toMatch(/\bestimate\b/)` (`:40`), and deep-equals the variables (`:43-48`); the same test asserts the mapped issue shape (`:51-53`). `issue()` helper (`:10-16`) has no estimate. The malformed-payload table at `:195-202` includes a priority-8 case and is the place malformed estimates would be covered.
- `integration/linearSync.integration.test.ts:30,108,116,134` — handler tests use empty issue arrays and assert the `{ issues, states, truncated, synced_at }` envelope and error bodies; they do not depend on issue fields, so they should pass unchanged.
- `src/state/ProjectManagerContext.test.ts:147-164` — `normalizeState` clamps `estimatePomos: 0.4` to `1`, documenting the integer/min-1 invariant.
- `src/lib/whatsNext.test.ts:391-400` — a PM estimate of `0` is treated as un-estimated (relevant to the zero decision).
- Prior documented gap: `docs/research/shortcut-points-to-time-mapping.md:78` records that no test covers unsupported/non-integer Shortcut point values (e.g. `4`, `8`, `13`, `4.5`), so the identity fallback is currently unverified by tests.
- Commands: `pnpm test:unit` runs `vitest run` with `include: ["src/**/*.test.{ts,tsx}", "supabase/functions/**/*.test.ts"]` (`vitest.config.ts:12-19`) — note there is no `supabase/functions/linear-sync/*.test.ts`, so the Linear API is exercised only through `integration/`. `pnpm test:integration` runs `pnpm supabase:reset && vitest run --config vitest.integration.config.ts`, which includes `integration/**/*.test.ts` (`vitest.integration.config.ts:5-11`). `pnpm lint` runs `tsc --noEmit` plus `deno check supabase/functions/*/*.ts` and `supabase db lint` (`package.json` scripts), which is the type gate for the Deno change. `pnpm build` also runs `tsc`. No e2e/Playwright test references Linear or Shortcut integrations.

## Risks, Edge Cases, And Unknowns

### Conversion coupling (issue decision 1)

- Facts: the table is module-private (`shortcutClassification.ts:54`); only `shortcutPointsToPomodoros` is exported (`:63`) and already published from the barrel (`index.ts:39`). Its doc comment says "Convert Shortcut story points…" (`:62`), and its fallback comment says unsupported values stay compatible "until an explicit mapping for them is defined" (`:64-66`).
- Consequence: importing the function into `linearClassification.ts` is the smallest change and introduces no cycle, but a Linear proposal would depend on a Shortcut-named, Shortcut-documented symbol. Exporting the table would leave two public conversion entry points. A provider-neutral rename (e.g. `pointsToPomodoros`) would touch the barrel, the Shortcut test, and the Shortcut builder, with a broader rename blast radius.
- Unknown: which symbol name the requester wants as the documented "single source of truth". This is a naming/API decision for requirements, not settled by the code.

### Explicit zero (issue decision 2)

- Facts: Linear `estimate: 0` is a real, deliberate value only when `issueEstimationAllowZero` is enabled (issue context; not verifiable in this repo — no Linear schema or fixtures are vendored). The shared table maps `0→1`, the Shortcut builder would do so for a numeric `0`, and every downstream invariant clamps zero to one anyway (`normalizeState`, `StateSyncBridge`, `createTask`, `whatsNext` un-estimated handling).
- Consequence: if `0` were passed through as `0`, it would not survive: `isIssue`-accepted payload → proposal `estimatePomos: 0` → `createTask` target `1` (because `target <= 0` → `1`) while the PM row would persist `0` until the next normalization/rounding rewrites it to `1`. The table's `0→1` avoids that transient inconsistency.
- Unknown: whether product semantics want "explicit zero effort" surfaced differently in the UI. The current preview has no zero/un-estimated distinction (`!== undefined` would render "0 pomodoros" if a raw zero ever reached it).

### Non-table and fractional values (issue decision 3)

- Facts: `estimate` is a GraphQL `Float` per the issue context; the Shortcut helper `optionalNumber` accepts any finite number (`shortcutApi.ts:103-108`), so a fractional value would arrive intact. The identity fallback converts non-table values one-to-one: Linear Fibonacci-extended `6, 7, 13, 16, 21, 32, 64` become that many pomodoros (at default 25 minutes, `13 → 5h25m`, `64 → 26h40m`).
- Facts on fractional handling are inconsistent across layers: backend target uses `Math.floor`/`Math.trunc` (`ProjectManagerContext.tsx:632`, `core.ts:129-131`), PM reconciliation uses `Math.round` (`StateSyncBridge.tsx:41-43`) and `normalizeState` rounds on load (`:934-940`), the inspector rounds on edit (`TaskInspector.tsx:70-73`), totals/`whatsNext` keep the fraction (`timer.ts:106-107`, `whatsNext.ts:53-60`), the Week overview rounds up (`weekOverview.ts:29-37`), and display helpers round or show one decimal (`timer.ts:219-225`). A fractional PM estimate is also rejected by Google Calendar scheduling and Start-of-Day validation.
- Consequence: a persisted fractional `estimatePomos` is a transient state that the app self-heals to an integer (round, min 1) on the next bridge pass or reload, but until then it can render as `2.5p` and be excluded from calendar scheduling. A raw fraction never reaches the backend target (it is floored).
- Unknown: the intended canonical value. "Floor" and "round" differ for `.5` values (`2.5 → 2` vs `3`), and the existing app does both in different places.

### Missing-field tolerance (issue decision 4)

- Facts: the guard currently ignores unknown properties, so a new field is silently accepted, and a malformed `estimate` would also be silently accepted today. `LinearDataAccess.test.ts` fixtures omit `estimate`, so the guard must continue accepting absence. The engine test fixture helper is typed with `Partial<LinearIssuePayload>` overrides, so a required engine field would force the fixture base to add it (compile-time).
- Consequence: making the browser payload `estimate` required (`number | null`) would still typecheck the Deno side but would break any payload literal that omits it (notably the engine test helper and any future mocks); making it optional (`estimate?: number | null`) expresses the deploy-order tolerance. Runtime validation should accept `undefined`/`null` and reject non-numbers/non-finite values, mirroring `optionalNumber`'s semantics.
- Unknown: whether a malformed `estimate` should fail the entire sync (`LINEAR_INVALID_RESPONSE`, consistent with `priority`) or be dropped to `null` per issue. Requirement 4 says reject like `priority`, which is a whole-response failure; the existing error path is all-or-nothing either way.

### Other risks and unknowns

- **Guard strictness asymmetry.** Adding `estimate` validation makes the Linear guard validate a field the Shortcut guard ignores (`ShortcutDataAccess.ts:125-135`). That is consistent with the issue's requirement but is a behavioural difference between integrations worth stating explicitly.
- **Partial documentation drift.** `supabase/README.md:120,126` and the issue's change-file list are out of sync; if the README is not updated it will contradict the shipped query and payload. `README.md:122` complexity math (`50 × (1 + 7×0.1 + 1 + 0.1)`) counts the seven scalar fields; adding an eighth scalar changes the arithmetic only marginally (still far below the 10,000-point ceiling) but the stated number becomes approximate.
- **Live-workspace behaviour unverified.** No Linear fixtures or schema are vendored; the issue's claims about `issueEstimationType`, `issueEstimationExtended`, `issueEstimationAllowZero`, and `Float` typing are not verifiable from the repository. `supabase/README.md:120` itself says live workspace behavior remains unverified.
- **No team estimation-type in the payload.** The query requests no team or estimation settings, so the frontend cannot distinguish "zero effort" from "not estimated" beyond the numeric value. Any zero-specific product rule would need a payload/query addition, which the issue does not request.
- **Summary/preview counters.** `describeLinearEmptyResult` and the modal counters are estimate-independent, but note `LinearClassificationResult` has no archived counter (unlike Shortcut) and the partial-creation path re-slices proposals; adding `estimatePomos` must not change these counts or the `key` (`proposal.tags[0]-index`, `LinearIntegrationCard.tsx:502`).
- **Time semantics.** The stored value is pomodoros; any user-facing "time" claim scales with the current `work_minutes` setting and excludes breaks (`docs/research/shortcut-points-to-time-mapping.md:28-39`). Requirements should not restate the mapping in minutes as if it were fixed.

## Downstream Guidance

- Requirements should account for:
  - The conversion decision must name one canonical symbol (import `shortcutPointsToPomodoros`, export the table, or a neutral rename) and state which module owns it; the code already supports any of the three without a cycle.
  - Explicit-zero semantics: confirm `0 → 1` parity, or state a different rule and how it survives `createTask`/`normalizeState`/`whatsNext` zero-clamping.
  - Fractional/intended-value rule: confirm identity fallback for non-table values, and decide whether a fractional `estimate` is rejected at the function, accepted and normalized (floor vs round) in the engine, or left to the existing PM normalization. The app currently floors the backend target and rounds the PM value.
  - Guard contract: optional `estimate?: number | null` in the browser payload, omission tolerated, non-numeric/non-finite rejected as `LINEAR_INVALID_RESPONSE`, and `estimate: null`/absent producing no `estimatePomos` key (not `undefined`).
  - Documentation scope: decide whether `supabase/README.md:120,126` is in scope; the issue's file list omits it but it is the only written payload contract.
  - Keep dedupe, status filtering, priority mapping, tags, links, due-date normalization, empty-result messaging, and all Shortcut behaviour explicitly unchanged.
- Planning should consider:
  - The implementation surface is six production files (`linearApi.ts`, engine `linearClassification.ts`, `index.ts` if the export changes, `LinearDataAccess.ts`, `LinearIntegrationCard.tsx`, and optionally `shortcutClassification.ts` if the symbol moves) plus `supabase/README.md`, with test updates in `linearClassification.test.ts`, `LinearDataAccess.test.ts`, `LinearIntegrationCard.test.tsx`, and `integration/linearApi.integration.test.ts`; `linearSync.integration.test.ts` should be unaffected.
  - The engine fixture helper `issue()` is typed `Partial<LinearIssuePayload>`, so a required payload field surfaces as a type error there — useful as a sequencing checkpoint.
  - Test strategy: a table-parity test that the same numeric point value yields the same `estimatePomos` through both builders (including `0`), an absent/null case asserting no key, a non-table case (e.g. `13`), and a guard/function case for a non-numeric estimate plus omission tolerance. The existing `not.toHaveProperty("estimatePomos")` and `body.query).not.toMatch(/\bestimate\b/)` assertions must be replaced, not merely deleted, so the new behaviour is pinned.
  - Validation: `pnpm test:unit`, `pnpm test:integration` (includes the Linear API and handler suites), `pnpm lint` (tsc + `deno check` for the Edge Function), and `pnpm build`; `pnpm test:platform`/`pnpm test:pwa` are unrelated to this change except as a full CI gate.
  - Deploy sequencing: function and frontend can ship in either order because the browser tolerates omission and the old browser ignores unknown keys; requirements should not mandate a coordinated deploy.
- Do not include:
  - New migrations, schema/RLS/grant changes, or any change to `linear_settings`.
  - Changing the Shortcut table values, adding a `4` entry, renaming the table's numeric semantics, or moving the conversion into the Edge Function.
  - Reworking `PMTask.estimatePomos` to a fractional model, changing backend `target_pomodoros` semantics, or redefining a pomodoro's length.
  - Introducing a shared/base proposal interface across GitHub/Shortcut/Linear, or adding a team-estimation-type query/payload field.
  - Tauri `invoke`/file paths, service-role credentials in the browser, or background sync/polling.
  - Opportunistic cleanup of the missing `docs/research/issue-122-linear-spike.md` reference or of the Shortcut guard's lax `isStory` validation.
