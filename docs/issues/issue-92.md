## Title: Frontend classification engine githubClassification.ts + tests

## Tags

Complexity Classification: T1
Severity: High
Reason: Single pure-TypeScript engine file plus unit tests mirroring `src/lib/engine/shortcutClassification.ts`. No I/O, no cross-module dependencies beyond state types — the lowest-risk issue in the epic.
Needs research before implementation: No — a direct sibling implementation exists.

## Summary

Add a pure TypeScript engine module `githubClassification.ts` (with tests) that converts GitHub issue payloads from the `github-sync` function into WorkTime task proposals: repo name as the tag, empty description, issue URL as the link with URL-normalized deduplication, and state/label-aware skip counts — mirroring `shortcutClassification.ts`.

## Steps to Reproduce Context

1. The Shortcut path has `src/lib/engine/shortcutClassification.ts` with `ShortcutStoryPayload`, `ShortcutTaskProposal`, `classifyShortcutStories` (overload + input-object form), URL normalization for dedup, and skip counts (`new`, `skippedAlreadyAdded`, ...).
2. The GitHub engine does not exist; issue 94's preview modal and issue 93's data access need the payload/proposal contract to build against.
3. `src/lib/engine/` is the pure source of truth: no I/O, network, wall-clock, or random-ID dependencies in command inputs.

## Expected Behavior

- A slim `GithubIssuePayload` type matching what `github-sync` (issue 91) returns (issue number, title, html_url, state, labels, closed flag).
- `buildGithubTaskProposal(issue, projectId)` produces a proposal with:
  - `tags: [repoName]` — the repo name (e.g. `owner/repo` or just the repo segment, per the agreed tag format) from the sync context;
  - `description: ""` — description-free imports by design;
  - `links: [issue.html_url]`;
  - stable status/priority defaults (Backlog/Medium) consistent with the Shortcut path;
  - no `estimatePomos`/`dueDate` unless a GitHub analog is defined (issues have no points/deadline by default).
- `classifyGithubIssues(input)` deduplicates by normalized issue URL against `currentTasks` links (reusing the URL-normalization approach from `normalizeShortcutUrl` — trim, strip query/fragment-suffix handling, trailing-slash removal), and returns counts including new/skippedAlreadyAdded plus state/label-aware skips: closed issues excluded when the repo's `include_closed` is false, and issues not matching the applied label filter when relevant to classification-time accounting.
- Repo-specific default project: the sync context carries the repo's `project_id` as the proposal default, still overridable per task in the preview modal (issue 94).

## Actual Behavior

No GitHub classification engine exists; issue payloads cannot become task proposals.

## Requirements for completed issue

1. `src/lib/engine/githubClassification.ts` with payload, proposal, counts, and result types plus `buildGithubTaskProposal` and `classifyGithubIssues` (both overload and input-object signatures, mirroring the Shortcut engine).
2. URL normalization + dedup semantics equivalent to the Shortcut implementation, applied to GitHub issue URLs.
3. `tags: [repoName]`, `description: ""`, and `links: [html_url]` on every proposal; no engine I/O, wall-clock, or random-ID dependencies.
4. Unit tests in `src/lib/engine/githubClassification.test.ts` covering: proposal shape, dedup (existing link, duplicate within batch), closed-issue skipping with/without `include_closed`, label-aware counting, default project propagation, and zero-issue input.
5. `pnpm test:unit` passes; existing engine tests unaffected.

## Context

- Files:
  - `src/lib/engine/shortcutClassification.ts` — the structural template (types, `buildShortcutTaskProposal`, `normalizeShortcutUrl`, `classifyShortcutStoriesInput`, dual signatures).
  - `src/lib/engine/shortcutClassification.test.ts` — test patterns to mirror.
  - `src/state/types.ts` — `PMTask`, `Project`, `TaskStatus`, `TaskPriority` types consumed by proposals.
- Code Snippets:

```ts
// src/lib/engine/shortcutClassification.ts (shape to mirror)
export function buildShortcutTaskProposal(story, projectId = null): ShortcutTaskProposal {
    return {
        title: story.name,
        projectId,
        status: "Backlog",
        priority: "Medium",
        description: story.description,
        tags: [story.story_type],
        links: [story.app_url],
        checklist: [],
        relatedTo: [],
    };
}
```

## Notes

- Decide and document the exact tag value: `owner/repo` full name vs bare repo name; the issue description says "the repo name as a tag" — pick one and encode it in tests since tags persist forever on imported tasks (staleness must never affect them).
- This issue is independent of issues 88–91 at code level (pure module + tests) but its payload type is the contract for issue 91's response and issue 93/94 consumers.
