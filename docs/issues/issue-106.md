## Title: Training tab presentation — progress-colored skill cards and animated state changes

## Tags

Complexity Classification: T1
Severity: Low
Reason: Purely presentational change concentrated in `src/components/pets/PetTrainingTab.tsx`, with at most a small addition to `src/index.css` (keyframes / `prefers-reduced-motion`) and adjustment of existing assertions in `PetPage.test.tsx`. No data-model, engine, or I/O changes. Blast Radius=2 (2–3 files), Uncertainty=1 (change surface clear; only minor design choices around animation encoding), Behavior=1 (UI layout/styling, non-functional), Testing=1 (existing DOM tests cover interactions; animation direction/reduced-motion are cosmetic but hard to assert), Reversibility=1 (simple revert). Total=6.
Needs research before implementation: No

## Summary

The Training tab is a plain list of dark cards with a small status pill; there is no sense of progress or achievement. Make the whole skill card reflect its training progress, add a visual progress indicator, and animate a skill's appearance when it changes state.

## Steps to Reproduce Context

1. Open `/pet` and switch to the **Training** tab.
2. Add a few skills in different states.
3. Observe that every card looks essentially the same regardless of progress, with only a small status pill distinguishing them.
4. Advance or resolve a skill and observe that nothing about the card's appearance changes in a noticeable or animated way.

## Expected Behavior

Each skill card visually communicates how far along the skill is at a glance (progress-based coloring plus a progress indicator), status remains understandable without relying on color alone, and a skill's state change is animated — with reversing a skill looking visually distinct from advancing it.

## Actual Behavior

Cards are plain neutral containers tinted only by a small status pill (`STATUS_TONES`). There is no progress meter and no transition animation between states.

## Requirements for completed issue

1. Each skill card's overall appearance reflects the skill's training progress/status at a glance.
2. A visual progress indicator (e.g. a meter or ring) conveys advancement through the statuses.
3. The current status is understandable without relying on color alone (e.g. icon and/or label).
4. Changing a skill's state is animated, and a reverse step is visually distinguishable from a forward step.
5. Animations use CSS/Tailwind only (no new dependency) and respect `prefers-reduced-motion`.
6. Color choices maintain adequate contrast against the dark theme.

## Context

- Files:
  - `src/components/pets/PetTrainingTab.tsx` — the Training tab; card rendering and `STATUS_TONES`.
  - `src/state/types.ts` (lines ~253–267) — `PetTrainingStatus` and `PetTrainingSkill`.
  - `src/index.css` — where global CSS / keyframes would live (Tailwind v4 entry, `@import "tailwindcss";`).
  - `tailwind.config.js` — Tailwind config (dark mode class; no theme extension).
- Code Snippets:

  Current status tinting (`src/components/pets/PetTrainingTab.tsx`):
  ```ts
  const STATUS_TONES: Record<PetTrainingStatus, string> = {
      introduced: "bg-neutral-800 text-neutral-300",
      progressing: "bg-amber-900/40 text-amber-300",
      reliable: "bg-emerald-900/40 text-emerald-300",
  };
  ```

  The status order the visual progression follows (`src/lib/pets/training.ts`):
  ```ts
  export const PET_TRAINING_STATUSES: readonly PetTrainingStatus[] = ["introduced", "progressing", "reliable"];
  ```

## Notes

- The skills list is currently rendered in insertion order (not sorted by progress), so same-element CSS transitions are sufficient. If the list is later sorted by progress, layout animation would be needed.
- This issue is presentation only; the actual "how long in training" / "session count" readouts are handled by the metrics issue and can be hosted on the card once available.
