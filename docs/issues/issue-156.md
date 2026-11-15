# Title: Attach an existing Linear/GitHub/Shortcut issue to an existing WorkTime task from the integrations page

## Tags

Complexity Classification: T3
Classification Reason: The three integration cards (`LinearIntegrationCard`, `GithubIntegrationCard`, `ShortcutIntegrationCard`) only receive `createTask` and throw away the raw sync payload after classifying it into proposals, so the reverse direction needs retained candidates, an attach path wired through `IntegrationsPage`/`App.tsx` and `usePM().updateTask`, a shared helper for external-issue identity plus one-to-one enforcement, and updated colocated tests. Blast radius is roughly a dozen files across three cards, app wiring, and the pure engine layer; there is no schema, RLS, or Edge Function change and the task entity keeps its existing `tags`/`links` fields.

Severity: Medium
Severity Reason: No existing behaviour is broken and nothing is lost silently, but the feature writes persisted PM state and deliberately replaces a task's previous external reference, so a wrong or duplicate attach can hide an issue from the import flow and overwrite a link the user did not intend to change.

Needs research before implementation: Yes

### Research Needed

The flow is agreed, but a few details must be settled before coding because the three providers expose different payload shapes and identities.

- Confirm what each card can retain for the picker: `LinearDataAccess.sync()` returns one `LinearSyncResult` slice (issues assigned to me, optional single team), `ShortcutDataAccess.sync()` returns one `ShortcutSyncResult`, and `GitHubDataAccess.sync(repoFullName)` returns one repo-scoped `GitHubSyncResult`. Decide whether the picker reads a retained payload from the last "Sync now" or re-calls the same `sync()` when it opens, and what happens when no sync has run yet.
- Decide the external-issue identity key. The normalized URL is the only value that identifies an issue for all three providers; the import tags are not issue-identifying for two of them (GitHub writes `owner/repo`, Shortcut writes `story_type`, only Linear writes `linear:<IDENTIFIER>`). Confirm that duplicate and one-to-one checks are link-based and that the tag added on attach mirrors what the matching proposal builder writes.
- Confirm how "replace the previous external reference" recognises an existing reference on a task, given that user-added links live in the same `links` array. Provider URL shapes: `linear.app/<workspace>/issue/<IDENTIFIER>`, `github.com/<owner>/<repo>/issues/<n>`, `app.shortcut.com/<workspace>/story/<n>`.
- Confirm the interaction between attaching and the existing `skippedAlreadyAdded` counters in `classifyLinearIssues` (tag-first), `classifyGithubIssues` and `classifyShortcutStories` (link-based), plus whether the truncated payload bound limits picker completeness.
- Confirm that task updates must go through `updateTask(id, patch)` from `usePM()` (synchronous `persist`) so staging/sync behave like every other task edit, and that adding `updateTask` to the three card prop types does not disturb `IntegrationsPage`'s generic card fallback.

## Summary

The integration cards on `/integrations` currently only import: "Sync now" fetches external items, classifies them into new-task proposals, and creates tasks on confirm. There is no way to point an already hand-created WorkTime task at work that already exists in Linear, GitHub, or Shortcut. This issue adds the reverse direction to all three cards at once: pick an external issue from the existing sync payload, pick an existing WorkTime task, and attach the issue by adding its URL to `PMTask.links` and the provider tag to `PMTask.tags` — the same representation the import builders already produce. No new backend endpoint, no new task field, and no change to the import path.

## Steps to Reproduce Context

1. Create a WorkTime task by hand for work that already exists as a Linear issue.
2. Open `/integrations`, connect Linear, and click "Sync now". The preview lists that issue as a new task because the task has no matching tag or link.
3. Dismiss the preview. There is no control anywhere in the card to point the hand-created task at the existing issue. The only workaround is copying the issue URL into the task's links field in the project page inspector, which bypasses the provider tag and any duplicate check.

## Requirements for completed issue

1. Each of the Linear, GitHub, and Shortcut cards offers an "attach existing issue" action while connected. The action opens a picker; it is not part of the sync preview and does not create a task.
2. Candidates come only from the existing sync data source: the retained result of the last "Sync now" or a fresh call to the same `sync()` method when the picker opens. No new Edge Function, no provider search API, and no widening of the current fetch scope.
3. The candidate list shows every item from that payload (title plus its identifier/URL), including items the import preview would have skipped because of included statuses. Items already attached to any task are not offered.
4. In the GitHub card the user first picks one of the synced repositories, because the payload is per repo and the repository name is the tag; the candidate list is scoped to that repository.
5. The user then picks an existing WorkTime task from a searchable list that shows at least the task title and its project and excludes archived tasks and tasks that already carry an external reference.
6. Attaching updates exactly one task through `updateTask(id, patch)`: the issue URL is added to `PMTask.links` and the provider tag to `PMTask.tags`, mirroring the import builders — Linear `linear:<IDENTIFIER>`, GitHub `<owner>/<repo>`, Shortcut story type.
7. Attachment is one-to-one per task. Attaching to a task that already holds a recognised external reference replaces that reference (its link and the provider tag that belongs to it) and leaves every unrelated link and tag untouched.
8. The same external issue cannot be attached to two tasks: an issue whose normalized URL already appears in another task's links is not offered and is rejected with a clear message if submitted. The existing normalizers are reused (`normalizeLinearUrl`, `normalizeGithubIssueUrl`, `normalizeShortcutUrl`).
9. Attaching does not create a task, does not alter the pending sync preview or its counters, and does not consume the preview's removal/project edits.
10. The attached link is visible and openable from the task exactly as a manual link is today: the existing `LinksEditor` in the task inspector renders it and opens it in a new tab. No new task display surface and no new unlink control are added; removal remains the existing `×` control, with the tag still editable in the tag editor.
11. After attaching, a later sync treats that issue as already added (Linear by its `linear:<IDENTIFIER>` tag, GitHub and Shortcut by the normalized link). Classification and the proposal builders are unchanged.
12. Failure cases — provider not connected, no sync has run yet so there are no candidates, an item already attached elsewhere, a task that has been archived or deleted since the picker opened — surface inside the card's existing error region without leaving the card stuck in a busy state.

## Expected Behavior

- A hand-created WorkTime task for an existing Linear issue can be attached from the Linear card: the task's links list gains the issue URL and the task gains the `linear:ENG-123` tag.
- The task inspector shows the Linear URL as a link and clicking it opens the issue in a new browser tab.
- Running "Sync now" again no longer offers that issue as a new task; it counts as already added.
- A GitHub issue can be attached the same way, after choosing its repository, and the task gains the `owner/repo` tag.
- A Shortcut story can be attached the same way and the task gains the story-type tag.
- Attaching issue X to task A makes X unavailable for task B.
- Attaching to a task that already carries an external reference replaces only that reference; unrelated links and tags on the task stay as they were.

## Actual Behavior

- The cards only render a connection form and, after a sync, a preview modal whose only actions are per-proposal project changes, removal, cancel, and create.
- The cards receive `currentTasks`, `projects`, and `createTask` only; `App.tsx`'s `AuthenticatedIntegrationsRoute` does not pass `updateTask`, so a card cannot modify an existing task.
- The raw synced payload is discarded: `syncNow`/`syncOne` pass the payload straight into the classifier and keep only proposals and counts, so there is no candidate list to pick from.
- The only way to give a task a link today is manual entry in `LinksEditor`, which performs no provider tag or duplicate handling.

### Testing

1. Pure unit tests for the attach helper per provider: the produced links/tags match the corresponding import builder; a recognised previous external link is replaced while unrelated links/tags survive; an issue already present in another task's links is reported as attached elsewhere using the provider normalizer.
2. `LinearIntegrationCard` tests: the attach action appears only when connected; the picker lists payload items including ones excluded by included statuses; picking a task calls `updateTask` once with a patch containing the issue URL and `linear:<IDENTIFIER>`; an already-attached issue is not offered; an empty payload before any sync shows the "nothing to attach yet" message.
3. `ShortcutIntegrationCard` tests: the same flow with a story, asserting the `app_url` link and the story-type tag.
4. `GithubIntegrationCard` tests: the attach flow requires a synced repository selection, scopes candidates to that repository, and applies the `owner/repo` tag.
5. Task picker behaviour: archived tasks and tasks that already hold an external reference are excluded, and searching by title narrows the list.
6. `IntegrationsPage.test.tsx`: `updateTask` is threaded to all three bound cards alongside the existing props.
7. Regression: the existing sync → preview → create tests for all three cards still pass unchanged, and `pnpm test:unit` plus `pnpm run build` succeed after the change.

## Issue Context

### New Files

A new pure module plus tests is expected, for example `src/lib/engine/externalIssueAttach.ts` (the exact name and layout are up to the implementer). It should own external-issue identity so the three cards share one rule set. Minimum shape:

```ts
export type ExternalIssueProvider = "linear" | "github" | "shortcut";

/** One picker row, derived from a provider's sync payload. */
export interface ExternalIssueCandidate {
    provider: ExternalIssueProvider;
    /** Display identity: Linear identifier (ENG-123), GitHub `#7`, Shortcut `#42`. */
    key: string;
    title: string;
    url: string;
    /** Tag the matching import builder would write. */
    tag: string;
}

/** Links/tags patch for `updateTask`, replacing a previous recognised reference. */
export function externalIssueAttachPatch(
    task: PMTask,
    candidate: ExternalIssueCandidate,
): Pick<PMTask, "links" | "tags">;

/** True when another task already links this issue; the URL is normalized per provider. */
export function isExternalIssueAttachedElsewhere(
    tasks: readonly PMTask[],
    candidate: ExternalIssueCandidate,
    exceptTaskId?: string,
): boolean;
```

Candidate builders belong next to each provider's classification module or in the same new module, mapping `LinearIssuePayload`, `GithubIssuePayload` (plus repo name), and `ShortcutStoryPayload` to `ExternalIssueCandidate`.

### Remove Files

None.

### Change Files

#### Shared task link/tag representation

Code Source: `src/state/types.ts`

Code Description: `PMTask` carries the two fields this feature reuses: `tags: string[]` and `links: string[]` (URLs). There is no dedicated external-reference field.

Code Change Description: No change. Attach writes into the existing arrays; `ProjectManagerContext` normalization already preserves them and drops non-string entries.

```ts
export interface PMTask {
    // ...
    tags: string[];
    links: string[]; // urls
}
```

Files Using: `src/state/ProjectManagerContext.tsx`, `src/components/ProjectManager/TaskInspector.tsx`, all integration cards.

#### Task update entry point

Code Source: `src/state/ProjectManagerContext.tsx` (`updateTask`, lines ~687–695; context type at ~94–96)

Code Description: `updateTask(id, patch)` merges the patch into PM state via `persist`, stamps `updatedAt`, and applies the waiting/completion invariants. It is the only supported way to modify an existing task.

Code Change Description: No change to the function. Pass it from `usePM()` through `IntegrationsPage` to the three cards.

```ts
updateTask: (id: string, patch: Partial<PMTask>) => void;
```

Files Using: `src/components/ProjectManager/TaskInspector.tsx`, `src/App.tsx`.

#### Integration route wiring

Code Source: `src/App.tsx` (`AuthenticatedIntegrationsRoute`, lines ~125–152) and `src/components/IntegrationsPage.tsx` (props at lines ~26–33, card dispatch at ~52–62)

Code Description: The route builds the four data-access objects and passes `currentTasks`, `projects`, and `createTask` into each card. `usePM()` already supplies `updateTask`; it is currently not destructured or forwarded.

Code Change Description: Destructure `updateTask` from `usePM()` and forward it to the Shortcut, Linear, and GitHub card prop groups, then add the prop to each card's `*IntegrationCardProps` type.

```tsx
return <IntegrationsPage
    shortcut={{ dataAccess, currentTasks, projects, createTask }}
    linear={{ dataAccess: linearDataAccess, currentTasks, projects, createTask }}
    googleCalendar={{ dataAccess: googleCalendarDataAccess }}
    github={{ dataAccess: githubDataAccess, currentTasks, projects, createTask }}
/>;
```

Files Using: `src/components/IntegrationsPage.test.tsx`, the three card components.

#### Linear card: retain candidates and attach

Code Source: `src/components/LinearIntegrationCard.tsx` (`syncNow` lines ~198–219, `confirmPreview` lines ~221–253, action row lines ~345–367)

Code Description: `syncNow` calls `dataAccess.sync()`, stores `discoveredStates`/`truncated`, and immediately classifies `synced.issues` into `preview`, discarding the payload. `confirmPreview` is the only path that writes to tasks, through `createTask`.

Code Change Description: Keep the last `synced.issues` in state, add the attach action and picker (candidate list → task picker → `updateTask`), and leave the preview/create path untouched. Clear retained candidates on disconnect, like `preview`/`summary` are cleared today.

```ts
const synced = await dataAccess.sync();
setSettings({ ...settings, lastSyncedAt: synced.syncedAt });
setDiscoveredStates(synced.states);
setTruncated(synced.truncated);
setPreview(classifyLinearIssues({ issues: synced.issues, currentTasks, includedStatuses, defaultProjectId: defaultProjectId || null }));
```

Files Using: `src/components/IntegrationsPage.tsx`, `src/components/LinearIntegrationCard.test.tsx`.

#### Shortcut card: retain candidates and attach

Code Source: `src/components/ShortcutIntegrationCard.tsx` (props lines ~16–21, `syncNow` lines ~175–194, `confirmPreview` lines ~196–230)

Code Description: Same pattern as Linear. `buildShortcutTaskProposal` writes `tags: [story.story_type]` and `links: [story.app_url]`, which the attach flow must mirror.

Code Change Description: Retain `synced.stories`, add the attach action/picker, and call `updateTask`. No change to `classifyShortcutStories` or the builder.

```ts
export interface ShortcutIntegrationCardProps {
    dataAccess: ShortcutDataAccess;
    currentTasks: readonly PMTask[];
    projects: readonly Project[];
    createTask: (title: string, options: Partial<PMTask>) => Promise<PMTask>;
    updateTask: (id: string, patch: Partial<PMTask>) => void; // new
}
```

Files Using: `src/components/IntegrationsPage.tsx`, `src/components/ShortcutIntegrationCard.test.tsx`.

#### GitHub card: per-repo candidates and attach

Code Source: `src/components/GithubIntegrationCard.tsx` (props lines ~20–26, `syncOne`/`syncRepo`/`syncSelected` lines ~292–352, repo list rendering ~439–508)

Code Description: GitHub sync is per repository; `syncOne` classifies `synced.issues` with the repo context and returns only a `RepoPreviewEntry`. The repository row already knows its `fullName`, which the import builder writes as the tag.

Code Change Description: Retain the synced issues keyed by repository full name (clearing them on repo removal and disconnect), add a repo-scoped attach picker (repo → issue → task → `updateTask`), and leave the preview/create path untouched.

```ts
async function syncOne(repo: GitHubRepoRow): Promise<RepoPreviewEntry> {
    const synced = await dataAccess.sync(repo.fullName, { isStale: repo.isStale });
    // keep synced.issues per repo for the attach picker
    return {
        fullName: repo.fullName,
        result: classifyGithubIssues({
            issues: synced.issues,
            currentTasks,
            repoName: repo.fullName,
            defaultProjectId: synced.repo.projectId,
            includeClosed: synced.repo.includeClosed,
            labelFilter: synced.repo.labelFilter,
        }),
    };
}
```

Files Using: `src/components/IntegrationsPage.tsx`, `src/components/GithubIntegrationCard.test.tsx`.

#### URL normalizers and import tags

Code Source: `src/lib/engine/linearClassification.ts` (`linearIssueTag`, `normalizeLinearUrl`, lines ~89–110), `src/lib/engine/githubClassification.ts` (`normalizeGithubIssueUrl`, lines ~63–69; `buildGithubTaskProposal` tags `repoName`), `src/lib/engine/shortcutClassification.ts` (`normalizeShortcutUrl`, lines ~80–86; `buildShortcutTaskProposal` tags `story_type`)

Code Description: These are the existing identity rules the import flow uses. Linear dedupes tag-first, then by normalized link; GitHub and Shortcut dedupe by normalized link only.

Code Change Description: Reuse them for the attach duplicate check and for producing the same tag the import would have written. Do not change their behaviour or the classification counters.

```ts
export function linearIssueTag(identifier: string): string {
    return `${LINEAR_TAG_PREFIX}${identifier}`;
}
export function normalizeLinearUrl(value: string): string
export function normalizeGithubIssueUrl(value: string): string
export function normalizeShortcutUrl(value: string): string
```

Files Using: the three classification modules, the three integration cards, the new attach helper.

#### Link display and removal (unchanged)

Code Source: `src/components/ProjectManager/TaskInspector.tsx` (`LinksEditor`, lines ~323, 432–460)

Code Description: Links render as `<a href={l} target="_blank" rel="noreferrer">` with a `×` per entry that removes it from `task.links`. Tags render in `TagEditor` above it.

Code Change Description: No change. The attached URL is visible and openable here; removal stays the existing `×` control and tags stay editable separately in `TagEditor`.

```tsx
<LinksEditor links={task.links} onChange={(links) => updateTask(task.id, { links })} />
```

Files Using: `src/components/ProjectManager/ProjectManagerPage.tsx`.

## Notes

- Scope limitation (accepted): candidates are limited to what each existing sync returns — Linear issues assigned to me (optionally one team), GitHub issues from the configured repositories, Shortcut stories in the configured team. An issue outside those scopes cannot be attached without a new backend endpoint, which is out of scope here.
- Because removal stays the existing links `×` control, removing an attached link leaves the provider tag behind. For Linear that tag is the primary identity, so the issue stays excluded from re-import until the tag is also removed in `TagEditor`. This is a consequence of keeping unlink behaviour unchanged.
- The one-to-one rule is enforced by the URL normalizers, so re-attaching the same issue to the same task is a no-op rather than a duplicate link.
- No staging-store, Supabase schema/RLS, or Edge Function work is expected; `PMTask` keeps its current shape and the staging record validator accepts the object as-is (`src/lib/data/staging/types.ts`).
