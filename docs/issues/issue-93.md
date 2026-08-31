## Title: Frontend data access GitHubDataAccess.ts + tests

## Tags

Complexity Classification: T1
Severity: High
Reason: Single data-access module plus tests mirroring `src/lib/data/ShortcutDataAccess.ts`. Well-understood method surface; no schema or cross-system changes of its own.
Needs research before implementation: No — `SupabaseShortcutDataAccess` provides the exact structure, error-mapping, and validation approach.

## Summary

Add `GitHubDataAccess.ts` (interface + `SupabaseGitHubDataAccess` implementation, with tests) mirroring `SupabaseShortcutDataAccess`: load settings, list repos + labels, toggle selection, edit per-repo `project_id`/`label_filter`/`include_closed`, run `sync(repo, options)` against the `github-sync` function, and disconnect.

## Steps to Reproduce Context

1. `src/lib/data/ShortcutDataAccess.ts` defines the established pattern: typed settings/result interfaces, `ShortcutIntegrationError` with code taxonomy, function error-body mapping, row validation.
2. The GitHub UI (issue 94) needs a typed data access to load settings/repos, mutate per-repo options, and invoke sync; none exists.
3. Issues 88–91 define the tables, RPCs, and Edge Functions this module calls.

## Expected Behavior

- Typed surface (names indicative):
  - `loadSettings(): Promise<GithubSettings | null>` — connected username, `lastSyncedAt`, `updatedAt`; never the token.
  - `listRepos(): Promise<{ repos: GithubRepoRow[]; labels: Record<repoFullName, string[]> }>` — via the enumeration endpoint (issue 90), returning staleness flags and per-repo label options.
  - `toggleSelection(repoFullName, selected)` and `updateRepoOptions(repoFullName, { projectId, labelFilter, includeClosed })` — through owner-derived RPCs/table writes from issue 88; stale rows remain editable.
  - `sync(repoFullName, options): Promise<GithubSyncResult>` — invokes `github-sync` with the repo's options, maps function error bodies to typed codes including `GITHUB_REPO_NOT_FOUND` (kept distinct from `GITHUB_TOKEN_INVALID`), `GITHUB_RATE_LIMITED` (with `retryAfterSeconds`), upstream/invalid-response codes.
  - `disconnect(): Promise<void>` — deletes `github_settings` (and by cascade/policy the repo rows), mirroring Shortcut's disconnect.
- Strict response validation (like `isStory`) for sync payloads and repo rows, throwing a typed invalid-response error.
- Error mapping mirrors `mapFunctionError`: parse the function error body `{ error, code, retry_after_seconds }`, fall back to `NETWORK_ERROR`.

## Actual Behavior

No GitHub data access exists; the UI has no way to talk to the GitHub backend.

## Requirements for completed issue

1. `src/lib/data/GitHubDataAccess.ts` with the interface, `SupabaseGitHubDataAccess` implementation, typed error class, and code taxonomy including `GITHUB_REPO_NOT_FOUND` as a distinct code.
2. Methods for settings load, repo+label listing, selection toggle, per-repo option edits, per-repo sync, and disconnect; stale repos are editable through the same paths but sync of a stale repo surfaces the not-accessible error rather than a generic failure.
3. Unit tests in `src/lib/data/GitHubDataAccess.test.ts` mirroring `ShortcutDataAccess.test.ts`: settings load, repo listing shape, option edits, sync success/validation failure, each error-code mapping, disconnect.
4. `pnpm test:unit` passes.

## Context

- Files:
  - `src/lib/data/ShortcutDataAccess.ts` — the template: `ShortcutIntegrationError`, `FUNCTION_ERROR_CODES` set, `mapFunctionError`, `isStory` validation, `sync()` via `client.functions.invoke`.
  - `src/lib/data/ShortcutDataAccess.test.ts` — mock-client test harness to mirror.
  - `docs/issues/issue-88.md` / `issue-90.md` / `issue-91.md` — RPCs, enumeration payload, and sync function this module consumes.
- Code Snippets:

```ts
// src/lib/data/ShortcutDataAccess.ts (patterns to mirror)
export type ShortcutIntegrationErrorCode =
    | "INVALID_SETTINGS" | "SHORTCUT_NOT_CONFIGURED" | "SHORTCUT_TOKEN_INVALID"
    | "SHORTCUT_RATE_LIMITED" | "SHORTCUT_UPSTREAM_ERROR" | "SHORTCUT_INVALID_RESPONSE"
    | "NETWORK_ERROR" | "UNKNOWN_ERROR";

async sync(): Promise<ShortcutSyncResult> {
    const response = await this.client.functions.invoke("shortcut-sync", { method: "POST" });
    if (response.error) throw await mapFunctionError(response.error);
    // ... strict payload validation
}
```

## Notes

- Per-repo sync seeds the preview's default project from the repo's `project_id`; the data access should return the repo's `project_id` in the sync result context so the UI (issue 94) can seed the modal.
- The token must never appear in any returned type — `loadSettings` returns only non-secret fields, exactly as Shortcut does.
- Depends on issues 88 (tables/RPCs), 90 (enumeration), 91 (sync function + payload); consumed by issue 94.
