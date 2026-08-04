## Title: Habit Tracker: 365 detail/expand interaction

## Tags

Complexity Classification: T2
Severity: Medium
Reason: UI-heavy expand/detail interaction: collapsed scrollable strips on the main page, expanded 7-column vertical scrollable grids for 365 daily and weekly, monthly unchanged, wired through the device-local UI slice. Bounded to the habits page subtree; grid math is consumed from the engine, not reimplemented.
Needs research before implementation: Yes — the exact API shapes it consumes once they exist: the 365-grid derivation functions from the pure engine (issue 1), the `ui` slice (period/selected/expanded) and device-local UI key of `HabitContext` (issue 4), and the Habits page component structure from issue 5.

## Summary

Add the per-habit 365 detail/expand interaction: collapsed scrollable strips on the main page and expanded 7-column vertical scrollable grids for daily and weekly (monthly as-is), with expanded/selected state persisted device-locally so it survives reloads without syncing.

## Steps to Reproduce Context

1. User selects/expands a habit on the Habits page to reveal its 365 history.
2. User scrolls the expanded 7-column vertical grid and checks cells.
3. User navigates away and returns; the expanded/selected state survives a reload.

## Expected Behavior

365 daily renders collapsed as a scrollable strip and expanded as a 7-col × ~53-row vertical scrollable grid with slightly smaller clickable cells; 365 weekly renders as a single scrollable row that becomes a 7-column vertical grid (a literal 7-cell wrap of the 52 weeks) when expanded; monthly is unchanged; expanded/selected state persists via the device-local UI key and is never synced.

## Actual Behavior

Not implemented; no selection/expansion state or detail grid exists.

## Requirements for completed issue

1. Collapsed scrollable strips render for 365 daily and weekly on the main page.
2. Expanded 7-column scrollable grids (daily + weekly) render from the engine's grid derivation with clickable cells; monthly layout is unchanged.
3. Expanded/selected state is persisted through the device-local UI key (survives reloads, not synced), modeled as a per-habit expanded flag plus a selected habit id.

## Context

- Files: `docs/brainstorming/Habit-Tracker.md` (overview item 6 and the "one subtlety" note on the device-local expanded flag + selected id), `src/state/ProjectManagerContext.tsx` (device-local UI prefs pattern), plus the outputs of the engine, `HabitContext`, and Habits page issues.
- Code Snippets:

```text
# docs/brainstorming/Habit-Tracker.md
The weekly detail grid being "7 columns like the day view" is a literal 7-cell wrap
of the 52 weeks — visually consistent, even if the columns aren't semantically meaningful.
...a per-habit expanded flag (and a selected habit id), device-local like PM's UI prefs,
so it survives reloads without being synced.
```

## Notes

None.
