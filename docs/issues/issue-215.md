# Title: Improve goal metric tracking UX: make connecting a habit to a goal clearer

## Tags

Complexity Classification: T3
Classification Reason: Parent tracking issue. The work is split into three sequential child issues spanning the pure goals layer, the goal wizard component, the goals page row/editor, and their test suites.

Severity: Medium
Severity Reason: The current connect flow is hard to discover and can mint targets that are unreachable in some periods of the cadence. No schema, sync, or data-model change is involved.

Needs research before implementation: No

## Summary

Connecting a habit to a goal for metric tracking is currently a confusing, multi-step process: tick *Track one metric* in the goal editor, invent a label/target/unit, find `Habit` inside a `Source` select, pick from a second select, and save (`src/components/GoalsPage.tsx:855-884`). The user also has to supply the target themselves, and it is validated against `maxHabitMetricBuckets` — a maximum over all periods, not this period's count.

This parent issue tracks the split. The risky part (deriving a target that cannot be wrong) is made provable in isolation before any surface changes; the visible change (entry point plus editor buttons) ships second; the broken-link states the app already detects are picked up last, once the flow to repair them exists.

## Child Issues

1. [#218 — Add HabitConnectWizard with a derived, always-achievable target](https://github.com/Dylan-Buchanan/WorkTime/issues/218) — three-step wizard with a minimum-derived target and stepper bounded by the maximum. Ships dark, mounted nowhere, tested in isolation.
2. [#219 — Make the goal row metric slot the connect affordance and strip the editor's metric enum](https://github.com/Dylan-Buchanan/WorkTime/issues/219) — row slot becomes the doorway; the editor drops the checkbox, `Source` select, habit picker, and draft/sentinel machinery in favour of state-following buttons and a read-only summary. Includes the test rewrites.
3. [#220 — Route known broken habit links through the connect wizard](https://github.com/Dylan-Buchanan/WorkTime/issues/220) — dangling links, linked-but-archived habits, and cadence-staled targets become normal on-ramps into the wizard.

## Requirements for completed issue

1. All three child issues are closed.
2. The only path to connecting a habit to a goal is the wizard; the goal editor no longer offers a source enum or habit picker.
3. No target the app stores can be unreachable in any period of the goal's cadence.

## Expected Behavior

- Someone who owns a habit can connect it to a goal in a short, guided flow that never asks them to invent a metric target.
- Broken links the app already detects have a visible repair path.

## Actual Behavior

- Connecting a habit takes a checkbox plus two chained selects, and the stored target is whatever the user typed, validated against a maximum rather than a guaranteed minimum.

### Testing

- Covered per child issue; the split is sequential, so each child must pass `pnpm test:unit` and `pnpm run build` before the next begins.

## Issue Context

- Split scope, in order: `#218` (wizard + `minHabitMetricBuckets`) → `#219` (row slot + editor buttons + test rewrites) → `#220` (broken-link repair on-ramps).
- Not in scope anywhere: no migration, no sync change, no new localStorage key, no `liftingtracker` conversion, no change to `isGoalMetric` invariants, no `CreateHabitModal` behaviour change beyond being hosted inline, and no habit-side "tracks N goals" screens.

## Notes

Superseded scope: the original placeholder listed open questions about entry points and step sequence. They are settled by the split above: the goal row is the entry point, and the sequence is habit → frequency → derived target.
