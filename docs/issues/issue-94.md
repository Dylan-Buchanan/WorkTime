## Title: GithubIntegrationCard UI (OAuth connect, per-repo controls, stale affordance, preview)

## Tags

Complexity Classification: T2
Severity: Medium
Reason: New card component (~5 files including tests and registry/page wiring): connect flow, per-repo pickers/toggles, stale affordance, preview modal, summaries. UI-state-heavy but bounded; GitHub is already a registry entry.
Needs research before implementation: No — `ShortcutIntegrationCard.tsx` and its test file provide the full behavioral template.

## Summary

Add `GithubIntegrationCard.tsx` to the Integrations page: OAuth connect button, repo list with per-repo project picker, one-label filter, include-closed toggle, and per-repo Sync; stale-repo affordance (editable for tracking but not syncable, or syncs to show "not accessible"); preview modal with per-task project override; per-repo sync summaries. Flip the GitHub registry entry from placeholder to live.

## Steps to Reproduce Context

1. `src/components/IntegrationsPage.tsx` special-cases only the Shortcut card; GitHub renders as a generic placeholder card from `src/lib/integrations/registry.ts` (`isPlaceholder: true`) with a disabled Connect button.
2. Issues 89–93 provide the OAuth flow, enumeration, sync, classification, and data access — but nothing renders them.
3. `ShortcutIntegrationCard.tsx` (492 lines) demonstrates connect, settings editing, sync, preview modal, confirmation through the PM callback, and error copy keyed on typed error codes.

## Expected Behavior

- **Connect**: OAuth connect button starts the authorize redirect (issue 89's flow); after the callback round-trip (issue 95) the card loads settings and shows the connected username.
- **Repo list**: rows per `github_repos` entry showing full_name, with:
  - a per-repo project picker (defaulting to the repo's `project_id`; multiple repos may share one project);
  - a one-label filter picker fed by the enumeration endpoint's per-repo labels (single label, nullable — "no filter" option);
  - an include-closed toggle;
  - a per-repo Sync button and per-repo summary (new/skipped counts from the classification result);
  - a selection toggle (auto-true on connect).
- **Stale repos**: rendered with a stale/not-accessible affordance; the project assignment and filters remain editable for tracking, the row can be removed manually, but Sync is disabled on a stale repo (or, if invoked, surfaces the `GITHUB_REPO_NOT_FOUND` "repo no longer accessible" state rather than a generic failure).
- **Preview modal**: per-repo Sync runs through `classifyGithubIssues` (issue 92) with the repo's `project_id` seeding the default project, overridable per task; confirming creates tasks via the existing `createTask` PM callback; zero-issue/zero-new results show empty-state copy.
- **Error copy**: mapped from `GitHubIntegrationError` codes — token-invalid prompts reconnect, rate-limit shows retry-after, `GITHUB_REPO_NOT_FOUND` shows the not-accessible message.
- **Registry**: `github` entry becomes `isPlaceholder: false` and `IntegrationsPage` renders the card.

## Actual Behavior

GitHub shows only a disabled "Coming soon" placeholder card.

## Requirements for completed issue

1. `src/components/GithubIntegrationCard.tsx` implementing the connect, repo list, per-repo controls, stale affordance, preview modal, and summaries described above, consuming `GitHubDataAccess` (issue 93) and the classification engine (issue 92).
2. Stale repos: editable (project/filters/remove) but not syncable, with clear "repo no longer accessible" messaging; already-imported tasks are unaffected by staleness.
3. Zero-repo and zero-issue empty states handled in the card.
4. Tests in `src/components/GithubIntegrationCard.test.tsx` mirroring `ShortcutIntegrationCard.test.tsx` (load, connect, edit, preview-without-create then confirm, error-code copy, stale-repo affordance).
5. `IntegrationsPage.tsx` renders the card and `registry.ts` flips GitHub to live; `pnpm test:unit` passes.

## Context

- Files:
  - `src/components/ShortcutIntegrationCard.tsx` — the direct template: props (`dataAccess`, `currentTasks`, `projects`, `createTask`), busy-state enum, error-message mapping, `formatLastSynced`, preview/confirm flow.
  - `src/components/ShortcutIntegrationCard.test.tsx` — test harness patterns (e.g. "previews without creating, then confirms through the PM callback", "surfaces invalid-token recovery and rate-limit guidance").
  - `src/components/IntegrationsPage.tsx` — where the Shortcut card is special-cased; GitHub card needs the same wiring.
  - `src/lib/integrations/registry.ts` — GitHub entry to flip live.
- Code Snippets:

```tsx
// src/components/ShortcutIntegrationCard.tsx (error-copy pattern to mirror)
case "SHORTCUT_TOKEN_INVALID":
    return "Your Shortcut token is invalid or has been revoked. Reconnect with a new token.";
case "SHORTCUT_RATE_LIMITED":
    return error.retryAfterSeconds === undefined
        ? "Shortcut's rate limit was reached. Try again later."
        : `Shortcut's rate limit was reached. Try again in ${error.retryAfterSeconds} seconds.`;
```

```ts
// src/lib/integrations/registry.ts (flip to live)
{ id: "github", name: "GitHub", authFlow: "oauth2", isPlaceholder: true }, // → false
```

## Notes

- Keep the card behind the authenticated route shell; public auth pages must not trigger authenticated data reads (repo AGENTS.md).
- The per-repo summary should accumulate results from the per-repo sync the same way `ShortcutIntegrationCard` accumulates its `SyncSummary`.
- Depends on issues 89 (connect flow), 90 (labels/staleness payload), 91+92 (sync + classification), 93 (data access), and coordinates with 95 for the callback round-trip.
