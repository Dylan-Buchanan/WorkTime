## Title: GitHub integration (OAuth + per-repo issue import)

## Tags

Complexity Classification: T3
Severity: Medium
Reason: Umbrella epic spanning schema/RLS, two-to-three Edge Functions, pure frontend engine, data access, UI, and Tauri/PWA callback handling (10+ files across systems). Each sub-issue is individually bounded, but the aggregate crosses data model, auth, and native shell boundaries.
Needs research before implementation: Yes — two aggregated unknowns need resolution across sub-issues: (a) whether GitHub OAuth App tokens require refresh handling (GitHub App user tokens expire; classic OAuth App tokens do not — issue 87 must record the decision), and (b) the feasible Tauri OAuth callback mechanism (deep-link vs loopback vs webview-origin redirect) without adding invoke data paths (issue 93).

## Summary

Bring GitHub issues into WorkTime tasks the way Shortcut brings stories — OAuth-based, per-repo, description-free, with lightweight source tracking. Users link GitHub via a custom OAuth App; repos are auto-selected on connect; each repo pulls issues via its own per-repo Sync, applying a server-side one-label filter and placing tasks into the repo's assigned project with the repo name as a tag and the issue URL as the link (no body). Repos that disappear from the API listing are kept visible as stale so users can still track the tasks they imported.

## Steps to Reproduce Context

1. The Integrations page (`src/components/IntegrationsPage.tsx`) renders GitHub from `src/lib/integrations/registry.ts` as a placeholder card (`isPlaceholder: true`, `authFlow: "oauth2"`) with a disabled Connect button.
2. No `github_settings`/`github_repos` tables, no GitHub Edge Functions, and no GitHub frontend data access or classification engine exist; only the Shortcut integration path is implemented end-to-end.
3. There is no OAuth callback handling on either the PWA or Tauri origin.

## Expected Behavior

- Users connect GitHub through a custom OAuth App; the client secret stays server-side and the user token is stored in `github_settings` and is never readable by the browser.
- On connect, the user's repos are enumerated and auto-selected; each repo row carries its own project assignment, single optional label filter, include-closed toggle, and staleness flag.
- Per-repo Sync imports open (and optionally closed) issues into the repo's assigned project: repo name as tag, issue URL as link, empty description; PRs are filtered out; URL dedup prevents re-import.
- Repos that disappear from `GET /user/repos` are marked stale (never deleted), remain editable for tracking, and re-flip automatically if access is re-granted. Already-imported tasks keep their repo tags regardless.
- The flow works on both the browser PWA and the Tauri webview, surviving the OAuth redirect round-trip on both origins via `VITE_PUBLIC_APP_URL`.

## Actual Behavior

GitHub appears only as a "Coming soon" placeholder card; no connection, enumeration, sync, or import path exists.

## Requirements for completed issue

This issue is done when all eight sub-issues are complete:

1. Schema, RLS, and RPCs for `github_settings` + `github_repos` with browser-writable own rows and a never-selectable token (issue 86).
2. OAuth App wiring with a server-side client secret and a token-exchange Edge Function storing token + connected username (issue 87).
3. A repo + label enumeration endpoint that seeds repos, supplies per-repo labels, and flips `is_stale` instead of deleting (issue 88).
4. A per-repo `github-sync` Edge Function with PR filter-out, pagination cap, rate-limit handling, and a `GITHUB_REPO_NOT_FOUND` error code distinct from token-invalid (issue 89).
5. A pure `githubClassification` engine producing description-free proposals with repo tags and URL dedup (issue 90).
6. A frontend `GitHubDataAccess` mirroring `SupabaseShortcutDataAccess` (issue 91).
7. A `GithubIntegrationCard` UI with per-repo controls, stale affordance, and preview modal wired into IntegrationsPage (issue 92).
8. OAuth callback handling that survives the redirect round-trip on both PWA and Tauri origins (issue 93).

## Context

- Files:
  - `src/lib/integrations/registry.ts` — GitHub entry already defined as a placeholder (`id: "github"`, `authFlow: "oauth2"`, `isPlaceholder: true`).
  - `src/components/IntegrationsPage.tsx` — renders cards from the registry; only Shortcut has a real card today.
  - `supabase/migrations/20260812000000_shortcut_settings.sql` — the token-never-readable pattern to mirror.
  - `supabase/functions/shortcut-sync/shortcutApi.ts`, `supabase/functions/shortcut-sync/index.ts` — the Edge Function error taxonomy and sync shape to mirror.
  - `src/lib/data/ShortcutDataAccess.ts`, `src/lib/engine/shortcutClassification.ts`, `src/components/ShortcutIntegrationCard.tsx` — frontend mirrors.
- Code Snippets:

```ts
// src/lib/integrations/registry.ts
{
    id: "github",
    name: "GitHub",
    description: "Connect issues and pull requests to the tasks and projects you manage in WorkTime.",
    icon: "github",
    authFlow: "oauth2",
    isPlaceholder: true,
},
```

## Notes

Final data model decisions:

- `github_settings`: owner_id, token, connected GitHub username, last_synced_at, updated_at. Token never readable by the browser (same as `shortcut_settings`).
- `github_repos`: owner_id, full_name (owner/repo), selected (auto-true on connect), project_id (per-repo; multiple repos may share one project), label_filter (single label, nullable), include_closed (bool), is_stale (bool) + updated_at.

Behavioral consequences of the stale-repo decision:

- Enumeration marks, doesn't delete (issue 88); reappearing repos flip back automatically.
- Sync must distinguish "repo gone" from "token invalid" via `GITHUB_REPO_NOT_FOUND` so the UI says "repo no longer accessible" and does not nuke the token or the assignment (issue 89).
- Stale repos stay editable but not syncable (issue 92).
- Tags persist on already-imported tasks regardless of staleness; staleness only affects the source row.

Other considerations carried into sub-issues: one-label filter (single nullable column, no join table), per-repo sync seeds the preview's default project from the repo's `project_id` (still overridable per task in the modal), PR filter-out, pagination cap, rate limits, zero-repo/zero-issue empty states, and Tauri/PWA callback handling.

Constraints (repo AGENTS.md): no Tauri `invoke` data paths; client secret server-only; browser config may use only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PUBLIC_APP_URL`.
