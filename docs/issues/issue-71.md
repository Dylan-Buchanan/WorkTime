## Title: Per-project workable time frame and workable weekdays

## Tags

Complexity Classification: T3
Severity: Low
Reason: Additive data-model change to the `Project` type and the persisted pm_state JSONB document, plus ProjectManagerContext create/update/normalize, the project editing UI, the TimerPanel projection engine, and the hardcoded Mon-Fri assumption in AnalyticsPage. Blast Radius=4 (10+ files across state, data layer, UI, and projection systems), Uncertainty=2 (defaulting semantics for existing projects and time-window rollover edge cases are open), Behavior=4 (data model + complex weekday/time-window spillover logic), Testing=2 (rollover edge cases like Friday→Monday and cross-project combined projections), Reversibility=2 (fields are additive, but the whole-row pm_state document is staged/synced). Total=14 → T3.
Needs research before implementation: Yes
Research needed: (1) Default scheduling semantics for existing projects where the new fields are unset (validator/normalize path in src/state/ProjectManagerContext.tsx ~lines 220-232 and pm_state validation in src/lib/data/staging/types.ts lines 389-394); (2) where the combined per-day projection across projects lives today (finishProjection vs AnalyticsPage CapacityForecast vs a new computation); (3) how a workable time-of-day window reshapes the current `Date.now() + totalMs` model, including spillover across day boundaries and to the next workable weekday.

## Summary

Add per-project scheduling settings — a workable time frame (e.g., 9 AM–5 PM) and a set of workable weekdays (e.g., Mon–Fri) — and use them in the projection engine so that when a project's available time is exhausted, spillover rolls to the next workable day (a Mon–Fri project's Friday overflow lands on Monday, not Saturday), making the combined per-day projection across projects accurate.

## Steps to Reproduce Context

1. Create a project with tasks that have estimates, on a Friday evening, with remaining work.
2. Look at the "Projected finish" card: the projection is a continuous clock with no notion of per-project available hours or available weekdays.
3. Observe there is no place in the app to configure a project's work hours or workdays — the `Project` type has only id, name, color, description, isArchived, sortOrder, createdAt, updatedAt.

## Expected Behavior

- Each project can have a workable time frame (start/end time) and a set of workable weekdays, editable in the project UI and persisted with the project through the existing pm_state path.
- The projection uses these per-project settings: when a project's daily available time is exhausted, remaining work rolls to the next workable day (e.g., Friday→Monday for a Mon–Fri project), and the combined per-day projection across projects reflects each project's availability.

## Actual Behavior

- `Project` has no scheduling fields (src/state/types.ts lines 16-25).
- The projection is a continuous wall-clock `Date.now() + totalMs` (TimerPanel.tsx line 270).
- `AnalyticsPage` `CapacityForecast` hardcodes Mon–Fri as workdays (lines 694-726).
- No day-availability concept exists anywhere in the app.

## Requirements for completed issue

1. Per-project workable time frame and workable weekday settings exist on the Project model, persist through the existing pm_state sync path, and are editable from the project UI.
2. The projection engine uses per-project availability so spillover rolls to the next workable day for each project, and the combined per-day projection across projects reflects each project's availability.

## Context

- Files:
  - `src/state/types.ts` — `Project` interface (lines 16-25).
  - `src/state/ProjectManagerContext.tsx` — `createProject` (lines 406-427), `updateProject` (lines 428-436), state normalization (~lines 220-232).
  - `src/components/ProjectManager/ProjectsSidebar.tsx` — active-project settings UI (lines 146-209).
  - `src/components/TimerPanel.tsx` — `finishProjection` (lines 154-293).
  - `src/components/AnalyticsPage.tsx` — `CapacityForecast` hardcoded Mon–Fri (lines 694-726).
  - `src/lib/data/staging/types.ts` — pm_state shape validation (lines 389-394) and ProjectManagerState schema.
  - `supabase/migrations/20260801000000_foundation.sql` — pm_state whole-row JSONB table (line 39).
- Code Snippets:

```
// src/state/types.ts — Project has no scheduling fields (lines 16-25)
export interface Project {
    id: string;
    name: string;
    color: string; // hex
    description?: string;
    isArchived: boolean;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}
```

```
// src/state/ProjectManagerContext.tsx — createProject shape (lines 408-417)
const project: Project = {
    id,
    name,
    color: color || randomColor(),
    description: "",
    isArchived: false,
    sortOrder: Object.keys(state.projects).length,
    createdAt: now(),
    updatedAt: now(),
};
```

```
// src/components/AnalyticsPage.tsx — existing hardcoded Mon-Fri workday assumption (lines 715-717)
next14.forEach((d) => {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return;
    forecastMins += avgPerWeekday[dow];
});
```

## Notes

- The pm_state staging validator only requires `isObject(pmState.projects)` (staging/types.ts lines 389-394), so optional new fields on `Project` are accepted without validator changes; confirm defaulting and normalize handling for older project rows during research.
- Feeds the weekly projection (issue-72) and week-overview page (issue-73) by providing per-day availability.
