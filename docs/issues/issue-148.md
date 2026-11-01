# Title: Show habit metrics in the presentation deck

## Tags

Complexity Classification: T3
Classification Reason: Ten-plus files across the pure plan layer and the renderer: `DeckPlanInput` and `buildDeckPlan` (`src/lib/goals/deck/plan.ts` L42–50, L270–366), `metricTextOf`/`buildSeries` (L105–112, L251–264), `findThinWarnings` (L436–483), `DeckMetricView`/`DeckSeries`/`DeckThinWarningKind` (`src/lib/goals/deck/types.ts` L14–21, L74–87, L113–114), the hand-authored SVG chart (`src/lib/goals/deck/chart.ts` L10–27), the renderer's recap details and progress block (`src/lib/goals/deck/render.ts` L46–51, L82–101), the preview (`src/components/goals/DeckPreview.tsx` L486–487, L611–618), the plan's only caller (`src/components/GoalsPage.tsx` L123–139), and `metricSnapshot` (`src/lib/goals/slips.ts` L211–215). The plan must stay a pure function of its input.

Severity: High
Severity Reason: Wrong numbers baked into an exported, presentable artifact are shown to an audience and undermine the review. A degenerate chart scale, a spurious "0 of 5" for a broken link, or a derived line that overwrites an edited appendix entry are all visible correctness bugs; recovery requires rebuilding the deck, and the exported file has already left the app.

Needs research before implementation: No

## Summary

The deck already has the shapes for this — `DeckSeries.kind: "metric"` with `current`/`target` fields has been dormant since the deck phase, and the contract records that metric history was deliberately not invented. Habit-linked goals (issues 145–147) now produce a live per-period reading, but the deck still shows the goal's stored `metric.current` on recaps and appendix entries and emits status-only progress series.

Bake the derived numbers into the deck plan at build time so the renderer stays pure and preview/export stay identical: derived metric lines on recap and appendix copy, a real `metric` series with a target reference line on the progress slide, a consecutive-period hit callout, and a thin warning for a broken habit link.

### Shared constraints (decided — do not re-litigate)

- The metric is the count of completed habit buckets whose **start date** falls in `[periodStart, periodEnd)`. The same rule defines both the numerator and the "out of N" denominator.
- The number is derived live from habit completions. `GoalCheckIn` gains no field and there is no new staging entity.
- One habit per goal metric: `source: "habit"` plus `habitId`. Additive and backwards-compatible with existing rows.
- `overridePinned` stays required-but-false for habit metrics and is not exposed in the UI.
- The goal-set format is unchanged: a habit-linked metric exports as label/target/unit and imports as `manual` / `0`.
- Sequencing: issue 145 supplies `src/lib/goals/habitMetric.ts`; this issue must not re-implement any counting.

## Steps to Reproduce Context

1. Attach a habit to a goal's metric (issue 146), record some habit completions, then build a deck for a completed period from `/goals`.
2. `buildDeck` (`src/components/GoalsPage.tsx` L123–139) calls `buildDeckPlan` with only `tracker`, `goals`, `checkIns`, `period`, and `now` — habits and completions are never passed, so the plan cannot know the habit state.
3. Inspect the recap: `buildRecapSlide` (`src/lib/goals/deck/plan.ts` L144–178) sets `metric: metricSnapshot(goal)` (L172), which copies the stored `current`/`target` verbatim. `metricTextOf` (L105–112) then renders "Label: current / target unit" on recap details and appendix entries.
4. Inspect the progress slide: `buildSeries` (L251–264) always emits `kind: "status"` from `buildSparkline`; `chart.ts` `buildSeriesSvg` has no target concept and picks its own min/max from the data.
5. Note there is no warning for a habit that no longer resolves — `findThinWarnings` (L436–483) only knows `miss-without-reason`, `goal-without-plans`, and `empty-period`.

## Expected Behavior

- The deck plan carries the period's **derived** reading for each habit-linked goal (label, current, target, unit, met, delta), and recap and appendix copy render it as "4 / 5 sessions · short by 1", "5 / 5 sessions", or "8 / 5 · 3 over".
- The stored `metric.current` of a habit-linked goal is never used for display, so an earlier period derives from habits even if the metric was switched from manual to habit mid-history.
- The progress slide gains a real `kind: "metric"` series for each habit-linked goal, with one point per stored check-in row whose `periodStart` is on the current grid (off-grid rows skipped) and `current`/`target` populated.
- The SVG chart draws a target reference line for metric series and frames sensibly when all values are identical or when the target sits far above the data.
- The recap carries a consecutive-period hit callout (for example "hit target 3 periods running") using the streak rule that walks back over periods where the goal was included, so a zero-count period the goal existed for breaks the streak while pre-creation periods are a boundary.
- A habit-linked goal whose habit no longer resolves shows the metric as unavailable and raises a thin warning, never "0 of 5".
- The plan stays a pure function of its input and its `generatedAt` seam; `countDeckWords` does not change for the same content; rebuild-for-the-same-period and `stampBuiltPeriod` behaviour is unchanged.

## Actual Behavior

- `DeckPlanInput` has no habits or completions, so no derived number can enter the plan (`src/lib/goals/deck/plan.ts` L42–50).
- Recap and appendix metric copy is the stored snapshot (`metricSnapshot`, `src/lib/goals/slips.ts` L211–215), rendered by `metricTextOf` and `render.ts` L46–51 as `Label: current / target unit`.
- `buildSeries` emits status series only, so `DeckSeries.kind: "metric"`, `current`, and `target` are unused; the chart has no target line and no metric ticks (`src/lib/goals/deck/chart.ts` L16–24).
- There is no hit-streak callout and no broken-habit warning kind.
- The preview echoes the same stored values (`src/components/goals/DeckPreview.tsx` L486–487).

## Requirements for completed issue

1. `DeckPlanInput` accepts habits and completions, and `GoalsPage.buildDeck` passes them; the plan remains a pure function of its input plus the existing `now` seam, with no I/O or clock reads added.
2. Recap and appendix metric copy use the period's derived reading from `src/lib/goals/habitMetric.ts` for habit-linked goals, including met/short/over phrasing, and are unchanged for manual metrics.
3. The stored `current` of a habit-linked metric is ignored for display, including for historical periods.
4. The progress slide includes a `kind: "metric"` series per habit-linked goal built from on-grid stored check-in rows only, with `current` and `target` populated, alongside the existing status series.
5. The SVG chart renders a target reference line for metric series and does not divide by zero or draw a degenerate scale when values are identical or the target is far outside the data range, while keeping the target line visible.
6. The recap includes a consecutive-period hit callout computed by the streak rule over included periods, and a goal that existed for a zero-count period has that period break its streak.
7. `DeckThinWarningKind` gains a broken-habit-link kind, the warning depends only on plan data, and a broken link renders the metric as unavailable rather than zero.
8. `countDeckWords` produces the same count for unchanged content (deltas and hit state are numbers, not prose), and in-memory recap edits and appendix copy retention still survive promote/demote refreshes.
9. Rebuilding a deck for the same period and `stampBuiltPeriod` behaviour are unchanged.

### Testing

- `plan.test.ts`: a habit-linked goal's recap `metric` carries the derived current/target/met/delta for the requested period; a manual metric is untouched; a historical period derives from habits even when the metric source changed later; a broken `habitId` yields an unavailable reading plus the new warning and not zero.
- `plan.test.ts` for series: metric series has one point per on-grid stored row and skips off-grid rows; fewer than two on-grid rows produces no metric series while the status series still renders; the hit callout appears with the right count and a zero-count included period breaks the streak.
- `chart.test.ts`: a metric series draws a target line; identical values do not divide by zero; a target far above the data still frames with the target line visible; status series output is unchanged.
- `plan.test.ts` for the estimator path: `countDeckWords` for a recap with a derived metric equals the count for the same content expressed with numbers only (no prose delta), and a promote/demote after editing the derived metric line does not overwrite the edited appendix entry.
- `render.test.ts`: recap details and the appendix roster render the derived phrasing, and the progress block renders metric series with its target line.
- `DeckPreview.test.tsx`: the recap metric line shows the derived reading and the progress block lists metric series.
- `pnpm test:unit` and `pnpm run build` (the pptx library must still load only through the function-local dynamic import in `render.ts`).

## Context

Code Source: `src/lib/goals/deck/plan.ts` (L42–50, L270–366)
Code Description: The plan input and builder. Habits/completions join the input here; the per-goal loop already computes `rows` and `current` for the requested period, which is exactly the window the derivation needs.

```ts
export interface DeckPlanInput {
    tracker: GoalTracker;
    goals: readonly Goal[];
    checkIns: readonly GoalCheckIn[];
    period: GoalPeriod;
    now: Date;
    evidenceTitlesByGoal?: Readonly<Record<string, readonly string[]>>;
    localDateOf?: LifecycleDateProjection;
}
```

Code Source: `src/lib/goals/deck/plan.ts` (L105–112, L172, L251–264)
Code Description: Where the stored snapshot becomes display copy and where the status-only series is built — both must branch on the habit source.

```ts
function metricTextOf(metric: DeckMetricView | null): string | null {
    if (!metric) return null;
    ...
    const values = `${metric.current} / ${metric.target}`;
```

Code Source: `src/lib/goals/deck/types.ts` (L14–21, L74–87, L113–114)
Code Description: `DeckMetricView`, the already-shaped `DeckSeries` with `kind: "metric"` and nullable `current`/`target`, and the warning kind union to extend.

```ts
export interface DeckSeries {
    goalId: string;
    goalTitle: string;
    kind: "status" | "metric";
    label: string;
    unit: string;
    current: number | null;
    target: number | null;
    points: DeckSeriesPoint[];
}
```

Code Source: `src/lib/goals/deck/chart.ts` (L10–27)
Code Description: The hand-authored SVG. Metric series need a domain that includes the target and a reference line; the current `min`/`max` come only from the data and `span = max - min || 1` is the only guard.

```ts
const values = series.points.map(point => point.value);
const min = series.kind === "status" ? 0 : Math.min(...values);
const max = series.kind === "status" ? 2 : Math.max(...values);
const span = max - min || 1;
```

Code Source: `src/lib/goals/deck/plan.ts` (L436–483)
Code Description: `findThinWarnings`, which must gain the broken-habit-link warning while continuing to depend only on `DeckPlan` data.

Code Source: `src/lib/goals/deck/render.ts` (L46–51, L82–101)
Code Description: The recap details bullet and the progress block that rasterizes each series to PNG; both consume plan data only and must stay pure.

Code Source: `src/components/goals/DeckPreview.tsx` (L486–487, L611–618, L672–681)
Code Description: The preview's recap metric line and progress series list, plus the editable appendix metric text whose retained edits must win over newly derived values.

Code Source: `src/components/GoalsPage.tsx` (L123–139)
Code Description: The only `buildDeckPlan` call site — it must supply the habit state from the habits provider, the same way it already supplies goals and check-ins.

Code Source: `src/lib/goals/slips.ts` (L211–215)
Code Description: `metricSnapshot`, the stored-snapshot helper whose output is replaced by the derived reading on habit-linked goals.

Code Source: `docs/goals/contract.md` (L782–798, L809–832, L834–841)
Code Description: The frozen deck derivation text ("Progress uses status-only series ... no metric history is invented", the retention rule that editing a recap metric must never overwrite an edited appendix entry, and the estimator/warning rules). These must be amended by the contract update in issue 145 so the document matches the new behaviour.

## Notes

- Warnings still depend only on plan data — the broken-link warning must be derivable from the plan, so the plan needs to record the unavailable state rather than re-reading habits at warning time.
- Existing hint: `renderSlide`'s progress branch filters `series.filter(item => item.points.length >= 2)` and prints "No status history is available yet." when nothing remains — keep that empty-state path working when a goal has only a metric series and too few points.
- Keep the metric series label/unit word-counted exactly as the status series already is; only rendered phrasing changes, so the estimate stays truthful.
