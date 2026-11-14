# Title: Deck project context

## Tags

Complexity Classification: T2
Classification Reason: Cross-file but presentation-only: deck types, the title and recap builders, the derivation refresh, the pptx renderer, the preview, and one call site, with three large existing suites.

Severity: Low
Severity Reason: Affects deck copy only; the plan, persistence, filename, and pptx metadata stay unchanged.

Needs research before implementation: No

## Summary

A deck never says which project the review is about. This issue adds the project list to the deck plan input, renders the tracker's project name on the title slide with a quiet "+N goals in other projects" when goals deviate, and labels only deviating goals on recap slides.

The deviation-only recap label becomes the signal that something was overridden, instead of putting one project name on every slide.

Depends on the resolution contract issue and the goal row display issue (shared deviation rule).

## Steps to Reproduce Context

1. Open Goals for a tracker and build a deck (`buildDeck`, `src/components/GoalsPage.tsx:228-250`). The input is `{ tracker, goals, checkIns, habits, completions, period, now }`; no projects are passed.
2. `DeckPlanInput` (`src/lib/goals/deck/plan.ts:43-53`) therefore has no project context.
3. The title slide is built by `buildTitleSlide` (`plan.ts:134-151`) from tracker name and purpose only; the preview shows `slide.trackerName` and the period (`src/components/goals/DeckPreview.tsx:534-537`) and the pptx renderer writes the same fields (`src/lib/goals/deck/render.ts:58-63`).
4. Recap slides (`buildRecapSlide`, `plan.ts:153-208`) carry no project field, so a goal that overrides its tracker project is indistinguishable from one that inherits it.
5. `refreshDeckDerivations` (`plan.ts:588`) clones every slide through `cloneSlide`, which copies fields per kind, and `countDeckWords` (`plan.ts:429-455`) enumerates fields per kind.

Any new slide field must be added to both or it is dropped on refresh or excluded from the estimate.

## Requirements for completed issue

1. `DeckPlanInput` accepts the project list; the Goals page passes `pm.state.projects` when building a deck.
2. The title slide carries the tracker's resolved project name and the count of goals whose resolved project deviates from it.
3. The title slide renders the project name, and a quiet "+N goals in other projects" line when the deviation count is greater than zero.
4. Recap slides carry and render a project label only for goals whose resolved project deviates from the tracker's. Inheriting and no-project goals show no label.
5. A deviating goal whose project no longer exists shows "Linked project is missing" rather than a blank or a raw id.
6. New fields survive `refreshDeckDerivations` cloning and appear in both the preview and the rendered pptx.
7. The new labels are included in word counts, so `suggestedSeconds` and the 300-second estimate account for them.
8. No new thin-warning type, no filename change, and no change to pptx document metadata.

## Expected Behavior

- A deck opens by naming the project the review is about.
- A deck for a tracker without a project but with goals scattered across projects shows the deviation count only, with no name.
- Only overridden goals carry a project label on recap slides.
- If a tracker's goals all inherit, the title reads cleanly and no recap is labelled.

## Actual Behavior

- Decks are project-blind: neither the title slide nor any recap slide names a project.
- There is no signal that a goal belongs somewhere other than the tracker's project.

### Testing

1. `src/lib/goals/deck/plan.test.ts` — title slide project name and deviation count for: tracker with project and all inheriting; tracker with project and two deviating goals; tracker without project with deviating goals; tracker without project with no deviations.
2. Recap labelling: inheriting goal unlabelled, overriding goal labelled, dangling override labelled with the missing copy.
3. `refreshDeckDerivations` retains the new fields; word counts and `suggestedSeconds` change when a label is present; the estimate still computes the 300-second target.
4. `src/lib/goals/deck/render.test.ts` and `src/components/goals/DeckPreview.test.tsx` — the title and recap labels render; filename and document metadata are unchanged.
5. No new warning kinds are produced (`findThinWarnings` output unchanged for the same input).
6. `pnpm test:unit` and `pnpm run build`.

## Issue Context

### New Files

None.

### Remove Files

None.

### Change Files

#### Deck types

Code Source: `src/lib/goals/deck/types.ts`
Code Description: `DeckTitleSlide` (line 34) holds `trackerName`, `purpose`, `periodLabel`, `periodRangeLabel`; `DeckRecapSlide` (line 44) holds no project field.
Code Change Description: Add a project name (nullable) and a deviation count to the title slide, and a nullable project label to the recap slide.

```ts
export interface DeckTitleSlide extends DeckSlideBase<"title"> {
    trackerName: string;
    purpose: string;
    periodLabel: string;
    periodRangeLabel: string;
    projectName: string | null;
    otherProjectsGoalCount: number;
}
```

#### Plan input and builders

Code Source: `src/lib/goals/deck/plan.ts`
Code Description: `DeckPlanInput` (line 43), `buildTitleSlide` (line 134), `buildRecapSlide` (line 153), `buildDeckPlan` (line 318), `countDeckWords` (line 429), `refreshDeckDerivations` (line 588) and `cloneSlide` above it.
Code Change Description: Accept `projects`, resolve the tracker and each goal once through the shared resolver, populate the new fields, include them in word counting, and copy them in `cloneSlide`. Keep recap labelling deviation-only.

#### Renderer and preview

Code Source: `src/lib/goals/deck/render.ts` (title slide, lines 58-63; file name line 109; metadata lines 118-125) and `src/components/goals/DeckPreview.tsx` (title slide lines 534-537; recap rendering)
Code Change Description: Render the project name and the quiet deviation line on the title slide, and the label on deviating recaps. Leave the filename and `presentation.title` untouched.

#### Goals page call site

Code Source: `src/components/GoalsPage.tsx`
Code Description: `buildDeckPlan({ tracker, goals, checkIns, habits, completions, period, now })` (lines 236-244).
Code Change Description: Pass the project list from `usePM()`.

## Notes

- Tracker without a project but goals overriding to several others yields no name; only the deviation count is shown.
- Provisional issue number; GitHub assigns the final number on creation.
