# Research: Phase 12 independent diff review — #137 evidence suggestions and #141 goal-set file

## Overview

This is the independent Phase 12 review of the two feature commits merged into
`epic/goals` at `dbd3521`, checked against the frozen authority in
`docs/goals/contract.md` sections 2–5, 7, 9 and 11, plus `docs/issues/issue-137.md`
and `docs/issues/issue-141.md`. The changes add (a) a pure project-evidence selector
with a wizard panel that suggests completed tasks, rolls up hours, and prefills
`current`, and (b) a pure portable goal-set file module with tracker-scoped
export/import mounted on `/goals`.

The frozen signatures and the merge/persistence rules are conformed: no new
`saveGoals` caller, no ID remap by hand, no replace/merge, no build-key write outside
`stampBuiltPeriod`. One export-validation defect rejects data the app itself allows
(BLOCKER), and there are several SHOULD-FIX behavioural gaps around prefill scoping
across periods, non-atomic import, and export UX. Verdict at the end of the document.

## Issue Context

- Scope reviewed (worktree `C:\Users\dylan\Desktop\Coding\VSCode\WorkTime`, branch
  `epic/goals`, HEAD `dbd3521`):
  - `8418bf4..dbd3521` — exactly one commit, `3474e96` "mount goal-set export and
    import on the goals page (#141)"; `src/components/GoalsPage.tsx` and
    `src/components/GoalsPage.test.tsx` only (`git diff 8418bf4..dbd3521 --stat`).
  - `2672a77` (#137, already merged at `8418bf4`) — `evidence.ts`,
    `GoalEvidencePanel.tsx`, `CheckInWizard.tsx` mount, `GoalsPage.tsx`
    project-link/editor, plus tests.
  - `114d577` (#141, already merged at `79c3724`) — `goalSetFile.ts`,
    `GoalSetActions.tsx`, plus tests.
- User/requested outcome (issue text): goals may optionally link one project; the
  check-in wizard offers that period's completed project tasks as explicit
  accept/reject suggestions, a folded hours summary, and an In Progress prefill of
  `current` that freezes on first manual edit; a tracker's goal structure can be
  exported to a versioned, human-diffable JSON file and imported as a **new**
  tracker with fresh IDs, never a merge or replace.
- Current pain being resolved: no relationship existed between goals and PM
  projects/tasks, and no portable representation of a tracker existed.
- Scope classification: T3 by issue (#137 T3, #141 T2); the epic's Phase 12 row
  expects an independent RESEARCH review before Gate 12
  (`docs/goals/contract.md:1315`, `docs/plans/goals-epic-parallel-workflow.md:882-939`).

## Current Behavior

### #137 — evidence selector and panel

- `buildGoalEvidence` (`src/lib/goals/evidence.ts:88-154`) converts
  `[periodStart, periodEnd)` **local dates** to two instants once per call
  (`evidence.ts:50-55,94`; default local-midnight via
  `localDateParts`/`localDateFromKey` at `evidence.ts:45-48`) and applies
  `instant < start || instant >= end` (inclusive start, exclusive end) to both
  backend completions (`evidence.ts:105`) and logs (`evidence.ts:137`).
- Null `goal.projectId` returns empty evidence with `brokenProject: false`
  (`evidence.ts:90`); a non-null id absent from `projects` returns empty evidence
  with `brokenProject: true` (`evidence.ts:91`). Project existence is id-only, so an
  archived project is a valid link (asserted by `evidence.test.ts:207-216`).
- Completed suggestions require PM `status === "Done"`, a non-empty `appTaskId`, a
  linked backend task with a parseable `completed_at` inside the instant window
  (`evidence.ts:100-105`); they are sorted by instant, title, id
  (`evidence.ts:115-118`) and expose `completedOn` from the injected/default local-date
  projection (`evidence.ts:110`). Accepted is membership in
  `checkIn.evidenceTaskIds` (`evidence.ts:96,111`).
- Hours sum non-break `duration_minutes` for logs whose `finished_at` is inside the
  same window and whose `task_id` belongs to the set of `appTaskId`s of PM tasks in
  the goal's project (`evidence.ts:128-139`). Each log is counted once (set
  membership); other projects, breaks and unmapped `task_id`s are excluded.
- In Progress items are PM tasks of the project with `status === "In Progress"`,
  sorted sortOrder/title/id (`evidence.ts:120-126`); `evidencePrefillText` joins
  titles with `", "` (`evidence.ts:163-165`); `formatEvidenceHours` rounds to one
  decimal and drops `.0` (`evidence.ts:157-160`).
- `GoalEvidencePanel` is rendered inside each goal card of the wizard only when
  `goal.projectId !== null` (`src/components/goals/CheckInWizard.tsx:250-255`). It
  builds evidence from `usePM()` and `useAppState()` every render
  (`src/components/goals/GoalEvidencePanel.tsx:22-37`), so **PM/AppState hydration is
  asynchronous**: on the first render `projects` is empty and the panel briefly shows
  the broken-link copy.
- Freeze/prefill is implemented with three refs
  (`GoalEvidencePanel.tsx:25-27`): `frozenRef` starts true when there is already
  `current` text; an effect marks frozen when `current` changes to anything other
  than the panel's own prefill (`:40-45`); a second effect writes `current` once when
  unfrozen, empty, and In Progress titles exist (`:48-55`); Refresh recomputes the
  text, sets `prefilledRef`/`lastSeenRef`, forces `frozenRef = true`, and writes
  (`:68-75`). The panel never writes `did` (`:47`).
- Checkbox toggles add/remove the `PMTask.id` in `evidenceTaskIds` while preserving
  unrelated stale ids (`GoalEvidencePanel.tsx:59-66`).
- The wizard keeps per-goal drafts in local state seeded from the stored
  natural-key row (`CheckInWizard.tsx:51-66,95`), patches drafts with a fresh
  `updatedAt` (`:127-134`), and persists only on submit through
  `goals.saveCheckIns(mergeDrafts(...))` (`:181-193`), where `mergeDrafts` retains
  every stored row whose `(goalId, periodStart)` was not replaced (`:72-78`).
  Selecting another period rebuilds drafts from stored rows (`:104-108`); the panel
  component instance is not remounted by that switch.

### #141 — goal-set file and page mount

- `serializeGoalSet` emits `format, version, tracker, goals` with canonical nested
  key order, two-space indent and a trailing newline (`src/lib/goals/goalSetFile.ts:211-236`),
  sorting goals by sortOrder/title/id and emitting definitions only (no ids, metric
  current/source/overridePinned, check-ins, anchors, build key, timestamps).
  It re-validates its own output through `readGoalSet` before stringifying
  (`goalSetFile.ts:235`).
- `parseGoalSet` uses plain `JSON.parse`, then a version gate
  (`goalSetFile.ts:239-247,176-196`) with the frozen error codes; `requireKeys`
  rejects unknown and missing keys on the root, tracker, cadence branch, goal and
  metric objects (`goalSetFile.ts:72-78,110-129,131-140,142-153,155-173`).
  Array order is preserved; no sorting on import.
- `materializeGoalSet` (`goalSetFile.ts:270-299`) re-validates, resolves the anchor
  with `resolveCadenceAnchorAt(..., validatedLocalDateKey(now))`, mints a fresh id
  per row, clears the build key, leaves the tracker unarchived, stamps
  `achievedAt`/`droppedAt` for achieved/dropped, resets metric progress to
  `current: 0, source: "manual", overridePinned: false`, and assigns sequential
  `sortOrder` 0..n-1.
- `goalSetFileName` produces `goals-<slug>-<YYYY-MM-DD>.json`, lowercased ASCII,
  non-alphanumeric runs to `-`, trimmed, capped at 40 with post-cap trailing-hyphen
  trim, fallback `tracker`, then passed through `sanitizeDownloadFileName`
  (`goalSetFile.ts:256-263`, `src/lib/goals/deck/delivery.ts:2-7`).
- `GoalSetActions` exports via `serializeGoalSet` + `initiateBlobDownload`
  (`src/components/goals/GoalSetActions.tsx:68-80`) and imports as
  file-pick → parse → inline review (`:82-97,167-184`) → confirm (`:99-133`).
  Confirm calls `materializeGoalSet` only as a validator/stamper, then creates a new
  tracker via the provider (`:106-111`), one goal per definition (`:112-120`), and
  applies non-active lifecycle via `setGoalLifecycle` (`:121`). It clears review,
  calls `onImported(created.id)`, then calls `selectTracker(created.id)` again
  (`:123-125`).
- `GoalsPage` mounts the component in the frozen slot
  `data-goals-slot="goal-set-actions"` + `data-tracker-id` (`src/components/GoalsPage.tsx:243-251`)
  and `onImported` selects the new tracker and clears deck preview, pinned check-in
  and goal edit (`:244-250`). The slot is rendered for archived trackers too (no
  `isArchived` guard, `:243`); the page is a single-selected-tracker view
  (`:60-63`).
- #137 also added the goal project picker in `GoalEditor`
  (`GoalsPage.tsx:393-423`) and the read-only project name / missing-project note in
  `GoalRow` (`GoalsPage.tsx:355-361`).

## Relevant Files And Entry Points

- `src/lib/goals/evidence.ts:1-165` — pure selector; window conversion, completed
  suggestions, hours, prefill text, hours formatting.
- `src/components/goals/GoalEvidencePanel.tsx:1-112` — frozen panel props, freeze/
  prefill refs, accept/reject toggles, hours summary, broken-link note.
- `src/components/goals/CheckInWizard.tsx:18,250-255` — panel mount; draft state
  (`:51-108`), patch functions (`:127-165`), submit/full-set save (`:181-198`).
- `src/components/GoalsPage.tsx:243-251` — #141 slot mount and page-state reset;
  `:355-361,393-423` — #137 project link UI; `:60-63` — selected-tracker resolution.
- `src/lib/goals/goalSetFile.ts:1-299` — frozen format, strict parser, serializer,
  filename, materializer.
- `src/components/goals/GoalSetActions.tsx:1-186` — export/import UI and the only
  call site of `materializeGoalSet`.
- `src/state/GoalContext.tsx:187-201,213-225,240-248,261-267,279-292,298,308-312` —
  full-set save/reconcile, auto-save effect, create/update/lifecycle/check-in APIs.
- `src/lib/data/StagedDataAccess.ts:637-679` — `loadGoals` (local-only) and
  `saveGoals` full-desired-set writer with build-key backwards guard (`:650`) and
  structural tombstones for omissions (`:665-668`).
- `src/lib/goals/factories.ts:7-19,38-55` — validators and creation factories used
  by the materializer and provider.
- `src/lib/goals/testFixtures.ts:81-260` — shared goal fixtures; no PM/Project/
  backend-Task/log builders exist.
- Tests: `src/lib/goals/evidence.test.ts`, `src/lib/goals/goalSetFile.test.ts`,
  `src/components/goals/GoalEvidencePanel.test.tsx`,
  `src/components/goals/GoalSetActions.test.tsx`,
  `src/components/goals/CheckInWizard.test.tsx` (new cases at `:565-648`),
  `src/components/GoalsPage.test.tsx` (new cases at `:586-630`, `:632-711`).

## Data Flow Or Control Flow

### A. Wizard evidence + prefill

1. `GoalsPage` pins a period and mounts `CheckInWizard` in the
   `data-goals-slot="check-in-wizard"` host (`GoalsPage.tsx:280-286`).
2. The wizard builds drafts for active, period-included goals from stored
   natural-key rows (`CheckInWizard.tsx:51-66,87-95`).
3. Each project-linked goal renders `GoalEvidencePanel`
   (`CheckInWizard.tsx:250-255`) with `period={activePeriod}`.
4. The panel calls `buildGoalEvidence` with provider PM/AppState data
   (`GoalEvidencePanel.tsx:29-37`); the selector converts the local-date window to
   instants once (`evidence.ts:94`) and joins PM tasks → backend completions and
   logs → project PM tasks.
5. If `current` was empty at mount and In Progress titles exist, the panel writes
   `current` through `onChange` → `patchDraft` (`GoalEvidencePanel.tsx:48-55`,
   `CheckInWizard.tsx:127-134,254`). Nothing is persisted at this point.
6. Accept/reject toggles patch `evidenceTaskIds` only
   (`GoalEvidencePanel.tsx:59-66`).
7. Submit merges every stored row not replaced by a draft and awaits
   `saveCheckIns` → provider `save()` re-reads staged, reconciles, and writes all
   three arrays through `data.saveGoals` (`CheckInWizard.tsx:186`,
   `GoalContext.tsx:187-201,308`).

Failure/edge path: if any stored row fails `isGoalCheckIn`, `save()` throws before
writing (`GoalContext.tsx:188-189`); the wizard surfaces the message
(`CheckInWizard.tsx:188-190`).

### B. Export

1. Click "Export goals" (`GoalSetActions.tsx:140-147`).
2. `serializeGoalSet(tracker, goalsForTracker)` (`:73`) sorts/validates; validation
   failure throws `GoalSetError` and is mapped to import-oriented copy (`:75-76,35-48`).
3. `goalSetFileName(tracker.name, today)` (`:74`) → `initiateBlobDownload`
   (`delivery.ts:10-25`). No provider write, no stamp, no localStorage artifact
   (asserted by `GoalSetActions.test.tsx:127-145`).

### C. Import

1. File pick → `file.text()` (`GoalSetActions.tsx:82-97`); read/parse errors render
   `role="alert"` copy and create nothing (`:88-96,165`).
2. Valid file → `review` state renders tracker name, cadence, goal titles and count
   (`:167-184`). Nothing is created yet.
3. Confirm (`:99-133`): `materializeGoalSet` validates/stamps, then provider
   `createTracker` (`:106-111`), `createGoal` per definition (`:112-120`),
   `setGoalLifecycle` for non-active (`:121`), `setReview(null)`,
   `onImported(created.id)`, `selectTracker(created.id)` (`:123-125`).
4. Each provider mutation publishes state; one batched auto-save effect then writes
   the full desired set to staging (`GoalContext.tsx:213-225,187-201`). Existing
   trackers/goals/check-ins are included from staged state, so the import is
   additive.
5. `GoalsPage.onImported` selects the new tracker and clears deck preview, pinned
   check-in and editor (`GoalsPage.tsx:244-250`); the slot re-renders with the new
   `data-tracker-id`.

Failure/edge path: the confirm handler is synchronous and not awaited against
persistence; a mid-loop throw leaves already-created rows in state (they are still
persisted by the effect), and a persistence failure is swallowed by the effect's
`console.warn` (`GoalContext.tsx:222`) after `onImported` already ran.

## Important Contracts And Constraints

### Frozen signatures — conformance

| Frozen item | Implementation | Result |
| --- | --- | --- |
| `EvidenceTaskSuggestion`, `EvidenceInProgressItem`, `GoalEvidence`, `EvidenceWindowInstants`, `EvidenceBoundaryConverter`, `EvidenceInput`, three functions (contract §5 `:505-548`) | `evidence.ts:7-42,88,157,163` | Match exactly (readonly modifiers, optional `boundaryInstants`/`localDateOf`, JSDoc note). |
| `GoalEvidencePanelProps` (contract §9 `:1146-1151`) | `GoalEvidencePanel.tsx:8-13` | Match exactly. |
| `GoalSetActionsProps` (contract §9 `:1153-1156`) | `GoalSetActions.tsx:17-20` | Match exactly. |
| `GOAL_SET_FORMAT`, `GOAL_SET_VERSION`, `GoalSetMetricDefinition`, `GoalSetGoalDefinition`, `GoalSetTrackerDefinition`, `GoalSetFile`, `GoalSetErrorCode`, `GoalSetError`, four functions (contract §7 `:866-907`) | `goalSetFile.ts:8-55,211,239,256,270` | Match, including the error-code union and `readonly code`. |
| Slot `data-goals-slot="goal-set-actions"` + `data-tracker-id` (contract §9 `:1103`) | `GoalsPage.tsx:243` | Present and stable; still one slot. |
| Ownership (contract §11 `:1289,1297-1298`) | lanes A/B files only in all three commits | Conformed; no `src/lib/data/**`, fixture, or contract edits. |

### Frozen semantics — conformance

- Local-date window → instants once, inclusive start/exclusive end, DST-safe
  (contract §5 `:551-561`) — `evidence.ts:45-55,94,105,137`; the injected converter
  is called exactly once (asserted `evidence.test.ts:248-262`).
- Suggestions = Done + project match + backend completion in window; missing links
  invisible; title-only; accepted = `evidenceTaskIds` membership; stale ids render
  nothing and survive edits; `completedTaskCount` counts qualifying suggestions
  (contract §5 `:563-569`) — `evidence.ts:100-114,59-66`.
- Hours join excludes breaks and other projects and counts each log once; null
  project yields no hours; archived projects valid (contract §5 `:571-575`) —
  `evidence.ts:128-139`; one literal divergence below.
- In Progress order and `", "` prefill join; one-decimal hours text
  (contract §5 `:575-577`) — `evidence.ts:120-126,157-165`.
- No new persisted evidence/completion field (contract §5 `:578`) — no schema,
  staging or type changes in the diff.
- Canonical goal-set key order, indentation, trailing newline, canonical goal sort,
  array-order preservation, sequential materialized sortOrder, exclusions, strict
  own-key validation, error-code mapping precedence (syntax → root shape → format →
  version → fields → empty) (contract §7 `:909-941`) — `goalSetFile.ts:57-62,72-78,176-196,198-236,239-247,270-299`.
- Import creates a new tracker with fresh provider IDs, never replace/merge, no
  check-ins, lifecycle preserved with import-now stamps, metric progress reset, no
  boundary math in the module (contract §7 `:932-941`, §9 `:1171-1174`) —
  `GoalSetActions.tsx:105-122`; provider IDs come from `crypto.randomUUID()`
  (`GoalContext.tsx:240-267`).
- Buckets/stamps: no new `saveGoals` caller; all writes go through the provider
  full-desired-set path; `lastBuiltPeriodStart` is untouched by both features and
  remains guarded (`GoalContext.tsx:250`, `StagedDataAccess.ts:650`).

### Divergences (all cited in Risks below)

1. Metric `target` is validated as **positive**, not merely finite
   (`goalSetFile.ts:96-100,137`), while the frozen format says "finite target"
   (contract §7 `:926-927`) and the app's own `isGoalMetric` only checks finite
   (`factories.ts:16-19`); the goal editor can persist `target: 0`
   (`GoalsPage.tsx:404,412`). Export therefore throws for legal stored data.
2. `serializeGoalSet` throws `empty-goals` for a tracker with zero goals
   (`goalSetFile.ts:187-189`) and the UI maps that to **import** copy
   (`GoalSetActions.tsx:45-46,75-76`).
3. Hours are joined through `PMTask.appTaskId` without requiring the backend
   `Task.id` row to still exist (`evidence.ts:128-139`), whereas contract §5
   `:571-573` describes `log.task_id → backend Task.id → PMTask.appTaskId`.
4. `completedOn` is derived for **every** qualifying suggestion
   (`evidence.ts:110`), not "after selection ... selected suggestions only"
   (contract §5 `:557-561`).
5. `serializeGoalSet` does not itself select the tracker's goals (caller filters:
   `GoalSetActions.tsx:63`), although contract §7 `:913` assigns that selection to
   the function's contract.
6. `goalSetFile.ts` imports `sanitizeDownloadFileName` from `deck/delivery.ts:4`
   (and is re-sanitized on download, `delivery.ts:16`), while contract §7 `:859-860`
   describes a pure module whose only cross-module import is the periods resolver.
7. Parser accepts untrimmed names/titles/metric labels (`goalSetFile.ts:85-89`)
   while contract §7 says "nonempty **trimmed** strings" (`:924-925`); factories
   trim tracker name and goal title but not metric labels
   (`factories.ts:40,46`), so an untrimmed label round-trips but an untrimmed title
   does not.

### Preserved invariants

- Check-in identity stays `(goalId, periodStart)`: drafts keyed by goal and period,
  `upsertCheckIns` preserves the staged id on natural-key replacement
  (`CheckInWizard.tsx:72-78`, `GoalContext.tsx:279-292`).
- Display filtering never reaches the writer: the wizard saves the merged full set,
  including off-grid and excluded-goal rows (`CheckInWizard.tsx:72-78,186`).
- Archived goals are excluded from the wizard (`:87-94`) and archived trackers
  never offer due/notifications (`GoalsPage.tsx:66-104`); the goal-set slot is
  intentionally still rendered for archived trackers.
- `goals_state_v1` UI-only selection is never staged or synced
  (`GoalContext.tsx:57-66,230-234`).

## Existing Tests And Validation

Commands run in this review (no supabase, dev server, tauri, or `test:all`):

- `pnpm lint:app` — clean (`tsc --noEmit`).
- `pnpm exec vitest run src/lib/goals/evidence.test.ts src/lib/goals/goalSetFile.test.ts src/components/goals/GoalEvidencePanel.test.tsx src/components/goals/GoalSetActions.test.tsx src/components/goals/CheckInWizard.test.tsx src/components/GoalsPage.test.tsx`
  — 6 files, 94 tests passed. (A scoped superset of the two suites' own gate; the
  full `pnpm test:unit` was not run.)

Coverage that exists and is meaningful:

- `src/lib/goals/evidence.test.ts:94-111` inclusive-start/exclusive-end with an
  injected window; `:113-138` hours (breaks, other project, outside window,
  unmapped `task_id`); `:140-157` ordering; `:159-190` best-effort gaps; `:192-217`
  null/broken/archived project; `:219-231` accepted vs stale ids; `:233-246` In
  Progress ordering + prefill; `:248-262` one boundary conversion; `:264-281`
  `completedOn` not a filter; `:283-290` title-only.
- `src/lib/goals/goalSetFile.test.ts:82-116` exact canonical bytes; `:118-135`
  ordering/cadence branch; `:137-170` exclusions; `:172-182` serializer rejects
  invalid tracker/goal/empty list/non-positive target; `:186-232` round-trip,
  array order, monthly branch; `:234-294` error-code matrix; `:296-307` error
  shape; `:310-351` materialize lifecycle/metric/clone; `:354-368` filename
  (including unicode, empty, `CON`, cap).
- `src/components/goals/GoalEvidencePanel.test.tsx:147-168` accept/reject +
  stale id + `did` untouched; `:170-183` hours summary; `:185-192` broken project;
  `:194-218` prefill/freeze/refresh; `:220-232` no overwrite at mount; `:234-239`
  unlinked renders nothing.
- `src/components/goals/CheckInWizard.test.tsx:565-599` evidence accepted id
  persisted with `did: ""`; `:601-618` no panel for unlinked goal;
  `:620-648` prefill/freeze/refresh through the real wizard.
- `src/components/goals/GoalSetActions.test.tsx:127-145` export blob/filename and
  no writes; `:147-168` review creates nothing; `:170-204` create tracker + goals;
  `:206-228` lifecycle; `:230-244` cancel; `:246-286` error copy and nothing
  created; `:288-301` retry.
- `src/components/GoalsPage.test.tsx:586-613` project link round-trip; `:615-630`
  missing-project note; `:632-655` slot mount/selection; `:657-704` end-to-end
  import through the real component, existing tracker/goal untouched;
  `:706-711` slot absent in the empty state.

Test-coverage gaps:

- No test for **export on a tracker with zero goals** — the shipped failure path
  and its wrong copy.
- No test for **export with a metric target of 0/negative** (only the unit test that
  asserts it throws; nothing connects that to the editor path that creates it).
- No test for the issue #137 cross-check "a linked goal with zero matching tasks
  behaves identically to an unlinked goal" (`docs/issues/issue-137.md:53`): the
  panel renders an empty Evidence section + best-effort copy instead of nothing, and
  that state is untested.
- No test that `hoursMinutes` excludes logs whose PM task still exists but whose
  backend `Task` row was deleted (the `evidence.test.ts:133` case has no PM task at
  all, so it does not exercise the divergence).
- No test for evidence/prefill after **switching the wizard to another period**
  (the existing period-switch tests use goals without projects, e.g.
  `CheckInWizard.test.tsx:340-373,517-563`).
- No test that a **failed persistence** after import surfaces to the user; no test
  that a mid-loop import failure leaves a partial tracker.
- Import tests assert provider **call arguments** (a mocked `useGoals`,
  `GoalSetActions.test.tsx:36-73,187-227`) and never assert the persisted
  `achievedAt`/`droppedAt`, the untouched existing check-ins, or the save count.
  `calls.selected` (`:199`) enshrines the component's own `selectTracker`, which
  duplicates the page mount (`GoalsPage.tsx:246`).
- Strict-validation negative matrix misses unknown keys inside `goal`/`metric`
  objects, non-integer `weekday`, non-string `notes`/`unit`/`color`, and oversized
  strings/arrays (no length caps).
- `GoalSetActions` has no test for an archived tracker, double-click/`busy`
  re-entry, or a very large file.

## Risks, Edge Cases, And Unknowns

### Data integrity (explicit assessment)

No path in these commits tombstones or overwrites existing goals/trackers/check-ins:

- No production `saveGoals` call was added (`git grep -n "saveGoals(" -- src` shows
  only tests and `GoalContext.tsx:197`).
- Import is additive through the provider; existing rows are part of every full-set
  save (`GoalContext.tsx:189-197`, `StagedDataAccess.ts:643-679`).
- Nothing writes `lastBuiltPeriodStart`; `updateTracker` still rejects it
  (`GoalContext.tsx:250`) and `saveGoals` still guards backwards movement
  (`StagedDataAccess.ts:649-651`).
- No check-in natural key can be duplicated by these features: the wizard's
  `mergeDrafts` replaces by `(goalId, periodStart)` and the provider re-keys by
  natural key (`GoalContext.tsx:279-292`).
- Export-reads and import-parses are pure; nothing is written on review or cancel.

Residual data-integrity risks, all inherited or procedural rather than new data
paths:

- **Non-atomic import** (`GoalSetActions.tsx:99-133`): a throw mid-loop leaves a
  tracker with a subset of goals, and "Create tracker" can be retried to produce a
  second partial tracker. There is no rollback and archive-only deletion means the
  user cannot clean up beyond archiving.
- **Success reported before persistence** (`:123-125` vs `GoalContext.tsx:222`):
  `onImported` fires before the batched save resolves, and a save failure is only
  `console.warn`ed. The user sees a switched tracker that may not be persisted; a
  later hydration/merge can drop it.
- **Dangling `projectId`s on cross-owner import**: ids are copied verbatim
  (`GoalSetActions.tsx:117`), so importing someone else's file yields
  "Linked project is missing" on every goal and no evidence, with no warning during
  review (`:167-184`). Not a data-loss risk, but a silent quality loss the user
  cannot see before confirming.
- **Inherited multi-tab window**: `save()` re-reads staged then writes via
  `store.update`; another tab's rows added between read and update can still be
  tombstoned. This is documented as best-effort and not CAS
  (`docs/goals/contract.md:1076-1083`), so it is not a Phase 12 regression.
- **Display-validation block**: if any staged row fails a validator, `save()` throws
  (`GoalContext.tsx:188-189`) and all goal persistence (including import) is blocked
  while the UI hides those rows (`:90-103`). Pre-existing, but import can now surface
  it as "Could not import…".

### Findings by severity

**BLOCKER**

1. **Export rejects a legal app state: metric `target` must be > 0.**
   `src/lib/goals/goalSetFile.ts:96-100,137` uses `requirePositiveNumber`, but
   contract §7 `:926-927` says "finite target", `isGoalMetric` only checks finite
   (`src/lib/goals/factories.ts:16-19`), and `GoalEditor` persists `target: 0` (the
   default state when "Track one metric" is toggled on) or any negative finite value
   (`src/components/GoalsPage.tsx:404,412`). `serializeGoalSet` re-validates its own
   output (`goalSetFile.ts:235`), so clicking "Export goals" on such a tracker throws
   and shows import-oriented copy (`GoalSetActions.tsx:75-76,45-46`). The frozen
   format is therefore not conformed in either direction, and the feature fails for
   data the product itself creates.
   *Minimal fix:* validate metric `target` with `requireNumber` (finite) in
   `goalSetFile.ts:137`, and update `goalSetFile.test.ts:172-182,277-279` to assert
   finite acceptance/rejection rather than positivity. If the intent is really
   `> 0`, then the editor must also enforce it and any already-stored `0` targets
   still need an export-safe path — a larger, cross-lane change.

**SHOULD-FIX**

2. **Export of a zero-goal tracker fails with import copy.**
   `goalSetFile.ts:187-189` maps zero goals to `empty-goals`, which `GoalSetActions`
   renders as "That goal-set file has no goals, so there is nothing to import."
   (`GoalSetActions.tsx:45-46,75-76`). A brand-new tracker (a normal state) shows an
   error on the first export click, and the message describes the wrong operation.
   *Minimal fix:* disable "Export goals" when `goals.length === 0` with adjacent copy
   ("Add a goal to export this tracker"), or give export its own message branch.

3. **Prefill/freeze state is not scoped to the selected period, and past periods can
   be auto-filled with today's In Progress titles.**
   The panel's refs live for the component instance
   (`GoalEvidencePanel.tsx:25-27`), while the wizard swaps drafts on period change
   without remounting the panel (`CheckInWizard.tsx:104-108,250-255`). Consequences:
   (a) editing `current` in period A freezes period B forever (the switch is seen as
   an external edit at `:40-45`), so "first-open prefill" silently stops working;
   (b) opening the past-period editor on a row with empty `current` prefills today's
   In Progress PM titles and saves them into a historical check-in, inventing
   content the user never authored.
   *Minimal fix:* key the panel per period/goal (e.g. from `CheckInWizard.tsx:250`)
   or reset `frozenRef`/`prefilledRef`/`lastSeenRef` when the row identity changes;
   and gate auto-prefill to the current open period (Refresh can remain available
   everywhere).

4. **Import is non-atomic and reports success before the save resolves.**
   `GoalSetActions.tsx:99-133` performs `1 + N + k` synchronous provider mutations
   with no `await`, no rollback, and no error surface for the batched persistence
   effect, which only warns (`GoalContext.tsx:222`). A mid-loop failure leaves a
   partial tracker; a persistence failure shows a new selected tracker that may not
   exist after reload.
   *Minimal fix:* `await goals.persist()` (already exposed,
   `GoalContext.tsx:313`) before `onImported`, keep the review open on failure, and
   keep the loop inside the same try so a failure is at least reported. A true
   all-or-nothing import needs a provider-level API, which is out of lane scope.

5. **Cross-owner import silently produces dangling project links.**
   `projectId` is copied verbatim (`GoalSetActions.tsx:117`) and the review summary
   only lists titles/cadence (`:167-184`). Every imported goal then shows "Linked
   project is missing" (`GoalsPage.tsx:355-361`) and loses evidence, with no
   pre-confirm warning.
   *Minimal fix:* during review, compare `projectId`s against `usePM().state.projects`
   and annotate or offer "import without project link"; no format change is needed.

**NICE-TO-HAVE**

6. **Hours double-count risk is absent, but the backend join is skipped.**
   `evidence.ts:128-139` counts a log whenever `task_id` matches a PM task's
   `appTaskId`, even if the backend `Task` row no longer exists, producing e.g.
   "0 tasks done · 2h". Contract §5 `:571-573` names the backend row in the chain;
   issue #137 `:44` and `src/lib/analytics.ts:27-45` support the implementation, so
   either add `backendById.has(log.task_id)` or amend the contract wording.
   *Minimal fix:* add the backend-existence check (one condition) or a contract note;
   add the missing test case.

7. **`completedOn` is computed for suggestions the user did not select.**
   `evidence.ts:110` runs the projection for every qualifying row, contrary to
   "after selection ... selected suggestions only" (contract §5 `:557-561`);
   `evidence.test.ts:279` only passes because one task qualifies.
   *Minimal fix:* compute `completedOn` only when `accepted`, or state that it is a
   per-suggestion presentation value.

8. **`serializeGoalSet` trusts its `goals` argument.**
   It sorts and validates whatever array it receives (`goalSetFile.ts:211-236`), so a
   future caller passing all goals would emit another tracker's goals. Contract §7
   `:913` assigns selection to this function.
   *Minimal fix:* filter by `tracker.id` inside the serializer (still add no new
   field) or document the caller's responsibility.

9. **Parser accepts untrimmed names/titles/labels.** `requireText`
   (`goalSetFile.ts:85-89`) checks non-empty-after-trim but returns the raw string;
   factories trim tracker name and goal title but not `metric.label`
   (`factories.ts:40,46`). Round-trip is therefore asymmetric for whitespace.
   *Minimal fix:* reject or normalize untrimmed values and state which in the
   contract.

10. **Filename ownership is over-broad.** `goalSetFile.ts:4,263` imports and applies
    `sanitizeDownloadFileName` even though the module contract is "pure; only the
    periods resolver" (contract §7 `:859-860`), and the download helper sanitizes
    again (`delivery.ts:16`). Harmless today.
    *Minimal fix:* keep the slug rules local and drop the extra import, or document
    the shared helper.

11. **Duplicate `selectTracker` calls.** `GoalSetActions.tsx:125` and
    `GoalsPage.tsx:246` both select the imported tracker, and
    `GoalSetActions.test.tsx:199` asserts the component's own call.
    *Minimal fix:* rely on `onImported` only and update that assertion.

12. **Transient false "project missing" copy.** PM state hydrates asynchronously
    (`src/state/ProjectManagerContext.tsx:200,269`), but both the panel
    (`GoalEvidencePanel.tsx:88-91`) and the goal row (`GoalsPage.tsx:355-361`) treat
    an empty project map as a broken link, so the first paint can flash "Linked
    project no longer exists". *Minimal fix:* gate on `pm.hydrated`.

13. **Import review has no announcement or focus move.** The review region appears
    inline after the hidden file input (`GoalSetActions.tsx:148-184`) with no
    `role="status"`/`aria-live` and no focus management; goals components have no
    modal/focus conventions to inherit (`DeckPreview.tsx` has no dialog semantics
    either). Errors do use `role="alert"` (`:165`).
    *Minimal fix:* make the review region a polite live region (or move focus to its
    heading) when it appears.

14. **No file-size or goal-count cap.** `file.text()` (`GoalSetActions.tsx:87`) and
    the import loop (`:112-122`) accept arbitrary sizes; a huge file can hang the
    renderer. *Minimal fix:* reject files above a small size/count with an error
    code/copy.

### Edge cases and unknowns

- **Freeze is session-only and can be lost:** with an empty `current` after manual
  clearing, closing and reopening the wizard re-enables auto-prefill
  (`GoalEvidencePanel.tsx:25,48-55`); no persisted "user touched this" marker exists
  (contract §5 `:577-578` forbids a new field). Behaviour is untested.
- **Prefill counts as an edit for LWW:** the panel's write stamps the draft's
  `updatedAt` (`CheckInWizard.tsx:127-134`), so a wizard opened only to review still
  rewrites untouched goals' `current` (and their whole-row stamp) on save. Accepted
  v1 whole-row LWW risk, but worth knowing before #143.
- **Duplicate `appTaskId` links:** two PM tasks in one project linked to the same
  backend task produce two accepted suggestions and `completedTaskCount: 2` for one
  completion, while hours count the log once. Not addressed by the contract.
- **`goal.lifecycle` transitions during review:** an imported file's lifecycle is
  applied by `setGoalLifecycle` after creation (`GoalSetActions.tsx:121`), so the
  row's `achievedAt`/`droppedAt` come from that call, not from
  `materializeGoalSet`'s stamp; the materializer's lifecycle branch is effectively
  test-only. Semantically both are "import now", but the duplicate paths can drift.
- **Archived-tracker import/export is allowed** (`GoalsPage.tsx:243`; no contract
  prohibition). Import always creates a new active tracker, so this is probably
  intended, but no test covers it and the product intent is unstated.
- **Unknown:** whether an import while the goal-lifecycle filter is "Achieved" or
  "Dropped" should reveal the imported goals (it will look empty because the page
  filter is unchanged). No test, no contract statement.
- **Unknown:** whether `serializeGoalSet` should tolerate zero goals by emitting an
  empty array (un-importable by its own parser) or block export. The contract only
  specifies the parser side.
- **Not inspected in depth:** deck/pptx (#140) interactions with evidence titles and
  the #143 metric-sync path beyond the contract text; no supabase/e2e/Tauri gates
  were run per review instructions.

## Downstream Guidance

- Requirements should account for:
  - The frozen file format must accept every value the app can store. Either metric
    `target <= 0` becomes impossible at the editor/`isGoalMetric` level (a #133
    surface change) or the file format accepts finite targets as written in
    contract §7. The current split is the only BLOCKER.
  - Export is an operation on a possibly empty tracker; decide the product rule
    (disable vs. emit an empty, non-importable file) and give export its own copy.
  - Prefill is a per-period behaviour. Decide explicitly whether the past-period
    editor may prefill from *today's* PM state; if not, scope the effect to the open
    period, and decide whether freeze state survives a period switch.
  - Import must fail visibly. Requirements should state whether a failed persistence
    after confirm is a user-visible error and whether partial imports are acceptable
    (archive-only deletion means they cannot be undone).
  - Cross-owner `projectId` handling is a product decision: warn, drop, or keep the
    dangling link. The format cannot carry project names.
- Planning should consider:
  - All fixes above are inside lane-owned files (`goalSetFile.ts` +
    `GoalSetActions.tsx` Lane B; `GoalEvidencePanel.tsx` + `CheckInWizard.tsx` +
    `GoalsPage.tsx` Lane A), so they can be routed without a contract signature
    change. Only the `target` decision may touch `factories.ts`/`GoalsPage.tsx`
    (#133 foundation) and therefore needs ORCH scope review.
  - Test strategy: add the missing negative/behavioural cases listed in Existing
    Tests (zero-goal export, target 0 export round-trip, persisted import
    round-trip with lifecycle stamps, linked-goal-with-zero-evidence, period-switch
    prefill, deleted-backend-task hours, failed persistence).
  - Validation remains `pnpm lint:app` + `pnpm test:unit` for lane work;
    `pnpm test:all` stays the Gate 12 acceptance run owned by ORCH.
- Do not include: deck/pptx changes, `src/lib/data/**` edits, new persisted fields
  (`completedAt`, "prefill touched" markers), a provider bulk-import API, or any
  merge/replace import mode. Those are explicit contract exclusions
  (contract §2 `:175-179`, §5 `:577-578`, §7 `:932-935`, §11 `:1287`).

### Final verdict

**PASS WITH FINDINGS** — the frozen signatures, ownership boundaries, full-set save
path, natural-key handling, and stamp semantics are conformed; the data model is not
at risk from these commits. One BLOCKER (export validation rejects app-legal metric
targets) and four SHOULD-FIX behavioural gaps (zero-goal export copy, per-period
prefill scoping, non-atomic/unreported import persistence, dangling imported project
links) should be resolved before Gate 12.

Prioritized list:

- BLOCKER — `src/lib/goals/goalSetFile.ts:96-100,137`: metric `target` must be
  finite, not positive (align with contract §7 `:926-927` and `factories.ts:16-19`);
  update `goalSetFile.test.ts:172-182,277-279`.
- SHOULD-FIX — `src/components/goals/GoalSetActions.tsx:73-76` +
  `goalSetFile.ts:187-189`: zero-goal export shows import copy; disable export or
  branch the message.
- SHOULD-FIX — `src/components/goals/GoalEvidencePanel.tsx:25-27,48-55` +
  `CheckInWizard.tsx:104-108,250-255`: scope freeze/prefill refs to the row/period
  and decide whether past periods may auto-prefill.
- SHOULD-FIX — `src/components/goals/GoalSetActions.tsx:99-133`: await
  `goals.persist()` before `onImported`, keep the review on failure, and avoid
  reporting success before persistence.
- SHOULD-FIX — `src/components/goals/GoalSetActions.tsx:117,167-184`: warn about
  `projectId`s that do not exist locally (or import them unlinked).
- NICE-TO-HAVE — `evidence.ts:110,128-139`; `goalSetFile.ts:4,85-89,211-236,263`;
  `GoalSetActions.tsx:125` + `GoalsPage.tsx:246`; `GoalEvidencePanel.tsx:88-91` +
  `GoalsPage.tsx:355-361`; `GoalSetActions.tsx:87,148-184`: contract-doc alignment,
  serializer filtering, redundant selection, hydration flash, file-size cap and
  review announcement.
