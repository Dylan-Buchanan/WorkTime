## Title: github-sync Edge Function + githubApi client (per-repo issue fetch)

## Tags

Complexity Classification: T2
Severity: High
Reason: One new Edge Function plus a testable `githubApi` client implementing per-repo issue fetch, PR filter-out, pagination cap, rate limits, and a mirrored error taxonomy. Contained to the function layer but behavior-critical for sync semantics.
Needs research before implementation: No — mirrors `supabase/functions/shortcut-sync/shortcutApi.ts` and GitHub's documented issues list API.

## Summary

Add a per-repo `github-sync` Edge Function and a `githubApi` client that fetches a single repo's issues honoring `{ includeClosed, labelFilter }`, filters out pull requests, caps pagination, handles rate limits, and maps errors — including `GITHUB_REPO_NOT_FOUND`, which must be distinct from token-invalid so the UI can say "repo no longer accessible" without nuking the token or the repo's project assignment.

## Steps to Reproduce Context

1. After issues 88–90, tokens and repo rows (with `label_filter`, `include_closed`) exist, but there is no way to fetch issues for a repo.
2. The classification engine (issue 92) and UI (issue 94) need a slim issue payload per repo to build task proposals.
3. `shortcut-sync` demonstrates the intended function structure: authenticated caller, service-role settings read, upstream client with typed errors, `last_synced_at` written only on success.

## Expected Behavior

- `githubApi` (mirroring `shortcutApi.ts`): typed request builders for repo issues (`GET /repos/{owner}/{repo}/issues`), query parameters for `state` (open vs open+closed per `include_closed`), `labels` (single label when `label_filter` is set), and per_page/page pagination with a hard page cap.
- PR filter-out: entries with a `pull_request` key are excluded — they are not issues.
- Response mapping is strict (throw `GITHUB_INVALID_RESPONSE` on shape violations) producing a slim payload: issue number, title, html_url, state, labels, closed flag, timestamps needed by the engine.
- Error mapping mirrors the Shortcut taxonomy: `GITHUB_TOKEN_INVALID` (401/403 auth failures), `GITHUB_RATE_LIMITED` (429/403 with `Retry-After`/rate-limit headers and `retry_after_seconds`), `GITHUB_UPSTREAM_ERROR`, `GITHUB_INVALID_RESPONSE`, and `GITHUB_REPO_NOT_FOUND` (404) as a distinct code — never treated as token-invalid, never clearing `project_id`, `label_filter`, or the token.
- The `github-sync` function accepts a repo identifier, verifies the caller owns the `github_repos` row, applies the repo's stored options, and updates `github_settings.last_synced_at` only after a successful fetch (mirroring `shortcut-sync`).

## Actual Behavior

No GitHub sync path exists; issues cannot be imported.

## Requirements for completed issue

1. A `githubApi` client module with typed errors including `GITHUB_REPO_NOT_FOUND` as a code distinct from token-invalid, PR filter-out, strict response validation, pagination cap, and `Retry-After` handling.
2. A `github-sync` Edge Function that syncs exactly one repo per call with `{ includeClosed, labelFilter }` honored from the repo's row, using the shared `githubApi` client.
3. Error responses use the established `{ error, code }` body shape; 404 on the repo maps to `GITHUB_REPO_NOT_FOUND` with a status the UI can distinguish.
4. `last_synced_at` is written only after a successful fetch; failed syncs never clear the token or repo assignments.
5. Unit tests for the client covering PR filtering, label/state query construction, pagination cap, 404 → `GITHUB_REPO_NOT_FOUND`, 401/403 → token-invalid, and rate-limit `retry_after_seconds` parsing (mirroring how `shortcutApi.ts` behavior is specified).

## Context

- Files:
  - `supabase/functions/shortcut-sync/shortcutApi.ts` — the direct template: `Fetcher` injectable for tests, `MAX_PAGES` cap, `ShortcutApiError` with `status`/`code`/`retryAfterSeconds`, strict `isRecord`/`required*` validation.
  - `supabase/functions/shortcut-sync/index.ts` — function skeleton: bearer JWT check, service-role client, settings read, success-only `last_synced_at` update, `{ error, code }` responses.
  - `docs/issues/issue-88.md` — `github_repos` options and `github_settings.last_synced_at`.
  - `docs/issues/issue-90.md` — shared enumeration endpoint that should reuse this client.
- Code Snippets:

```ts
// supabase/functions/shortcut-sync/shortcutApi.ts
export type ShortcutErrorCode = "SHORTCUT_TOKEN_INVALID" | "SHORTCUT_RATE_LIMITED" | "SHORTCUT_UPSTREAM_ERROR" | "SHORTCUT_INVALID_RESPONSE";
export class ShortcutApiError extends Error {
    readonly status: number;
    readonly code: ShortcutErrorCode;
    readonly retryAfterSeconds?: number;
}
```

```ts
// supabase/functions/shortcut-sync/index.ts (success-only sync stamping)
const { error: updateError } = await supabase
    .from("shortcut_settings")
    .update({ last_synced_at: syncedAt })
    .eq("owner_id", userData.user.id);
```

## Notes

- A `GITHUB_REPO_NOT_FOUND` response must not flip `is_stale` by itself — staleness is owned by enumeration (issue 90); sync only reports the not-accessible state so the UI (issue 94) can render "repo no longer accessible" while keeping the row editable.
- Pagination cap: reuse the `MAX_PAGES`-style constant approach; document the chosen cap (e.g. 4 pages × 100).
- Depends on issues 88–89; consumed by issue 92's engine (payload shape contract) and issue 93's data access.
