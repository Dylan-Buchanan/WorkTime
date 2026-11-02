# Title: Reset confirmation dialog is confined to the sidebar by the aside's backdrop-blur containing block

## Tags

Complexity Classification: T2
Classification Reason: The root cause is a single CSS interaction — `backdrop-blur-sm` on the desktop `<aside>` (`src/App.tsx` L239) sets `backdrop-filter`, which makes the aside the containing block for `position: fixed` descendants, so the reset overlay in `src/components/SettingsPanel.tsx` L226–290 resolves `inset-0` against the 288px sidebar instead of the viewport. The corrected outcome is small, but the decided scope adds an audit of every `fixed` overlay mount in the app (App.tsx L260, TimerPanel.tsx L651, ProjectManagerPage.tsx L204/L220, GoalsPage.tsx L289 → DeckPreview.tsx L786, the three integration preview cards, PetTrainingTagDialog.tsx, TauriCloseContext.tsx L215, plus `SyncControls.tsx` L69 as the existing portal precedent) and a new real-layout Playwright geometry assertion. jsdom runs no layout, so the existing unit test cannot guard it.

Severity: Medium
Severity Reason: The overlay and dialog render at the wrong size and position during a destructive confirmation ("delete all timer tasks, logs, settings and timer state"), and the rest of the app stays undimmed and interactive behind it. The 288px-wide dialog sits inside a 264px content box (aside `w-72` minus `p-3`), so the confirm input and buttons can clip or force a nested scrollbar. Typing `yes`, Cancel, and Delete Data still work, so destructive data is not put at risk — this is a rendering and trust defect, not a data-integrity bug.

Needs research before implementation: No

## Summary

On desktop, `SettingsPanel` is rendered inside the `MainLayout` sidebar (`src/App.tsx` L239), which carries `backdrop-blur-sm`. A `backdrop-filter` value other than `none` establishes a containing block for all `position: fixed` descendants, so the Reset confirmation overlay (`src/components/SettingsPanel.tsx` L227 `<div className="fixed inset-0 z-40 …">`) is clamped to the aside box rather than the viewport: the dimming scrim only covers the sidebar and the dialog is centred inside the 288px column.

The mobile path is unaffected because there `SettingsPanel` is rendered inside the panel drawer (`src/App.tsx` L259–276), whose wrappers use `absolute`, not `backdrop-filter`. Unit tests (`src/components/SettingsPanel.test.tsx` L124–206) click straight through the dialog and pass because jsdom performs no layout.

The same class of defect can appear anywhere a `fixed` overlay is mounted beneath a `transform`, `filter`, `backdrop-filter`, `contain`, or `will-change` ancestor — for example, a goal card carries a dnd transform (`src/components/GoalsPage.tsx` L373–374) and `AgentPanel` is itself `fixed` + `backdrop-blur` (`src/components/ProjectManager/AgentPanel.tsx` L582). Today only the reset dialog is actually at risk, but nothing prevents a future mount from regressing silently.

## Steps to Reproduce Context

1. Open the app at a desktop viewport (≥1024px so `MainLayout` takes the `isDesktop` branch, `src/App.tsx` L236–243).
2. In the sidebar, scroll to the bottom of `SettingsPanel` and press **Reset All Data** (`src/components/SettingsPanel.tsx` L215–225), which sets `showReset`.
3. Observe the confirmation overlay. It renders inside the sidebar: the `bg-black/70` scrim ends at the aside's borders instead of covering the page, and the dialog is centred in the 288px column.

## Expected Behavior

- The Reset confirmation scrim covers the whole viewport and the dialog is centred on the viewport, matching how the same panel behaves at mobile widths.
- The dialog is never clipped by, or forced to scroll inside, the sidebar column.
- The behaviour holds at every viewport where the reset dialog can be opened, in both the desktop aside mount and the mobile drawer mount.
- Non-fixed layout (sidebar blur, panel scroll, dialog styling) is otherwise unchanged.

## Actual Behavior

- `fixed inset-0` on the overlay (`src/components/SettingsPanel.tsx` L227) and on the scrim (L228) resolve against the aside (`src/App.tsx` L239) because of its `backdrop-blur-sm`, so both are sized to the sidebar.
- The dialog wrapper (L229) is `w-72` (288px) inside a 264px content box, so it overflows the aside's padding and can clip or introduce horizontal scroll inside the `app-scrollbar` aside.
- No automated test detects this: `src/components/SettingsPanel.test.tsx` asserts the reset call and staged-data behaviour, and jsdom has no layout.

## Requirements for completed issue

1. Opening the Reset confirmation from the desktop sidebar dims the full viewport and centres the dialog on the viewport, with no clipping by the sidebar column.
2. The reset dialog behaves correctly at both the desktop aside mount and the mobile drawer mount of `SettingsPanel`, including across the 1024px breakpoint.
3. Every `fixed` overlay mount in the app is audited for a `transform` / `filter` / `backdrop-filter` / `contain` / `will-change` ancestor; any overlay found at risk is corrected so it is sized to the viewport, and any that is already correct is recorded in the issue/PR notes with its reasoning.
4. The sidebar's blur styling, the Reset All Data → Confirm Data Reset flow, and the scoped reset semantics described in the dialog are unchanged.
5. The existing jsdom suite (`pnpm test:unit`, including `src/components/SettingsPanel.test.tsx`) still passes.
6. A Playwright test asserts the dialog's viewport geometry in a real browser, so this class of regression cannot silently return.

### Testing

1. `pnpm test:unit` — the reset-scope test in `src/components/SettingsPanel.test.tsx` L124 must still pass unchanged in intent (one reset call, PM slice untouched).
2. New Playwright coverage (see Testing Instructions) run via `pnpm test:e2e` with the local Supabase stack, asserting the reset overlay's bounding box matches the viewport at a desktop viewport and that the dialog is centred within the viewport rather than the aside.
3. Manual check at a desktop width: open **Reset All Data** and confirm the entire page dims, the dialog is centred, and no horizontal scrollbar appears inside the sidebar.
4. Manual check at a mobile width (for example 375×700): open **Tasks & Settings** → **Reset All Data** and confirm the same viewport-covering behaviour, so the desktop correction does not break the drawer path.
5. Resize across 1024px with the dialog open, and close/reopen it, to confirm no stale positioning.

## Context

### Affected component — reset overlay

Code Source: `src/components/SettingsPanel.tsx` L215–290
Code Description: The Reset All Data trigger and the confirmation overlay, both rendered inline in the panel's own DOM tree.

```tsx
<button …onClick={() => { play("pressSide"); setShowReset(true); }} …>Reset All Data</button>
{showReset && (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-700 bg-neutral-900/95 p-4 shadow-xl space-y-3 text-[11px]">
            <h4 className="text-neutral-200 font-semibold text-xs">Confirm Data Reset</h4>
            …
        </div>
    </div>
)}
```

### Containing-block source

Code Source: `src/App.tsx` L236–243
Code Description: Desktop `MainLayout`; `backdrop-blur-sm` on the aside makes it the containing block for fixed descendants. `SettingsPanel` is rendered inside it.

```tsx
if (isDesktop) {
    return (
        <div className="flex h-full">
            <aside className="app-scrollbar w-72 border-r border-neutral-800 p-3 flex flex-col gap-6 overflow-y-auto bg-neutral-900/30 backdrop-blur-sm"><TaskPanel /><SettingsPanel /></aside>
            <main className="flex-1 flex min-w-0 min-h-0 overflow-y-auto"><TimerPanel /></main>
        </div>
    );
}
```

### Unaffected mobile mount (same panel)

Code Source: `src/App.tsx` L259–276
Code Description: On mobile, `SettingsPanel` is rendered inside the side-panel drawer, whose wrappers use `absolute`/`fixed` without `backdrop-filter`, so the reset overlay already resolves against the viewport.

```tsx
<div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Tasks and settings">
    <div className="absolute inset-0 bg-black/60" onClick={() => setPanelOpen(false)} />
    <div id="timer-side-panel-drawer" className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] …">
        …
        <div className="app-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto p-3"><TaskPanel /><SettingsPanel /></div>
```

### Existing precedent for escaping the ancestor

Code Source: `src/components/SyncControls.tsx` L69–76
Code Description: The delete-staged-changes confirm dialog is already portalled out of the blurred topbar (`src/App.tsx` L210 has `backdrop-blur` and hosts `<SyncControls />` at L222), and it names itself with `role="dialog"` / `aria-modal` / `aria-labelledby`.

```tsx
{showDeleteConfirm && createPortal(
    <div className="fixed inset-0 z-50 bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-changes-title">
        <div className="absolute left-1/2 top-1/3 w-80 …">…</div>
    </div>, …)}
```

### Audit inventory of `fixed` overlays (verified mount points)

| Overlay | Mount chain | Containing-block risk today |
| --- | --- | --- |
| `SettingsPanel.tsx` L227–228 (reset) | inside desktop `<aside>` L239 | **At risk** — `backdrop-blur-sm` |
| `SyncControls.tsx` L71 | portalled | None (portalled) |
| `App.tsx` L260 (mobile tasks/settings drawer) | `MainLayout` root, no blur | None |
| `TimerPanel.tsx` L651 (mobile panel backdrop) | inside `<main>` L240, no blur | None |
| `ProjectManagerPage.tsx` L204, L220 (drawers) | PM page root, no blur | None |
| `DeckPreview.tsx` L786 (deck reader) | `GoalsPage.tsx` L289 page root; sortable transform lives on goal `<article>` L373–374, not an ancestor | None |
| `GithubIntegrationCard.tsx` L725, `LinearIntegrationCard.tsx` L477, `ShortcutIntegrationCard.tsx` L398 (preview dialogs) | inside `IntegrationsPage.tsx` `<main>` L49; the blurred header L44 is a sibling | None |
| `PetTrainingTagDialog.tsx` L33 | `PetTodayTab.tsx` L264, sibling of the blurred `PetPottyBar` L14 | None |
| `TauriCloseContext.tsx` L215 (unsaved-changes) | rendered next to `children` under `BrowserRouter`/`AuthProvider` (`App.tsx` L78, L100–104) | None |
| `TimerPanel.tsx` L658 (panel container itself) | `backdrop-blur` on the fixed element itself — blurs content inside it, not itself | None (re-verify) |
| `AgentPanel.tsx` L582 | page-level `fixed` + `backdrop-blur` panel; no fixed children today | None — watch if children are added |

### Testing instructions — existing harness

Code Source: `e2e/helpers.ts` L29 and `e2e/responsive.spec.ts` L1–30
Code Description: `openApp(browser, seed?, pmSeed?, { viewport })` creates an authenticated local-Supabase user per test; `responsive.spec.ts` already uses `page.evaluate` and bounding boxes to assert geometry with an explicit viewport, and `playwright.config.ts` runs a desktop Chromium project. A new spec (or an extension of `responsive.spec.ts`) can open `/`, expand the settings section, press **Reset All Data**, and compare the overlay's bounding box against `page.viewportSize()`.

### Related test that must keep passing

Code Source: `src/components/SettingsPanel.test.tsx` L124–206
Code Description: Asserts a single `resetAppState` call, that the PM slice is untouched, and that the dialog describes the scoped deletion. jsdom has no layout, so this test documents behaviour but cannot catch the positioning defect.

## Notes

- This is a pre-existing bug unrelated to the goals/deck work; it was noticed during a visual pass.
- The reset dialog currently has no `role="dialog"`, `aria-modal`, or accessible name, unlike `SyncControls` L69–76 and the drawer overlays in `App.tsx` L260 / `ProjectManagerPage.tsx` L204. Any E2E test that targets it by role will need this addressed; treat as an optional adjacent improvement, not a requirement of this issue.
- Repo layout constraints to preserve: keep `DataProvider`/`AppStateProvider`/`ProjectManagerProvider`/`StateSyncBridge` placement unchanged; this change must not touch timer/task semantics or the staging store.
