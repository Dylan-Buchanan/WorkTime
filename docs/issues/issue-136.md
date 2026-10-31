# Title: Goal-by-goal check-in wizard

## Tags

Complexity Classification: T3
Classification Reason: A multi-step wizard surface (goal-by-goal cards, three buckets, planned-item rows, focus toggles, stale-period guard) writing through the GoalProvider, with draft/save semantics and upsert-by-period identity. Single domain, established persistence pattern, but substantial UI + test surface.

Severity: Low
Severity Reason: Enhancement; no existing behavior changes.

Needs research before implementation: No

## Summary

The per-period update flow: a wizard of goal-by-goal cards where the user records, per goal, the three buckets — **did** / **currently working on** / **planned next** (text + optional due date) — plus a status pill (on track / at risk / blocked), an optional one-line miss reason, and a focus toggle. These entries are the goal's timeline; the only history the Goals design keeps. Check-ins are editable after saving (immutability was explicitly rejected).

Decisions already made: the wizard **pins its period window at open** (the current grid period derived from `cadenceAnchorAt` + the cadence rule, per #135) and keeps writing against it even if sync advances `lastBuiltPeriodStart` from another device — with a stale-period guard that warns and refreshes rather than silently retargeting. Check-in identity is `(goalId, periodStart)` with `periodStart` a `LocalDateKey`, so re-opening the wizard upserts rather than duplicates. A tracker with no open period yet (before its first boundary) cannot open the wizard at all, and v1 has no backfill of earlier periods. Focus defaults **on** for every active goal (the LLM focus suggestion is deferred to #142, so there is no rule engine in v1).

## Steps to Reproduce Context

1. Open `/goals` (#134) — goals can be created but there is no way to record a period update for any of them.
2. Observe that `GoalCheckIn` data exists (#133) but nothing writes it.
3. Observe the sync edge case: `lastBuiltPeriodStart` can advance mid-edit via `revision` reload, since the staging store syncs across devices.
4. Observe the period grid: a tracker created before its first cadence boundary has no open period, so the check-in entry must not open a wizard.

## Expected Behavior

- "Check in" on a tracker opens a wizard listing every active goal as a card, in `sortOrder`.
- Each card captures: status pill, did (free text; checkbox suggestions arrive in #137), current, planned items (text + optional date), optional miss reason, focus toggle (default on). The slip counter from #135 is visible on each card.
- Nothing gets skipped: the wizard walks goal-by-goal (cards, not a table — prose has room).
- Saving writes `GoalCheckIn` rows keyed by `(goalId, periodStart)` where `periodStart` is the pinned grid boundary; re-opening the wizard for the same period loads and edits the existing rows.
- If sync advances `lastBuiltPeriodStart` while the wizard is open, the wizard detects the pinned period is stale and warns the user (offering to reload against the new period) instead of silently saving into a closed period.
- Before the tracker's first boundary there is no open period, so the check-in entry is disabled with an explanation of when the first period starts. There is no backfill and no partial first period.
- Past-period check-ins remain editable from the goal's history view (edits can retroactively change slip counts — accepted per #135).

## Actual Behavior

No check-in flow exists; there is no way to produce the data the deck (#138) consumes.

## Requirements for completed issue

1. Wizard component (suggested `src/components/goals/CheckInWizard.tsx`) reachable from the GoalsPage per tracker.
2. Period pinned at open using #135's grid derivation; displayed as the period label on the wizard header.
3. Per-goal card with status pill, three buckets, planned-item add/remove with optional due dates, miss reason, focus toggle, and the #135 slip badge.
4. Upsert semantics by `(goalId, periodStart)` — no duplicate check-ins on re-open; goals created after the wizard opened appear on refresh, not mid-edit. Note that two devices creating the same period offline can collapse to one row via #133's natural-key dedupe, so never assume a locally generated check-in id survives sync.
5. Stale-period guard: when a `revision` reload advances `lastBuiltPeriodStart` for the open tracker, show a non-blocking warning with reload/continue choices.
6. Editable past check-ins from a goal history view (minimal: select a past period from the known timeline, edit, save). Only periods that already have check-ins or are on the grid after the first boundary are selectable.
7. No project-derived prefill in this issue — that is #137; the did/current buckets are plain text here.

### Testing

- Wizard component tests: full flow (status → did → current → planned → focus → save), planned item add/remove with dates, upsert on re-open, focus default on, slip badge rendering.
- Stale-period test: simulate a store revision that advances `lastBuiltPeriodStart` mid-wizard and assert the warning and both recovery paths.
- No-open-period test: the wizard cannot open before the tracker's first boundary and explains why.
- Provider-level test: saved check-ins reach `data.saveGoals` and survive remount; past-period edit persists; the full check-in set (including unchanged rows) is passed on every save.
- Empty tracker: wizard shows an explanatory empty state rather than a blank card list.

## Context

Code Source: `src/state/GoalContext.tsx` (from #134)
Code Description: The provider whose save effect and `revision` reload the wizard rides; the stale-period guard hooks the same reload path.

Code Source: `src/components/pets/PetScheduleItemForm.tsx`, `src/components/HabitsPage.tsx`
Code Description: Existing form/card component patterns and dnd-kit usage in this codebase.

Code Source: `src/lib/goals/periods.ts` (from #135)
Code Description: The grid derivation the wizard pins at open — `cadenceAnchorAt` + the cadence rule, returning `LocalDateKey` boundaries.

Code Source: `src/lib/data/StagedDataAccess.ts`, `saveHabits` (~L447–509)
Code Description: Why upsert identity matters — the staging writer diffs the full desired set, so the wizard must always pass the complete check-in set including unchanged rows.

## Notes

- Depends on #133, #134, #135.
- Planned items are the lightest thing that is still checkable in two weeks — effort sizing was considered and dropped; do not add it.
- Bucket screens (per-bucket instead of per-goal) were rejected; keep the card shape.
