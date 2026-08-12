## Title: UI: Shortcut connect, settings, and sync flow on the Integrations page

## Tags

Complexity Classification: T2
Severity: Low
Reason: Replaces the placeholder Shortcut card with a full connection + sync flow spanning components, state wiring, data access, routing, and tests — top edge of T2. Blast Radius=3 (IntegrationsPage, registry `isPlaceholder` flag, App.tsx mount/wiring, new card/preview-modal components, new context or hooks, data-access additions, updated + new tests), Uncertainty=2 (flow and decisions locked, but the `shortcut-sync` and classification module contracts come from parallel issues, and settings-storage reuse of `public.settings` vs a new table is unknown), Behavior=3 (complex UI state: in-flight sync, multi-state modal workflow, error handling, createTask integration), Testing=2 (async connect/sync flows and modals are hard to test; existing tests assert all cards are "Coming soon" and must change), Reversibility=1 (pure UI revert, task creation is user-confirmed). Total=11 → T2.
Needs research before implementation: Yes
Research needed: (1) The exact request/response contract of the `shortcut-sync` Edge Function and the classification module (proposal shape, result counts, error codes for invalid/revoked token, network failure, and 429) since these are defined in the parallel backend/frontend issues; (2) whether the per-owner settings row (token, team, excluded statuses) reuses the existing `public.settings` table or requires a new table/migration with matching RLS; (3) where the new context/hook should mount relative to the authenticated route shell per AGENTS.md.

## Summary

Replace the placeholder Shortcut card on the Integrations page with a connect/disconnect, settings (team + excluded statuses), and a manual preview-then-confirm sync flow that creates PMTasks through the existing project manager pipeline.

## Steps to Reproduce Context

1. User opens `/integrations` and connects a Shortcut API token to the Shortcut card.
2. User selects a team and edits the excluded status list (defaults: "Defining Requirements", "Ready for Review", "Done").
3. User clicks "Sync now"; a preview modal lists the proposed new tasks; user confirms.
4. Tasks are created via the existing PMTask creation path and a result summary is shown.

## Expected Behavior

- The Shortcut card shows a connected state with disconnect, a team selector, an editable excluded-status list, and a "Sync now" button with an in-flight/disabled state.
- Sync fetches stories via the Edge Function, classifies them, and shows a preview of proposed new tasks before creating anything.
- Confirmation creates PMTasks through the existing `usePM().createTask` pipeline; results are summarized (created / skipped already-added / skipped status-excluded) with a last-synced indicator.
- Invalid/revoked token (prompt to reconnect), network failure, and rate-limit (429) errors are surfaced clearly.

## Actual Behavior

The Shortcut card shows "Coming soon" with a disabled Connect button. `IntegrationsPage` is mounted at `/integrations` in `src/App.tsx` with no props, and the shortcut entry in `src/lib/integrations/registry.ts` has `isPlaceholder: true` and `authFlow: "api-token"`.

## Requirements for completed issue

1. The Shortcut card supports connect/disconnect of an API token and persists the per-owner settings (token, team, excluded statuses) through the existing Supabase data access layer.
2. A manual "Sync now" flow fetches stories, shows a preview of proposed tasks, and creates them only after user confirmation via the existing PMTask creation path.
3. Results are summarized (created / skipped already-added / skipped status-excluded) and a last-synced indicator is shown.
4. Invalid/revoked token, network failure, and rate-limit errors are surfaced clearly with appropriate recovery actions.
5. Existing IntegrationsPage tests are updated and new coverage is added for the connect, sync, and preview flows.

## Context

- Files:
  - `src/components/IntegrationsPage.tsx` — card grid; `renderActions` optional prop; placeholder cards render "Coming soon" + disabled Connect.
  - `src/lib/integrations/registry.ts` — `shortcut` entry: `{ id: "shortcut", name: "Shortcut", authFlow: "api-token", isPlaceholder: true, icon: "shortcut" }`.
  - `src/App.tsx` — `<Route path="/integrations" element={<ErrorBoundary><IntegrationsPage /></ErrorBoundary>} />`.
  - `src/components/IntegrationsPage.test.tsx` — existing tests assert the placeholder cards.
  - `src/state/ProjectManagerContext.tsx` — `usePM().createTask(title, opts)` public creation path persisting through the staging/Supabase pipeline.
  - `src/lib/data/` — `DataAccess.ts`, `SupabaseDataAccess.ts` for RLS-backed per-owner reads/writes.
- Code Snippets:

```ts
// src/lib/integrations/registry.ts
{
    id: "shortcut",
    name: "Shortcut",
    icon: "shortcut",
    authFlow: "api-token",
    isPlaceholder: true,
}
```

```tsx
// src/App.tsx
<Route path="/integrations" element={<ErrorBoundary><IntegrationsPage /></ErrorBoundary>} />
```

## Notes

- AGENTS.md: public auth pages must not trigger authenticated data reads; `DataProvider`, `AppStateProvider`, `ProjectManagerProvider`, and `StateSyncBridge` stay behind the authenticated route shell — any new integration context must mount accordingly.
- Depends on the backend `shortcut-sync` function and the frontend classification module (parallel issues); their payload/error contracts must be agreed before the sync wiring is finalized.
