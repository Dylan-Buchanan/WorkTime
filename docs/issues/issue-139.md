# Title: Deck preview — reorder, hide, edit copy, promote from appendix, thin-item pass

## Tags

Complexity Classification: T3
Classification Reason: A substantial editing surface over the #138 deck plan (dnd-kit reorder, per-slide show/hide, inline text editing, appendix promotion/demotion, live talk-length estimate) plus the pre-export confirmation pass. No new dependencies; all persistence is in-memory plan state (nothing is stored).

Severity: Low
Severity Reason: Enhancement; no existing behavior changes.

Needs research before implementation: No

## Summary

The step between building and exporting: an in-app preview of the deck plan where the user can **reorder slides, hide slides, edit copy, and promote/demote goals between the appendix and full slides**, with a running talk-length estimate pressuring (never capping) the five-minute target. A pre-export pass surfaces anything thin — misses without reasons, goals with no planned items — and lets the user fix, skip, or proceed. **Warn, never block.** No file is written here; the edited plan is handed to #140.

## Steps to Reproduce Context

1. With check-ins complete (#136) and a plan builder available (#138), press Build Deck — there is no preview; nothing renders the plan.
2. Observe there is no slide-editing surface anywhere in the app.

## Expected Behavior

- Build Deck opens a preview of the current plan, slide by slide, in order.
- The user can drag to reorder slides, hide/show any slide, and edit any text/bullet copy inline.
- Goals can be promoted from the appendix roster into a full recap slide, and demoted back — the appendix grows/shrinks accordingly.
- A running talk-length estimate updates live as slides are hidden/reordered/edited; a soft warning appears when the estimate exceeds the target. **No hard cap exists anywhere.**
- The pre-export pass lists thin items (miss without a reason, goal with no planned items, empty-period placeholder slides) with fix / skip / proceed choices.
- "Export" hands the edited plan to the renderer (#140). Until #140 lands, the export button can be wired to a disabled/placeholder state — this issue is complete without the file.
- Edited plans are never persisted: closing the preview discards edits, and Build always regenerates from data (no deck archive, by design).

## Actual Behavior

No preview exists.

## Requirements for completed issue

1. Preview component (suggested `src/components/goals/DeckPreview.tsx`) rendering the `DeckPlan` slide types from #138 with a 16:9-styled slide frame, light/minimal/TV-readable styling, and speaker notes visible per slide.
2. Reorder (dnd-kit, existing pattern), hide/show, inline copy editing.
3. Promote/demote between appendix and recap slides, keeping the fixed-order constraint sensible (recaps stay in the recap block; the appendix remains last).
4. Live talk-length estimate driven by #138's estimate function, recomputed on every edit.
5. Pre-export thin-item pass with fix/skip/proceed.
6. Export action emits the edited `DeckPlan` to a clearly defined handler (the seam #140 fills).
7. No persistence of plan edits anywhere — in-memory only.

### Testing

- Component tests: initial render in fixed order, reorder updates order, hide/show toggles, edit copy updates the plan, promote/demote moves a goal between appendix and recaps, estimate updates on hide, thin-item pass lists each category and allows proceed.
- Plan immutability: closing and rebuilding shows the original generated plan (edits discarded).

## Context

Code Source: `src/lib/goals/deck/plan.ts` + `types.ts` (#138)
Code Description: `DeckPlan`/`DeckSlide` — the data structure this issue edits; promotion changes `isFocus`-equivalent slide placement, not the stored check-ins.

Code Source: `src/components/HabitsPage.tsx` (~L117), `src/components/ProjectManager/TasksBoardView.tsx`
Code Description: Existing dnd-kit reorder implementations to copy.

Code Source: `src/components/pets/PetPage.tsx`
Code Description: In-page tab/panel pattern if the preview lives as a view state on the GoalsPage rather than its own route — either is acceptable; keep pptx-adjacent code out of the entry chunk either way (the renderer dependency arrives in #140).

## Notes

- Depends on #133, #134 (page to mount on), #135, #136 (check-ins to build from), #138 (the plan). #137 enriches recap content and can land before or after this issue.
- The talk-length estimate is the only pressure mechanism — the brainstorm explicitly rejected slide-count caps and "you have too many goals" warnings. Keep it that way.
