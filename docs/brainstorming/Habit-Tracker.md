Idea: Habit tracker tab

- What: A new /habits route with reorderable, color-coded habit cards whose day/week/month grain cells are click-to-check, gated by a 7-day (current Sun–Sat week) / month (current calendar month) / 365-day (trailing) window, with per-habit expansion into a 7-column vertical history grid.
- Motivation: First new synced data domain since Project Manager; establishes the pattern for how future domains ride the staged sync.
- Considerations: Staging schema v1→v2 migration is the hidden cost; bucket keys are device-local dates; future-starting cells disabled, current-period cells checkable; archive is first-class with cascading delete.
  Locked-in decisions
  Decision Choice
  Persistence Row-level habits + habit_completions, staged-sync'd like tasks/logs
  7-day window Current Sun–Sat week, daily habits only
  30-day window Current calendar month, daily + weekly
  365-day window Trailing 365, all habits
  Check semantics Bucket = Sunday week-start / YYYY-MM-01; one completion per (habit_id, bucket); check = idempotent insert, uncheck = tombstone
  Future cells Disabled until the period's start day arrives; current week/month checkable
  365 daily layout Collapsed: scrollable strip; expanded: 7-col × ~53-row vertical scrollable grid, slightly smaller clickable cells
  365 weekly layout Single scrollable row on main page; selected/expanded → 7-column vertical grid (same interaction as daily)
  Removal Archive first-class; hard-confirm delete cascades completions
  Reorder position int, @dnd-kit (already a dependency), rewritten like reorderTasks
  One subtlety that falls out of the weekly answer: "selecting the habit" now implies a selection/expanded state — the detail grid is a distinct interaction from the main page strip. I'd model that as a per-habit expanded flag (and a selected habit id), device-local like PM's UI prefs, so it survives reloads without being synced. The weekly detail grid being "7 columns like the day view" is a literal 7-cell wrap of the 52 weeks — visually consistent, even if the columns aren't semantically meaningful.

Overview

1. Pure habits domain + window/grid engine — src/lib/habits/: Habit/HabitCompletion types, bucket math (day/Sunday-week/month, device-local), window computation + visibility filtering (daily→all, weekly→month+365, monthly→365), checkability rules, 365 grid derivation. Fully Vitest-tested; no I/O. Foundation.
2. Schema migration — habits + habit_completions tables, RLS, updated_at trigger, unique(habit_id, bucket) + unique(owner_id, id) idempotency keys, (owner_id, position) and (owner_id, habit_id, bucket) indexes, grants.
3. Staged sync plumbing — staging schema v1→v2 with in-record migration; SyncSnapshot/merge/PushPlan/countPending/coordinator habit awareness; apply_staged_sync + 4 new args (LWW-gated habit upserts, guarded habit tombstones, idempotent completion upserts, identity completion tombstones); all three DataAccess impls + full test updates.
4. HabitContext provider — state (habits, completions, ui: period/selected/expanded, meta), all actions, PM-style hydration/reload/save-effect discipline, local UI key.
5. Habits page UI — route + nav link, period selector, @dnd-kit reorder with 6-dot handles, habit card (colorized name, description, cell strip, today highlight, checked fill + check glyph for non-color accessibility), add/edit form, empty state, archive/delete affordances.
6. 365 detail/expand interaction — collapsed strips, expanded 7-column scrollable grids (daily + weekly), monthly as-is, expanded/selected state wiring.
7. E2E/integration coverage — Playwright flows (create, check, period switch, reorder, expand) + RPC integration checks.
   Build order is strict through 4; 5 and 6 can land together after 4.
   The "30 days" selector label will lie once it means "current calendar month" (worth renaming to Month), and reusing PM's existing color palette keeps the color picker consistent with the rest of the app.
