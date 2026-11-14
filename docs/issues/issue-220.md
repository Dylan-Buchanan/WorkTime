# Title: Route known broken habit links through the connect wizard

## Tags

Complexity Classification: T3
Classification Reason: The change is small in line count but sits on three independent detection points — habit deletion, ledger rows the data layer permits, and cadence edits — each with different hydration and lifecycle ordering. It depends on the wizard's step-1 contract and the rewritten row/editor from the two prerequisite issues, and must not regress the `habit-link-missing` deck warning or the `goal-metric-hint` row hint.

Severity: High
Severity Reason: Today these states are visible but unrecoverable in the UI, and after the editor rewrite the "switch Source to Manual" escape only exists as a manual rebuild. A dangling link means the goal has no live reading at all, and a stale target silently misstates attainment for the rest of the period.

Needs research before implementation: Yes

### Research Needed

One premise in the request does not match the code and must be settled before implementation.

- **Goal-set import does not produce dangling habit links.** `materializeGoalSet` (`src/lib/goals/goalSetFile.ts:340-341`) always writes imported metrics as `source: "manual"` with `current: 0` and no `habitId`, and `serializeGoalSet` strips the link (`src/lib/goals/goalSetFile.test.ts:424-431`). Confirm the real dangling sources instead: the swallowed `RangeError` in `HabitsPage.removeHabit` (`src/components/HabitsPage.tsx:138-142`) and legacy/hand-edited rows the data layer permits (`integration/SupabaseDataAccess.integration.test.ts:697`).
- Define exactly how each state is classified pre- and post-`HabitContext.hydrated`, including how a linked-but-archived habit and a target above the current cadence maximum are distinguished from a legitimately large manual target.
- Confirm which entry points already exist after the prerequisite issues (row connect affordance, row hint, editor summary) and which need a new variant.

## Summary

The app already detects three broken habit-link states, in three separate places, and offers no way to act on any of them:

- A dangling `habitId` — produced when `HabitsPage.removeHabit` (`src/components/HabitsPage.tsx:138-142`) swallows a failed `downgradeHabitMetric` write before deleting the habit, and permitted by the data layer for any row whose habit no longer exists (`integration/SupabaseDataAccess.integration.test.ts:697` round-trips such a metric deliberately). Note: goal-set import is **not** a source — `materializeGoalSet` always imports metrics as `source: "manual"` with no `habitId` (`src/lib/goals/goalSetFile.ts:340-341`).
- A linked habit that has since been archived.
- A target that a tracker cadence edit made stale because `maxHabitMetricBuckets` shrank under it.

Each one currently surfaces only as prose: the deck emits a `habit-link-missing` warning with a `goalId` (`src/lib/goals/deck/plan.ts:587`), the row reads "Linked habit is missing", and the delete dialog is the only place the relationship is mentioned. This issue makes each state a normal on-ramp into the connect wizard, so there is one repair flow instead of three dead ends.

Out of scope: a deep link from `DeckPreview`'s warning (it needs a selection channel back into `GoalsPage`), and any habit-side entry point.

## Steps to Reproduce Context

1. Delete a habit while its dependent goal's downgrade write fails (the `RangeError` is swallowed, so the goal keeps a `habitId` that no longer resolves), or load a row whose habit no longer exists — the data layer permits and round-trips this state (`integration/SupabaseDataAccess.integration.test.ts:697`).
2. Open the Goals page and look at the goal row: it reads "Linked habit is missing".
3. Try to repair it: the editor's habit picker shows the state but the only escape is retyping a manual metric — after the editor rewrite there is no picker at all.
4. Separately: link a habit, then edit the tracker cadence so fewer buckets fit. The row shows the `goal-metric-hint` stale-target warning, with no action attached.
5. Archive a linked habit, then reopen the goal: the habit is excluded from fresh options but there is no explanation.

## Requirements for completed issue

1. Opening the wizard on a goal with a dangling `habitId` starts at step 1 with the broken link named and the habit picker ready to choose a replacement.
2. Opening the wizard on a goal whose linked habit is archived shows that habit preselected and labelled, keeps it connectable, and keeps other archived habits out of the list.
3. A target made stale by a cadence edit can be repaired through the wizard, with the target recomputed from the new cadence.
4. Repairing a stale target with the same habit recomputes label, unit, and target rather than no-op'ing.
5. Repair is non-destructive by accident: opening the wizard on a dangling link and cancelling leaves the metric exactly as it was.
6. The wizard never calls a link broken before habits are `hydrated`; during loading it shows the loading state instead of the "missing" note.
7. The existing detection surfaces keep working unchanged: the row's `data-goals-slot="goal-metric-hint"` hint and the deck's `habit-link-missing` warning both still fire.
8. Imported goal-set metrics with bespoke labels lose those labels to the recompute rule — this is accepted for this pass and needs no escape hatch.

## Expected Behavior

- Every broken-link state the app can detect has a visible, one-click path into the wizard, and the wizard opens pre-loaded with what it already knows about the broken link.
- Cancelling any repair leaves stored data untouched.

## Actual Behavior

- The states are shown as text warnings with no action; the only recovery is rebuilding the metric by hand through the editor.
- Archive/deleted-habit relationships are only explained inside the habit delete confirmation dialog.

### Testing

1. Wizard tests (extend the prerequisite issue's suite) — dangling link opens with a repair note, archived link is preselected and labelled while other archived habits are hidden, cancel leaves the metric unchanged, same-habit repair recomputes, and no "missing" note appears before `hydrated` is true.
2. `src/components/GoalsPage.test.tsx` — the row hint and the connect affordance both still render for a dangling and for a stale target.
3. `src/lib/goals/deck/plan.test.ts` — the `habit-link-missing` warning is unchanged.
4. `integration/SupabaseDataAccess.integration.test.ts` — the existing dangling-link round trip stays green with no schema change; `src/lib/goals/goalSetFile.test.ts` confirms import still yields manual metrics.
5. `pnpm test:unit` and `pnpm run build` pass.

## Issue Context

### Change Files

#### Dangling links from habit deletion

Code Source: `src/components/HabitsPage.tsx` (`removeHabit`, ~lines 125-150)
Code Description: On delete, every dependent goal is downgraded with `goals.updateGoal(goal.id, { metric: downgradeHabitMetric(goal.metric) })`; a `RangeError` is swallowed so the delete proceeds, which is exactly how a dangling `habitId` survives.

```ts
try {
    goals.updateGoal(goal.id, { metric: downgradeHabitMetric(goal.metric) });
} catch (error) {
    // A failed goal write degrades to today's missing-habit card.
    if (!(error instanceof RangeError)) throw error;
}
```

Code Change Description: No behaviour change required here — this issue only needs that resulting state to be repairable from the goals surface. Do not change the delete flow.

#### Dangling links permitted by the data layer

Code Source: `integration/SupabaseDataAccess.integration.test.ts:695-705`
Code Description: Round-trips a goal metric whose `habitId` is `missing-habit-is-allowed` and asserts the pairing rules for `source`/`habitId`, proving a link to a non-existent habit is a legal stored state.
Code Change Description: None. Use this as the fixture shape when testing the repair path. Goal-set import is not an origin for this state: `src/lib/goals/goalSetFile.ts:340-341` materializes imported metrics as `source: "manual"` with no `habitId`, and `src/lib/goals/goalSetFile.test.ts:424-431` asserts the link is stripped on export.

#### Existing detection surfaces

Code Source: `src/components/GoalsPage.tsx` (`HabitMetricLine` ~614-648, `goal-metric-hint` at ~626-646) and `src/lib/goals/deck/plan.ts` ~580-594
Code Description: The row shows "Linked habit is missing" when the id does not resolve (and guards on `habits.hydrated` before doing so); the deck emits `{ id: "thin:habit-link-missing:<goalId>", kind: "habit-link-missing", goalId, message }`.
Code Change Description: Both stay. The wizard's step 1 (from the prerequisite issue) needs the same hydration guard the row already uses, so a link is only named broken once habit state is loaded.
Files Using: new `HabitConnectWizard`, `src/components/goals/DeckPreview.tsx`

#### Wizard entry points

Code Source: `src/components/GoalsPage.tsx` (row slot and editor from the prerequisite issue)
Code Description: The wizard is opened by the row's connect affordance and by the habit summary's *Change habit* button.
Code Change Description: Add the same entry from the broken/stale states so there is one flow: the row's missing-link reading and the stale-target hint become actionable, and the wizard receives the goal plus its current `habitId` so step 1 can present the broken or archived link pre-selected.

## Notes

- Order matters: this issue lands after the wizard and the row/editor change, and before any deep-link work from the deck preview.
- Do not add a second disconnect path while repairing — disconnect stays in wizard step 1.
