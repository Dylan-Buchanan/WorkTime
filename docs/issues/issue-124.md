# Title: Spike — verify Linear GraphQL access and query shape

## Tags

Complexity Classification: T1
Classification Reason: The deliverable is a single new research document plus out-of-band manual verification against a live Linear workspace. No source, schema, or runtime behavior changes. The unknowns are explicitly enumerated but genuinely empirical, and the findings constrain the two follow-up issues without anything depending on them at runtime.

Severity: Medium
Severity Reason: Nothing shipped here can break the app, and the no-secrets policy is trivially satisfiable. The risk is entirely downstream: a superficial spike lets the follow-up Edge Function ship a name-based status filter that matches nothing and reports "0 new" while looking like a healthy sync.

Needs research before implementation: No

This issue *is* the research phase for the Linear feature. The remaining unknowns are empirical facts about Linear's API that cannot be answered by reading this codebase.

## Summary

WorkTime needs a Linear integration that imports the issues assigned to the connected user, mirroring the existing Shortcut integration. The method for reaching Linear's data is currently unknown, and every remaining decision in the feature (auth header form, query shape, pagination, page size, status names) is empirical rather than architectural.

This is a time-boxed investigation that produces findings, not production code. It confirms against a real workspace which Linear API access path works, what the query must look like, and what a real workspace actually returns.

Parent request: #122.

## Steps to Reproduce Context

1. Open the Integrations page — there is no Linear entry in the registry or any Linear card.
2. Search the repository for Linear code — there is none; `supabase/functions/` contains only `shortcut-sync`, `github-*`, `google-calendar*`, and `invite-signup`.
3. Attempt to reuse the Shortcut fetcher (`supabase/functions/shortcut-sync/shortcutApi.ts`) against Linear — its `Shortcut-Token` header and `next`-URL pagination have no Linear equivalent.
4. Observe that no query string, state-name list, or sync approach exists to build the backend from.

## Expected Behavior

A short, reviewable set of findings that the backend and frontend issues can be implemented against without rediscovering the answers through failed syncs:

- A confirmed way to authenticate a Linear personal API key (Settings → Security & access) using the raw `Authorization: <API_KEY>` header, and a note that Linear's OAuth flow uses `Bearer <token>` so the Shortcut-style fetcher cannot be copied header-for-header.
- A confirmed query that resolves `viewer { id }` and then returns the issues assigned to that viewer, verified to match the set the Linear UI shows as "assigned to me."
- A confirmed answer on whether the optional team filter applies server-side via a team key (e.g. `ENG`), and whether an unknown key returns an empty set or an error.
- A confirmed maximum practical `first:` page size that stays under Linear's 10,000-point single-query complexity ceiling for the selected field set.
- The distinct workflow state names across the target teams, which are the raw material for the name-based status filter.
- Confirmation that `dueDate` returns a shape `normalizeTaskDueDate` accepts.

## Actual Behavior

- No Linear code, query string, or state-name list exists anywhere in the repository.
- The auth header form, pagination model, page size, and error semantics are all unknown.
- The team-filter behavior is unknown, so it cannot be stated whether an unknown team key is distinguishable from a legitimately empty result.
- The `dueDate` shape is unverified against `normalizeTaskDueDate`, which only accepts a leading `YYYY-MM-DD` validated as a real UTC calendar date.

## Requirements for completed issue

1. A findings document exists at `docs/research/linear-spike-findings.md` recording the answers to every open question below.
2. The confirmed GraphQL query string is recorded verbatim, ready for reuse in the Edge Function, including the exact header form that authenticated it.
3. The document records a state-name-per-team list from a real workspace.
4. The document records the practical `first:` page size and the reasoning that keeps the query under the 10,000-point complexity ceiling for the selected fields.
5. The document records whether the team filter is applied server-side, and whether an unknown team key produces an empty set or an error.
6. The document records whether `dueDate` satisfies `normalizeTaskDueDate`, with a sample value.
7. No API key appears in any committed file, log output, screenshot, or `VITE_` variable.

### Testing

This issue has no automated test; the verification is manual against a real workspace. Completion means each claim in the findings document was observed directly rather than inferred from Linear's documentation:

- Confirm the assigned-to-me query result set matches the Linear UI's "assigned to me" set for the same viewer.
- Confirm the team filter behavior with a known-good key and with a deliberately unknown key.
- Confirm the response shape for a workspace with no assigned issues.
- Confirm the `errors` array is inspected separately from `response.ok` on at least one failing or partial query.
- Re-read the committed document and repository diff to confirm no key material was committed.

## Context

### Access form and pagination are not portable from Shortcut

Code Source: `supabase/functions/shortcut-sync/shortcutApi.ts`
Code Description: The Shortcut client sends a custom `Shortcut-Token` header and follows a full `next` URL. Linear instead expects the raw API key in `Authorization` and uses Relay cursor pagination (`pageInfo.hasNextPage` / `endCursor`), so neither the header nor the cursor guard can be reused unchanged.

```ts
response = await fetcher(url, { method: "GET", headers: { Accept: "application/json", "Shortcut-Token": token } });
```

```ts
function nextSearchUrl(next: unknown, visited: Set<string>): URL | null {
    if (next === null || next === undefined || next === "") return null;
    if (typeof next !== "string") throw invalidResponse("Shortcut returned an invalid pagination cursor");
    const url = new URL(next, SHORTCUT_API_ORIGIN);
    if (url.origin !== SHORTCUT_API_ORIGIN || url.pathname !== SEARCH_PATH || visited.has(url.href)) {
        throw invalidResponse("Shortcut returned an invalid pagination cursor");
    }
    return url;
}
```

### Rate-limit header handling already has a usable precedent

Code Source: `supabase/functions/shortcut-sync/shortcutApi.ts`
Code Description: `retryAfterSeconds` already parses both numeric and HTTP-date `Retry-After` values. The spike should confirm Linear returns a `Retry-After` header on `429` with `extensions.code: "RATELIMITED"`, since the backend issue will carry it through as `retry_after_seconds`.

```ts
function retryAfterSeconds(response: Response): number | undefined {
    const value = response.headers.get("Retry-After");
    if (!value) return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
```

### Due-date shape the query must satisfy

Code Source: `src/lib/taskDueDate.ts`
Code Description: `normalizeTaskDueDate` accepts only a leading `YYYY-MM-DD` (optionally followed by `T…`) that also round-trips as a real UTC calendar date. A date-only string works; anything else is discarded. Files using: `src/lib/engine/shortcutClassification.ts`.

```ts
export function normalizeTaskDueDate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    const match = ISO_DATE_PREFIX.exec(trimmed);
    if (!match) return undefined;
    if (trimmed.length > 10 && Number.isNaN(Date.parse(trimmed))) return undefined;
    // ...
}
```

### Existing task-proposal contract the payload must feed

Code Source: `src/lib/engine/shortcutClassification.ts`
Code Description: The Linear payload has to carry enough to build this shape. Note `status: "Backlog"` is fixed and there is no `skippedArchived` equivalent needed for Linear.

```ts
export interface ShortcutTaskProposal {
    title: string;
    projectId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    estimatePomos?: number;
    description: string;
    tags: string[];
    links: string[];
    checklist: PMTask["checklist"];
    relatedTo: string[];
}
```

### Files to read before starting

- `supabase/functions/shortcut-sync/shortcutApi.ts` and `index.ts` — the fetching, error, and pagination precedent.
- `src/lib/taskDueDate.ts` — the due-date contract to validate against.
- `src/lib/engine/shortcutClassification.ts` — the payload fields the query must return.
- `docs/research/` — destination directory for the findings document.

## Notes

Open questions the findings must answer explicitly:

- Does a key pasted with a leading `Bearer ` fail with a confusing 401, and should the backend detect and report that rather than sending it?
- Does Linear ever return HTTP 200 with a populated `errors` array while also returning partial data, and is partial data usable?
- Are rate limits really per user rather than per key (2,500 requests/hour, 3M complexity points/hour), meaning shared consumption with the user's other Linear tooling?
- Does a workspace with no assigned issues return an empty set with `hasNextPage: false`, distinct from an error?
- The `estimate` field must not be requested at all — record that it was excluded, since it costs complexity points and is intentionally out of scope.
