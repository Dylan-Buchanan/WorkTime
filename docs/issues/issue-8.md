## Title: Integrations screen and extensible integration registry

## Tags

Complexity Classification: T1
Severity: Low
Reason: New additive feature-area scaffold (integrations screen + extensible registry), not a data-model or cross-system change. Blast Radius=2 (only `App.tsx` is an existing file with dependents — one new route + one TopNav link; the new page component, registry module, and tests are additive files with no dependents), Uncertainty=2 (the screen/nav pattern is well-precedented via `HabitsPage`, but the registry schema — entry fields, auth-type slots, connection-state persistence, which placeholder integrations to list — is greenfield design with moderate unknowns about future integration needs), Behavior=2 (registry-driven menu rendering and simple UI logic; no state management, API handlers, auth rules, or data model), Testing=1 (standard Vitest component/registry tests mirroring existing test setup; moderate impact if the nav/route breaks), Reversibility=1 (trivial revert — remove route, nav link, and new files; no data consequences, no schema or RLS changes). Total=8 → T1.
Needs research before implementation: Yes
Research needed: Design the integration registry schema — what fields each entry needs (id/slug, name, description, icon, auth flow type, connection status, "coming soon" placeholder flag) — and decide whether connection state should persist in the per-owner staging store now or be deferred until the first real integration lands. Confirm which placeholder integrations (Google Calendar, Shortcut, GitHub) to list, whether the route should be wrapped in `ErrorBoundary` like `ProjectManagerPage`, and whether any PWA/platform test checks (`pnpm test:pwa`, `test:platform`) are affected by the new route/nav.

## Summary

Create an Integrations screen and an extensible integration registry that future integrations (Google Calendar, Shortcut, GitHub) plug into. This issue only sets the foundations: a new top-level authenticated route/nav entry, a screen that renders integration entries from the registry, and the registry data structure that later integration issues will extend.

## Steps to Reproduce Context

1. A user wants to see and manage third-party integrations (e.g., Google Calendar, Shortcut, GitHub) from a dedicated place in the app.
2. Today no integrations feature exists: there is no integration registry, no connect/disconnect concept, no OAuth helper, and no integration screen anywhere in `src/`.

## Expected Behavior

- A new authenticated screen (e.g., `/integrations`) is reachable from the `TopNav` alongside Timer, Projects, Analytics, and Habits.
- The screen lists integration entries that are driven by an extensible registry, so adding a future integration is a matter of adding an entry rather than building new screen scaffolding.
- Entries that have no implementation yet render as clearly marked placeholders ("coming soon"), while the structure leaves room for future connect/disconnect and connection-state handling.

## Actual Behavior

No integrations code exists today. `src/App.tsx` defines the authenticated routes and `TopNav`, and the closest existing surface is `SettingsPanel` (`src/components/SettingsPanel.tsx`), a side panel for timer settings and the agent API key that contains no integration concept. Full top-level feature screens follow the `src/components/HabitsPage.tsx` pattern.

## Requirements for completed issue

1. Add an Integrations screen as a new authenticated route in `src/App.tsx` with a corresponding `TopNav` link, following the existing page patterns (including `ErrorBoundary` wrapping consistent with other feature routes).
2. Introduce an extensible integration registry (pure TypeScript module) that defines the entries rendered by the screen, where each entry can describe itself (name, description, icon, auth flow type, placeholder flag) so future integrations can be added as registry entries.
3. The screen renders the registry entries, displaying future/placeholder integrations distinctly from any that may later be implemented, with the interaction surface (connect/disconnect) left as a defined slot for later integration issues.
4. Add Vitest coverage for the registry and screen behavior, mirroring the existing component test setup.

## Context

- Files:
  - `src/App.tsx` — authenticated routes (Timer `/`, Projects `/projects`, Analytics `/analytics`, Habits `/habits`) and the `TopNav` that renders the nav `<Link>` items; new route + nav link go here.
  - `src/components/HabitsPage.tsx` — the established full-page feature screen pattern to mirror for the new screen.
  - `src/components/SettingsPanel.tsx` — closest existing "menu" surface (side panel, no integration concept).
  - `src/lib/data/DataAccess.ts` and `src/lib/data/staging/` — the persistence patterns available if connection state is persisted later.
  - `supabase/migrations/20260803000000_habits.sql` — precedent for an owner-scoped, RLS-protected domain table should connection persistence require server storage.
- Code Snippets:

```
// src/App.tsx — where the new route and nav link are added
<Route element={<AuthenticatedShell />}>
    <Route path="/" element={<MainLayout />} />
    <Route path="/projects" element={<ErrorBoundary><ProjectManagerPage /></ErrorBoundary>} />
    <Route path="/analytics" element={<AnalyticsPage />} />
    <Route path="/habits" element={<HabitsPage />} />
</Route>

// src/App.tsx — TopNav nav links
<Link to="/" ...>Timer</Link>
<Link to="/projects" ...>Projects</Link>
<Link to="/analytics" ...>Analytics</Link>
<Link to="/habits" ...>Habits</Link>
```

## Notes

- This is a foundations issue only: no concrete integration, OAuth flow, connection persistence, or data model is in scope. Those belong to later issues that extend the registry established here.
- Keep the new screen and registry pure/additive; do not touch timer/task semantics. Per AGENTS.md, the pure engine code in `src/lib/` must have no I/O, network, wall-clock, or random-ID dependencies in command inputs.
