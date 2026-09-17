## Title: `/pet` route with Today view (schedule page)

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New lazy route + TopNav link in `src/App.tsx` and a multi-component page (profile card, countdown ring, overdue banner, nap reflow panel, card deck with collapse/summary strip, potty bar, onboarding empty states). Blast Radius=3 (~5-10 new files plus App.tsx routing/nav), Uncertainty=1 (clear spec, habits grid/week overview as visual precedents), Behavior=3 (significant UI state management: reflow confirmation, mid-day start, conditional banners), Testing=1 (standard unit/e2e patterns, moderate user impact), Reversibility=1 (additive route/page). Total=9.
Needs research before implementation: No

## Summary

Add an authenticated top-level `/pet` route with internal tabs (Today | Training | Fixations | Timeline) and implement the **Today** tab: a desktop-first, glanceable page showing Whitney's profile, a countdown-ring hero, the nap toggle with wake-confirmation reflow, today's schedule as a card deck, a conditional overdue banner, and a persistent bottom Potty action bar. Route is named `/pet` (not dog-specific) for a possible future second animal.

## Steps to Reproduce Context

1. The app has no pet page or route; `/pet` does not exist in `src/App.tsx` and there is no TopNav entry.
2. A user has no way to see what care activities are due now/next or to indicate the pet is napping.

## Expected Behavior

Visiting `/pet` shows the Today tab: profile card at top, hero status (ring + sentence), today's upcoming schedule with one-tap actions, collapsed completed strip, and a potty bar always available. During a nap the schedule visibly pauses and reflows on wake with a confirmable suggestion. Overdue items get a persistent banner with their fix-action inline.

## Actual Behavior

Route and page do not exist.

## Requirements for completed issue

1. **Route & nav**: lazy-loaded `PetPage` registered in `src/App.tsx` under the `RequireAuth`/`AuthenticatedShell` shell, plus a `TopNav` link (`/pet`). Training/Fixations/Timeline tabs render as placeholders in this issue (built in Issues D and E).
2. **Layout, top to bottom**: header with tabs → profile card → hero status → conditional overdue banner → nap toggle → today's schedule card deck → persistent bottom potty bar.
3. **Profile card**: placeholder avatar (photos are deferred — do not add image storage), editable name and birth date, derived age display (weeks until 6 months, months after — from Issue A's formatting function), and current weight with an append-only weight log entry flow.
4. **Hero status**: countdown ring counting to the next obligation of any kind (amber → red as it approaches) plus a status sentence beneath (e.g. "Whitney's napping — next potty ~3:10, ~75 min free"). Both are pure presentations of Issue A engine state; the ring's color/icon conveys item type. Edge cases (overdue item + upcoming fixed item; nap active → ring pauses) must come from engine state, not UI improvisation.
5. **Overdue banner** (conditional): pinned under the hero — "Potty was due 20 min ago" with an inline [Log potty] action. Multiple overdue items stack. The banner is owned by this issue; the *toast* on overdue-crossing is owned by Issue F.
6. **Nap toggle**: a single 💤 button. While napping it shows elapsed time; ending it opens a slide-in confirmation of the engine's proposed reflow ("Potty pulled up to now. Move playtime to 3:45 and training to 4:30?") with [Confirm] / [Adjust], **default-accept and non-blocking** — one confirm-tap maximum, skippable entirely.
7. **Schedule card deck**: completed items collapse to a slim summary strip ("Done today: 3 potty, 1 training, nap 1:30–2:10"); upcoming items are cards with time, icon, status chip (done at 2:15 / due now), shift indicator ("↺ +40m — nap"), and an inline check button when due. Full-day view available via expand.
8. **Bottom potty bar**: a single persistent [🚽 Potty] button available from anywhere on the page; one tap logs an unscheduled potty and resets the interval.
9. **First-run / empty states**: no birth date or no schedule items → a simple onboarding flow ("When was Whitney born?" → "Add your first schedule items"). The **mid-day start** case must be handled: setting up mid-afternoon leaves the earlier part of the day visibly empty/graceful, never implying the day is blank.
10. **Inline checks and the potty bar call the same single write path** (Issue C's `logActivity` command) — no divergent per-button logic. If Issue C has not landed, wire the actions to it once available; this issue should not invent a second path.
11. **Design principles**: calm structure with playful styling (this page may have personality — but structure/UX stay simple); desktop-first with the phone (PWA) as a usable fallback.
12. Tests: unit tests for page state logic (nap flow, deck collapse, empty states) following the provider-stack test pattern from `src/state/HabitContext.test.tsx`; route/nav covered per existing App routing tests.

## Context

- Files:
  - `src/App.tsx` — lazy route registration (`const PetPage = lazy(...)`, `<Route path="/pet" .../>` under RequireAuth/AuthenticatedShell) and TopNav link pattern.
  - `src/state/HabitContext.tsx` — context/provider + provider-stack test pattern to follow for any pet context usage.
  - `src/components/` — HabitsPage, AnalyticsPage etc. as page-component precedents (named exports resolved to default by the lazy wrapper).
  - Engine types/functions from Issue A (`src/lib/pets/`).
- Code Snippets:

  Route registration pattern (`src/App.tsx`):
  ```tsx
  <Route element={<RequireAuth />}>
      <Route element={<AuthenticatedShell />}>
          <Route path="/habits" element={<HabitsPage />} />
          {/* /pet registers here */}
  ```

## Notes

- Countdown ring ring-counts to next obligation; "free until" in the status sentence is defined by the engine as the next schedule item (fixed or flexible).
- Toast ownership boundary (agreed): when an item crosses overdue while the user is on the page, the toast fires (Issue F); if the user is elsewhere in the app, the banner is already here on return. Do not double-specify this with notifications.
- Photo/avatar deferred to a future issue — bigger plans exist for pet photos; placeholder only.
- No quiet-hours, no streaks, no "here's what you missed" digest (decided).
