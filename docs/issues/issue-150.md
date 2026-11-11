## Tags

Complexity Classification: T2
Classification Reason: Single-route UI/navigation refactor confined to the Goals page. Blast radius is `src/components/GoalsPage.tsx` (page shell, tracker card, tracker maintenance), `src/components/GoalsPage.test.tsx` (markup-coupled assertions), and optionally one new rail component; no data model, schema, storage key, or auth change. Behavior is non-trivial client state work (centralized selection reset, effective-tracker derivation, archive auto-selection, rail/drawer/menu open state, scroll-into-view) but every reuse point is already identified.

Severity: Medium
Severity Reason: This is the primary navigation and tracker-switching surface of the Goals page. A regression could strand a user on an archived tracker, break check-in/deck flows, or clip content by introducing a second scroller — but there is no data-loss risk, selection keeps persisting through the existing `goals_state_v1` UI state, and archiving keeps its existing confirmation.

Needs research before implementation: No

## Summary

Tracker switching is currently buried in a `<select>` disguised as the tracker card's title, so the set of trackers a user owns is invisible until the dropdown is opened and switching costs two interactions. Replace that select with a persistent, full-height left rail that lists every tracker and selects one on click, and move all tracker maintenance (new, edit, archive, reactivate, archived filtering, goal-set import/export) out of the card and into the rail so it has a stable home.

The rail should make selection one click, surface per-tracker status at a glance, and match the navigation pattern already used by the timer sidebar and the Projects screen.

## Steps to Reproduce Context

1. Open the Goals page with at least two trackers saved.
2. Observe the tracker card header: the tracker name is rendered as a dropdown (`<select aria-label="Tracker">` in `src/components/GoalsPage.tsx` L263–277), with the archived tag and a `···` menu beside it.
3. Click the name and pick the other tracker — this costs an extra interaction and gives no view of the other trackers' status before opening it.
4. Observe that "Show archived trackers" lives in the page header (L217), "Add tracker" lives in the page header (L218), and Edit tracker / Archive tracker / goal-set import-export live inside the card's `···` panel (L296–318) — i.e. maintenance is inside the thing you are trying to switch away from.

## Requirements for completed issue

1. The Goals page renders a two-column shell under TopNav: a persistent `w-64` rail at `lg` and above (border-r, `bg-neutral-900/30`, independently scrolling via `app-scrollbar`) plus a content column that keeps the Goals title/description, the tracker card, the goal list, and the existing `<main>` scroller with `mx-auto max-w-5xl` preserved.
2. Below `lg` the rail is hidden and a "Trackers" button in the content column opens a drawer with an overlay, `role="dialog"`, `aria-modal`, an accessible name, and a Close control; the drawer closes on overlay click, Escape, and tracker selection, mirroring `pm-projects-drawer`.
3. The rail is a `<nav aria-label="Goal trackers">` of buttons; each row shows the color dot, the truncated tracker name (`title` for the full value), and a status line in the form "3 active · 1 achieved" that excludes dropped goals (matching the card's progress math), plus `TrackerDueBadge` only for a tracker that is due.
4. Archived rows render dimmed with the existing "Archived" tag, and the selected row is highlighted with `aria-current` and scrolled into view on mount and whenever selection changes.
5. Selection goes through `goals.selectTracker(...)` from one centralized handler that also clears `editingGoal`, `pinnedCheckIn`, `deckPreview`, and `trackerActionsOpen` and scrolls the content column back to the top.
6. The in-card `<select aria-label="Tracker">` is removed and the tracker name becomes a plain `<h2>`; the card's `···` panel and its Archive/Edit buttons are removed.
7. The rail header has a compact "New tracker" action, and each row has a `···` menu with Edit tracker, Archive tracker (keeping the existing confirm), and Reactivate tracker for archived rows. Edit opens the existing `TrackerForm` inline at the top of the content column.
8. `GoalSetActions` (import/export goal set) becomes an explicit control in the content column next to the card; an import creates and selects a new tracker, the rail/drawer reflect it immediately, and the drawer closes.
9. A "Show archived (n)" toggle at the bottom of the rail replaces the page-header "Show archived trackers" checkbox, and the page header's "Add tracker" button is removed (the rail's "New tracker" is the only creation affordance when trackers exist).
10. The effective tracker stays selected-if-visible ?? first-visible; the rail highlights the effective tracker and never a stale archived selection. Archiving the selected tracker auto-selects the next active tracker, or clears selection when none remain.
11. The rail renders whenever any tracker exists; with zero trackers it is hidden and the existing "Start your first tracker" panel goes full width.
12. The card's internal `lg:grid-cols-[minmax(0,1fr)_19rem]` split moves to `xl:` so it is not squeezed between 1024 and 1279px.
13. `<main>` remains the only content scroller: no second nested scroller is introduced around the card and `CheckInWizard` stays mounted inside `<main>`.
14. `data-goals-slot` values stay unique — per-row due badges use a distinct slot (e.g. `tracker-rail`) rather than reusing `tracker-due`.
15. `GoalsPage.test.tsx` is updated for the removed `combobox` "Tracker" and the changed "Add tracker" button counts, and covers the rail, the drawer path, and archived filtering.

## Expected Behavior

- Every tracker the user owns is visible at a glance in the rail, with its active/achieved counts and a due badge when that tracker's deck is due.
- One click on a rail row switches the content column, clears any pinned check-in / deck preview / open editor, and shows the newly selected card from the top.
- Tracker maintenance (new, edit, archive, reactivate, archived toggle, goal-set import/export) is reachable from the rail or the content column, never from inside the card's title.
- On narrow widths, the "Trackers" button opens a drawer that behaves like the Projects drawer and closes on overlay click, Escape, or selection.
- Archived trackers never become the highlighted row when they are hidden; if the selected tracker disappears, the first visible tracker is shown without writing a new selection.
- With zero trackers, no rail is rendered and the start panel fills the width with a single "Add tracker" affordance.

## Actual Behavior

- Tracker switching is a `<select>` styled as the card title (`GoalsPage.tsx` L263–277); the tracker set and per-tracker status are invisible until the dropdown is opened.
- Tracker maintenance, archived filtering, and creation are split between the page header (L217–218) and the card's `···` panel (L296–318).
- No rail exists, so there is no persistent tracker navigation and no per-tracker status summary outside the selected tracker's card.

### Testing

- `pnpm test:unit` — update the existing `GoalsPage.test.tsx` assertions that depend on the removed select (`getByRole("combobox", { name: "Tracker" })` at L145, 208, 531, 544, 740, 742, 810, 817, 978, 1020), the "Add tracker" counts (L123, L155), the "Show archived trackers" checkbox (L186, 543, 816), and the "Tracker actions" menu (L162, 179, 183, 960, 975, 979, 1007).
- Assert the slot loop at `GoalsPage.test.tsx` L203 (single element per `data-goals-slot`) still passes with the new rail due-badge slot.
- New coverage: rail renders one row per tracker with name, color dot, and status counts; clicking a row switches the card; archived rows are dimmed and tagged; the due badge appears only on due trackers; the "Show archived (n)" toggle filters; Edit/Archive/Reactivate from a row work; archiving the selected tracker auto-selects the next active one; zero trackers hides the rail.
- Drawer coverage: with the `lg` media query stubbed false, the "Trackers" button opens a `role="dialog"` drawer that closes on overlay click, Escape, and selection. Note that jsdom's `matchMedia` stub makes `isLg` false by default, so both branches need explicit stubbing via `src/hooks/useMediaQuery.ts`.
- Manual check in the Tauri webview or a narrow desktop window that the drawer path works without touch input.

## Issue Context

### New Files

Optional but recommended: `src/components/goals/TrackerRail.tsx` to hold the rail markup (`<nav aria-label="Goal trackers">`, rows, header "New tracker" action, "Show archived (n)" toggle, per-row `···` menu). Suggested props:

```tsx
export interface TrackerRailProps {
    trackers: readonly GoalTracker[]; // effective display order
    selectedId: string | null; // effective tracker, never a stale archived id
    showArchived: boolean;
    archivedCount: number;
    onSelect: (id: string) => void; // centralized selection reset
    onNew: () => void;
    onEdit: (tracker: GoalTracker) => void;
    onArchive: (tracker: GoalTracker) => void; // keeps the existing window.confirm
    onReactivate: (tracker: GoalTracker) => void;
    onToggleArchived: (show: boolean) => void;
}
```

### Remove Files

None.

### Change Files

#### Goals page shell

Code Source: `src/components/GoalsPage.tsx` L209–223
Code Description: The page is a single column — `header` (title, description, archived checkbox, Add tracker) then `<main className="min-h-0 flex-1 overflow-auto p-4">` wrapping `<div className="mx-auto max-w-5xl space-y-4">`.
Code Change Description: Introduce the two-column shell (rail + content column) under the existing `<main>`/`max-w-5xl` content wrapper, keeping `<main>` as the only content scroller. Add the `<lg` "Trackers" button and drawer. Remove the archived checkbox and Add tracker from the header.

```tsx
<header className="border-b border-neutral-800 px-4 py-4 sm:px-6"> ... </header>
<main className="min-h-0 flex-1 overflow-auto p-4">
    <div className="mx-auto max-w-5xl space-y-4"> ... </div>
</main>
```

#### Tracker list and effective selection

Code Source: `src/components/GoalsPage.tsx` L38, L94–96
Code Description:

```tsx
const ordered = <T extends { sortOrder: number; id: string }>(rows: T[]) => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
const trackers = ordered(Object.values(state.trackers)).filter((row) => showArchived || !row.isArchived);
const hasTrackers = Object.keys(state.trackers).length > 0;
const tracker = trackers.find((row) => row.id === state.ui.selectedTrackerId) ?? trackers[0];
```

Code Change Description: Keep the selected-if-visible ?? first-visible derivation for the content column, but derive an explicit rail list from all trackers so the rail can render active and archived rows (dimmed) and highlight the effective tracker. Do not write a new `selectedTrackerId` during fallback.

#### Selection handler

Code Source: `src/components/GoalsPage.tsx` L263–277
Code Description: The select handler already performs the reset that must survive the refactor.

```tsx
onChange={event => {
    goals.selectTracker(event.target.value);
    setEditingGoal(null);
    setPinnedCheckIn(null);
    setDeckPreview(null);
    setTrackerActionsOpen(false);
}}
```

Code Change Description: Move this into one `selectTracker(id)` handler shared by rail rows, drawer rows, and `GoalSetActions.onImported`; add a content-column scroll-to-top so the newly selected card is fully visible. Remove the `<select>` and the `▾` glyph; render the tracker name as a plain `<h2>` (replacing the `sr-only` h2 at L261).

#### Card maintenance removal

Code Source: `src/components/GoalsPage.tsx` L284–318
Code Description: Archived → "Reactivate tracker" button; otherwise the `···` "Tracker actions" button with `aria-controls="tracker-actions-panel"` opening a panel containing Edit tracker, Archive tracker (`window.confirm(\`Archive “${tracker.name}”? Its goals and history will be kept.\`)`), and `data-goals-slot="goal-set-actions"`around`<GoalSetActions key={tracker.id} trackerId={tracker.id} onImported={...} />`.
Code Change Description: Delete the panel and both buttons. Move Edit/Archive/Reactivate into the rail rows and mount `GoalSetActions`as an explicit control in the content column next to the card.`GoalSetActionsProps` (`src/components/goals/GoalSetActions.tsx`L18–21) is`{ trackerId: string; onImported: (newTrackerId: string) => void }`and its`onImported` must go through the shared selection handler and close the drawer.

#### Due badge slot

Code Source: `src/components/GoalsPage.tsx` L324–326
Code Description: `<div data-goals-slot="tracker-due" data-tracker-id={tracker.id}><TrackerDueBadge due={dueTracker !== null} periodLabel={...} /></div>`
Code Change Description: Keep the card's `tracker-due` slot as the single card instance and give rail rows a distinct slot (e.g. `data-goals-slot="tracker-rail"`) so the single-element slot assertions in `GoalsPage.test.tsx` L203 and the `querySelector('[data-goals-slot="tracker-due"]')` lookups at L206, 527, 542, 553 keep working.

#### Empty states

Code Source: `src/components/GoalsPage.tsx` L237–247
Code Description: A single section that renders either "No active trackers" or "Start your first tracker" with copy and one `primaryLarge` "Add tracker" button.
Code Change Description: Keep both panels; "No active trackers" renders inside the content column while the rail is still shown; "Start your first tracker" renders full width with the rail hidden.

#### Drawer precedent

Code Source: `src/components/ProjectManager/ProjectManagerPage.tsx` L102–112, L203–218
Code Description: Trigger button uses `aria-expanded` / `aria-controls="pm-projects-drawer"`; the drawer is `<div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Projects">` with a `bg-black/60` overlay whose `onClick` closes, and a `#pm-projects-drawer` panel (`w-80 max-w-[85vw]`, `inset-y-0 left-0`, `bg-neutral-950 shadow-2xl`) with a Close button. Responsiveness comes from `useMediaQuery` (`src/hooks/useMediaQuery.ts`), `isLg = "(min-width: 1024px)"`.
Code Change Description: Mirror this structure for the Goals tracker drawer and use the same `useMediaQuery` hook so the rail/drawer branch is CSS-independent and testable.

#### Existing state used, not extended

Code Source: `src/state/GoalContext.tsx` L11–15, L296
Code Description: `GoalUIState` is `{ selectedTrackerId: string | null; expandedGoalIds: Record<string, boolean> }`, persisted to `GOAL_UI_STORAGE_KEY = "goals_state_v1"`; `selectTracker: id => mutate(previous => ({ ...previous, ui: { ...previous.ui, selectedTrackerId: id } }))`.
Code Change Description: None — reuse `selectedTrackerId` and `selectTracker` exactly; do not add a second selection source or a schema/storage change.

### Files Using

`src/App.tsx` (lazy route `/goals`, TopNav link at L215), `src/state/GoalContext.tsx`, `src/components/GoalsPage.test.tsx`.

## Notes

- This is Issue 1 of 2. Issue 2 ("Reorder active goal trackers from the rail") adds `reorderTrackers` to the goals context and drag handles over active rail rows, and assumes this issue is merged.
- Explicitly out of scope for this issue: dragging/reordering trackers, any `sortOrder` write path, and any persistence or schema change.
- The inline `CheckInWizard` is mounted inside `<main>` deliberately (`GoalsPage.tsx` L407–417) so later goals are not clipped; do not move it or wrap the card in a nested scroller.
