## Title: Training skill progression is forward-only — allow reversing and reopening skills

## Tags

Complexity Classification: T1
Severity: Medium
Reason: Well-understood, pattern-following addition of two pure transition functions plus small UI controls. Blast Radius=2 (engine `src/lib/pets/training.ts`, the `src/lib/pets/index.ts` barrel, `PetTrainingTab.tsx`, and the two existing test files), Uncertainty=1 (existing `advance`/`resolve` patterns are directly mirrored; persistence for `status`/`resolvedAt` is already verified end-to-end), Behavior=2 (simple status-transition logic plus UI handlers), Testing=1 (pure functions are trivial to unit test; UI tests already exist), Reversibility=1 (no schema/data change). Total=7.
Needs research before implementation: No

## Summary

The Training tab only lets a skill move forward: it can be advanced (`introduced → progressing → reliable`) or resolved/done. There is no way to step a skill back if it was advanced by mistake, and no way to bring a resolved skill back into the active list. Add both a reverse step and a reopen action.

## Steps to Reproduce Context

1. Open `/pet` and switch to the **Training** tab.
2. Add a skill and press **Advance** — or tap it accidentally.
3. Observe there is no control to move the skill back a status.
4. Press **Mark done** on a skill; it moves to the archive and cannot be returned to the active list.

## Expected Behavior

A skill can be stepped back one status at a time (down to the first status), and a resolved skill can be reopened so it returns to the active list. Invalid directions (e.g. stepping back from the first status) are unavailable rather than silently applied.

## Actual Behavior

`advancePetTrainingSkill` and `resolvePetTrainingSkill` are forward-only. No reverse or reopen command exists in the pure engine, and the Training tab exposes no controls for either.

## Requirements for completed issue

1. A user can step an active skill back one status at a time, stopping at the first status.
2. A user can reopen a resolved skill, returning it to the active list with a sensible status.
3. Invalid reversals (e.g. stepping back below the first status, or reversing a resolved skill) are prevented, not silently applied.
4. The Training tab exposes both the reverse and reopen actions.
5. Status transitions remain pure, dependency-free engine logic covered by unit tests.
6. No new persisted fields are required — existing `status`/`resolvedAt` persistence and sync carry the change.

## Context

- Files:
  - `src/lib/pets/training.ts` — the pure engine where the reverse/reopen commands belong.
  - `src/lib/pets/index.ts` (lines ~74–81) — the barrel that re-exports training commands.
  - `src/lib/pets/training.test.ts` — pure-engine tests.
  - `src/components/pets/PetTrainingTab.tsx` — the Training tab UI (`advance`/`resolve` handlers, status pill, action buttons).
  - `src/components/pets/PetPage.test.tsx` (lines ~393–449) — existing skill UI tests.
  - `src/state/PetContext.tsx` — `setTrainingSkills`, the persistence path.
- Code Snippets:

  The current forward-only transitions (`src/lib/pets/training.ts`):
  ```ts
  export function advancePetTrainingSkill(skill: PetTrainingSkill, now: Date): PetTrainingSkill {
      if (skill.resolvedAt !== null) throw new RangeError("A resolved training skill cannot be advanced");
      const status = nextPetTrainingStatus(skill.status);
      if (status === null) throw new RangeError("A reliable training skill cannot advance further");
      return { ...skill, status, updatedAt: now.toISOString() };
  }

  export function resolvePetTrainingSkill(skill: PetTrainingSkill, now: Date): PetTrainingSkill {
      if (skill.resolvedAt !== null) throw new RangeError("A training skill is already resolved");
      return { ...skill, resolvedAt: now.toISOString(), updatedAt: now.toISOString() };
  }
  ```

  The status order (`src/lib/pets/training.ts`):
  ```ts
  export const PET_TRAINING_STATUSES: readonly PetTrainingStatus[] = ["introduced", "progressing", "reliable"];
  ```

## Notes

- Reopening should restore a sensible status. The exact restore target (previous status vs. dropping to `progressing`) is a design detail to settle during implementation.
- Reopening interacts with the Skill Stamps gallery, which is a live view over resolved skills — reopening a skill will remove its stamp.
- No staging-store or Supabase changes: `status` and `resolvedAt` are already persisted and synced.
