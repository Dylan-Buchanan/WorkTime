# Title: Link a habit as a goal's metric in the goal editor

## Tags

Complexity Classification: T2
Classification Reason: Frontend-only, but spans several files in one feature area: `GoalEditor` (`src/components/GoalsPage.tsx` L393–437) including the metric fieldset and source select (L424–433), `GoalRow`'s metric line (L388) and `MetricBadge` (L360–362), the habits delete flow (`src/components/HabitsPage.tsx` `removeHabit` L120–123), a new habit picker, and the matching `GoalsPage.test.tsx` / `HabitsPage.test.tsx` suites. No schema, persistence, or engine change — it consumes issue 145's helpers.

Severity: High
Severity Reason: The editor is the only place a goal's metric is authored, so mistakes here persist malformed metrics (a stale `habitId`, a leftover stored `current`, `overridePinned: true`) straight into the full-set save. An unguarded habit delete also silently orphans a goal's metric while destroying the completion history it depended on. Recoverable by editing, so no data loss.

Needs research before implementation: No

## Summary

`GoalEditor` hard-codes the metric source to `manual` (with a permanently disabled `Auto` for legacy `liftingtracker` rows), so there is no way to attach a habit to a goal — which makes the derivations added in issue 145 unreachable from the UI. Add `Habit` as a source in the existing single-metric section, with a habit picker, an editable label defaulted to the habit name, target and unit fields, and a save-time guard against targets the tracker's cadence can never produce. Then show the live derived reading on the goal card instead of the stored `current`, and warn before a linked habit is deleted.

### Shared constraints (decided — do not re-litigate)

- The metric is the count of completed habit buckets whose **start date** falls in `[periodStart, periodEnd)`. The same rule defines both the numerator and the "out of N" denominator.
- The number is derived live from habit completions. `GoalCheckIn` gains no field and there is no new staging entity.
- One habit per goal metric: `source: "habit"` plus `habitId`. Additive and backwards-compatible with existing rows.
- `overridePinned` stays required-but-false for habit metrics and is not exposed in the UI.
- The goal-set format is unchanged: a habit-linked metric exports as label/target/unit and imports as `manual` / `0`.
- Sequencing: issue 145 (data model, constraint, `src/lib/goals/habitMetric.ts`) lands first; this issue consumes its exports.

## Steps to Reproduce Context

1. Open `/goals`, pick a tracker, and click "Edit goal" on any goal — the metric fieldset (`src/components/GoalsPage.tsx` L425–433) shows Label, Current, Target, Unit, and a Source select whose only enabled option is `Manual`.
2. Confirm `Auto` is unreachable: it renders only when `goal.metric?.source === "liftingtracker"` and is always `disabled` (L431).
3. Save the goal — `onSave` (L413) writes `{ label, current, target, unit, source, overridePinned }`, so a metric can only ever be a hand-typed number.
4. Read the goal card — `GoalRow` (L388) renders `goal.metric.current / goal.metric.target` from storage, so even a metric that were derived would display a stale number.
5. Open `/habits` and press Delete on a habit — `removeHabit` (`src/components/HabitsPage.tsx` L120–123) confirms only that the habit and its completion history will be deleted; it cannot mention a goal that depends on it.

## Expected Behavior

- The metric Source select offers `Habit` alongside `Manual`, and the legacy `Auto` option keeps its current disabled behaviour.
- Choosing `Habit` reveals a habit picker seeded from the user's active habits, plus target and unit inputs and a label that defaults to the habit name and stays editable.
- The unit is suggested from the habit's frequency (days / weeks / months) and is freely editable.
- Saving writes `source: "habit"`, `habitId`, label, target, and unit, with `overridePinned: false`.
- A target that the selected tracker's cadence can never satisfy is blocked at save time, with the specific reason surfaced (for example "a period this cadence can hold at most 14 days").
- If the cadence changes later so an already-saved target becomes unreachable, the same inline hint appears and the stored target is never rewritten.
- A habit-linked goal card shows the live current-period reading with days left instead of the stored `current`; a broken link shows "Linked habit is missing".
- Deleting a habit that is linked to a goal asks for confirmation that names the affected goal, and still allows deletion.

## Actual Behavior

- The Source select only allows `Manual`, with a disabled `Auto` for legacy rows.
- There is no habit picker, no default label from a habit, and no unit suggestion anywhere in the editor.
- Save validation only checks that label is non-blank and current/target are finite numbers (`src/components/GoalsPage.tsx` L412).
- The goal card renders the stored `current` and a `Manual` / `Auto` badge; there is no live reading and no broken-link state.
- The habits delete confirmation mentions only the habit name and its completion history.

## Requirements for completed issue

1. The goal editor's metric section exposes `Habit` as a source next to `Manual`, with `Auto`/`liftingtracker` keeping its existing disabled behaviour.
2. Selecting `Habit` shows a picker of the user's active habits; selecting a habit defaults the label to the habit name and suggests a unit from its frequency, both editable.
3. Saving a habit metric writes `source: "habit"`, `habitId`, `label`, `target`, `unit`, and `overridePinned: false`.
4. Save-time validation blocks a target above the cadence-aware maximum from issue 145 and surfaces the specific reason rather than a generic error.
5. A target that becomes unreachable after a cadence change shows the same inline hint on the goal without being rewritten.
6. Switching a metric between `manual` and `habit` never leaves a stale `habitId`, a stale stored `current`, or `overridePinned: true`; clearing the link returns a clean manual metric.
7. An already-linked habit that has since been archived still renders and counts, and appears as the selected value even though it is not offered among fresh picker options.
8. The goal card shows the live current-period reading (count, target, unit, days left) for habit-linked goals, gated on the habits provider being hydrated, and shows "Linked habit is missing" for a broken link.
9. The habits delete flow names the affected goal when the habit is linked, and still allows deletion.
10. Goals that are both project-linked and habit-linked render both states without implying they are the same link, and imported goal sets (manual, no link) render exactly as today.

### Testing

- `GoalsPage.test.tsx`: choosing Habit reveals the picker; selecting a habit defaults label and unit; saving produces the expected metric object; switching manual → habit → manual clears `habitId`, resets `overridePinned`, and does not carry the stored `current`; an impossible target blocks save with the cadence reason; an unreachable saved target shows the hint without changing stored data; a broken habit link shows "Linked habit is missing"; the card does not show `0 / 12` while habits are still hydrating.
- `HabitsPage.test.tsx`: deleting a linked habit shows a confirmation naming the goal, cancel aborts the delete, and confirming still deletes the habit and its completions.
- A card test for a goal with both a `projectId` and a habit metric.
- `pnpm test:unit` and `pnpm run build`.

## Context

Code Source: `src/components/GoalsPage.tsx` (L401–413)
Code Description: The metric editor state and the save validation/serialization that must learn the new source. Note `overridePinned` is carried over only when the source is unchanged — the habit path must force it false.

```tsx
const [source, setSource] = useState<GoalMetric["source"]>(goal.metric?.source ?? "manual");
...
if (metric && (!label.trim() || !current.trim() || !target.trim() || !Number.isFinite(Number(current)) || !Number.isFinite(Number(target)))) throw new RangeError("Metric needs a label and finite current and target values.");
onSave({ title, notes, projectId: projectId || null, metric: metric ? { label: label.trim(), current: Number(current), target: Number(target), unit, source, overridePinned: source === goal.metric?.source ? goal.metric.overridePinned : false } : null });
```

Code Source: `src/components/GoalsPage.tsx` (L424–433)
Code Description: The metric fieldset and source select — the insertion point for the habit option and picker.

```tsx
<label className="grid gap-1">Source<select className={control} value={source} onChange={event => setSource(event.target.value as typeof source)}>
    <option value="manual">Manual</option>{goal.metric?.source === "liftingtracker" && <option value="liftingtracker" disabled>Auto</option>}
</select></label>
```

Code Source: `src/components/GoalsPage.tsx` (L360–362, L364–370, L372–391)
Code Description: `MetricBadge`, the existing broken-link presentation pattern (`GoalProjectLink` renders "Linked project is missing"), and `GoalRow`'s metric line that must switch to the live reading.

```tsx
{goal.metric && <p className="mt-2">{goal.metric.label}: {goal.metric.current} / {goal.metric.target} {goal.metric.unit} <MetricBadge metric={goal.metric} /></p>}
```

Code Source: `src/components/HabitsPage.tsx` (L120–123)
Code Description: The existing delete confirmation, which must gain the goal name when the habit is linked.

```tsx
if (window.confirm(`Delete “${habit.name}”? This also deletes its completion history.`)) {
    deleteHabit(habit.id);
}
```

Code Source: `src/state/HabitContext.tsx` (L20–34, L179, L301)
Code Description: The habits provider surface (`state.habits`, `state.completions`, `hydrated`, `deleteHabit`) the editor and card read from. Archived habits remain in `state.habits` with `isArchived: true`.

Code Source: `src/lib/goals/habitMetric.ts` (added by issue 145)
Code Description: Supplies the per-period reading used by the card and the cadence-aware maximum buckets used by save-time validation. Do not re-derive either in the component.

Code Source: `src/lib/goals/periods.ts` (L86–98, L206–223)
Code Description: `resolveCadenceAnchorAt` and `periodAt` give the tracker's current period, which is the window the card's live reading covers.

## Notes

- Habit data is not part of `GoalContext`; the card and editor need the habits provider. Keep the reading gated on hydration rather than assuming an empty habit set means zero completions.
- Do not add a "current" input for habit metrics — the value is derived, so the field should not be presented as editable.
- The picker must explain why a habit is unavailable (impossible target for the selected cadence) rather than silently omitting it.
