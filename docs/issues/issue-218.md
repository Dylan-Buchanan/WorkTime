# Title: Add HabitConnectWizard with a derived, always-achievable target

## Tags

Complexity Classification: T2
Classification Reason: New `HabitConnectWizard` owning a three-step state machine and a create-then-update write with a compensating delete, a new `minHabitMetricBuckets` beside `maxHabitMetricBuckets` (with tests), reuse of `CreateHabitModal`'s name/color/frequency body, and reuse of `HabitMetricStrip`'s reading copy (currently module-private). Roughly six files in one module, the spec is unusually precise, and the write/rollback contract is load-bearing even though nothing is mounted yet.

Severity: Low
Severity Reason: No user-visible behaviour changes in this issue — the component ships dark and is mounted nowhere. The risk is contained to new code plus an additive pure function.

Needs research before implementation: No

## Summary

Connecting a habit to a goal is currently only possible through the goal editor: tick *Track one metric*, type a label/target/unit, find `Habit` in a `Source` select, then pick from a second select and Save (`src/components/GoalsPage.tsx:855-884`). That flow requires the user to invent the metric target themselves, and the number they invent is validated against `maxHabitMetricBuckets` — a maximum over *all* periods, not the count this period actually holds.

This issue builds the guided replacement in isolation: a `HabitConnectWizard` that asks which habit, then how often (only frequencies the tracker cadence can hold), then confirms a derived target in one sentence. The stored `target` is seeded from a new guaranteed **minimum**, and the stepper range is `1..maxHabitMetricBuckets`, so no typed or stepped value can be unreachable. The wizard owns the whole write and rolls back a freshly created habit if the goal write fails.

It ships mounted nowhere and is exercised entirely by its own tests. The visible surface change is a follow-up.

## Steps to Reproduce Context

1. Open the Goals page and click **Edit goal** on an active goal.
2. Tick **Track one metric**.
3. Type a label, target, and unit, then change **Source** to `Habit` and choose a habit from the second select.
4. Save. Observe that the target the user typed is what gets stored, and that an over-max target is rejected with `This cadence can hold at most N <unit>` (`GoalsPage.tsx:826`).
5. Change the tracker cadence in an existing tracker so fewer buckets fit, then reopen the goal: the stored target is now stale and the row shows the `goal-metric-hint` warning.

## Requirements for completed issue

1. `minHabitMetricBuckets(cadence, frequency)` exists beside `maxHabitMetricBuckets` and returns the guaranteed-minimum bucket count for every cadence/frequency pair, with unit tests proving the minimum is actually attainable and never exceeds the maximum.
2. A `HabitConnectWizard` component exists that performs the whole habit-to-goal connection: choose habit (or create one), choose frequency, confirm the derived target, Save.
3. Step 1 lists only active habits (plus the currently linked habit when it is archived), annotated with how many goals each habit tracks, offers a "Create a new habit" tile, shows a loading state while habits are not hydrated, and is skipped entirely when the user has no habits.
4. The inline create form behaves exactly like `CreateHabitModal` (name, color, frequency, focus trap, Escape, Enter handling) but offers only frequencies the tracker cadence can hold — `monthly` only when the cadence is `monthly-weekday`.
5. The seeded target is the minimum, the step-3 stepper range is `1..maxHabitMetricBuckets`, and the confirmation is one sentence naming the habit and the derived count.
6. Save writes `habits.createHabit` first when minting a habit, then `goals.updateGoal` with `{ label: habit name, current: 0, target, unit: <frequency plural>, source: "habit", habitId, overridePinned: false }`, then closes.
7. If the goal write fails after a habit was created, the handler deletes that habit; if the delete also fails, the habit stays selected and the existing "link it from /habits" message is shown.
8. Escape and backdrop clicks cancel without writing anything, and Enter inside the create form never submits past it.
9. Relinking an existing habit always recomputes label, unit, and target (`current` stays `0`); replacing a manual metric or a different link shows an inline note in step 1 with Save still enabled.
10. A dangling `habitId` never renders as an empty picker: step 1 names the broken link and shows the repair note.
11. The component is not mounted anywhere in the app.

## Expected Behavior

- The user picks a habit and a frequency, sees one sentence such as "Track **Read 20 minutes** against 4 days per period", adjusts with a stepper, and saves — with a target that is always reachable in every period of that cadence.
- Creating a habit inline commits the habit only when the goal write succeeds.

## Actual Behavior

- The only path is the enum-heavy editor flow, and the stored target is whatever the user typed, validated against a maximum that is not this period's count.
- A habit can be created and then left orphaned if the goal write fails (the message points at `/habits`).

### Testing

1. `src/lib/goals/habitMetric.test.ts` — assert `minHabitMetricBuckets` for `every-n-weeks` (equal to `maxHabitMetricBuckets`) and for `monthly-weekday` (4 weeks / 28 days / 1 month), and assert over a generated period list that the minimum count actually occurs and never exceeds the max.
2. New `src/components/goals/HabitConnectWizard.test.tsx` — cover: no-habits skip, hydration loading state with Save disabled, archived-but-linked habit preselected, dangling link repair note, frequency filtering by cadence, stepper bounds, cancel paths (Escape, backdrop), Enter inside the create form, habit creation on Save, goal-write failure deleting the created habit, and the delete-failure fallback message.
3. `pnpm test:unit` passes; `pnpm run build` passes.

## Issue Context

### New Files

`src/components/goals/HabitConnectWizard.tsx`

The three-step wizard. Proposed public surface (final naming is up to the implementer, but the shape must hold):

```tsx
export interface HabitConnectWizardProps {
    goal: Goal;
    cadence: GoalCadence;
    /** Habit promoted to the top of step 1 and preselected; may be archived or dangling. */
    linkedHabitId: string | null;
    onClose: () => void;
}

export const HabitConnectWizard: React.FC<HabitConnectWizardProps>;
```

It reads `useHabits()` (`hydrated`, `state.habits`, `state.completions`, `createHabit`, `deleteHabit`) and `useGoals()` (`updateGoal`). Step 1 needs the per-habit goal count, which comes from `Object.values(goals.state.goals).filter(goal => goal.metric?.source === "habit" && goal.metric.habitId === habit.id).length`.

The commit handler must reuse today's ordering — guard, then create, then goal write — from `GoalsPage.tsx:788-834`:

```ts
// habit metric commit (today's editor, for reference)
nextMetric = {
    label: label.trim(), current: 0, target: Number(target), unit,
    source: "habit", habitId: habit.id, overridePinned: false,
};
onSave({ title, notes, projectLink, metric: nextMetric });
```

`src/components/goals/HabitConnectWizard.test.tsx` — mirrors the conventions already used by `src/components/goals/CreateHabitModal.test.tsx` and the goals provider harness in `src/components/GoalsPage.test.tsx`.

### Change Files

#### New derivation in the pure habit-metric layer

Code Source: `src/lib/goals/habitMetric.ts`
Code Description: Pure bucket math. `maxHabitMetricBuckets(cadence, frequency)` returns the exact attainable maximum across periods of a cadence (`monthly-weekday` yields 5–6 weeks / 35–42 days / 2 months depending on weekday).
Code Change Description: Add a sibling minimum. For `every-n-weeks` the minimum equals the maximum (`intervalWeeks * 7`, `intervalWeeks`, `maxMonthStarts(...)`); for `monthly-weekday` it is the worst case over weekday-snapped windows: `4` weeks, `28` days, `1` month.
Files Using: `src/components/GoalsPage.tsx`, new `HabitConnectWizard`, `src/lib/goals/habitMetric.test.ts`

```ts
/** Guaranteed-minimum bucket count for this cadence and frequency. */
export function minHabitMetricBuckets(cadence: GoalCadence, frequency: HabitFrequency): number;
```

#### Inline create body

Code Source: `src/components/goals/CreateHabitModal.tsx`
Code Description: `role="dialog" aria-label="Create habit"` with name input, `HABIT_COLORS` swatches, frequency select built from the module-private `FREQUENCIES` list, a focus trap, and Escape handling.
Code Change Description: Expose the name/color/frequency body (and `NewHabitDraft`) for inline hosting inside wizard step 2b so behaviour and focus trap are shared rather than copied. Only the option set differs: `monthly` is omitted unless the cadence is `monthly-weekday`, otherwise `daily`/`weekly`. No other behaviour change — the modal's existing tests must keep passing.
Files Using: `src/components/GoalsPage.tsx`, new `HabitConnectWizard`

#### Related types and providers (read-only for this issue)

Code Source: `src/state/types.ts`
Code Description: `GoalMetric` is `{ label; target; current; unit; source: "manual" | "liftingtracker" | "habit"; habitId?; overridePinned }`; `Habit` carries `id, name, color, frequency, position, isArchived, createdAt`; `HabitFrequency` is `"daily" | "weekly" | "monthly"`.
Files Using: `src/state/HabitContext.tsx` (`createHabit(input: NewHabitInput): Habit`, `deleteHabit(id)`), `src/state/GoalContext.tsx` (`updateGoal(id, patch)`)

## Notes

- Unit words for a frequency already exist privately in `GoalsPage.tsx` (`HABIT_UNIT_WORDS`, `habitUnitSuggestion`); the wizard needs the same plural mapping.
- `readHabitMetric.totalBuckets === 0` is the strip's "No buckets in this period." state — a `monthly` habit under an `every-n-weeks` cadence must be unselectable to avoid it.
- Out of scope anywhere in this split: migrations, sync changes, new localStorage keys, `liftingtracker` conversion, and changes to `isGoalMetric` invariants.
