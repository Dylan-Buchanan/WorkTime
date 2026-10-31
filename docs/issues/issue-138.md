# Title: Deck plan builder — pure slide assembly with focus/appendix, notes, and talk-length estimate

## Tags

Complexity Classification: T3
Classification Reason: A sizable pure TypeScript module (slide inventory, ordering, appendix collapse, speaker notes, per-slide seconds, chart series, talk-length estimate) with heavy Vitest coverage. No dependencies, no UI, no new libraries — but it is the design heart of the deck feature and every output shape consumed downstream (#139 preview, #140 renderer) is defined here.

Severity: Low
Severity Reason: Enhancement; pure module, zero impact on existing behavior.

Needs research before implementation: No

## Summary

The deterministic layer of deck generation: a pure function that assembles a **deck plan** — slides as plain data — from a tracker, its goals, their current-period check-ins, and the #135 derivations (slips, sparklines, period window). No LLM (deferred to #142), no pptx library, no file. The plan is the single source the preview (#139) edits and the renderer (#140) consumes.

Slide inventory, in fixed order: **Title/period** (tracker name + one-line purpose + period label) → **per-goal recaps** (focus goals only) → **misses + reasons** → **next plans** → **progress charts** → **closing commitments** → **appendix** (all non-focus goals as a compact status-pill roster).

## Steps to Reproduce Context

1. Complete a check-in (#136) and press Build — nothing happens; no deck concept exists.
2. Observe that `src/lib/goals/` has no deck module and no output type another layer could render.

## Expected Behavior

- `buildDeckPlan(input)` returns a `DeckPlan`: ordered slides, each with a type, title, content (text/bullets/series), speaker notes, and a suggested seconds value.
- The plan is built for one explicit period, passed in as `LocalDateKey` boundaries from #135. The title/period slide uses #135's label for that period; the builder never reads the clock to decide which period it is producing.
- Every active goal appears in every period's plan: focus goals get full recap slides; non-focus goals collapse into the single appendix roster slide. Focus defaults on (#136), so a 4-goal tracker yields 4 recap slides and no appendix; demoting goals in #139 produces the appendix.
- Achieved goals appear in the recap of the period they were achieved (via #135 inclusion rules) and nowhere after; the "slipped 2×" badge renders on the recap slide with neutral factual language — no closing-slide callout, no lecturing.
- Misses slide lists unchecked planned items and their optional reasons; next-plans slide lists the current period's planned items with optional dates; closing slide lists next-period commitments.
- Progress charts slide carries per-goal series data: this period's movement plus the sparkline from check-in history since goal start (data only — rendering is #140). A first-period goal with no history yields no series, not a broken one.
- A running talk-length estimate is computed (stated words-per-minute assumption + per-slide base seconds) and included in the plan. Nothing is capped anywhere — overrun is visible, not blocked.
- An empty period (zero progress on every goal) still produces a complete plan with honest placeholder copy — warn, never block.

## Actual Behavior

No deck plan exists; there is nothing to preview or render.

## Requirements for completed issue

1. Pure module `src/lib/goals/deck/plan.ts` (+ `types.ts`): `DeckPlan`, `DeckSlide` and slide-type union, `buildDeckPlan(input)` with injected `now`; no I/O, no clock, no random IDs — engine-module conventions apply.
2. Fixed slide order exactly as listed above; appendix omitted when no goal is non-focus.
3. Speaker notes and suggested seconds on **every** slide.
4. Talk-length estimate with an explicitly named WPM constant (pick ~130 wpm + a per-slide base; the number must be a named constant, not a magic literal).
5. Chart series data (this-period movement + sparkline) attached to the progress slide from #135 derivations.
6. Escalation badge ("slipped 2×") on recap slides at exactly 2+ consecutive slips; neutral copy.
7. Empty-period and thin-input behavior: complete plan, honest placeholders (e.g. "No progress recorded this period").
8. Metric current/target text on recap slides when a metric exists (manual values only until #143).

### Testing

- `plan.test.ts` with fixture builders (fixed `LocalDateKey` grids, tracker/goal/check-in factories from #133): full-order assertion, focus/appendix split at several goal counts, achieved-goal inclusion boundary, misses aggregation, commitment slide content, badge at 1/2/3 slips, empty-period plan, title-slide label for a snapped-backward monthly period, talk-length estimate arithmetic, determinism (same input → identical plan).
- Property-ish case: every active goal appears exactly once across recaps + appendix.

## Context

Code Source: `src/lib/goals/` — `types.ts`, `factories.ts` (#133), `periods.ts`, `slips.ts` (#135)
Code Description: Inputs to the plan builder; the check-in timeline is the sole history source — the plan reads it, never mutates it.

Code Source: `src/lib/engine/` (e.g. `weekOverview.ts`, `endOfDay.ts`)
Code Description: The pure-module + fixture-test conventions this module must follow; note the AGENTS.md rule that engine-style modules stay I/O-free.

Code Source: `src/lib/goals/evidence.ts` (#137)
Code Description: Accepted evidence (task titles, hours) flows into recap slide content — task titles only, never task or project descriptions.

## Notes

- Depends on #133 and #135 (types + derivations). **Buildable in parallel with #134/#136/#137** as long as the #133 types and #135 derivation signatures are agreed — fixtures can stand in for UI-produced data.
- The deck plan is deliberately **not persisted** — no deck archive, ever. Rebuild is always available and the plan is regenerated from data each time.
- Slide types as declarative data per tracker, and per-slide "punch up" re-runs, were brainstorm directions deliberately left out of v1.
