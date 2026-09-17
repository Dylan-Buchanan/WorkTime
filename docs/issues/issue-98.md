## Title: Pet data model & schedule engine (pure TS domain)

## Tags

Complexity Classification: T2
Severity: High
Reason: New additive pure-TS domain lib (`src/lib/pets/` following the habits/engine house style) plus record types in `src/state/types.ts`, with genuinely complex logic: interval recurrence, nap reflow (delay/pull-forward/manual-suggestion with fixed items immovable), fulfillment windows, and next-due computation. Blast Radius=3 (new lib files + shared state/types.ts, no existing dependents yet), Uncertainty=1 (well-specified, established patterns to copy), Behavior=3 (complex state/reflow logic), Testing=1 (pure functions, co-located Vitest with fixed dates), Reversibility=1 (additive new files). Total=9.
Needs research before implementation: No

## Summary

Create the pure TypeScript pet domain that underpins the entire `/pet` feature: a pet profile with derived age, care activity types, a schedule model with fixed-time and interval-based items, a nap toggle with reflow semantics, and next-due/overdue computation. This issue is engine-only — persistence, UI, and notifications are separate issues — but its types and API boundary are what every other pet issue consumes.

## Steps to Reproduce Context

1. Today there is no way to model a pet's care schedule in the app; the domain does not exist.
2. A user cannot express "potty every 60–90 minutes anchored to the last potty" or "training at 3:45, flexible."
3. The pet UI issues (Today view, logging, training/fixations, timeline, notifications) all need these types and pure functions to exist first.

## Expected Behavior

A pure, dependency-free pet domain exists that can answer, for any given `now`: how old the pet is, what schedule items are due now/next, whether the pet is napping and how the schedule reflows around a nap, and what the "free until" window is — all computed from record inputs, testable with fixed dates.

## Actual Behavior

The pet domain does not exist; no types, factories, or schedule logic are present.

## Requirements for completed issue

1. **Pet profile** record: name, birth date. Age is always *derived* from birth date, never stored. Age display rule: weeks until the pet is 6 months old, months only afterward (as a pure formatting function, engine-tested).
2. **Activity types**: `potty`, `training`, `playtime`, `feeding` (extensible enum-style type).
3. **Schedule items** each carry a stable ID and a machine-readable time window (consumable by a future master-calendar page without scraping UI), a **fixed vs. flexible** classification, an ordering/priority, and support two recurrence modes:
   - fixed-time items (clock-anchored, never move), and
   - interval-based items (e.g. potty every 60–90 minutes, anchored to the last potty record).
4. **Activity records** are minimal and append-only: `{ activityType, timestamp, durationMinutes? }` — `durationMinutes` optional and only meaningful for training/playtime; no provenance, notes, or trigger attribution fields.
5. **Schedule fulfillment rule** (decided): a scheduled item counts as fulfilled when an activity record of the matching type exists within `[item start, next item start)`. Implement and engine-test this exact window rule.
6. **Nap records + nap toggle state**: starting/ending a nap writes a nap record (start/end timestamps). Naps are *stored records* (usable for future nap-pattern analysis) but are not notable-events and not schedule items. While napping, interval accumulation pauses.
7. **Reflow engine** (the core of this issue):
   - Nap start → interval-based items (potty) delay; no overdue accrual during the nap.
   - Nap end → next potty pulls forward (post-wake urgency).
   - Flexible items (playtime, training) are **manual-with-suggestion**: the engine proposes a reflowed arrangement, the user confirms or adjusts (the UI for this is Issue B; the engine produces the proposal as data).
   - Fixed items never move.
   - The engine emits **shift indicators** as computed data (e.g. "potty +40m — nap 1:30–2:10") so the UI can display why today's schedule looks the way it does.
8. **Next-due / overdue computation**: two distinct answers, both engine functions — the **countdown target** is the next obligation of any kind, and **"free until"** is the next schedule item (fixed or flexible). Overdue is computed from the log, never stored.
9. **Weight log** record type: append-only `{ timestamp, weight }` entries (the profile's "current weight" is the latest entry).
10. House conventions: record types in `src/state/types.ts` re-exported through the `src/lib/pets/` barrel; factories take `(input, now: Date, id: string)` with no wall-clock or random-ID inside logic (per `src/lib/engine/` rules); no I/O or network. Persistence is intentionally out of scope (Issue G), but the record shapes here are the contract G implements.
11. Engine tests, co-located, using builder functions and fixed dates (house style from `src/lib/engine/weekOverview.test.ts`), covering at minimum: interval anchoring after a potty record; out-of-order/corrected timestamps; nap spanning a scheduled potty; nap ending right before a fixed item; potty logged mid-nap (defined behavior required, even if rejected); two consecutive naps; overdue accumulation across a nap; fulfillment-window matching (in-window, out-of-window, boundary); age display at the 6-month transition.

## Context

- Files:
  - `src/lib/engine/core.ts` — EngineResult/EngineError conventions, clone-first command pattern, caller-supplied `now`.
  - `src/lib/engine/weekOverview.ts` — single-input-object builder pattern with RangeError validation for larger derivations.
  - `src/lib/habits/types.ts`, `src/lib/habits/factories.ts`, `src/lib/habits/calendar.ts` — domain lib layout, `createX(input, now, id)` factory naming, local-noon date math style.
  - `src/lib/todos/recurrence.ts` — discriminated-union recurrence model with `normalizeRule`/`isDueOn`/`nextOccurrence` shape.
  - `src/state/types.ts` — where shared domain record types live (Habit, HabitCompletion, Todo, TodoCompletion precedents).
- Code Snippets:

  Factory pattern to follow (`src/lib/habits/factories.ts`):
  ```ts
  export function createHabit(input: NewHabitInput, now: Date, id: string): Habit {
      return { id, name: input.name, ..., createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }
  ```

  Builder-input pattern to follow (`src/lib/engine/weekOverview.ts`):
  ```ts
  export interface BuildWeekOverviewInput { tasks: readonly PMTask[]; projects: Readonly<Record<string, Project>>; reference: Date; }
  export function buildWeekOverview(input: BuildWeekOverviewInput): WeekOverview
  ```

## Notes

- Dependency root: Issues B, C, D, E, F, G all consume this domain's types and functions.
- Deliberately excluded: provenance (scheduled vs ad-hoc), trigger attribution (post-nap), notes on activity records — decided against for v1; the append-only shape allows adding optional fields later without breaking history.
- Known gap accepted: post-nap potty attribution is not answerable from v1 data (decided).
- The fulfillment window rule `[item start, next item start)` is the agreed default; if it proves wrong in the UI, it changes here — in the engine, with tests — not in components.
