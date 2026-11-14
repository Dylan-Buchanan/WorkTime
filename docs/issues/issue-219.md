# Title: Make the goal row metric slot the connect affordance and strip the editor's metric enum

## Tags

Complexity Classification: T2
Classification Reason: Rewrites the largest interactive surface in `GoalsPage.tsx` — `GoalRow`'s metric line and the whole `GoalEditor` metric block — while preserving `goal-metric-hint`, `overridePinned` semantics, and test/e2e slots. It deletes an interlocking cluster of state (`sourceTouched`, `draft`, sentinel options, `habitSelectRef`, missing/unreachable escalation flags) and requires rewriting the habit block of `GoalsPage.test.tsx` (~lines 520–1080) plus `CreateHabitModal.test.tsx` against new surfaces.

Severity: Medium
Severity Reason: User-visible behavioural change on the main goals surface. The risk is regression in metric editing: `overridePinned` preservation, the stale-target hint, and disconnect behaviour all live in the code being replaced. No schema or data migration is involved.

Needs research before implementation: Yes

### Research Needed

The file and line surface is verified; what remains is a consumer sweep before deleting the editor's controls.

- Find every consumer of the surfaces being removed: the `Track one metric`, `Source`, and `Habit` accessible names and `goal-metric-hint` in `src/components/GoalsPage.test.tsx` (habit block, ~lines 520–1080), `src/components/goals/CreateHabitModal.test.tsx`, and `e2e/`.
- Confirm `HabitMetricStrip`'s "Insert into Current" path is used by `CheckInWizard` and is unaffected by sharing its reading copy with the editor summary.
- Decide where the wizard's open state lives (page-level next to `editingGoal`, or per row) and how the row affordance reaches it.

## Summary

Once the connect wizard owns the habit link, the goal editor should stop offering an alternative route to it. Today `GoalEditor` (`src/components/GoalsPage.tsx:686-895`) exposes a `Track one metric` checkbox, a `Source` select with a disabled `Auto` option, a second habit `<select>`, a nested `CreateHabitModal`, and the sentinel/draft machinery that makes those two selects behave (`DRAFT_HABIT`, `CREATE_HABIT`, `habitSelectRef`, `replacingHabit`, `missingHabit`, `attemptedMissingHabit`, `attemptedUnreachable`, `unreachable`).

This issue replaces that enum with state-named buttons and makes the goal row's metric slot the discoverable doorway into the wizard.

## Steps to Reproduce Context

1. Open the Goals page with an active goal that has no metric.
2. Observe the row: nothing indicates a metric can be connected, and the only route is **Edit goal**.
3. Open **Edit goal** and observe the `Track one metric` checkbox, the `Source` select, and — only after selecting `Habit` — a habit picker and a `+ Create new habit…` option inside a second select.
4. Connect a habit, save, then reopen the editor: the habit link is now reachable both from the editor's selects and from the check-in strip.

## Requirements for completed issue

1. The goal row's metric slot renders `No metric · Connect a habit` for an active goal with no metric, and that affordance opens the wizard.
2. A habit-linked goal's row shows the live reading as today, now clickable, and opens the wizard. This applies to achieved and dropped goals whenever they already hold a link (the only road to disconnect) but they never start a new link.
3. Manual and `liftingtracker` metrics keep their current reading unchanged and are not wizard entry points.
4. The row's stale-target hint (`data-goals-slot="goal-metric-hint"`, `GoalsPage.tsx:626-628`) is preserved, because a tracker cadence edit still invalidates an existing target independently of the wizard.
5. `GoalEditor` no longer contains the checkbox, the `Source` select, the habit picker, the sentinel/draft state, or the nested `CreateHabitModal`; instead it renders buttons that follow the current metric state:
   - no metric: *Track manually* / *Connect a habit*
   - manual: existing label/current/target/unit fields plus *Stop tracking*
   - habit: `Tracked by habit: Read · 4 of 4 days` (the `HabitMetricStrip` reading copy, without its Insert button) plus *Change habit* / *Stop tracking*
   - `liftingtracker`: read-only reading plus *Stop tracking* only
6. Disconnect for a habit link goes through `downgradeHabitMetric` and is offered only from the wizard's step 1, so the editor's habit summary has *Change habit* but no second disconnect path.
7. Clearing a metric is no longer a checkbox: habit metrics downgrade via the wizard, and a manual metric is never silently cleared — the user makes an explicit choice.
8. `overridePinned` handling survives: a manual metric that was never retargeted keeps its override, matching today's `sourceTouched` guard (`GoalsPage.tsx:817`). A metric whose target is edited still drops it.
9. `data-goals-slot="goal-metric"` is retained and the new affordance gets its own slot so agent and e2e surfaces stay stable.
10. Large derived targets still render plainly, and habit metrics with an unavailable link still read "Linked habit is missing".
11. The habit block of `src/components/GoalsPage.test.tsx` and `src/components/goals/CreateHabitModal.test.tsx` are rewritten against the new surfaces and pass.

## Expected Behavior

- A goal with no metric shows one obvious affordance: *Connect a habit*.
- The editor names the two tracking modes the product actually offers and shows the current state as a read-only summary, with no `Source`/`Habit` selects and no *Track one metric* checkbox.

## Actual Behavior

- The row gives no indication that a habit can be connected, and the editor offers the connection through a checkbox plus two chained selects, one of which hides the habit list behind a source enum.
- The editor can create and link a habit outside the guided path, which is how the two surfaces drift.

### Testing

1. `src/components/GoalsPage.test.tsx` — rewrite the habit-metric block for: no-metric affordance and its slot, clickable habit reading opening the wizard, manual and `liftingtracker` readings untouched, `Track manually`/`Stop tracking` flows, `overridePinned` preservation on an unrelated edit, the stale-target hint still rendering after a cadence change, and absence of the `Track one metric` / `Source` / `Habit` controls.
2. `src/components/goals/CreateHabitModal.test.tsx` — update for the inline-hosted create body if its public surface moved; behaviour (focus trap, Escape, Enter, colour/frequency) must stay green.
3. Manual smoke: active, achieved, and dropped goals with each metric source; confirm achieved/dropped goals with a link can still reach disconnect and cannot start a new link.
4. `pnpm test:unit` and `pnpm run build` pass.

## Issue Context

### Change Files

#### Row metric slot

Code Source: `src/components/GoalsPage.tsx` (`GoalMetricLine` ~line 604, `HabitMetricLine` ~line 614, `GoalRow` ~line 650)
Code Description: `GoalMetricLine` returns a plain `<p data-goals-slot="goal-metric">` for non-habit metrics and delegates to `HabitMetricLine` for habits, which renders the derived reading, a `MetricBadge`, and the `goal-metric-hint` warning computed from `maxHabitMetricBuckets(cadence, habit.frequency)`.
Code Change Description: Add the no-metric affordance and make the habit reading the wizard trigger. Keep the existing hint and slot; add a dedicated slot (for example `goal-metric-connect`) for the affordance so selectors remain stable. `GoalRow` must be able to open the wizard, so it needs an `onConnectHabit` prop alongside the existing `onEdit`/`onLifecycle`.
Files Using: `src/components/GoalsPage.tsx` (row render at ~line 461), `e2e/` selectors

#### Editor metric block

Code Source: `src/components/GoalsPage.tsx` (`GoalEditor` ~lines 686-895)
Code Description: Metric state is `metric`, `label`, `current`, `target`, `unit`, `source`, `sourceTouched`, `habitId`, `draft`, `createHabitOpen`, `habitSelectRef`, `replacingHabit`, `missingHabit`, `attemptedMissingHabit`, `attemptedUnreachable`, `unreachable`. `onSubmit` validates, checks `Number(target) > maxHabitMetricBuckets(...)`, creates a draft habit before writing, and builds:

```ts
nextMetric = { label: label.trim(), current: 0, target: Number(target), unit, source: "habit", habitId: habit.id, overridePinned: false };
// manual branch keeps overridePinned only when untouched:
nextMetric = { label, current: Number(current), target: Number(target), unit, source, overridePinned: !sourceTouched && source === goal.metric?.source ? goal.metric.overridePinned : false };
```

Code Change Description: Delete the checkbox, `Source` select, habit select, sentinel constants (`CREATE_HABIT`, `DRAFT_HABIT`), the draft/replacing/missing/unreachable state, and the nested `CreateHabitModal`. Replace with state-named buttons plus a read-only habit summary that reuses `HabitMetricStrip`'s `readingCopy` output without its Insert button. Keep the manual-metric fieldset and its `overridePinned` rule. Keep the title/notes/project-link fields untouched.
Files Using: `src/lib/goals/metrics.ts` (`downgradeHabitMetric`), `src/components/goals/HabitMetricStrip.tsx`, new `HabitConnectWizard`

#### Constants that become dead

Code Source: `src/components/GoalsPage.tsx` lines 46-62
Code Description: `missingHabitMessage`, `habitUnitWord`, `habitUnitSuggestion`, `cadenceHoldMessage`, `orderedHabits`, `CREATE_HABIT`, `DRAFT_HABIT`.
Code Change Description: `missingHabitMessage` and the sentinel constants become unused; `cadenceHoldMessage` and `habitUnitWord` are still needed by the row hint. Move/keep only what the new surfaces use, and remove the rest so the editor cannot re-grow the enum.

## Notes

- Related: the wizard and the minimum-target derivation are a prerequisite issue; the broken-link repair on-ramps are a follow-up issue.
- `HabitMetricStrip`'s `readingCopy` is module-private today; reuse means exporting it or lifting it into a shared helper — either is acceptable as long as the strip's own output is unchanged.
