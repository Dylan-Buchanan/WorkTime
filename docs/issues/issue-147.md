# Title: Report habit progress during check-in

## Tags

Complexity Classification: T2
Classification Reason: Contained to the check-in wizard's per-goal card (`src/components/goals/CheckInWizard.tsx` L233–291), one new presentational component, a small insert helper, and their tests. The deliberate constraint is that `GoalEvidencePanel` (`src/components/goals/GoalEvidencePanel.tsx` L41–91) and the wizard's save payload are untouched, so the risky part is state interaction (a derived readout plus an opt-in write into the free-text `current` field that also feeds slip detection via `src/lib/goals/slips.ts` L42–58), not spread.

Severity: Medium
Severity Reason: The strip is read-only and insertion is opt-in, and the stored `GoalCheckIn` shape does not change, so the worst case is duplicated prose in `current` or a planned-item line being read as complete. It does not corrupt metric data or block saving.

Needs research before implementation: No

## Summary

The check-in wizard is where a user writes "I was short by 5", but it shows nothing derived — the goal's habit metric (if any) is invisible in the room, so the number gets estimated or skipped. Add a read-only derived reading strip next to the existing evidence panel showing the period's bucket count against the target, with a hit indicator, a partial/in-progress reading for the period containing today, and an explicit unavailable state for a broken link. Offer an opt-in "Insert into Current" action that appends the reading as prose.

### Shared constraints (decided — do not re-litigate)

- The metric is the count of completed habit buckets whose **start date** falls in `[periodStart, periodEnd)`. The same rule defines both the numerator and the "out of N" denominator.
- The number is derived live from habit completions. `GoalCheckIn` gains no field and there is no new staging entity.
- One habit per goal metric: `source: "habit"` plus `habitId`. Additive and backwards-compatible with existing rows.
- `overridePinned` stays required-but-false for habit metrics and is not exposed in the UI.
- The goal-set format is unchanged: a habit-linked metric exports as label/target/unit and imports as `manual` / `0`.
- Sequencing: issue 145 provides `src/lib/goals/habitMetric.ts`; this issue only renders its output.

## Steps to Reproduce Context

1. Open `/goals`, start a check-in for a tracker, and look at a goal card in the wizard (`src/components/goals/CheckInWizard.tsx` L233–291).
2. Note the card sections: status/focus, `Did`, optional `GoalEvidencePanel` (only when `goal.projectId !== null`, L250–256), "Did not do", `Currently working on`, and `Planned next`.
3. Record a habit completion on `/habits` for a bucket inside the current goal period, then return to the wizard — nothing on the card changes; the only numbers shown are the slip badge and, for project goals, the evidence summary.
4. Type into `Currently working on` — nothing derived is available to insert, so any metric sentence must be typed from memory.

## Expected Behavior

- A habit-linked goal's card shows a derived reading strip: "4 of 5 sessions · short by 1" for a completed period, "3 so far · 5 days left" for the period containing today, and a clear hit indicator when the target is met.
- A period with zero buckets of that frequency says "no buckets in this period" rather than "0 of 0", and never renders a rate from a zero denominator.
- A broken habit link shows an explicit unavailable state, consistent with how `GoalEvidencePanel` handles a missing project.
- An opt-in "Insert into Current" action appends prose such as "4 of 5 (short by 1)" to the free-text `current` field; repeated presses do not stack duplicates.
- The strip never auto-prefills and never overwrites authored prose, so the evidence panel's first-open prefill and freeze-after-edit behaviour is unchanged, and the strip behaves identically when editing a past period.
- Goals with no metric, or with a manual/liftingtracker metric, show no strip.
- The wizard's save payload shape is unchanged.

## Actual Behavior

- Nothing in `CheckInWizard` reads `goal.metric`, the habits provider, or habit completions; the card cannot show a derived number.
- The `Current` textarea (`src/components/goals/CheckInWizard.tsx` L275–277) is hand-typed only; the single automated write path in the wizard is `GoalEvidencePanel`'s prefill (L82–91).
- There is no unavailable state for a habit link, because no habit link is rendered at all.

## Requirements for completed issue

1. A derived reading strip renders on the check-in card for habit-linked goals, sourced from `src/lib/goals/habitMetric.ts` (issue 145) and the habits provider — not from any new stored field.
2. The strip distinguishes a completed period from the period containing today, showing count/target/unit plus days remaining for the in-progress case, and only counts buckets that are not in the future.
3. A met target shows a hit indicator; a zero-bucket period shows the explicit "no buckets in this period" message; a broken link shows the unavailable state.
4. "Insert into Current" appends the reading as prose to `current` without duplicating an identical insertion, and does not insert for the unavailable state.
5. The strip writes nothing on its own — no prefill, no overwrite — and the existing evidence prefill/freeze behaviour and the save payload shape are unchanged.
6. Days remaining is `0` (never negative) on the last day, the partial flag never applies to a past period, and an in-progress reading updates as completions change elsewhere and resolves to a final reading once the period closes.
7. Inserting must not alter what the slip logic considers a completed planned line (`src/lib/goals/slips.ts` `completedLines`) — a repeated press may not silently mark a planned item done.

### Testing

- `CheckInWizard.test.tsx`: strip renders for a habit-linked goal and not for a manual metric or no metric; completed-period copy and in-progress copy; hit state; zero-bucket message; broken-link unavailable with no insert affordance; days-remaining clamps at 0 on the final day; past periods never render the partial reading.
- A test that the strip performs no write on mount or on habit-completion changes (authored `current` prose is byte-identical), and that the evidence panel's prefill still fires only on first open of the current period.
- Insert behaviour: press once appends the expected sentence; press twice does not duplicate; the resulting `did`/`planned` slip comparison is unchanged for an unrelated planned item.
- A test that a completion added for a bucket inside the current period changes the displayed reading on re-render, and that the same goal edited for a past period shows that period's final count.
- `pnpm test:unit` and `pnpm run build`.

## Context

Code Source: `src/components/goals/CheckInWizard.tsx` (L226–291)
Code Description: The per-goal card loop. The strip belongs beside the existing evidence panel render, and the goal's history for the slip comparison is already available as `storedHistory` / `slips`.

```tsx
{goal.projectId !== null && <GoalEvidencePanel
    key={`${goal.id}:${activePeriod.periodStart}`}
    goal={goal}
    checkIn={draft}
    period={activePeriod}
    onChange={patch => patchDraft(goal.id, patch)}
/>}
```

Code Source: `src/components/goals/CheckInWizard.tsx` (L275–277, L186)
Code Description: The `current` textarea the insert action writes into, and `saveCheckIns` — the payload must stay the merged draft set with no extra fields.

```tsx
<textarea className={control} aria-label={`Current for ${goal.title}`} value={draft.current} onChange={event => patchDraft(goal.id, { current: event.target.value })} />
```

Code Source: `src/components/goals/GoalEvidencePanel.tsx` (L41–91)
Code Description: The freeze/prefill contract that must not be disturbed — `frozenRef`, `prefilledRef`, and the "first open of the current period only" prefill effect.

```tsx
const frozenRef = useRef(goal.projectId === null || checkIn.current !== "");
const prefilledRef = useRef<string | null>(null);
...
if (frozenRef.current || prefilledRef.current !== null) return;
if (checkIn.current !== "" || goal.projectId === null) return;
if (!isCurrentPeriod(period, todayLocalDateKey())) return;
```

Code Source: `src/lib/goals/slips.ts` (L34–58)
Code Description: How `did` lines become completed planned items. Any inserted prose lands in `current`, not `did`, and the strip must never write `did` for this reason.

Code Source: `src/lib/goals/habitMetric.ts` (added by issue 145)
Code Description: Supplies the per-period reading (completed, total, partial, days remaining, met, delta) and the unavailable state. The component must not count buckets itself.

Code Source: `src/state/HabitContext.tsx` (L20–34, L179)
Code Description: The habits provider (`habits`, `completions`, `hydrated`) the strip reads. Gate the reading on `hydrated` so an in-flight hydrate does not present a false count.

Code Source: `src/lib/goals/periods.ts` (L14–17)
Code Description: `PeriodBounds` is the window every reading is expressed against, and the wizard's `activePeriod` is the one to pass.

## Notes

- Give the strip a distinct accessible label per goal (for example `aria-label={`Habit metric for ${goal.title}`}`) and expose the hit state as text, not colour alone.
- The strip must work identically for the past-period editor, so do not gate it on `isCurrentPeriod`; only the partial/days-remaining mode depends on the period containing today.
- Keep the wording derived from numbers rather than stored prose so the deck (issue 148) and the check-in agree.
