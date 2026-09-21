## Title: Skill Stamps gallery replaces the plain archived skills list

## Tags

Complexity Classification: T1
Severity: Low
Reason: Self-contained presentation change that replaces the archived-skills list in `PetTrainingTab.tsx` with a derived "Skill Stamps" gallery. It is a live view over already-resolved skills (`resolvedAt !== null`), so no schema, persistence, data-model, or cross-system changes are involved; only an optional small pure emoji-mapping helper (plus its test and barrel export) may be added in `src/lib/pets/`. Blast Radius=1 (primarily one component plus an isolated helper), Uncertainty=1 (design decided; only the keyword dictionary contents are minor unknowns), Behavior=2 (mostly UI layout with a simple derived lookup helper), Testing=1 (standard Vitest / `PetPage.test.tsx` patterns apply), Reversibility=1 (simple revert). Total=6.
Needs research before implementation: No

## Summary

Resolved skills currently drop into a plain "archive" list. Replace that with a "Skill Stamps" section that presents each completed skill as a collectible stamp showing the skill, when it was completed, and a placeholder emoji — making it fun to look back on progress.

## Steps to Reproduce Context

1. Open `/pet` and switch to the **Training** tab.
2. Add a skill and press **Mark done**.
3. Observe the skill moves into a plain, unstyled archive list with only a small "done <date>" label.
4. Observe there is nothing celebratory or memento-like about the completed skills.

## Expected Behavior

Completed skills appear as stamps in a "Skill Stamps" gallery. Each stamp shows which skill was completed, when it was completed, and a placeholder emoji representing the skill.

## Actual Behavior

Resolved skills are shown in a plain collapsed archive section (`src/components/pets/PetTrainingTab.tsx`, lines ~256–287) with no emoji or gallery presentation.

## Requirements for completed issue

1. Completed skills are presented as a "Skill Stamps" gallery rather than a plain archive list.
2. Each stamp shows the completed skill and its completion date.
3. Each stamp shows a placeholder emoji representing the skill, derived from its label with a sensible generic fallback.
4. The gallery is a live view of completed skills: reopening a skill removes its stamp, and completing it again restores it.
5. No new persisted entity or storage is introduced.
6. Completion context from the metrics feature (e.g. how long it took / sessions) may be surfaced on each stamp.

## Context

- Files:
  - `src/components/pets/PetTrainingTab.tsx` (lines ~119–120 split active vs archived; lines ~256–287 archive render) — the section being replaced.
  - `src/lib/pets/training.ts` — `isPetTrainingSkillResolved`.
  - `src/state/types.ts` (lines ~253–267) — `PetTrainingSkill` (`label`, `resolvedAt`).
  - `src/lib/pets/` — barrel where an optional small emoji-mapping helper could live.
  - `src/components/pets/PetPage.test.tsx` (lines ~393–449) — existing skill UI tests to update.
- Code Snippets:

  The active/archived split (`src/components/pets/PetTrainingTab.tsx`):
  ```ts
  const active = skills.filter((skill) => !isPetTrainingSkillResolved(skill));
  const archived = skills.filter(isPetTrainingSkillResolved);
  ```

  The resolved check the gallery is derived from (`src/lib/pets/training.ts`):
  ```ts
  export function isPetTrainingSkillResolved(skill: PetTrainingSkill): boolean {
      return skill.resolvedAt !== null;
  }
  ```

## Notes

- Attaching images to stamps is explicitly a separate future issue; for now stamps use a placeholder emoji only.
- Because stamps are a live view, the companion progression-reversal issue (reopening a skill) will make a stamp disappear — this is the intended, consistent behavior.
