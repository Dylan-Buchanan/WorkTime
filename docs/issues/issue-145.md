# Title: Habit-linked goal metrics — data model, DB constraint, and pure derivation engine

## Tags

Complexity Classification: T4
Classification Reason: Touches a live Supabase table constraint (`public.goals.metric` at `supabase/migrations/20261030000000_goals.sql` L41) plus the shared `GoalMetric` contract at `src/state/types.ts` L330–337, its validator/factory at `src/lib/goals/factories.ts` L16–19, the two copies of the same source union (`GoalMetricSnapshot` at `src/lib/goals/slips.ts` L25–32, `DeckMetricView` at `src/lib/goals/deck/types.ts` L14–21), and the goal-set importer at `src/lib/goals/goalSetFile.ts` L286–287. It also introduces a new pure module and a new frozen contract section, and it gates the three downstream surfaces (issues 146–148). The migration half is only verifiable against the local Supabase stack.

Severity: Critical
Severity Reason: If the DB constraint and the validator disagree, the full-set goals save path (`src/state/GoalContext.tsx` `saveGoals` L197 → `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql` L71–74) rejects the whole row set, so every goal save fails — not just habit ones. This module also becomes the single source of truth for every habit number rendered by issues 146, 147, and 148, so an arithmetic bug here propagates to four surfaces.

Needs research before implementation: Yes

### Research Needed

The shape change and the module ownership are decided, but the current schema and habit inputs must be pinned before the migration is written.

- **Constraint identity:** the metric check in `20261030000000_goals.sql` L41 is an unnamed table-level `check (...)`; confirm the name Postgres actually materialized (`goals_metric_check` vs `goals_check`) against the local stack (`\d public.goals`, `pg_constraint`) and choose a drop strategy that is safe to re-run.
- **Other rejection points:** verify no other validator rejects `source: "habit"` first — `isGoalMetric` (`src/lib/goals/factories.ts` L16–19), `readMetric` (`src/lib/goals/goalSetFile.ts` L125–136), the staged-sync RPC, and the data-access layer.
- **Habit inputs available to a pure module:** confirm the exact `HabitCompletion` shape (`src/state/types.ts` L151–157) and how complete a set the caller can pass, including whether archived habits and their completions are retained (they are hard-deleted with completions today — `src/state/HabitContext.tsx` `deleteHabit` L301, `src/components/HabitsPage.tsx` L121).
- **Bucket boundary convention:** habit buckets are Sunday-anchored weeks and calendar months (`src/lib/habits/calendar.ts` L40–47) while goal periods are arbitrary anchor/stride windows (`src/lib/goals/periods.ts` L100–117, L186–241); pin the comparable "bucket start" for a weekly bucket that begins inside the window but ends after `periodEnd`.
- **Max-buckets table:** confirm the per-cadence maximums (7-day stride: 7×intervalWeeks daily / intervalWeeks weekly / 1 monthly; monthly: 28–35 daily / 4–5 weekly / up to 2 monthly) against real monthly periods, since the monthly boundary can snap into the prior month (`monthlyBoundary` L77–84).

## Summary

Goal metrics are a single stored object that supports only `manual` and `liftingtracker` today, and the `goals` table enforces exactly that union. There is no way to express "this goal is measured by a habit", and no code path derives a number from habit completions — the stored `current` is a static number and the deck contract explicitly states no metric history is invented.

Add `source: "habit"` with a `habitId` reference to `GoalMetric`, relax and re-create the DB check constraint so those rows can be saved, and add one pure module (`src/lib/goals/habitMetric.ts`) that owns all habit↔period arithmetic. Every other surface (goal editor, check-in strip, deck) consumes that module rather than counting for itself.

### Shared constraints (decided — do not re-litigate)

- The metric is the count of completed habit buckets whose **start date** falls in `[periodStart, periodEnd)`. The same rule defines both the numerator and the "out of N" denominator.
- The number is derived live from habit completions. `GoalCheckIn` gains no field and there is no new staging entity.
- One habit per goal metric: `source: "habit"` plus `habitId`. Additive and backwards-compatible with existing rows.
- `overridePinned` stays required-but-false for habit metrics and is not exposed in the UI.
- The goal-set format is unchanged: a habit-linked metric exports as label/target/unit and imports as `manual` / `0`.
- Sequencing: this issue lands first; issues 146, 147, and 148 follow in parallel.

## Steps to Reproduce Context

1. Open `/goals`, add a goal, tick "Track one metric" — the Source select (`src/components/GoalsPage.tsx` L430–432) offers `Manual`, plus a disabled `Auto` only when the goal already carries a `liftingtracker` metric.
2. Inspect `src/state/types.ts` L330–337 — `GoalMetric.source` is `"manual" | "liftingtracker"` with a required numeric `current` that is authored by hand.
3. Attempt to save a goal whose `metric` has `source: "habit"` — the goals row travels unchanged through `saveGoals` and the staged-sync RPC, and `public.goals` rejects it at `supabase/migrations/20261030000000_goals.sql` L41, whose check pins `metric->>'source' in ('manual','liftingtracker')`.
4. Look for a habit-based count — `src/lib/habits/calendar.ts` can produce a bucket key for a date, and `src/lib/habits/windows.ts` exposes `isHabitCompleted`, but nothing maps a habit's buckets into a goal period, and nothing distinguishes a partial in-progress period from a completed one.

## Expected Behavior

- `GoalMetric` accepts `source: "habit"` with a non-empty `habitId`, and existing `manual` / `liftingtracker` rows keep validating exactly as they do today.
- A habit metric with an absent, empty, or non-string `habitId` is rejected by both the validator/factory and the database.
- Any other source carrying a `habitId` is rejected by both the validator/factory and the database.
- The goals table accepts habit metrics after the migration and still rejects malformed metric objects.
- A single pure module owns bucket enumeration, per-period reading, hit/delta, per-cadence maximum buckets, and the consecutive-period hit streak, with no clock, no I/O, and injectable `now`/`today`.
- `docs/goals/contract.md` gains a frozen section describing the shape change, the window rule, and the module's exported surface, and its existing "no metric history" statement is reconciled rather than left contradicting the new behaviour.

## Actual Behavior

- `GoalMetric.source` is a two-member union (`src/state/types.ts` L335) and `isGoalMetric` rejects anything else (`src/lib/goals/factories.ts` L18).
- `public.goals` carries a table-level check that permits only `manual` and `liftingtracker` (`supabase/migrations/20261030000000_goals.sql` L41); no later migration alters it (`supabase/migrations/20261031000000_goal_staged_sync_rpc.sql` passes `metric` through untouched at L71–74).
- `GoalMetricSnapshot` (`src/lib/goals/slips.ts` L30) and `DeckMetricView` (`src/lib/goals/deck/types.ts` L19) repeat the same two-member union.
- The goal-set importer hard-codes `source: "manual"` and `current: 0` (`src/lib/goals/goalSetFile.ts` L287).
- There is no module, export, or type anywhere that turns a habit's frequency plus completions into a per-goal-period count.

## Requirements for completed issue

1. `GoalMetric` in `src/state/types.ts` gains `source: "habit"` and a `habitId` reference, with the strict pairing decided above (habit requires a non-empty `habitId`; `manual` and `liftingtracker` must not carry one).
2. One new Supabase migration drops the existing metric check on `public.goals` and re-adds it as an explicitly named constraint that accepts `habit` and enforces the same strict `habitId` pairing. No new table, no new column, and no change to the goals staged-sync RPC.
3. `isGoalMetric` and `createGoal`/`createGoalCheckIn` in `src/lib/goals/factories.ts` accept the new source under the same rules, and every existing source keeps its exact current validation behaviour.
4. `src/lib/goals/habitMetric.ts` exists, is pure (no clock, no I/O, injectable `now`/`today`), and exports: bucket enumeration for a habit frequency inside a `PeriodBounds` window using the bucket-start-in-window rule; a per-period reading (completed count, total buckets in the window, buckets already available, partial flag, days remaining); hit state and delta as numbers (`met`, `delta`) rather than prose; the maximum buckets a cadence can ever produce in one period, computed from the cadence rather than by walking dates; and the consecutive-period hit streak over grid periods.
5. `GoalMetricSnapshot` and `DeckMetricView` stay consistent with the widened union, and the goal-set export/import path is unchanged in behaviour (habit-linked metrics export as label/target/unit and import as `manual` / `0`).
6. `docs/goals/contract.md` gains a new frozen section covering the shape change, the `[periodStart, periodEnd)` window rule, and the derivation exports, and the existing sections that freeze `GoalMetric`, `GoalMetricSnapshot`, and `DeckMetricView` are updated so the document no longer states a two-source union or that no metric history exists.
7. A reading for a goal whose `habitId` does not resolve is "unavailable", never `0`, mirroring `brokenProject` in `src/lib/goals/evidence.ts` L91.
8. An archived habit remains fully countable for every period; archiving never blanks history.
9. Off-grid historical `periodStart` keys do not throw.

### Testing

- Vitest (`pnpm test:unit`) for `src/lib/goals/habitMetric.ts` covering: daily, weekly, and monthly habits across a multi-week and a monthly goal period; a weekly bucket whose Sunday start is inside the window but whose week extends past `periodEnd` counting there and not in the adjacent period; a period containing zero buckets of that frequency reading as `0 of 0` with "nothing possible" distinguished from `0 of 5`; an in-progress period reporting partial and counting only non-future buckets; a completed period never reporting partial; `daysRemaining` clamped at `0` on the last day; the per-cadence maximum helper for every frequency/cadence combination, including the monthly 4–5 weekly and 28–35 daily ranges; the streak rule counting back over grid periods and stopping at the goal's first period; and an unresolvable `habitId` reading as unavailable.
- Vitest for `src/lib/goals/factories.ts`: habit metrics validate; missing/blank `habitId` is rejected; `habitId` on `manual`/`liftingtracker` is rejected; the existing invalid-metric cases still fail.
- `pnpm test:integration` against the local stack: the new migration applies, a habit metric row inserts and updates, and a habit metric with a blank `habitId` (and a `manual` metric carrying a `habitId`) is rejected by the database.
- `pnpm test:unit` for the goal-set suite confirming habit-linked metrics still round-trip as `manual` / `0`.

## Context

Code Source: `src/state/types.ts` (L330–337)
Code Description: The metric contract being widened. `current` stays a required number on every metric so existing rows and the goal-set format keep working; for habit metrics it is not the display value.

```ts
export interface GoalMetric {
    label: string;
    target: number;
    current: number;
    unit: string;
    source: "manual" | "liftingtracker";
    overridePinned: boolean;
}
```

Code Source: `src/lib/goals/factories.ts` (L16–19, L44–49)
Code Description: The single validator and factory every stored goal passes through; `createGoal` clones the metric object, so nothing else may rewrite it.

```ts
export function isGoalMetric(v: unknown): v is GoalMetric {
    return object(v) && nonempty(v.label) && finite(v.target) && finite(v.current) && text(v.unit) &&
        (v.source === "manual" || v.source === "liftingtracker") && typeof v.overridePinned === "boolean";
}
```

Code Source: `supabase/migrations/20261030000000_goals.sql` (L23–43)
Code Description: The `public.goals` table. The metric check is a table-level, unnamed `check` expression, which is why its generated constraint name must be verified before the drop.

```sql
    metric jsonb,
    ...
    check (metric is null or (jsonb_typeof(metric) = 'object' and coalesce(jsonb_typeof(metric->'label') = 'string' and jsonb_typeof(metric->'target') = 'number' and jsonb_typeof(metric->'current') = 'number' and jsonb_typeof(metric->'unit') = 'string' and metric->>'source' in ('manual','liftingtracker') and jsonb_typeof(metric->'overridePinned') = 'boolean',false)))
```

Code Source: `supabase/migrations/20261031000000_goal_staged_sync_rpc.sql` (L71–74)
Code Description: The full-set upsert. `metric` is passed through as jsonb, which is why no RPC change is needed once the table constraint accepts `habit`.

```sql
        insert into public.goals(owner_id,id,tracker_id,title,notes,project_id,metric,lifecycle,...)
        values(...,nullif(v_row->'metric','null'::jsonb),...)
```

Code Source: `src/lib/habits/calendar.ts` (L36–70), `src/lib/habits/windows.ts` (L151–178)
Code Description: Existing habit bucket primitives (day / Sunday-anchored week / month) and completion matching. These stay as they are; the new module reuses the bucket-start notion and must not duplicate the calendar math.

```ts
export function getBucketKey(date: Date, frequency: HabitFrequency): string { ... }
export function isHabitCompleted(completions, habitId, bucket): boolean { ... }
```

Code Source: `src/lib/goals/periods.ts` (L14–27, L100–117, L248–259)
Code Description: `PeriodBounds`/`GoalPeriod`, the weekly and monthly period constructors, and `listPeriods`, which is the existing way to walk the grid for the streak.

Code Source: `src/lib/goals/slips.ts` (L25–32, L211–215), `src/lib/goals/deck/types.ts` (L14–21)
Code Description: The two other copies of the metric source union, which must stay consistent with `GoalMetric`.

Code Source: `src/lib/goals/goalSetFile.ts` (L125–136, L286–288)
Code Description: The goal-set metric definition is deliberately label/target/unit only, and import materializes `manual` / `0`; unchanged by this issue.

Code Source: `docs/goals/contract.md` (L66–73, L104–105, L404–411, L601–608, L786, L834–841)
Code Description: The frozen `GoalMetric`, the "no persisted historical metric snapshot" statement, `GoalMetricSnapshot`, `DeckMetricView`, the "no metric history is invented" decision, and the chart decision. All must be reconciled by the new frozen section.

Code Source: `src/state/HabitContext.tsx` (L179, L301)
Code Description: The habits provider exposes a `hydrated` flag and a `deleteHabit` that removes the habit and its completion history — the reason a link can go missing and must degrade to unavailable.

## Notes

- Do not add a `goal_id` column to habits, a new table, or a new RPC argument. The existing `metric` jsonb already carries everything needed.
- The max-buckets helper exists so the goal editor (issue 146) can block impossible targets without walking a date range per period; keep it a pure function of cadence + frequency and out of the per-period hot path.
- Keep `src/lib/goals/habitMetric.ts` free of imports from `src/state/` providers; pass plain habit/completion data in.
