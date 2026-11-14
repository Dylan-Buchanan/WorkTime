# Title: Create a habit from the goal editor's habit picker

## Tags

Complexity Classification: T2
Classification Reason: A self-contained feature inside the goal editor plus a small modal, but with intricate component state orchestration across the habits and goals contexts: a sentinel select value, a draft stand-in that feeds the existing derived reads, and a two-context commit order with a rollback message. Affects `src/components/GoalsPage.tsx`, a new goals-scoped modal, `HABIT_COLORS` (currently module-local to `src/components/HabitsPage.tsx`), and `src/components/GoalsPage.test.tsx`. No schema, RPC, auth, or `NewHabitInput` change; `HabitContext.createHabit`'s signature is untouched.

Severity: Medium
Severity Reason: Worst failure modes are a habit created invisibly without a goal link, or a goal metric silently unlinked, both user-visible but confined to the user's own tracker. The buffered draft removes the common orphan case (cancel), and the residual orphan case gets an explicit recovery hint pointing at `/habits`.

Needs research before implementation: No

## Summary

WorkTime already models "a goal is measured by exactly one habit" end to end: the `GoalMetric.habitId` slot, the `goals_metric_check` DB constraint, `isGoalMetric`, `HabitMetricLine` on the goal card, the check-in strip, the deck series, the `maxHabitMetricBuckets` cadence cap, and the habit-deletion warning. The only missing piece is a **creator** at that slot.

Add a final `+ Create new habit…` entry to `GoalEditor`'s existing Habit `<select>`. Choosing it opens a modal that collects only **name** (prefilled from the goal title), **color** (existing swatches, defaulted), and **frequency** (defaulted), because the metric fieldset above already supplies label, target, and unit. If the goal currently counts from a habit, the modal states which link will be replaced at the moment of decision.

On confirm the habit becomes a **buffered draft** held in `GoalEditor` state, and the select shows it as a clearly non-persisted entry (e.g. `New habit: Read 20 min (not saved yet)`). Nothing is written until **Save goal**, at which point the habit is created and the metric is written with its returned id in the same commit. `Cancel` therefore cannot orphan a habit.

This inverts an existing picker rather than adding a new section, model, or link path. It inherits RLS, sync validation, `validateHabit`, and `isGoalMetric` for free, and needs zero schema, RPC, or staging-store changes.

## Steps to Reproduce Context

1. Open `/goals`, pick a tracker, create or edit a goal, tick `Track one metric`.
2. Set `Source` to `Habit`. The Habit `<select>` lists existing habits plus a `Select a habit` placeholder; there is no way to create one.
3. Note the metric fieldset already captures label, target, and unit, and that the habit picker drives label/unit defaulting (`chooseHabit`) and the cadence cap (`maxHabitMetricBuckets`).
4. Habit creation exists only on `/habits` (`HabitsPage`), after which the user must come back and re-open the goal to link it.

## Requirements for completed issue

1. `GoalEditor`'s Habit `<select>` ends with a `+ Create new habit…` entry, backed by a sentinel value.
2. Choosing it opens a modal collecting name (prefilled from the goal title), color (existing swatches, defaulted), and frequency (defaulted). No label/target/unit/description fields.
3. When the goal currently counts from a habit, the modal states which habit link will be replaced, shown at the moment of decision.
4. Confirming the modal stores a draft in `GoalEditor` state only; the select shows a clearly non-persisted entry such as `New habit: Read 20 min (not saved yet)`. No habit row is written at this point.
5. The draft feeds the existing derived reads so that label/unit defaulting and the cadence cap behave exactly as they do for a picked habit, without fabricating ids, positions, or timestamps.
6. `Save goal` runs the existing unreachable-target guard first; only if it passes does it call `habits.createHabit(...)` and then save the metric as `{ label, current: 0, target, unit, source: "habit", habitId: habit.id, overridePinned: false }`.
7. If the goal write fails after the habit was created, a message names the unlinked habit and points at `/habits`.
8. Cancelling the goal editor after drafting writes nothing: no habit exists and nothing is orphaned.
9. `HabitContext.createHabit`'s signature and `NewHabitInput` are unchanged; `createHabit` still returns the created `Habit`.

## Expected Behavior

- Creating a habit from the goal editor is one flow: draft in place, persist once, on `Save goal`.
- Label, unit, and cadence-cap behavior for a drafted habit is indistinguishable from picking an existing habit.
- Dismissing the modal without a draft restores the prior habit selection.
- Re-opening the modal after drafting prefills from the draft rather than the goal title.
- Picking a real habit after drafting discards the draft and uses the picker's normal replacement semantics.
- For achieved/dropped goals the create entry is hidden; the picker still works for existing links.
- An empty name shows `"Give this habit a name first."`, mirroring `HabitsPage`. Duplicate habit names remain permitted.
- A cadence-impractical target is rejected before any habit is created, and changing the draft frequency recomputes that guard live.

## Actual Behavior

- The Habit picker lists only existing habits; there is no create entry.
- Creating the habit on `/habits` and linking it back to the goal is the only path, and it leaves the habit's goal association to a separate step.

### Testing

- `src/components/GoalsPage.test.tsx`
  - Create a habit from the editor and assert one call to `saveHabits` (via the data access double) with a habit whose name/color/frequency match the modal input, and a goal whose `metric` is `{ source: "habit", habitId: <created id>, overridePinned: false, current: 0 }` with the metric's label/target/unit.
  - `Cancel` on the modal with no draft restores the prior habit selection.
  - `Cancel` on the goal editor after drafting writes no habit and no metric.
  - Re-opening the modal after drafting prefills from the draft.
  - Drafting then picking a real habit discards the draft.
  - Empty name rejects with `"Give this habit a name first."`.
  - Cadence-impractical target (e.g. monthly habit on a weekly cadence) blocks save with no habit written; changing the draft frequency clears the block.
  - Achieved/dropped goal hides the create entry.
  - Error path: when the goal write throws, the message names the unlinked habit and `/habits`.
- Existing goal-editor tests for habit-source selection, label defaulting, and the unreachable-target guard must still pass.

## Issue Context

### New Files

A goals-scoped modal component (suggested `src/components/goals/CreateHabitModal.tsx`) plus its test. It mirrors `TrackerDrawer`'s dialog/escape precedent in `src/components/GoalsPage.tsx` and `HabitsPage`'s swatch/frequency markup.

Suggested shape (illustrative):

```tsx
export type NewHabitDraft = { name: string; color: string; frequency: HabitFrequency };
export function CreateHabitModal({ initial, replacing, onConfirm, onCancel }: {
    initial: NewHabitDraft;
    /** Name of the habit link this will replace, or null when none. */
    replacing: string | null;
    onConfirm: (draft: NewHabitDraft) => void;
    onCancel: () => void;
}): JSX.Element;
```

`HABIT_COLORS` is currently module-local to `src/components/HabitsPage.tsx:20`; it must be exported or relocated so the modal can reuse the same swatches.

### Remove Files

None.

### Change Files

#### GoalEditor habit picker

Code Source: `src/components/GoalsPage.tsx` (lines 665-772)
Code Description: `habitId`, `habitOptions`, `selectedHabit`, `maxBuckets`, `unreachable`, `chooseHabit`, and the submit path.

```tsx
const [habitId, setHabitId] = useState(goal.metric?.source === "habit" ? goal.metric.habitId ?? "" : "");
const habitOptions = orderedHabits(habits.state.habits).filter(habit => !habit.isArchived || habit.id === habitId);
const selectedHabit = habitId ? habits.state.habits[habitId] : undefined;
const maxBuckets = selectedHabit ? maxHabitMetricBuckets(cadence, selectedHabit.frequency) : null;

function chooseHabit(nextId: string) {
    const next = habits.state.habits[nextId];
    setHabitId(nextId);
    setAttemptedUnreachable(false);
    if (!next) return;
    const previous = habits.state.habits[habitId];
    // Only default the label while it is empty or untouched from the prior habit.
    if (!label.trim() || (previous !== undefined && label === previous.name)) setLabel(next.name);
    setUnit(habitUnitSuggestion(next.frequency));
}
```

Code Change Description: add a `NEW_HABIT` sentinel option after the mapped options; a `draft: NewHabitDraft | null` state plus a modal-open flag; a local stand-in exposing `{ name, frequency }` for the draft so `selectedHabit`, `maxBuckets`, `unreachable`, and `chooseHabit`-style defaulting work unchanged. The submit handler creates the habit only after the unreachable guard passes, then saves the metric with the returned id, and surfaces a post-create goal-write failure naming the habit and `/habits`. Hide the create entry when `goal.lifecycle !== "active"`.

Reference — current submit build of the habit metric (line 727):

```tsx
nextMetric = { label: label.trim(), current: 0, target: Number(target), unit, source: "habit", habitId: habit.id, overridePinned: false };
```

Reference — parent wiring (lines 452-455):

```tsx
onSave={patch => {
    goals.updateGoal(edit.id, patch);
    setEditingGoal(null);
}}
```

#### Habit creation API (reference only)

Code Source: `src/state/HabitContext.tsx` (lines 288-293)
Code Description: `createHabit(input: NewHabitInput): Habit` assigns the next `position`, builds the habit with a generated id, persists it, and returns the created habit synchronously.
Code Change Description: none. Use it as-is.

#### Input type (reference only)

Code Source: `src/lib/habits/types.ts` (lines 22-28)
Code Description: `NewHabitInput { name: string; description?: string; color: string; frequency: HabitFrequency; position?: number }`.

#### Habits page form conventions (reference only)

Code Source: `src/components/HabitsPage.tsx` (lines 20, 35-40, 98-112, 273-283)
Code Description: `HABIT_COLORS`, the blank-draft defaults (`color: "#6366F1"`, `frequency: "daily"`), the `"Give this habit a name first."` validation, and the swatch radiogroup plus frequency select markup the modal should mirror.

#### Cadence guard (reference only)

Code Source: `src/lib/goals/habitMetric.ts` (lines 115-127)
Code Description: `maxHabitMetricBuckets(cadence, frequency)` is the exact attainable maximum; the editor uses it for both the option hints and the save guard.

#### Goal metric validation (reference only)

Code Source: `src/lib/goals/factories.ts` (lines 16-22)
Code Description: habit metrics require a non-empty `habitId` and `overridePinned === false`.

## Notes

- Deliberately out of scope, one line each: wiring this flow into `QuickAdd` goal creation or a new-goal-with-no-metric shortcut; any `Habit.goalId` field; goal-set export losing habit links.
- Habit and goal persist through separate contexts, so this is "committed together", not transactional. The create-then-save order is what makes the residual failure mode visible and recoverable.
- One habit per goal is structural, not enforced by new code: the metric slot is singular.
- The draft must respect `habitOptions`' archived-but-linked rule; a draft is neither archived nor in the store, so it is always selectable.
- This issue ships after "Deleting a habit downgrades dependent goal metrics to manual" (#168), so newly created habit links can always be repaired through the deletion path.
