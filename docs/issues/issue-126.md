# Title: Frontend — Linear data access, classification, card, and registry wiring

## Tags

Complexity Classification: T2
Classification Reason: A well-scoped but multi-module feature slice: three new files plus edits to the integrations registry, the integrations page, and the app shell, with unit tests. Every pattern has a Shortcut precedent, but the contract from the backend issue does not exist in the repository yet, so it must be taken on trust.

Severity: Medium
Severity Reason: Additive frontend code with no regression risk to existing behavior, but it is the only consumer of the Linear backend, so the parent feature is inert without it. A dedupe failure creates duplicate tasks rather than losing data or exposing anything.

Needs research before implementation: Yes

### Research Needed

The `linear-sync` response contract and the Linear settings RPC/table names come from the backend issue and are absent from this repository. Read the backend issue and `docs/research/linear-spike-findings.md` before starting.

- Confirm the exact field names and types of `issues`, `states`, and `truncated` in the sync response, and the error-code strings to allowlist in `mapFunctionError`.
- Confirm the `linear_settings` column names and the `save_linear_settings` / `update_linear_preferences` parameter names.
- Confirm how the payload distinguishes "nothing assigned" from "nothing matched the filter" so the empty-result messages are derivable rather than guessed.
- Verify that `createTask` and `PMTask` preserve a `linear:<identifier>` tag unmodified, since tag-first dedupe depends on it.

## Summary

Give the Linear backend a consumer. Copy the Shortcut frontend slice with the agreed departures, so the deliberate improvements over Shortcut live in one place: priority mapped from Linear's real scale, tag-first dedupe, and discovered state names surfaced as hints so a name-based filter is usable across multiple teams instead of a silent-failure trap.

Parent request: #122. Depends on the backend issue (#125) and the spike findings (#124).

## Steps to Reproduce Context

1. Open the Integrations page — it renders Google Calendar, GitHub, and Shortcut from `integrationRegistry`, with no Linear entry.
2. Inspect `src/lib/data/` — there is `ShortcutDataAccess.ts` and no Linear equivalent, so nothing can invoke `linear-sync`.
3. Inspect `src/lib/engine/shortcutClassification.ts` — status names are matched against a user-typed list, with no way to learn what names actually exist.
4. Attempt to configure a status filter for a Linear workspace — no state names are ever shown, so a typo or a second team's different naming silently yields zero imports.

## Expected Behavior

- The Integrations page shows a Linear card next to Shortcut, GitHub, and Google Calendar.
- Connecting stores a token, an optional team key, an included-status list, and a default project through the backend RPCs.
- Saving preferences, syncing, reconnecting, and disconnecting all work with user-visible state and error messaging.
- A sync shows a preview of proposed tasks before creating them, with counts distinguishing why issues were skipped.
- The distinct state names discovered during a sync are shown as clickable hints under the included-statuses field.
- A truncated sync is visibly flagged rather than silently short.
- Imported tasks always land in `Backlog`, never carry an estimate, and carry a `linear:<identifier>` tag.

## Actual Behavior

- There is no Linear entry in `integrationRegistry` and no Linear card, icon, or render branch.
- No frontend code invokes `linear-sync`.
- No Linear classification exists, so priorities and dedupe are undefined.
- No discovered state names are surfaced anywhere, so a name-based status filter can only be typed blind.

## Requirements for completed issue

1. `src/lib/data/LinearDataAccess.ts` exposes the same interface shape as `ShortcutDataAccess` — `loadSettings`, `connect`, `updatePreferences`, `disconnect`, `sync` — with typed error codes, a `mapFunctionError` equivalent, and a sync result carrying `issues`, `states`, and `truncated`.
2. `src/lib/engine/linearClassification.ts` maps the payload to a task proposal: priority from Linear's scale, status always `Backlog`, no estimate, `linear:<identifier>` tag first for dedupe and URL comparison second with the slug normalized away.
3. `src/components/LinearIntegrationCard.tsx` implements connect/save/sync/reconnect/disconnect, the preview modal, clickable discovered state-name hints under the included-statuses field, and a truncation notice.
4. `src/lib/integrations/registry.ts` gains a Linear entry with the `api-token` auth flow, and `IntegrationsPage.tsx` gains the icon in the `ICONS` map plus a render branch.
5. `src/App.tsx` wires `SupabaseLinearDataAccess` into the integrations route alongside the existing data access instances.
6. A blank team key means all teams, and the UI does not require one.
7. Empty sync results clearly distinguish "nothing assigned," "nothing matched the filter," and "everything already imported."
8. The archived-skip counter is not carried into the Linear slice, since Linear hides archived issues by default.
9. Unit tests cover the classification engine and the card.

### Testing

- `pnpm test:unit` — `src/lib/engine/linearClassification.test.ts` mirroring `shortcutClassification.test.ts`: every priority value including `None`, status always `Backlog`, no estimate on the proposal, tag-first dedupe, URL dedupe with the slug removed, and count separation between the three empty-result cases.
- `pnpm test:unit` — `src/components/LinearIntegrationCard.test.tsx` mirroring `ShortcutIntegrationCard.test.tsx`: initial load, connect, save preferences, sync and preview, create-from-preview, reconnect after an invalid token, disconnect, state-name hints rendering and applying a name, and the truncation notice.
- `pnpm test:unit` — update `src/lib/integrations/registry.test.ts` and `src/components/IntegrationsPage.test.tsx` for the new entry and card branch.
- `pnpm run build` — confirm the new module graph and registry typing compile.

## Context

### Interface and error mapping to copy

Code Source: `src/lib/data/ShortcutDataAccess.ts`
Code Description: The interface, error class, code union, and function-error mapper are the shape `LinearDataAccess.ts` must reproduce. The Linear version adds `states` and `truncated` to the sync result and swaps the `SHORTCUT_*` codes for the `LINEAR_*` ones plus `LINEAR_TEAM_NOT_FOUND`. Files using: `src/components/ShortcutIntegrationCard.tsx`, `src/App.tsx`.

```ts
export interface ShortcutDataAccess {
    loadSettings(): Promise<ShortcutSettings | null>;
    connect(input: ShortcutConnectionInput): Promise<void>;
    updatePreferences(input: ShortcutPreferencesInput): Promise<void>;
    disconnect(): Promise<void>;
    sync(): Promise<ShortcutSyncResult>;
}
```

```ts
const FUNCTION_ERROR_CODES = new Set<ShortcutIntegrationErrorCode>([
    "SHORTCUT_NOT_CONFIGURED",
    "SHORTCUT_TOKEN_INVALID",
    "SHORTCUT_RATE_LIMITED",
    "SHORTCUT_UPSTREAM_ERROR",
    "SHORTCUT_INVALID_RESPONSE",
]);
```

### Classification shape and dedupe precedent

Code Source: `src/lib/engine/shortcutClassification.ts`
Code Description: The proposal interface, `normalizeShortcutUrl`, and the classify loop are the template. The Linear loop drops `skippedArchived`, replaces the URL-only dedupe with a tag-first check, and maps priority instead of hardcoding `Medium`. Files using: `src/components/ShortcutIntegrationCard.tsx`.

```ts
const existingLinks = new Set(
    input.currentTasks.flatMap((task) => task.links.map(normalizeShortcutUrl)),
);
```

```ts
return {
    title: story.name,
    projectId,
    status: "Backlog",
    priority: "Medium",
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(story.estimate !== null ? { estimatePomos: shortcutPointsToPomodoros(story.estimate) } : {}),
    description: story.description,
    tags: [story.story_type],
    links: [story.app_url],
    checklist: [],
    relatedTo: [],
};
```

### Priority ceiling that drives the mapping

Code Source: `src/state/types.ts`
Code Description: `TaskPriority` has only three members, so the Linear mapping is necessarily lossy. `TaskStatus` fixes the `Backlog` target.

```ts
export type TaskStatus = "Backlog" | "Next" | "In Progress" | "Blocked" | "Done";
export type TaskPriority = "Low" | "Medium" | "High";
```

### Card state machine to mirror

Code Source: `src/components/ShortcutIntegrationCard.tsx`
Code Description: The busy union, the settings-dirty comparison, the per-code `errorMessage`, and the preview/summary state are the template. The Linear card adds state-name hints and a truncation notice. Tests: `src/components/ShortcutIntegrationCard.test.tsx`.

```tsx
const [busy, setBusy] = useState<"connect" | "save" | "disconnect" | "sync" | "create" | null>(null);
const [preview, setPreview] = useState<ShortcutClassificationResult | null>(null);
const [summary, setSummary] = useState<SyncSummary | null>(null);
```

```tsx
const settingsDirty = settings !== null && (
    teamName.trim() !== settings.teamName
    || includedStatuses.join("\n") !== settings.includedStatuses.join("\n")
    || (defaultProjectId || null) !== settings.defaultProjectId
);
```

### Registry and render branch to extend

Code Source: `src/lib/integrations/registry.ts`
Code Description: `IntegrationIcon` is a closed union, so the Linear icon must be added there before it can be used in the page.

```ts
export type IntegrationIcon = "calendar" | "github" | "shortcut";
```

Code Source: `src/components/IntegrationsPage.tsx`
Code Description: The `ICONS` map and the ternary chain both need a Linear case, and `IntegrationsPageProps` needs a `linear` prop object.

```tsx
const ICONS: Record<IntegrationIcon, LucideIcon> = {
    calendar: CalendarDays,
    github: GitPullRequest,
    shortcut: Milestone,
};
```

```tsx
{integrations.map((integration) => integration.id === "shortcut" && shortcut ? (
    <ShortcutIntegrationCard key={integration.id} {...shortcut} />
) : integration.id === "google-calendar" && googleCalendar ? (
    ...
```

### App wiring

Code Source: `src/App.tsx`
Code Description: `AuthenticatedIntegrationsRoute` constructs each data access with `useMemo` keyed on `session?.user.id` and passes prop objects to `IntegrationsPage`. `SupabaseLinearDataAccess` is added the same way.

```tsx
const dataAccess = useMemo(
    () => new SupabaseShortcutDataAccess(supabase, session!.user.id),
    [session?.user.id],
);
```

## Notes

Documented tradeoffs that must appear as code comments, not be "fixed" later:

- Priority mapping is lossy. `TaskPriority` is only `Low | Medium | High`, so Urgent→High, High→High, Medium→Medium, Low→Low, and None (no priority)→Medium. Two Linear priorities collapse onto High; that is a constraint of the existing type.
- An issue moved between Linear teams changes its identifier (`ENG-123` → `PLAT-88`), so it imports as a duplicate. This is accepted and documented, not a defect.
- A blank team key means all teams, where a single global status-name list may not span every team — exactly the case the discovered-name hints exist for.
- Archived issues are hidden by Linear by default, so the inherited archived-skip counter is dropped from this slice.
