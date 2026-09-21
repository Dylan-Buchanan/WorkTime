## Title: Show elapsed training time and total session count per skill

## Tags

Complexity Classification: T2
Severity: Medium
Reason: Contained derived-metrics feature: pure selector/derivation in `src/lib/pets/`, a humanized duration formatter, barrel export, and display in `src/components/pets/PetTrainingTab.tsx` (skill cards + stamps) with unit/component tests. Blast Radius=2 (3–5 files), Uncertainty=3 (the session-count half depends on an unlanded separate issue adding `skillIds` to `PetActivityRecord`, and the humanized duration thresholds are unspecified), Behavior=2 (simple pure logic plus display), Testing=1 (pure functions with fixed dates; display-only), Reversibility=1 (pure derivation, no data). Total=9.
Needs research before implementation: Yes
Research needed: Confirm the `skillIds` contract from the "Skill-tagged training sessions" issue (field name, cardinality, nullability, how deleted/unknown skill ids are represented) so the counting selector can tolerate them; and settle the humanized elapsed-duration formatting rules/thresholds (weeks vs months/years) to match existing pet-domain formatting conventions.

## Summary

There is no way to tell how long a skill has been worked on, or how many training sessions have included it. Add two derived data points to each skill — elapsed time in training and total training sessions — so effort and progress feel tangible.

## Steps to Reproduce Context

1. Open `/pet` and switch to the **Training** tab.
2. Look at an active skill card.
3. Observe there is no indication of how long the skill has been in training or how often it has been worked on.
4. Resolve a skill and observe the archive entry likewise shows no effort/history information.

## Expected Behavior

Each skill shows how long it has been in training (and, once completed, how long it took in total) and how many training sessions have included it. These values update as new sessions are logged and as time passes.

## Actual Behavior

Skill cards show only label, notes, and status. No elapsed-time or session-count information is derived or displayed anywhere.

## Requirements for completed issue

1. Each skill displays elapsed time in training, derived from when it started (and its completion time when resolved) — never stored.
2. Each skill displays how many training sessions have included it.
3. The session count is derived from training sessions tagged with that skill and safely ignores references to unknown/deleted skills.
4. Both readouts are visible on active skill cards and on completed stamps.
5. Values refresh as sessions are logged and as time advances.
6. Elapsed-time formatting follows the pet domain's existing humanized-duration conventions.
7. Derived logic is pure and unit-tested with fixed dates; no new persisted fields are added by this issue.

## Context

- Files:
  - `src/state/types.ts` (lines ~221–230) — `PetActivityRecord` (source of session data).
  - `src/state/types.ts` (lines ~253–267) — `PetTrainingSkill` (`createdAt`, `resolvedAt`, `status`).
  - `src/lib/pets/` — the pure domain barrel (`index.ts`) where the derived selector/formatter belongs.
  - `src/components/pets/PetTrainingTab.tsx` — where the readouts are displayed (cards and archive).
  - `src/state/PetActivityContext.tsx` — exposes `state.records` (the activity log).
- Code Snippets:

  The skill timestamps available for elapsed-time derivation (`src/state/types.ts`):
  ```ts
  export interface PetTrainingSkill {
      id: string;
      label: string;
      notes: string;
      status: PetTrainingStatus;
      resolvedAt: string | null;
      createdAt: string;
      updatedAt: string;
  }
  ```

  The activity record that session counts are derived from (`src/state/types.ts`):
  ```ts
  export interface PetActivityRecord {
      id: string;
      activityType: PetActivityType;
      timestamp: string;
      durationMinutes?: number;
      createdAt: string;
  }
  ```

## Notes

- The session-count half depends on the **Skill-tagged training sessions** issue, which adds the skill↔session association; the elapsed-time half has no dependency and can ship independently.
- Session count is inherently a derived value — no denormalized counter should be stored, which avoids double-counting when sessions are edited.
