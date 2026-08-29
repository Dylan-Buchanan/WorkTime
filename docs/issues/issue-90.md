## Title: GitHub repo + label enumeration endpoint (seed repos, labels, staleness)

## Tags

Complexity Classification: T2
Severity: High
Reason: One new Edge Function calling `GET /user/repos`, seeding `github_repos`, returning per-repo labels, and flipping `is_stale`. API-handler behavior with staleness semantics, but contained to a single function plus tests.
Needs research before implementation: No — the GitHub REST endpoints (`GET /user/repos`, per-repo `GET /repos/{owner}/{repo}/labels`) are stable and documented.

## Summary

Add an enumeration endpoint that lists the connected user's accessible repositories via `GET /user/repos`, seeds `github_repos` rows (auto-selected on connect), returns each repo's available labels for the one-label filter picker, and marks stored rows absent from the listing as `is_stale = true` instead of deleting them. Rows for repos that reappear flip back to `is_stale = false` automatically.

## Steps to Reproduce Context

1. After issue 87, a user can connect GitHub, but there is no way to populate `github_repos` or choose per-repo label filters.
2. The UI (issue 92) needs per-repo label lists to power the single-label picker and needs the stale flag to render stale-repo affordances.
3. `github_repos` (issue 86) exists with `selected`, `project_id`, `label_filter`, `include_closed`, and `is_stale` columns but is never written by any code path.

## Expected Behavior

- A new Edge Function (e.g. `github-enumerate-repos`) authenticates the caller (mirroring `shortcut-sync/index.ts`), loads the token from `github_settings` via the service role, and calls `GET /user/repos` with pagination (affiliation/sort choices documented).
- For each returned repo it upserts a `github_repos` row keyed by `(owner_id, full_name)` with `selected = true` when newly seeded, preserving existing per-repo settings (project_id, label_filter, include_closed) and flipping `is_stale` back to `false` for reappearing repos.
- Rows in `github_repos` that are absent from the `GET /user/repos` result are updated to `is_stale = true` — never deleted (enumeration marks, doesn't delete).
- The response includes the repo rows (non-secret fields) plus each repo's available labels (from `GET /repos/{owner}/{repo}/labels`) for the filter picker; per-repo label fetching respects the pagination cap and rate-limit handling from the shared client work in issue 89.
- Error mapping mirrors the `shortcutApi.ts` taxonomy, including `GITHUB_TOKEN_INVALID`, rate-limit with `retry_after_seconds`, and upstream/invalid-response codes.

## Actual Behavior

No endpoint exists; repos can't be listed, seeded, filtered by label, or marked stale.

## Requirements for completed issue

1. An enumeration Edge Function that seeds/updates `github_repos` from `GET /user/repos`, auto-selects new rows, preserves user per-repo settings, and returns per-repo labels for the picker.
2. Staleness semantics: missing repos are flagged `is_stale = true`, reappearing repos are unflagged; no row is ever deleted by enumeration.
3. Error responses follow the established `{ error, code }` shape with a token-invalid code distinct from repo-specific codes.
4. Unit tests for the request/response mapping and staleness flip logic (seeded vs reappearing vs missing rows), mirroring how `shortcutApi.ts` logic is testable.
5. The data access layer (issue 91) can call this endpoint and receive a typed repo+labels payload.

## Context

- Files:
  - `supabase/functions/shortcut-sync/index.ts` — auth, CORS, service-role settings read, and error-body conventions to mirror.
  - `supabase/functions/shortcut-sync/shortcutApi.ts` — fetch/error taxonomy (`SHORTCUT_TOKEN_INVALID`, `SHORTCUT_RATE_LIMITED` with `Retry-After`, `SHORTCUT_UPSTREAM_ERROR`, `SHORTCUT_INVALID_RESPONSE`) and pagination-cap pattern (`MAX_PAGES`).
  - `docs/issues/issue-86.md` — `github_repos` schema with `is_stale`.
  - `docs/issues/issue-89.md` — the shared `githubApi` client this endpoint should reuse for GitHub fetches and error mapping.
- Code Snippets:

```ts
// supabase/functions/shortcut-sync/shortcutApi.ts (error taxonomy to mirror)
export type ShortcutErrorCode = "SHORTCUT_TOKEN_INVALID" | "SHORTCUT_RATE_LIMITED" | "SHORTCUT_UPSTREAM_ERROR" | "SHORTCUT_INVALID_RESPONSE";
if (response.status === 401) throw new ShortcutApiError("Shortcut token is invalid or revoked", 401, "SHORTCUT_TOKEN_INVALID");
if (response.status === 429) throw new ShortcutApiError("Shortcut rate limit reached", 429, "SHORTCUT_RATE_LIMITED", retryAfterSeconds(response));
```

## Notes

- Zero-repo result (fresh GitHub account or no accessible repos) must return a well-defined empty payload the UI can render as an empty state (issue 92).
- Label listing per repo can be N+1 across repos; respect the pagination cap and rate limits — the cap chosen in issue 89 applies here too.
- This issue depends on issues 86 (tables) and 87 (token in `github_settings`); issue 92 consumes its payload.
