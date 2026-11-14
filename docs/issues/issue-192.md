# Title: Add Linear estimation support and audit current estimate mappings

## Tags

Complexity Classification: T2
Classification Reason: A narrow vertical slice mirroring an existing, fully-read Shortcut pipeline: the Linear GraphQL query and payload validation in the `linear-sync` Edge Function, the payload/proposal/conversion in `src/lib/engine/linearClassification.ts`, the barrel exports, the runtime guard in `src/lib/data/LinearDataAccess.ts`, the preview in `src/components/LinearIntegrationCard.tsx`, plus the tests that currently assert the opposite. About ten files, but one coherent feature path with no schema, permission, or data-format change; `PMTask.estimatePomos` already exists.

Severity: Medium
Severity Reason: Wrong or missing estimates degrade planning accuracy for every imported Linear task (Today/Week pomodoro totals and daily load), but nothing is destructive: dedupe, status filtering, priority mapping and existing tasks are untouched, there is no migration, and the change is a plain revert.

Needs research before implementation: Yes

### Research Needed

A short verification pass to settle four decisions before implementation:

- **Conversion coupling.** `SHORTCUT_POINTS_TO_POMODOROS` (`src/lib/engine/shortcutClassification.ts:54`) is module-private; only `shortcutPointsToPomodoros` is exported. Confirm whether Linear should import that function, or whether the table should be exported/renamed to a provider-neutral symbol, and which direction keeps `src/lib/engine/index.ts` clean.
- **Zero and extended-scale values.** Linear `estimate: 0` is an *explicit* "zero effort" estimate when the team enables zero estimates, not an unestimated issue. Reusing the Shortcut table maps `0 → 1` pomodoro. Confirm this is the intended parity, given Linear's semantics differ from Shortcut's.
- **Non-table values and non-integers.** With pass-through fallback, Linear extended/linear scales yield values like `6, 7, 13, 16, 21, 32, 64` (and `estimate` is a GraphQL `Float`). `ProjectManagerContext.createTask` floors the app task target (`src/state/ProjectManagerContext.tsx:632`) but persists `estimatePomos` unrounded (`:642`). Confirm the intended `PMTask.estimatePomos` value for a fractional point value.
- **Missing-field tolerance.** Confirm `isIssue` in `src/lib/data/LinearDataAccess.ts:158` must accept a payload with no `estimate` key, so a frontend deploy that lands before the `linear-sync` Edge Function is redeployed does not reject valid sync responses.

Also confirm the Shortcut table itself is the intended one and needs no value changes — the audit half of this issue.

## Summary

Shortcut imports already carry an effort estimate: `supabase/functions/shortcut-sync/shortcutApi.ts` maps `estimate` from the API, and `src/lib/engine/shortcutClassification.ts` converts story points to pomodoros via `SHORTCUT_POINTS_TO_POMODOROS` (`0→1, 1→3, 2→5, 3→8, 5→12`) with an identity fallback for unmapped values. `buildShortcutTaskProposal` then sets `estimatePomos`, the preview shows `"N pomodoros"`, and `createTask` persists it.

Linear has none of this. `LINEAR_SYNC_QUERY` does not request `estimate`, `LinearIssuePayload` has no such field, `LinearTaskProposal` deliberately omits `estimatePomos` (its doc comment says Linear exposes no estimate), the preview shows only priority/due date/tag, and `createTask` therefore applies its own default `target_pomodoros`.

This issue closes that gap so Linear-imported tasks are estimated the same way Shortcut tasks are, reusing the same point→pomodoro table, and records the current Shortcut mapping as the confirmed source of truth.

## Steps to Reproduce Context

1. Configure the Linear integration with a personal API key and a team whose estimate scale is set (e.g. Fibonacci), so some assigned issues have estimates.
2. Open Integrations and click "Sync now" on the Linear card.
3. Inspect the sync preview: each proposal shows priority, due date and the `linear:<IDENTIFIER>` tag — never a pomodoro count.
4. Confirm the import. The created task's estimate comes from `createTask`'s default rather than from the Linear issue.
5. Compare with the Shortcut card on the same page, where proposals show `"N pomodoros"` derived from the story's points.

## Requirements for completed issue

1. The current Shortcut points→pomodoros mapping (`{{0:1, 1:3, 2:5, 3:8, 5:12}}` plus identity fallback) is confirmed as the intended table and documented as the single source of truth for point→pomodoro conversion.
2. Shortcut behaviour is unchanged: the same points still produce the same pomodoro counts.
3. The `linear-sync` Edge Function requests each issue's `estimate` from the Linear GraphQL API and returns it in the sync payload as a nullable number that tolerates `null`.
4. Malformed estimate values (non-numeric, non-finite) are rejected the same way the existing payload validation rejects a malformed `priority`, while a legitimately absent estimate is accepted.
5. The browser payload type and the `isIssue` runtime guard accept the new field and tolerate a payload that omits it, so a frontend deploy ahead of the function redeploy does not fail.
6. A Linear proposal with an estimate sets `estimatePomos` using exactly the same conversion as Shortcut, so an identical point value yields an identical pomodoro count across both integrations.
7. A Linear estimate value absent from the table passes through unchanged as pomodoros, matching `shortcutPointsToPomodoros`'s existing fallback.
8. A Linear issue with no estimate (`null`/absent) produces a proposal with no `estimatePomos`, so `createTask` keeps applying its own default.
9. The Linear preview shows the pomodoro count for proposals that have one, matching the Shortcut preview's formatting.
10. Dedupe, status filtering, priority mapping, tags, links, due-date normalization and empty-result messaging are unchanged.
11. Comments and tests that assert Linear carries no estimate are corrected: `buildLinearTaskProposal`'s doc comment, the `confirmPreview` comment in `LinearIntegrationCard.tsx`, `linearClassification.test.ts` (`not.toHaveProperty("estimatePomos")`), the card test's matching assertion, and the integration test that asserts the query does not contain `estimate`.

## Expected Behavior

- Syncing Linear returns each issue's estimate alongside its existing fields.
- The Linear sync preview shows a pomodoro count for estimated issues, and nothing extra for unestimated ones.
- Creating an estimated Linear task persists a pomodoro estimate equal to what the same point value would produce from Shortcut.
- Creating an unestimated Linear task behaves exactly as today, using `createTask`'s default.
- Points outside the table (e.g. `13`, `21`) become that many pomodoros rather than being dropped.
- The Shortcut integration is unaffected.

## Actual Behavior

- `LINEAR_SYNC_QUERY` selects only `id identifier title description url dueDate priority state { name }`; `estimate` is never requested or returned.
- `LinearIssuePayload` has no estimate field, and `mapIssue` validates only `priority`, `state` and the string fields.
- `LinearTaskProposal` has no `estimatePomos`, and its doc comment states that Linear exposes no estimate in the sync payload.
- `LinearIntegrationCard`'s `ProposalPreview` renders priority, due date and the identity tag only.
- `confirmPreview` passes proposals straight to `createTask` with a comment noting that Linear carries no estimate, so every imported task gets `createTask`'s default target.

### Testing

- `pnpm test:unit` — engine and component tests, including a table-parity test that the same point value yields the same pomodoro count through both the Shortcut and Linear proposal builders, and a test that an absent estimate leaves `estimatePomos` unset.
- `integration/linearApi.integration.test.ts` — stub-fetcher tests for `fetchLinearIssues`: the issued query includes `estimate`, `estimate: 3` is mapped onto the issue, and `estimate: null` stays `null`; the existing `body.query).not.toMatch(/\bestimate\b/)` assertion is removed or inverted.
- `src/lib/data/LinearDataAccess.test.ts` — `isIssue` guard accepts an estimate, still accepts a payload without the key, and rejects a non-numeric estimate.
- `src/components/LinearIntegrationCard.test.tsx` — the preview shows `"N pomodoros"` for an estimated issue, `createTask` receives `estimatePomos`, and an unestimated issue still omits it.
- `pnpm test:integration` — local Supabase config checks still pass (no migration is expected).

## Issue Context

### New Files

None expected. If research lands on a Linear-named conversion wrapper rather than importing the Shortcut function directly, it belongs in `src/lib/engine/linearClassification.ts` and must be exported from `src/lib/engine/index.ts`.

### Remove Files

None.

### Change Files

#### Linear GraphQL query and payload

Code Source: `supabase/functions/linear-sync/linearApi.ts`
Code Description: Defines `LINEAR_SYNC_QUERY`, the `LinearIssuePayload` shape, and `mapIssue` validation for each issue node.
Code Change Description: Add `estimate` to the issue selection set, to the payload interface, and to the `mapIssue` validation/mapping (nullable number, rejecting non-finite values). Follow the Shortcut client's `optionalNumber` helper at `supabase/functions/shortcut-sync/shortcutApi.ts:103`.
Files Using: `supabase/functions/linear-sync/handler.ts` (returns the result to the browser unchanged), `integration/linearApi.integration.test.ts`

```ts
export interface LinearIssuePayload {
    id: string;
    identifier: string;
    title: string;
    description: string;
    url: string;
    dueDate: string | null;
    priority: number;
    state: { name: string };
}

function mapIssue(value: unknown): LinearIssuePayload { /* validates priority 0-4, state, strings */ }
```

#### Engine conversion and proposal

Code Source: `src/lib/engine/linearClassification.ts`
Code Description: `LinearIssuePayload` mirror, `LinearTaskProposal`, and `buildLinearTaskProposal`.
Code Change Description: Add the estimate to the payload mirror; set `estimatePomos` in `buildLinearTaskProposal` using the same conversion as Shortcut; remove the doc comment claiming Linear has no estimate.
Files Using: `src/lib/engine/index.ts`, `src/components/LinearIntegrationCard.tsx`, `src/lib/engine/linearClassification.test.ts`

```ts
const SHORTCUT_POINTS_TO_POMODOROS: Readonly<Record<number, number>> = {
    0: 1, 1: 3, 2: 5, 3: 8, 5: 12,
};

export function shortcutPointsToPomodoros(points: number): number {
    return SHORTCUT_POINTS_TO_POMODOROS[points] ?? points;
}

// The Shortcut precedent to mirror in buildLinearTaskProposal:
...(story.estimate !== null ? { estimatePomos: shortcutPointsToPomodoros(story.estimate) } : {}),
```

#### Browser payload guard

Code Source: `src/lib/data/LinearDataAccess.ts`
Code Description: `isIssue` is the runtime guard applied to the Edge Function response before it is treated as `LinearIssuePayload[]`.
Code Change Description: Accept the new optional estimate field and keep tolerating its absence.
Files Using: `src/lib/data/LinearDataAccess.test.ts`

```ts
function isIssue(value: unknown): value is LinearIssuePayload {
    // ...validates id, identifier, title, description, url, dueDate, priority (integer 0-4), state.name
}
```

#### Preview rendering

Code Source: `src/components/LinearIntegrationCard.tsx`
Code Description: `ProposalPreview` renders priority, due date and `proposal.tags[0]`; `confirmPreview` forwards each proposal to `createTask`.
Code Change Description: Render the pomodoro count when `proposal.estimatePomos` is defined, matching `src/components/ShortcutIntegrationCard.tsx:487`, and drop the stale "no estimate" comments at `confirmPreview`.
Files Using: `src/components/LinearIntegrationCard.test.tsx`

```tsx
<div className="mt-2 flex flex-wrap gap-2 text-[9px] text-neutral-400">
    <span>{proposal.priority} priority</span>
    {proposal.dueDate && <span>Due {proposal.dueDate}</span>}
    <span>{proposal.tags[0]}</span>
</div>
```

#### Estimate consumers (no change expected)

Code Source: `src/state/ProjectManagerContext.tsx`
Code Description: `createTask` uses `opts.estimatePomos` when present, otherwise falls back to the app task's `target_pomodoros`; the app task target is floored at `Math.max(1, Math.floor(target))`.
Code Change Description: No behaviour change is required; confirm the persisted `estimatePomos` value is consistent with the floored target for pass-through values.
Files Using: `src/lib/today.ts`, `src/lib/timer.ts` (pomodoro totals and load ordering)

## Notes

Mapping scope confirmed with the requester: the mapping to audit is the Shortcut points→pomodoros table, Linear estimates reuse that same table, and values outside the table pass through unchanged as pomodoros.

For reference, Linear estimates are team-scoped and depend on the team's `issueEstimationType` (`exponential`, `fibonacci`, `linear`, `tShirt`), `issueEstimationExtended`, and `issueEstimationAllowZero`. Numeric scales are `1,2,4,8,16` (exponential), `1,2,3,5,8` (fibonacci) and `1–5` (linear); t-shirt sizes translate to the Fibonacci numbers; extended scales add two larger values and zero is a valid explicit estimate. That is why values such as `6`, `7`, `13`, `16`, `21`, `32`, `64` and `0` reach the conversion table. `Issue.estimate` is a GraphQL `Float`, so a fractional value is theoretically possible.
