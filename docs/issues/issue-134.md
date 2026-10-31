# Title: Goals page — provider, /goals route, tracker and goal CRUD, metric block

## Tags

Complexity Classification: T3
Classification Reason: Full domain surface (context/provider with the hydrate/suppress/save/revision lifecycle, lazy route, nav entry, tracker and goal CRUD with reorder, keyboard quick-add rows, and a metric block), mirroring `HabitContext` + `HabitsPage` in scope. Cross-file but follows an established pattern throughout.

Severity: Low
Severity Reason: Pure enhancement; no existing functionality changes beyond adding a nav link and route.

Needs research before implementation: No

## Summary

Build the visible Goals surface on top of the domain foundation (#133): a `GoalProvider`, a lazy `/goals` route with TopNav entry, tracker management (create/edit/archive/switch — **multiple trackers per owner is a baseline requirement**, each person runs a work tracker and a life tracker), goal CRUD with reorder and lifecycle, keyboard quick-add rows for fast goal entry, the one-metric block with manual value entry, and a clean empty state.

## Steps to Reproduce Context

1. Run the app and observe the TopNav (`src/App.tsx` ~L178–213) — there is no Goals link.
2. Navigate to `/goals` — no route exists (404).
3. Observe there is no provider between `HabitProvider` and `TodoProvider` in `AuthenticatedShell` for a goals slice.

## Expected Behavior

- `/goals` renders behind the authenticated shell; public auth pages never trigger goal reads.
- A user can create a tracker (name, one-line purpose, a **cadence rule** — "every N weeks on a weekday" or "the first weekday of each month" — and a color), edit it, archive it, and switch between their trackers. Trackers are **archive-only**; there is no hard delete in v1.
- A tracker created mid-cycle has **no open period** until its first boundary. The page states when the first period starts, and the check-in entry stays unavailable until then.
- Within a tracker, a user can quick-add goals (keyboard flow: name → tab → status → tab → note), edit, reorder (drag), and move goals through `active | achieved | dropped` (with reactivate preserving timeline — data already survives via #133).
- Each goal has an optional single metric block (label, target, current, unit) with a typed manual value; the auto/override badge states are displayed but only `manual` is selectable until #143.
- A tracker with no goals shows a clean empty state: one "Add your first goal" row and a one-line explainer of the three buckets (did / currently working on / planned next). No seeded goals, no tour.
- Adding a goal is never more than a two-keystroke operation; a project link is optional (#137) and absent from the quick-add row.

## Actual Behavior

No Goals page, provider, or route exists.

## Requirements for completed issue

1. `GoalProvider` in `src/state/GoalContext.tsx` following the habits provider lifecycle: hydrate via `data.loadGoals()`, hydration-echo suppression, save effect gated on `hydrated && initialized` keyed on `revision` serializing only the server slice, reload on `revision`, `useGoals()` hook guard. Wire it inside `AuthenticatedShell` near `HabitProvider`.
2. Lazy `/goals` route and TopNav link in `src/App.tsx` (same `lazy(() => import(...))` pattern as `HabitsPage`).
3. `GoalsPage.tsx` with a tracker switcher, tracker create/edit/archive, and per-tracker goal list.
4. Keyboard quick-add rows above the goal list.
5. Goal reorder via `@dnd-kit` (same pattern as `HabitsPage.tsx` ~L117), lifecycle transitions, and tracker **archive** with confirmation. Do not implement a tracker or goal hard delete; v1 has none, and adding one re-opens the tombstone-cascade work #133 skipped.
6. Metric block on the goal edit form: optional, at most one per goal, manual current value entry.
7. Device-local UI state (selected tracker, collapsed rows) under a `goals_state_v1` localStorage key holding **UI-only** state — same precedent as `habit_state_v1` / `pet_state_v1`; never synced, never in the staging store.
8. Achieved/dropped goals leave the active list but remain viewable (history surface is minimal — a filter/toggle is enough; the timeline UI is #136's concern).
9. The provider's save path always passes the **complete** `loadGoals()` set to `saveGoals` — archived trackers and achieved/dropped goals included. Hiding them is a display filter only.

### Testing

- `GoalContext.test.tsx` mounting the real provider stack over `InMemoryDataAccess` (copy the `HabitContext.test.tsx` wrapper): hydration, staged saves reach `data.saveGoals`, remount survival, hook guard, device-local UI persistence under `goals_state_v1`, and a save after archiving a tracker still carries every archived row.
- `GoalsPage.test.tsx`: tracker create/switch/archive, both cadence-rule variants, the no-open-period state, goal quick-add/edit/reorder/lifecycle, metric entry, empty state.
- `src/App.test.tsx` route smoke: `/goals` renders page + nav link.

## Context

Code Source: `src/state/HabitContext.tsx`
Code Description: The provider template — `serverSlice()` separation, `suppressServerSaveRef` + `lastServerSerializedRef`, save effect keyed on `revision`, `LS_KEY = "habit_state_v1"` for UI-only state.

Code Source: `src/components/HabitsPage.tsx`
Code Description: Single-file page with period tabs and dnd-kit sorting (`reorderHabits(arrayMove(...))` ~L117) — the closest structural precedent for GoalsPage.

Code Source: `src/App.tsx` ~L36–58, L137–176
Code Description: Lazy route registration and the provider ordering inside `AuthenticatedShell` (DataProvider → SyncProvider → AppStateProvider → ProjectManagerProvider → AgentApprovalProvider → HabitProvider → …). `GoalProvider` slots in alongside `HabitProvider`; it must sit inside `SyncProvider`.

Code Source: `src/lib/goals/` (from #133)
Code Description: Pure factories and types the provider and forms consume.

## Notes

- Depends on #133. #138 (deck plan) can be built in parallel with this issue.
- Cadence is a discriminated union of two rule kinds — every-N-weeks on a weekday, and the first weekday of each month (with the Mon/Tue snap-backward rule). A custom N-day cadence is deliberately out of scope. Validate rules with #133's `cadence.ts`; do not reimplement the boundary logic here (that is #135).
- Archived trackers keep their goals and history; they are never deleted, and they must still be included in every save.
- The due badge and period label on tracker cards belong to #135, not here — leave a clear place to mount them.
