## Title: Pet training & fixations tracking

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New record types and lifecycle/progression logic in the pet domain lib, DataAccess save/load pairs, and two new tabs on the /pet page with resolved-archive viewing. Blast Radius=3 (pet lib, state/types.ts, data access layer, page tabs), Uncertainty=1 (follows established A/C/D patterns), Behavior=3 (lifecycle state management plus persistence wiring), Testing=1 (standard unit tests for logic, straightforward UI), Reversibility=1 (additive). Total=9.
Needs research before implementation: No

## Summary

Add the training and fixation tracking facets of the `/pet` page: training skills (command training, leash training) with a status progression, and fixations ("current obsessions/behavior problems") with an active → resolved lifecycle and archive. Both follow the pet domain's record + pure-logic conventions and persist via the established DataAccess pattern.

## Steps to Reproduce Context

1. The `/pet` page has placeholder Training and Fixations tabs (from Issue B) with no backing model or UI.
2. There is no way to record which commands Whitney is learning, how they are progressing, or what fixations she currently has.

## Expected Behavior

The Training tab lists skills with their progression status and lets the user advance or resolve them. The Fixations tab lists active fixations with notes, and resolved fixations move to a viewable archive ("grew out of it" / "solved with redirection"). Both record types persist through the staging/sync lifecycle like habits and todos.

## Actual Behavior

The tabs are placeholders; no training or fixation model exists.

## Requirements for completed issue

1. **Training skills**: record type for a skill (e.g. command name/label, optional notes, created/updated stamps) with a **status progression** — `introduced → progressing → reliable` — and the ability to resolve/close a skill when it's effectively done. Status transitions are pure logic in the pet domain lib (validated transitions, engine-tested).
2. **Fixations**: record type with a **lifecycle** — created, actively worked on, then resolved/archived with a reason captured as freeform note ("grew out of it", "solved with redirection", etc.). Active fixations form the current short list; resolved ones are archived but never deleted.
3. **Resolved archives are viewable**: both resolved skills and archived fixations remain reachable (e.g. collapsed archive section) — the "look how far we've come" payoff lives here.
4. **Persistence**: add `savePetTrainingSkills/load...` and `savePetFixations/load...` pairs (naming per house style) to the `DataAccess` interface, implemented in `InMemoryDataAccess` and `StagedDataAccess` following `saveHabits`. Schema fields and Supabase tables are Issue G; this issue implements the interface pairs.
5. **Tabs**: implement the Training and Fixations tabs on `/pet` (replacing the placeholders from Issue B), each a list view with create/edit and status controls. Keep both tabs simple lists — no grids, no streaks, no scoring.
6. Training/fixation records are **not** notable-events (Issue E) and do not appear in the timeline; status *changes* may optionally generate a notable event later — out of scope here.
7. House conventions: record types in `src/state/types.ts` via the pet barrel; factories `(input, now, id)`; pure transition/validation logic co-located and tested with fixed dates.
8. Tests: engine/unit tests for status transitions and fixation lifecycle (invalid transition rejection, resolve+archive, archive visibility); context/data-access tests per `src/state/HabitContext.test.tsx`; light UI tests for the two tabs.

## Context

- Files:
  - `src/lib/habits/types.ts` + `src/lib/habits/factories.ts` — record + factory conventions to follow.
  - `src/lib/data/DataAccess.ts` — save/load pair pattern to mirror.
  - `src/state/HabitContext.tsx` — context persistence/save-guard/reload-on-revision pattern.
  - `/pet` page component from Issue B — where the two tabs mount.
- Code Snippets:

  Status-as-literal-union precedent (house style, e.g. PMTask status in `src/state/types.ts`):
  ```ts
  export type HabitFrequency = "daily" | "weekly" | "monthly";
  ```

## Notes

- Fixations are deliberately a *different* entity from training skills: skills progress forward; fixations are problems that eventually disappear. Do not merge them into one type.
- No photos, no reminders, no analytics in this issue (reminders are F; analytics/patterns is a future page).
