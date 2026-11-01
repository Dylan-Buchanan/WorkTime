# Goals epic shared contract — Phase 2

Implementation status: **Phases 1–12 are implemented; the Phase 12 ownership amendment is ratified.** This contract remains binding for the #143/#142 follow-ups.

Status: **Signatures FROZEN by ORCH review, contingent on the normal Phase 2 gate;
not a gate record.** RESEARCH authored the chat draft at foundation HEAD
`4d365119e0b46d5c7e213de71b6e61f4d8093c5c`; IMPL+ materialized the contract and
shared fixtures; ORCH reviewed the signatures and in-memory
`DeckPlan.appendixEntriesByGoal` retention shape. Phase 2 acceptance requires ORCH
to run the four gate commands independently after the separate commit/merge.
This status does not claim an ORCH gate run or that later modules, mounts,
downloads, or human checks have been implemented or passed.

Binding precedence is **user prompt > workflow > contract**. The no-write role
and commit-only sandbox exceptions are user directives and supersede contradictory
workflow passages. The Phase 4 minimum dependency, slip encoding, chart selection,
and other interface decisions are ORCH-reviewed choices under the user's
"make your best judgment" instruction, not itemized human amendments or sign-off.
ORCH owns signature sign-off, freeze, merge, push, and gate acceptance, with no direct
file editing or ordinary git add/commit/version-bump permission. Authorized children
edit and commit their own branches and never push. Lanes open only after ORCH
review/signature freeze, the authorized child commit, and Phase 2 gate acceptance.
Later signature changes require an
authorized delegated contract edit, ORCH review, and notice to both lanes; rebase
only branches not yet merged into `epic/goals`. A lane finding a contract error
stops and reports rather than inventing a competing module.

Phase 2 owns only this contract and `src/lib/goals/testFixtures.ts`; lanes read/import
them. Feature implementation, including `periods.ts`, belongs to later phases.

## 1. Existing #133 foundation

Source of truth: `src/state/types.ts`, `src/lib/goals/{cadence,factories}.ts`,
`src/lib/data/{DataAccess,StagedDataAccess}.ts`, the staging types/upgrade ladder,
`src/lib/data/sync/merge.ts`, and the two goals migrations
`20261030000000_goals.sql` / `20261031000000_goal_staged_sync_rpc.sql`.
No foundation or migration changes are authorized here.

`LocalDateKey` comes from `src/lib/todos/types.ts`:

```ts
export type LocalDateKey = `${number}-${number}-${number}`;
```

Actual entity shapes from `src/state/types.ts`:

```ts
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sunday=0
export type GoalCadence =
    | { kind: "every-n-weeks"; weekday: Weekday; intervalWeeks: number }
    | { kind: "monthly-weekday"; weekday: Weekday };

export interface GoalTracker {
    id: string;
    name: string;
    purpose: string;
    cadence: GoalCadence;
    cadenceAnchorAt: LocalDateKey;
    color: string;
    sortOrder: number;
    isArchived: boolean;
    lastBuiltPeriodStart: LocalDateKey | null;
    createdAt: string;
    updatedAt: string;
}
export interface GoalMetric {
    label: string;
    target: number;
    current: number;
    unit: string;
    source: "manual" | "liftingtracker";
    overridePinned: boolean;
}
export interface Goal {
    id: string;
    trackerId: string;
    title: string;
    notes: string;
    projectId: string | null;
    metric: GoalMetric | null;
    lifecycle: "active" | "achieved" | "dropped";
    achievedAt: string | null;
    droppedAt: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}
export interface GoalCheckIn {
    id: string;
    goalId: string;
    periodStart: LocalDateKey;
    did: string;
    current: string;
    planned: { text: string; dueDate: LocalDateKey | null }[];
    statusPill: "on-track" | "at-risk" | "blocked";
    missReason: string;
    isFocus: boolean;
    evidenceTaskIds: string[];
    createdAt: string;
    updatedAt: string;
}
```

There is no persisted `periodEnd` (the validator rejects it), planned completion
boolean, historical metric snapshot, deck state, or additional completion field.

### Existing exports and defaults

`src/lib/goals/cadence.ts` (#133; validation only):

```ts
export function normalizeGoalCadence(rule: GoalCadence): GoalCadence;
export function isValidGoalCadence(value: unknown): value is GoalCadence;
```

Normalization clones, validates integer weekday `0..6` and safe integer
`intervalWeeks >= 1`, and throws `RangeError` on malformed rules. Monthly carries
only `kind` and `weekday`. It does not compute boundaries.

`src/lib/goals/factories.ts` (#133):

```ts
export function isGoalDateKey(v: unknown): v is LocalDateKey;
export function isGoalMetric(v: unknown): v is GoalMetric;
export function isGoalTracker(v: unknown): v is GoalTracker;
export function isGoal(v: unknown): v is Goal;
export function isGoalCheckIn(v: unknown): v is GoalCheckIn;
export function createGoalTracker(
    input: Pick<GoalTracker, "name" | "cadence" | "cadenceAnchorAt"> &
        Partial<Omit<GoalTracker, "id" | "createdAt" | "updatedAt">>,
    now: Date,
    id: string,
): GoalTracker;
export function createGoal(
    input: Pick<Goal, "trackerId" | "title"> &
        Partial<Omit<Goal, "id" | "createdAt" | "updatedAt">>,
    now: Date,
    id: string,
): Goal;
export function createGoalCheckIn(
    input: Pick<GoalCheckIn, "goalId" | "periodStart"> &
        Partial<Omit<GoalCheckIn, "id" | "createdAt" | "updatedAt">>,
    now: Date,
    id: string,
): GoalCheckIn;
```

All factories use `now.toISOString()` for both timestamps and throw
`RangeError("Invalid goal tracker")`, `RangeError("Invalid goal")`, or
`RangeError("Invalid goal check-in")` respectively. Tracker defaults: empty purpose
and color, sort order 0, unarchived, null build key; trim name, normalize cadence.
Goal defaults: empty notes, null project/metric, active, null lifecycle stamps,
sort order 0; trim title, clone metric. Check-in defaults: empty did/current/reason,
on-track, **isFocus false**, empty planned/evidence arrays; clone arrays/items.
The #136 wizard explicitly defaults new active-goal check-ins to **isFocus true**.

## 2. Binding decisions and persistence

These restate the eight binding #133 decisions; lanes need no second document to
implement them.

1. **Whole-row LWW:** use `mergeVersionedCollection` for trackers, goals, and
   check-ins, including remote winning exact ties. Do not port habits' field merge.
   Concurrent edits to different fields of one row can lose a side; accepted for
   single-owner v1. `metric.current` is part of the whole goal row; #143 must use
   guarded/awaited treatment or explicitly record an accepted concurrency risk.
2. **Monotonic build key:** `lastBuiltPeriodStart` is a period start, never an export
   timestamp. Merge takes the maximum local/remote/merged date key and restamps if
   changed. `saveGoals` rejects null or earlier than an existing non-null key with
   `RangeError("lastBuiltPeriodStart cannot move backwards")` before any write.
   Equal keys permit rebuilding. No export timestamp is stored.
3. **Natural key:** check-in identity is `(goalId, periodStart)`. SQL conflict target
   is `(owner_id, goal_id, period_start)`. A server ID owns a natural-key collision
   regardless of the local losing row's stamp; remove the local ghost row, stamp,
   and tombstone. Transport IDs may change after sync. UI identity/React keys use
   the natural-key pair. Losing offline typed content is an accepted v1 risk.
4. **Archive/lifecycle only:** trackers archive, goals become active/achieved/dropped,
   check-ins upsert. No hard delete, cascade provenance, or cascade guard. Structural
   tombstone maps exist, but v1 callers keep them empty. The RPC rejects nonempty
   goal tombstones with `GOALS_ARCHIVE_ONLY`. Adding deletion requires reopening
   the complete two-level cascade design, not a partial affordance.
5. **Cadence union and resolved anchor:** use the actual union above.
   `cadenceAnchorAt` is a synced, actually resolved boundary, the weekly parity epoch
   and creation/reset first open-period start. Reset whenever the cadence rule
   changes. Do not store an unsnapped date or normalize an invalid anchor on read.
   Monthly uses the exact Mon/Tue nominal-month rule in section 3.
6. **Anchored local-date grid:** derive from cadence + anchor, never the build key.
   The first boundary is strictly after the creation local date; there is no partial
   first period and no backfill. Before it there is no open period, badge, nudge,
   or wizard. Resets start at a resolved boundary strictly after the reset date.
   Preserve all historical `periodStart` keys verbatim, even if off the new grid.
   Stored earlier anchors remain parity epochs; the creation floor still applies.
   Labels use the nominal period month, not a snapped date's calendar month.
7. **Storage/transport:** exactly nine flat fields below, staging schema **9**.
   The automated v8→v9 ladder injects empty maps in both record and `lastSynced`;
   required-field checks, pending counts, and discard cover all nine. `metric`,
   `planned`, `evidence_task_ids` are jsonb. RPC grows six positional arguments,
   **36 → 42**, not 38 → 44: `p_goal_tracker_upserts`,
   `p_goal_tracker_tombstones`, `p_goal_upserts`, `p_goal_tombstones`,
   `p_goal_check_in_upserts`, `p_goal_check_in_tombstones`. Push parents first:
   trackers → goals → check-ins. No bundled payload or new persisted field.
8. **Full desired set:** every `saveGoals` call includes every tracker (archived
   too), every goal (achieved/dropped too), and every check-in (unchanged too).
   Display filtering never reaches the writer. Omission creates tombstones and is
   a bug in v1. Provider saves reconcile the full latest staged set and local edits.

`StagedOwnerRecord` fields from `src/lib/data/staging/types.ts`:

```ts
goalTrackers: Record<string, GoalTracker>;
goalTrackerUpdatedAt: Record<string, string>;
goalTrackerTombstones: Record<string, { id: string; deletedAt: string }>;
goals: Record<string, Goal>;
goalUpdatedAt: Record<string, string>;
goalTombstones: Record<string, { id: string; deletedAt: string }>;
goalCheckIns: Record<string, GoalCheckIn>;
goalCheckInUpdatedAt: Record<string, string>;
goalCheckInTombstones: Record<string, { id: string; deletedAt: string }>;
```

`SyncSnapshot` (the non-null `lastSynced` baseline) has the same nine top-level
map names. Its three entity maps wrap each entity as `{ value: Entity; updatedAt:
string }`: `GoalTracker` for `goalTrackers`, `Goal` for `goals`, and `GoalCheckIn`
for `goalCheckIns`. The six stamp/tombstone maps retain the shapes shown above.

Existing `DataAccess` signatures:

```ts
saveGoals(trackers: GoalTracker[], goals: Goal[], checkIns: GoalCheckIn[]): Promise<void>;
loadGoals(): Promise<{ trackers: GoalTracker[]; goals: Goal[]; checkIns: GoalCheckIn[] }>;
```

`loadGoals` clones the staged arrays; it does not network. `saveGoals` validates all
rows, clones input, stamps changed rows only, and writes localStorage. Invalid
payloads reject with `RangeError("Invalid goals payload")` without writing.
No later phase may edit `src/lib/data/**` without IMPL+ escalation.

## 3. Canonical cadence, periods, and Phase 4 dependency amendment

**Explicit ORCH scope/dependency correction:** #134 cannot satisfy its resolved
tracker-anchor requirement before the #135 dependency exists. Phase 4 is escalated
to **IMPL+**, temporarily owning the minimal canonical #135 dependency in
`src/lib/goals/periods.ts` and its test: the period types needed by UI and exactly
`resolveCadenceAnchorAt(rule, after)`. Phase 5 Lane B receives that merged module
and extends it with the frozen APIs below. Phases remain in order. There is one
implementation of snapping in `periods.ts`, reused by anchor resolution and all
later windows/due/slip consumers. No `anchor.ts`, UI/provider date math, unsnapped
creation date, or normalization-on-read substitute is allowed. No such module is
created in Phase 2.

### Frozen `src/lib/goals/periods.ts` exports

```ts
import type { GoalCadence, GoalTracker } from "../../state/types";
import type { LocalDateKey } from "../todos/types";

export type GoalMonthKey = `${number}-${number}`;
export interface PeriodBounds {
    readonly periodStart: LocalDateKey;
    readonly periodEnd: LocalDateKey;
}
export interface GoalPeriod extends PeriodBounds {
    readonly monthKey: GoalMonthKey;
}
export interface GoalGridInput {
    readonly cadence: GoalCadence;
    readonly cadenceAnchorAt: LocalDateKey;
    readonly createdOn: LocalDateKey;
    readonly isArchived: boolean;
    readonly lastBuiltPeriodStart: LocalDateKey | null;
}
export function resolveCadenceAnchorAt(rule: GoalCadence, after: LocalDateKey): LocalDateKey;
export function goalGrid(tracker: GoalTracker): GoalGridInput;
export function firstPeriod(grid: GoalGridInput): GoalPeriod;
export function periodAt(grid: GoalGridInput, date: LocalDateKey): GoalPeriod | null;
export function previousPeriod(grid: GoalGridInput, period: GoalPeriod): GoalPeriod | null;
export function nextPeriod(grid: GoalGridInput, period: GoalPeriod): GoalPeriod | null;
export function mostRecentCompletedPeriod(grid: GoalGridInput, today: LocalDateKey): GoalPeriod | null;
export function listPeriods(grid: GoalGridInput, from: LocalDateKey, to: LocalDateKey): GoalPeriod[];
export type DueState =
    | { readonly kind: "archived" }
    | { readonly kind: "before-first-period"; readonly firstPeriod: GoalPeriod }
    | {
          readonly kind: "not-due";
          readonly current: GoalPeriod;
          readonly mostRecentCompleted: GoalPeriod | null;
          readonly lastBuiltPeriodStart: LocalDateKey | null;
      }
    | {
          readonly kind: "due";
          readonly current: GoalPeriod;
          readonly mostRecentCompleted: GoalPeriod;
          readonly lastBuiltPeriodStart: LocalDateKey | null;
      };
export function dueState(grid: GoalGridInput, today: LocalDateKey): DueState;
export function periodLabel(period: GoalPeriod): string;
export function periodRangeLabel(period: GoalPeriod): string;
```

`resolveCadenceAnchorAt` returns the first rule boundary **strictly after** `after`.
Weekly creation/reset chooses the next matching weekday; same weekday means next
week, even when `intervalWeeks > 1`. That returned boundary starts the first open
period and becomes the parity epoch; subsequent boundaries are exactly
`intervalWeeks * 7` local calendar days apart. It does not choose a preexisting
global biweekly parity. Reads use the saved boundary directly.

Monthly resolution enumerates nominal months and selects the first resolved
boundary `> after`. For nominal `(year, month)`, let `first` be its local-noon 1st,
`d` its JS weekday, and `w` the rule weekday:

- If `d` is Monday (1) or Tuesday (2), boundary is the matching weekday **on or
  before** the 1st: shift by `-((d - w + 7) % 7)` days, including equality.
- Otherwise use the first matching weekday on or after the 1st: shift by
  `(w - d + 7) % 7` days.
- The trigger is the weekday of the 1st, never a gap threshold. The boundary belongs
  to that nominal month even when its date falls in the previous calendar month.
  Enumerate adjacent nominal months so snapped dates are considered correctly.
  Never add a fixed monthly duration (monthly periods vary with the rule).

Frozen examples: Sunday nominal October 2026 starts `2026-10-04`; nominal November
starts `2026-11-01`. October label is `October 2026`, range
`Oct 4 – Oct 31, 2026`. Sunday nominal December 2026 starts `2026-11-29` because
December 1 is Tuesday; next is `2027-01-03`. Label `December 2026`, range
`Nov 29, 2026 – Jan 2, 2027`. Monday the 1st with Monday cadence resolves to the
1st itself, but a creation/reset **on** that date still chooses a later boundary.

### Grid floor, windows, and labels

`goalGrid` is the convenience conversion of `createdAt` to a host-local creation
date using `localDateKey(new Date(tracker.createdAt))`. Pure tests inject
`GoalGridInput.createdOn` directly. The calendar helper currently returns `string`;
validate/narrow to `LocalDateKey` at this conversion seam without changing the helper.

Weekly lattice: `cadenceAnchorAt + k * intervalWeeks * 7` days for integer `k`, with
no read-time weekday snapping. Monthly lattice: canonical nominal-month boundaries.
Find the first lattice boundary strictly after `createdOn`; take the later of that
and the saved anchor as the floor; `firstPeriod` starts at the first lattice boundary
at/after the floor. This retains the binding creation floor for older epoch anchors
while new/reset anchors already supply the exact first start. No partial periods or
backfill. A reset preserves stored historical keys without rewriting them.

`periodEnd` is always the next boundary, **exclusive**. `periodAt` returns the
containing lattice period, or null before the floor. Monthly containment searches
neighboring nominal-month boundaries: November 29–30, 2026 belong to December's
period. `previousPeriod` returns null below the floor; `nextPeriod` returns its
successor. `mostRecentCompletedPeriod` is the current period's predecessor; null
before the first start or while the first period is in progress. Completed means
`periodEnd <= today`. `listPeriods` returns ascending periods overlapping `[from,to)`
above the floor, or `[]` for `to <= from`.

Archived trackers are excluded by consumers from period, slip, badge, nudge, and
deck derivations; they remain in every save. `dueState` returns `archived` first.
Pure grid geometry helpers can describe a period for informational copy, which
does not authorize an archived wizard or deck. Otherwise due state is
`before-first-period` if no current period, `not-due` if none completed, `due` if
a completed period exists and build key is null or earlier than its start, and
`not-due` otherwise. A future build key never reopens a period.

Monthly `monthKey` is the nominal month, not `periodStart.slice(0,7)`; weekly uses
the start's month. Fixed English labels; no locale APIs. Range label shows inclusive
last day (`periodEnd - 1 local day`): same year `Sep 27 – Oct 31, 2026`, cross-year
`Dec 28, 2026 – Jan 2, 2027`. Use `src/lib/todos/calendar.ts` local-noon helpers,
never UTC date-key parsing (`new Date("YYYY-MM-DD")`), fixed 30/31-day arithmetic,
or a clock in a pure module. ISO instants may be projected at explicitly named seams.

| Consumer | Target source | Build key use |
| --- | --- | --- |
| Wizard | Current `periodAt(goalGrid(tracker), today)`, pinned at open | Staleness warning only |
| Past editor | Stored keys and grid periods above floor | None |
| Due badge/nudge | Most recent completed grid period | Comparison only |
| Deck | Most recent completed grid period, same-period rebuild allowed | Stamp after initiation |
| Slips | Stored keys ordered through requested period | None |
| Goal-set file | Definitions only | Omitted |

Phase 4 calls only the minimal resolver, shows the exact saved first-start date,
and leaves badge/wizard/deck mounts for future phases. It does not derive windows,
due state, or a ready deck. No `pending-boundaries` assumption is needed.

## 4. Frozen slips/history contract — #135, Lane B

```ts
import type { Goal, GoalCheckIn } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import type { PeriodBounds } from "./periods";

export type LifecycleDateProjection = (iso: string) => LocalDateKey;
export interface SlipSummary {
    readonly goalId: string;
    readonly consecutiveSlips: number;
    readonly escalated: boolean;
    readonly slippedPeriods: readonly LocalDateKey[];
    readonly lastCleanPeriod: LocalDateKey | null;
    readonly latestPeriod: LocalDateKey | null;
}
export interface GoalSeriesPoint {
    readonly periodStart: LocalDateKey;
    readonly value: number;
}
export interface GoalSparkline {
    readonly goalId: string;
    readonly kind: "status";
    readonly points: readonly GoalSeriesPoint[];
}
export interface GoalMetricSnapshot {
    readonly label: string;
    readonly current: number;
    readonly target: number;
    readonly unit: string;
    readonly source: "manual" | "liftingtracker";
    readonly overridePinned: boolean;
}
export function normalizeSlipText(value: string): string;
export function normalizeCheckInHistory(checkIns: readonly GoalCheckIn[]): GoalCheckIn[];
export function unmetPlannedItems(
    previous: GoalCheckIn,
    current: GoalCheckIn,
): { text: string; dueDate: LocalDateKey | null }[];
export function isSlipTransition(previous: GoalCheckIn, current: GoalCheckIn): boolean;
export function slipSummary(
    goalId: string,
    checkIns: readonly GoalCheckIn[],
    throughPeriodStart?: LocalDateKey,
): SlipSummary;
export function isGoalIncludedInPeriod(
    goal: Goal,
    period: PeriodBounds,
    localDateOf?: LifecycleDateProjection,
): boolean;
export const STATUS_SERIES_VALUES: Readonly<Record<GoalCheckIn["statusPill"], number>>;
export function buildSparkline(
    goalId: string,
    checkIns: readonly GoalCheckIn[],
    throughPeriodStart?: LocalDateKey,
): GoalSparkline | null;
export function metricSnapshot(goal: Goal): GoalMetricSnapshot | null;
```

### Exact completion encoding in the existing `did: string`

`normalizeSlipText` trims, collapses whitespace, and lower-cases only. Compare each
nonempty normalized previous planned text to **one entire normalized did line**.
Split did on line breaks. Before normalizing a did line, strip at most one leading
common list prefix (`-`, `*`, `+`, or decimal digits followed by `.` or `)`, each
followed by whitespace) and then an optional checked checkbox prefix `[x]`/`[X]`
followed by whitespace. Bare checked-checkbox lines are also supported. An unchecked
`[ ]` after an optional list prefix disqualifies the line; `- [ ] Ship the migration`
never completes a plan. Strip no other words or punctuation. Blank planned rows
are ignored, cannot prove completion, and an all-blank plan counts as zero planned.

Examples for plan `Ship the migration`: `Ship the migration`, `- Ship the migration`,
and `- [x] Ship the migration` complete it; `did not Ship the migration`,
`Did Ship the migration`, `Ship the migration tomorrow`, and unchecked checkbox
lines do not. No substring matching, inferred negations, or prose interpretation.

#136 offers previous-planned completion checkboxes. Checking adds a canonical exact
line `- [x] <planned text>`; unchecking removes that canonical line while retaining
typed prose. No new field. Deduplicate equivalent canonical completion lines.
An independently typed exact line still proves completion after unchecking; the
UI derives the checked state from all remaining exact lines so this is predictable.
Changing other prose never silently marks an item complete.

A transition slips if any nonblank previous planned item remains unmet; partial
completion does not reset. Clean/zero-planned transitions reset. Blocked status
never suppresses a slip. `unmetPlannedItems` compares only the same goal's successive
stored check-ins and returns cloned unmet items. Gaps create no synthetic slips or
resets: evaluate successive stored rows without assuming alignment to today's grid.
`slipSummary` counts backwards until a clean transition; slipped keys refer to the
current row of each slipping transition in ascending order; escalation is `>= 2`.
No transition means zero slips, no clean key, and latest key from the available row.

History normalization dedupes by **(goalId, periodStart)**, retaining greatest
`updatedAt`, tie lexicographically smallest `id`. Sort by periodStart, then goalId
for simultaneous goals, then updatedAt/id for deterministic ordering. This defensive
pure derivation has no server provenance; it does not replace storage's server-ID
dedupe. Every per-goal derivation filters by goalId and, if provided, inclusive
`throughPeriodStart`. Deck calls always supply their requested period start, so
future rows cannot affect slips, focus, misses, or series for an earlier deck.

`isGoalIncludedInPeriod` first projects `goal.createdAt` through the existing
optional `localDateOf` (`LifecycleDateProjection`) and excludes a goal whose creation local date
is `>= periodEnd`, before applying active/achieved projection. A goal created in a
later period cannot appear in an older recap as `No progress recorded this period`.
For goals passing that check: active true, dropped always false. Achieved goals
with a valid achievement local date in `[periodStart,periodEnd)` are included and marked achieved;
an achievement before the window is excluded. An achievement at/after periodEnd
is projected as still active for this earlier deck, with **no achievement badge**.
Missing achievedAt cannot establish inclusion for an achieved row. The optional
`localDateOf` defaults to validated `localDateKey(new Date(iso))`; tests inject it.
`DeckPlanInput.localDateOf` uses this same type and projection for inclusion and
`achievedInPeriod`, preventing later achievement from leaking backwards. No
historical metric snapshot exists: current metric is explicitly current text only.

ORCH ratifies status-only history: `blocked=0`, `at-risk=1`, `on-track=2`.
`buildSparkline` returns null with fewer than two deduped, filtered points.
`metricSnapshot` returns a clone of current metric fields for text, or null.

## 5. Frozen evidence selector — #137, Lane A (ratified Phase 12)

The Phase 12 amendment is **ratified**: `src/lib/goals/evidence.ts` and
`src/components/goals/GoalEvidencePanel.tsx` are **both Lane A**, as one change. The
original workflow's Lane B assignment for the selector is superseded, because the
selector's only consumer is the Lane A wizard panel, so splitting them added a
cross-lane dependency without isolating anything. This section's signature and
semantics are unchanged by the amendment; only ownership is ratified. Lane A mounts
the panel inside the check-in wizard; Lane B does not touch `evidence.ts`.

```ts
import type { Goal, GoalCheckIn, PMTask, PomodoroLogEntry, Project, Task } from "../../state/types";
import type { LocalDateKey } from "../todos/types";
import type { PeriodBounds } from "./periods";

export interface EvidenceTaskSuggestion {
    readonly pmTaskId: string;
    readonly appTaskId: string | null;
    readonly title: string;
    readonly completedOn: LocalDateKey;
    readonly accepted: boolean;
}
export interface EvidenceInProgressItem {
    readonly pmTaskId: string;
    readonly title: string;
    readonly sortOrder: number;
}
export interface GoalEvidence {
    readonly completedTasks: EvidenceTaskSuggestion[];
    readonly inProgress: EvidenceInProgressItem[];
    readonly completedTaskCount: number;
    readonly hoursMinutes: number;
    readonly brokenProject: boolean;
}
export interface EvidenceWindowInstants {
    readonly start: number; // epoch milliseconds, inclusive
    readonly end: number;   // epoch milliseconds, exclusive
}
export type EvidenceBoundaryConverter = (period: PeriodBounds) => EvidenceWindowInstants;
export interface EvidenceInput {
    readonly goal: Goal;
    readonly checkIn: Pick<GoalCheckIn, "evidenceTaskIds">;
    readonly period: PeriodBounds;
    readonly projects: readonly Project[];
    readonly pmTasks: readonly PMTask[];
    readonly backendTasks: readonly Task[];
    readonly logs: readonly PomodoroLogEntry[];
    readonly boundaryInstants?: EvidenceBoundaryConverter;
    /** Presentation only for selected suggestions; never window filtering. */
    readonly localDateOf?: (iso: string) => LocalDateKey;
}
export function buildGoalEvidence(input: EvidenceInput): GoalEvidence;
export function formatEvidenceHours(minutes: number): string;
export function evidencePrefillText(items: readonly EvidenceInProgressItem[]): string;
```

Convert the `[periodStart,periodEnd)` **local date** window to start/end instants
once per selector call using `boundaryInstants`, defaulting to local calendar
midnight for each date boundary (DST-aware, not a fixed-duration interval). Use those
same numeric boundaries for both completed tasks and logs. Parse each authored ISO
timestamp to an instant and compare `start <= instant < end`; do not separately
project every timestamp to a local date for filtering. Tests inject fixed numeric
boundaries and are independent of host timezone. `completedOn` is a presentation
date for selected suggestions only, derived after selection from the completion
instant via optional `localDateOf` (default validated host-local date projection);
tests can inject it too. It is never a second filtering criterion, and logs need
no per-row local-date projection.

Evidence IDs are **PMTask.id**. Suggestions require Done status, goal-project match,
and linked backend `Task.completed_at` within the instant window. Missing/deleted
links or Done tasks without a backend completion are invisible: best effort,
document this gap. Suggestion content is title-only, never task body/notes. Accepted
is membership in `evidenceTaskIds`; the user explicitly accepts/rejects suggestions,
and rejected items never silently re-enter did prose. Stale IDs render nothing
and remain until edited. `completedTaskCount` counts qualifying suggestions.

Hours sum non-break `duration_minutes` for log `finished_at` within the same window,
joining `log.task_id -> backend Task.id -> PMTask.appTaskId -> goal.projectId`;
exclude missing joins and breaks, count each log once. Null goal project gives no
project suggestions/hours. `brokenProject` is true for a non-null missing project;
archived projects are valid links. In Progress titles are sorted by sortOrder,
title, then id for ties; prefill joins with `", "`. Hours round to one decimal,
omitting `.0`: `14h`, `14.5h`. Freeze prefill after first manual edit; only explicit
refresh resynchronizes. No new persisted evidence or completion field.

## 6. Frozen deck data — #138, Lane B

`src/lib/goals/deck/types.ts` is plain data: no React/ReactNode, pptx library,
renderer, canvas handle, or I/O import.

```ts
import type { GoalCheckIn } from "../../../state/types";
import type { LocalDateKey } from "../../todos/types";
import type { GoalPeriod } from "../periods";

export const DECK_SLIDE_KINDS = [
    "title", "recap", "misses", "next-plans", "progress", "closing", "appendix",
] as const;
export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number];
export const DECK_SLIDE_ORDER: readonly DeckSlideKind[] = DECK_SLIDE_KINDS;
export const DECK_WORDS_PER_MINUTE = 130;
export const DECK_SLIDE_BASE_SECONDS = 8;
export const DECK_TARGET_SECONDS = 300;

export interface DeckMetricView {
    label: string;
    current: number;
    target: number;
    unit: string;
    source: "manual" | "liftingtracker";
    overridePinned: boolean;
}
export interface DeckSlideBase<K extends DeckSlideKind> {
    readonly id: string;
    readonly kind: K;
    title: string;
    notes: string;
    suggestedSeconds: number;
    isHidden: boolean;
}
export interface DeckTitleSlide extends DeckSlideBase<"title"> {
    trackerName: string;
    purpose: string;
    periodLabel: string;
    periodRangeLabel: string;
}
export interface DeckRecapItem {
    text: string;
    dueDate: LocalDateKey | null;
}
export interface DeckRecapSlide extends DeckSlideBase<"recap"> {
    goalId: string;
    goalTitle: string;
    placement: "body" | "appendix";
    statusPill: GoalCheckIn["statusPill"];
    did: string;
    current: string;
    planned: DeckRecapItem[];
    missReason: string;
    metric: DeckMetricView | null;
    slipCount: number;
    slipBadge: boolean;
    achievedInPeriod: boolean;
    evidenceTaskTitles: string[];
}
export interface DeckMissItem {
    goalId: string;
    goalTitle: string;
    text: string;
    dueDate: LocalDateKey | null;
    reason: string;
}
export interface DeckMissesSlide extends DeckSlideBase<"misses"> {
    items: DeckMissItem[];
}
export interface DeckPlanItem {
    goalId: string;
    goalTitle: string;
    text: string;
    dueDate: LocalDateKey | null;
}
export interface DeckNextPlansSlide extends DeckSlideBase<"next-plans"> {
    items: DeckPlanItem[];
}
export interface DeckSeriesPoint {
    periodStart: LocalDateKey;
    value: number;
}
export interface DeckSeries {
    goalId: string;
    goalTitle: string;
    kind: "status" | "metric";
    label: string;
    unit: string;
    current: number | null;
    target: number | null;
    points: DeckSeriesPoint[];
}
export interface DeckProgressSlide extends DeckSlideBase<"progress"> {
    series: DeckSeries[];
}
export interface DeckCommitment {
    goalId: string;
    goalTitle: string;
    text: string;
}
export interface DeckClosingSlide extends DeckSlideBase<"closing"> {
    commitments: DeckCommitment[];
}
export interface DeckAppendixEntry {
    goalId: string;
    goalTitle: string;
    recapSlideId: string;
    statusPill: GoalCheckIn["statusPill"];
    slipCount: number;
    metricText: string | null;
}
export interface DeckAppendixSlide extends DeckSlideBase<"appendix"> {
    entries: DeckAppendixEntry[];
}
export type DeckSlide =
    | DeckTitleSlide | DeckRecapSlide | DeckMissesSlide | DeckNextPlansSlide
    | DeckProgressSlide | DeckClosingSlide | DeckAppendixSlide;
export type DeckThinWarningKind =
    | "miss-without-reason" | "goal-without-plans" | "empty-period";
export interface DeckThinWarning {
    id: string;
    kind: DeckThinWarningKind;
    goalId: string | null;
    message: string;
}
export interface DeckEstimate {
    visibleSlides: number;
    totalSeconds: number;
    targetSeconds: number;
    overTarget: boolean;
    wordsPerMinute: number;
}
export interface DeckPlan {
    trackerId: string;
    trackerName: string;
    period: GoalPeriod;
    generatedAt: string;
    slides: DeckSlide[];
    /** In-memory copy retention keyed by stable goal ID, including body recaps. */
    appendixEntriesByGoal: Record<string, DeckAppendixEntry>;
    warnings: DeckThinWarning[];
    estimate: DeckEstimate;
}
```

`appendixEntriesByGoal` is the minimal in-memory copy-retention addition required
by the ORCH appendix correction: a promoted goal's edited appendix copy must
survive removal of its roster membership, including removal of the final appendix
slide. It adds no persisted entity field, storage key, or deck archive. It stores
only the existing `DeckAppendixEntry` shape; no renderer-specific state.

### Frozen `src/lib/goals/deck/plan.ts` exports

```ts
import type { Goal, GoalCheckIn, GoalTracker } from "../../../state/types";
import type { GoalPeriod } from "../periods";
import type { LifecycleDateProjection } from "../slips";
import type { DeckEstimate, DeckPlan, DeckSlide, DeckThinWarning } from "./types";

export interface DeckPlanInput {
    tracker: GoalTracker;
    goals: readonly Goal[];
    checkIns: readonly GoalCheckIn[];
    period: GoalPeriod;
    now: Date;
    evidenceTitlesByGoal?: Readonly<Record<string, readonly string[]>>;
    localDateOf?: LifecycleDateProjection;
}
export function buildDeckPlan(input: DeckPlanInput): DeckPlan;
export function countDeckWords(slide: DeckSlide): number;
export function suggestedSecondsForSlide(slide: DeckSlide): number;
export function estimateDeck(plan: DeckPlan): DeckEstimate;
export function findThinWarnings(plan: DeckPlan): DeckThinWarning[];
export function refreshDeckDerivations(plan: DeckPlan): DeckPlan;
export function setSlideHidden(plan: DeckPlan, slideId: string, hidden: boolean): DeckPlan;
export function moveSlide(plan: DeckPlan, slideId: string, direction: "up" | "down"): DeckPlan;
export function moveGoalToAppendix(plan: DeckPlan, goalId: string): DeckPlan;
export function moveGoalToBody(plan: DeckPlan, goalId: string): DeckPlan;
```

### Builder, ordering, retention, and edits

Archived tracker throws `RangeError("Cannot build a deck for an archived tracker")`.
Filter goals by tracker, creation-date exclusion, and lifecycle projection from section 4; sort sortOrder,
title, then id. Filter each goal's history through the requested period before any
derivation. Current check-in is the exact `(goalId, periodStart)` match. Focus uses
its isFocus; absent a current row, active-at-period goals default focus true.
Non-focus goals use appendix placement, retaining their full recap content.
Missing rows produce `No progress recorded this period` and empty planned items,
not a missing recap. That exact generated did placeholder is reserved for absence
of progress; it does not itself count as progress.

Slides always follow fixed blocks: title, all recaps (contiguous), misses,
next-plans, progress, closing, appendix. Each included goal has exactly one recap
`recap:<goalId>`. Other IDs are exactly `title`, `misses`, `next-plans`, `progress`,
`closing`, `appendix`; appendix exists iff at least one recap has appendix placement.
Hidden slides remain in the plan but are excluded from rendering/estimate; hiding
never discards content or changes placement. Appendix-placement recaps render only
through the roster, not again as body slides.

Misses come from unmet prior plans for goals with both previous and current stored
rows; reason is current missReason. Next-plans uses current planned items, closing
uses their texts with an honest placeholder when absent. Progress uses status-only
series through the requested period; no metric history is invented. Metric values
are current text on recaps/appendix. All notes are nonempty strings, seconds numeric.
`generatedAt = now.toISOString()` is the only clock seam. Same input deep-equals
same plan, including IDs/order/warnings/estimate. All copy is editable in memory.

`refreshDeckDerivations` recomputes seconds, warnings, estimate, and appendix
**membership**. Before membership changes, fold existing edited appendix entries
into `appendixEntriesByGoal` by stable goalId. Existing copy wins over newly derived
recap values; derive an entry only when missing. Roster entries select retained
copies for appendix-placement goals in recap order; removed membership keeps its
copy in the map while that recap exists. Remove retained copy only if the goal's
recap itself is removed. `goalId` and `recapSlideId` remain structural IDs. Editing
recap title/status/metric must never overwrite an already edited appendix entry.
Preview appendix edits update the corresponding retained entry before refresh.

Promote/demote first capture edited entries, change only placement and roster
membership, then refresh. The retained map preserves appendix edits in both
directions, even if the appendix slide temporarily disappears. Recap copy and its
hidden state survive both operations. No check-in is touched. `moveSlide` reorders
within its block only (in practice among recaps); crossing a block is rejected with
RangeError, as are unknown IDs/duplicate IDs/invalid block order. No cross-block
reordering, no silent duplicate slides. Plain copy edits are followed by refresh.

### Estimator and thin warnings

`countDeckWords` counts human-readable copy per slide kind: title, notes,
did/current/planned, reasons, metric labels/units, evidence titles, appendix copy,
series labels. Exclude IDs, date fields, numeric values, and suggestedSeconds.
Whitespace-separated nonempty tokens in copy count as words. Canonical seconds:
`8 + ceil(words / 130 * 60)`. Estimate counts/sums only visible rendered slides
(`!isHidden`, excluding appendix-placement recaps); target 300 seconds, overTarget
iff totalSeconds > 300. No slide cap or goal-count warning. Preview recomputes
after edits; estimator is the only talk-length calculation.

Warnings depend **only on DeckPlan data**, never an absent checkIns field:

- `thin:miss-without-reason:<goalId>` once per goal with a nonblank miss entry
  whose reason trims empty.
- `thin:goal-without-plans:<goalId>` once per recap with no nonblank planned text.
- `thin:empty-period` iff every recap has no progress: did trims empty or equals
  the exact generated placeholder, current trims empty, and evidenceTaskTitles has
  no nonblank entry. Metric text/status/planned/notes alone do not prove period
  progress. No recaps also means empty. This rule works after in-memory edits.

Warnings include hidden/appendix recaps so hiding cannot erase missing content.
IDs/order are deterministic (miss warnings in recap order, plan warnings in recap
order, empty warning last). Preview offers fix/skip/proceed; warnings never block.

### Chart and delivery decisions — #140, IMPL+

ORCH's decision **at freeze** is **hand-authored SVG + canvas PNG**, selected from
the researched options for its small dependency footprint and identical numeric
series across preview/export. RESEARCH compared options; it did not choose this
renderer. #140 implements and tests it. Series remain plain numeric status values
and date labels; `DeckSeries.kind` retains its future metric alternative, but v1
builders emit only status. Fewer than two points means no series.

Load the pptx library by a function-local dynamic import in the export handler,
never in the entry chunk or preview's static imports. Browser delivery direction
is anchor + blob; this is **not a claim of tested browser/native success**.
WebView2 delivery remains **UNVERIFIED until the Phase 11 human report** from the
real installed app. Phase 11 also checks PowerPoint editable text and fidelity.
Do not freeze an unproven success outcome in tests or PR claims. If native
plugin-dialog/plugin-fs fallback is required, it requires explicit policy review
and delegated IMPL+ edits to native/dependency/capability/AGENTS files; no quiet
fallback expansion of the slim shell.

Stamp only after the delivery helper has resolved successful **initiation**.
There is no browser download-completion/cancel signal. Renderer/pre-initiation
failure leaves the stamp unchanged. Then await `stampBuiltPeriod`; if initiation
succeeds but stamping fails, the export action rejects and displays that error.
No unawaited optimistic stamp, saved plan, cache, snapshot, or deck archive.

## 7. Frozen goal-set format — #141, Lane B

`src/lib/goals/goalSetFile.ts` is pure: no I/O, React, provider import, or boundary
math. It imports the canonical resolver from `periods.ts` for a new tracker anchor.

```ts
import type { Goal, GoalCadence, GoalTracker } from "../../state/types";
import type { LocalDateKey } from "../todos/types";

export const GOAL_SET_FORMAT = "worktime.goal-set" as const;
export const GOAL_SET_VERSION = 1 as const;
export interface GoalSetMetricDefinition {
    label: string;
    target: number;
    unit: string;
}
export interface GoalSetGoalDefinition {
    title: string;
    notes: string;
    projectId: string | null;
    metric: GoalSetMetricDefinition | null;
    lifecycle: Goal["lifecycle"];
    sortOrder: number;
}
export interface GoalSetTrackerDefinition {
    name: string;
    purpose: string;
    cadence: GoalCadence;
    color: string;
}
export interface GoalSetFile {
    format: typeof GOAL_SET_FORMAT;
    version: typeof GOAL_SET_VERSION;
    tracker: GoalSetTrackerDefinition;
    goals: GoalSetGoalDefinition[];
}
export type GoalSetErrorCode =
    | "invalid-json" | "unsupported-version" | "invalid-format" | "invalid-field" | "empty-goals";
export class GoalSetError extends Error {
    readonly code: GoalSetErrorCode;
    constructor(code: GoalSetErrorCode, message: string);
}
export function serializeGoalSet(tracker: GoalTracker, goals: readonly Goal[]): string;
export function parseGoalSet(json: string): GoalSetFile;
export function goalSetFileName(trackerName: string, today: LocalDateKey): string;
export function materializeGoalSet(
    file: GoalSetFile,
    now: Date,
    nextId: () => string,
): { tracker: GoalTracker; goals: Goal[] };
```

Canonical JSON key order is root `format, version, tracker, goals`; tracker
`name, purpose, cadence, color`; goal `title, notes, projectId, metric, lifecycle,
sortOrder`; metric `label, target, unit`; cadence `kind, weekday, intervalWeeks`
(omit intervalWeeks for monthly). Serialize as `JSON.stringify(value, null, 2) + "\n"`.
Select the tracker's goals and sort canonically by sortOrder, title, then id.
Include all its lifecycle states. Parser **preserves array order**. Materializer
assigns **sequential sortOrder 0..n-1 matching array order**, regardless of the
definition's numeric sortOrder, so the file list displays in that order.

Use ordinary `JSON.parse`, no extra parser/dependency. JSON syntax failure maps to
`invalid-json`. Non-object/array/null root maps to `invalid-field`; wrong/missing
format to `invalid-format`; wrong/missing version to `unsupported-version`;
remaining shape/field errors to `invalid-field`; valid-shaped zero goals to
`empty-goals`. Require exactly the listed own keys on every object, including the
correct cadence branch, with all required fields present; reject unknown keys.
Names/titles/metric labels must be nonempty trimmed strings; purpose is a string
without CR/LF; notes/color/unit strings; projectId null or nonempty string; metric
null or exact metric object with finite target; sortOrder finite number; lifecycle
exactly active/achieved/dropped. Cadence must pass #133 validation plus strict
branch keys (integer weekday 0..6, safe intervalWeeks >= 1). Duplicate JSON object
keys follow normal JSON.parse last-key semantics: no duplicate-key detection
promise. Invalid numbers/overflow are rejected by finite checks.

Definitions only: omit all IDs, metric current/source/overridePinned, all check-ins,
lastBuiltPeriodStart, cadenceAnchorAt, all created/updated/achieved/dropped timestamps,
tracker isArchived/sortOrder, and deck data. `materializeGoalSet` uses real factories,
fresh nextId values for tracker and every goal, never replace/merge. Use
`resolveCadenceAnchorAt(file.tracker.cadence, validatedLocalDateKey(now))`, with
the local-date conversion as an explicit input seam and **no boundary math here**.
New tracker is unarchived with null build key; provider appends its sort order.
Preserve goal lifecycle; import-now stamps achievedAt or droppedAt for that state,
clear the other, active clears both. Metric current 0, source manual, unpinned.
No imported check-ins. Clone cadence, metric, and goal arrays.

Filename is `goals-<slug>-<YYYY-MM-DD>.json`: ASCII lowercase; non-alphanumeric
runs become `-`; trim hyphens, cap at 40 characters (trim trailing hyphen after
cap), fallback `tracker`. No timestamp other than the supplied date.

## 8. Goal provider contract — #134, Phase 4 IMPL+ / Lane A

Mount `GoalProvider` inside `AuthenticatedShell`, inside SyncProvider, next to
HabitProvider; public login/signup/reset-password pages never construct it or read
goals. The intended nesting is:

```tsx
<DataProvider dataAccess={dataAccess}>
    <SyncProvider ownerId={session!.user.id}>
        <AppStateProvider>
            <ProjectManagerProvider>
                <AgentApprovalProvider>
                    <HabitProvider>
                        <GoalProvider>
                            <TodoProvider>{/* existing tree */}</TodoProvider>
                        </GoalProvider>
                    </HabitProvider>
                </AgentApprovalProvider>
            </ProjectManagerProvider>
        </AppStateProvider>
    </SyncProvider>
</DataProvider>
```

Use `useData()` and `useSync()`. Frozen `src/state/GoalContext.tsx` exports:

```ts
export const GOAL_UI_STORAGE_KEY = "goals_state_v1";
export interface GoalUIState {
    selectedTrackerId: string | null;
    expandedGoalIds: Record<string, boolean>;
}
export interface GoalState {
    trackers: Record<string, GoalTracker>;
    goals: Record<string, Goal>;
    checkIns: Record<string, GoalCheckIn>;
    ui: GoalUIState;
}
export interface NewGoalTrackerInput {
    name: string;
    purpose: string;
    cadence: GoalCadence;
    color: string;
    /** Optional supplied resolved boundary; must equal the canonical creation boundary. */
    cadenceAnchorAt?: LocalDateKey;
}
export interface NewGoalInput {
    trackerId: string;
    title: string;
    notes?: string;
    projectId?: string | null;
    metric?: GoalMetric | null;
    sortOrder?: number;
}
export interface GoalContextValue {
    state: GoalState;
    hydrated: boolean;
    revision: number;
    createTracker(input: NewGoalTrackerInput): GoalTracker;
    updateTracker(
        id: string,
        patch: Partial<Omit<GoalTracker, "id" | "createdAt" | "lastBuiltPeriodStart">>,
    ): void;
    archiveTracker(id: string, archived?: boolean): void;
    selectTracker(id: string | null): void;
    createGoal(input: NewGoalInput): Goal;
    updateGoal(id: string, patch: Partial<Omit<Goal, "id" | "trackerId" | "createdAt">>): void;
    setGoalLifecycle(id: string, lifecycle: Goal["lifecycle"]): void;
    reorderGoals(trackerId: string, idsInOrder: readonly string[]): void;
    upsertCheckIns(checkIns: readonly GoalCheckIn[]): void;
    saveCheckIns(checkIns: readonly GoalCheckIn[]): Promise<void>;
    stampBuiltPeriod(trackerId: string, periodStart: LocalDateKey): Promise<void>;
    persist(): Promise<void>;
    refreshGoals(): Promise<void>;
    setGoalExpanded(id: string, expanded: boolean): void;
}
export const GoalProvider: React.FC<{ children: React.ReactNode }>;
export function useGoals(): GoalContextValue;
```

`useGoals` throws outside the provider. `createTracker` assigns next sort order
and calls the pure canonical resolver with the creation local date. Rule changes
call it with the reset local date; an optional supplied anchor must equal that
result, otherwise reject. An anchor-only update without a rule change cannot
silently reset the grid. No provider boundary math. It may import this resolver
from the Phase 4 minimal periods dependency; it does not derive windows/due state
or import slips/evidence. Only `stampBuiltPeriod` changes lastBuiltPeriodStart;
runtime patch attempts to change it are rejected as well as excluded by typing.

Lifecycle setters stamp now for selected achieved/dropped state and clear the
other; active clears both. No deletion. Reorder modifies only named goals in the
tracker; omitted goals retain order and remain saved. Check-in upserts merge by
natural key, retain all other rows, and use a latest staged server ID where present.
`saveCheckIns` merges then awaits the serialized complete-set save. All UI keeps
the natural pair as identity.

### Hydration, revision handling, and serialized full-set saves

Mirror HabitContext's lifecycle/echo suppression, with the stronger awaited seam:

1. Hydrate once with loadGoals, validate each row using #133 validators, warn/drop
   invalid rows without throwing, load validated UI-only state, set hydrated and
   baseline serialized slice, suppress first save. Authenticated mounting is required.
2. Retain lastSavedSerializedRef, pendingSerializedRef, suppressSaveRef. Skip
   duplicate/pending slices and first post-hydrate effect. Save effects require
   hydrated and SyncProvider initialized. CRUD save failures clear pending markers
   and warn; no retry loop that bypasses error handling.
3. **Every save** (effect, persist, saveCheckIns, stamp) uses one provider-local
   serialized promise queue; failed writes do not poison later queue operations.
   Capture local pending edits relative to the last accepted baseline, then at
   execution time re-read the latest full staged set via loadGoals. Retain staged
   remote-only rows and unchanged rows; overlay pending local whole-row edits by
   ID/natural key, reconcile staged check-in IDs, and preserve maximum build key.
   Do not overlay a stale entire state snapshot over untouched remote rows.
4. Reconcile edits made while a queued write was in flight: do not mark later edits
   saved by advancing the baseline to a slice that was never written. Queue them
   against the latest baseline/staged slice. Save all three complete arrays, with
   deterministic ID sorting for comparison only. Never filter lifecycle/archive.
5. Revision reload calls loadGoals. If local edits are pending, reconcile instead
   of replacing them; otherwise accept loaded state, advance baseline, suppress
   echo. Surface revision for #136's pinned-period stale warning. refreshGoals
   awaits `sync({ reason: "manual" })` then reloads staged data through this path.
6. `stampBuiltPeriod` joins the same queue, re-reads staged data at execution time,
   overlays pending local edits without omitting remote additions, and saves
   `max(requested, staged, pending-local build keys)`. Publish the stamp in memory
   only after successful awaited save, retaining edits made meanwhile. Failure
   rejects, surfaces through #140, and publishes no optimistic stamp. The stamp
   operation itself makes no storage change on writer validation/save failure.

This is a **best-effort provider-local ordering boundary**, not atomic multi-tab
compare-and-swap. Current DataAccess offers no CAS/version predicate across tabs;
another tab can change staged rows between load and save. Preserve observed newer
stamps, rely on the writer's backwards guard, and propagate any rejection. Do not
claim lost-update immunity. Tests must cover serialized ordering of effect/awaited
saves, a remote-only staged row, pending local edit preservation, a newer staged
stamp, and failed stamping after successful download initiation. Any needed
DataAccess change escalates to IMPL+; later lanes do not edit `src/lib/data/**`.

`goals_state_v1` contains only selectedTrackerId (string/null) and expandedGoalIds
(boolean record); ignore other fields. UI persistence uses try/catch; quota failure
is nonfatal. It is device UI state, never staged, synced, or part of saveGoals.

## 9. Page mount points and frozen props

Lane A owns GoalsPage and all mount hunks. Phase 4 leaves stable DOM slots and
exact first-start copy from the saved resolved anchor; later components mount in
their assigned phases. It does not claim badge/wizard/deck implementation or
Phase 4 window derivation. Existing period types may be imported once the minimal
Phase 4 dependency exists. No pending/unsnapped-boundary availability variants.

| Slot | Location | Later owner |
| --- | --- | --- |
| `data-goals-slot="tracker-due"` + `data-tracker-id` | Tracker header | Lane A #135 |
| `data-goals-slot="goal-slip"` + `data-goal-id` | Goal row | Lane A #135 |
| `data-goals-slot="check-in-entry"` + `data-tracker-id` | Tracker actions | Lane A #136 |
| `data-goals-slot="deck-entry"` + `data-tracker-id` | Tracker actions | Lane A mount #139 |
| `data-goals-slot="goal-set-actions"` + `data-tracker-id` | Tracker actions | Lane A mount / Lane B #141 |
| `data-goals-slot="check-in-wizard"` | Page modal root | Lane A #136 |
| `data-goals-slot="deck-preview"` | Page modal root | Lane A mount / Lane B component #139 |
| `data-goals-slot="due-nudge"` | Page effect host | Lane A #135 |

```ts
// src/components/goals/TrackerDueBadge.tsx — Lane A, #135
export interface TrackerDueBadgeProps { due: boolean; periodLabel: string | null; }
// src/components/goals/GoalSlipBadge.tsx — Lane A, #135
export interface GoalSlipBadgeProps { consecutiveSlips: number; }

// src/components/goals/CheckInEntry.tsx — Lane A, #136
export type CheckInAvailability =
    | { kind: "not-started"; message: string; firstPeriodLabel: string | null }
    | { kind: "open"; periodStart: LocalDateKey; periodLabel: string };
export interface CheckInEntryProps {
    trackerId: string;
    availability: CheckInAvailability;
    onOpen: (periodStart: LocalDateKey) => void;
}
// src/components/goals/DeckEntry.tsx — Lane A entry/mount, #139
export type DeckEntryAvailability =
    | { kind: "not-ready"; message: string }
    | { kind: "ready"; period: GoalPeriod; built: boolean };
export interface DeckEntryProps {
    trackerId: string;
    trackerName: string;
    availability: DeckEntryAvailability;
    onBuild: (period: GoalPeriod) => void;
}
// src/components/goals/CheckInWizard.tsx — Lane A, #136
export interface CheckInWizardProps {
    trackerId: string;
    period: GoalPeriod;
    onClose: () => void;
}
// src/components/goals/DeckPreview.tsx — Lane B component, Lane A GoalsPage mount
export interface DeckPreviewProps {
    plan: DeckPlan;
    onClose: () => void;
    onExport: (plan: DeckPlan) => void | Promise<void>;
}
// src/components/goals/GoalEvidencePanel.tsx — Lane A, #137
export interface GoalEvidencePanelProps {
    goal: Goal;
    checkIn: GoalCheckIn;
    period: PeriodBounds;
    onChange: (patch: Partial<Pick<GoalCheckIn, "did" | "current" | "evidenceTaskIds">>) => void;
}
// src/components/goals/GoalSetActions.tsx — Lane B, #141; Lane A mounts
export interface GoalSetActionsProps {
    trackerId: string;
    onImported: (newTrackerId: string) => void;
}
// src/components/goals/GoalDueNudge.tsx — Lane A, #135
export interface GoalDueNudgeProps { today: LocalDateKey; }
```

Due badge renders nothing unless due; slip badge renders nothing below two,
neutral factual copy at two or more. Entries are disabled when not-started/not-ready,
with exact saved first-start date in relevant copy. Phase 4 leaves future mounts,
not falsely open/ready entries. #136 derives current period at open, refuses an
invalid/no-current target, pins it throughout the session, and offers reload/continue
on stale revision/build-key change without retargeting. Staleness is test-verifiable
until #140 exists; do not claim real-world verification earlier. Upserts retain the
full set; past editor preserves historical keys even after resets.

DeckEntry chooses mostRecentCompletedPeriod, built iff key equals target start.
DeckPreview edits only in memory and never statically imports pptx. Evidence panel
is a future wizard mount with explicit accept/reject and freeze-on-touch. GoalSetActions
uses the #140 delivery helper and creates a new tracker through the provider path;
never replace/merge existing goals. Component and GoalsPage mount remain separate
owners. Due nudge baselines on mount, no closed-app catch-up, in-memory session
dedupe `${trackerId}:${periodStart}`, calls `notifyNow({ title, body })` directly,
not maybeNotifyTimerEnd. No persisted marks, push, or background sync; archived and
pre-first-period trackers never notify.

## 10. Shared fixtures — integrator-owned, test-only

`src/lib/goals/testFixtures.ts` exports exactly these builders/constants and fixed
override interfaces. Lanes import, never edit; production code must not import it.
No runtime I/O, wall clock, random IDs, calendar resolution, or later module import.

```ts
export const GOALS_FIXTURE_CREATED_AT: string;
export const GOALS_FIXTURE_TODAY: LocalDateKey;
export const GOALS_FIXTURE_SNAPPED_TODAY: LocalDateKey;
export const GOALS_FIXTURE_EVERY_N_WEEKS: GoalCadence;
export const GOALS_FIXTURE_MONTHLY: GoalCadence;
export const GOALS_FIXTURE_ANCHOR: LocalDateKey;
export const GOALS_FIXTURE_SNAPPED_ANCHOR: LocalDateKey;
export interface GoalTrackerFixtureOverrides {
    id?: string;
    name?: string;
    purpose?: string;
    cadence?: GoalCadence;
    cadenceAnchorAt?: LocalDateKey;
    color?: string;
    sortOrder?: number;
    isArchived?: boolean;
    lastBuiltPeriodStart?: LocalDateKey | null;
    createdAt?: string;
    updatedAt?: string;
}
export interface GoalFixtureOverrides {
    id?: string;
    trackerId?: string;
    title?: string;
    notes?: string;
    projectId?: string | null;
    metric?: GoalMetric | null;
    lifecycle?: Goal["lifecycle"];
    achievedAt?: string | null;
    droppedAt?: string | null;
    sortOrder?: number;
    createdAt?: string;
    updatedAt?: string;
}
export interface GoalCheckInFixtureOverrides {
    id?: string;
    goalId?: string;
    periodStart?: LocalDateKey;
    did?: string;
    current?: string;
    planned?: GoalCheckIn["planned"];
    statusPill?: GoalCheckIn["statusPill"];
    missReason?: string;
    isFocus?: boolean;
    evidenceTaskIds?: string[];
    createdAt?: string;
    updatedAt?: string;
}
export interface GoalFixtureSet {
    tracker: GoalTracker;
    goals: Goal[];
    checkIns: GoalCheckIn[];
}
export interface GoalFixtureSetOverrides {
    tracker?: GoalTracker;
    goals?: Goal[];
    checkIns?: GoalCheckIn[];
}
export function buildGoalTrackerFixture(overrides?: GoalTrackerFixtureOverrides): GoalTracker;
export function buildGoalFixture(overrides?: GoalFixtureOverrides): Goal;
export function buildGoalCheckInFixture(overrides?: GoalCheckInFixtureOverrides): GoalCheckIn;
export function buildEveryNWeeksTrackerFixture(overrides?: GoalTrackerFixtureOverrides): GoalTracker;
export function buildMonthlyWeekdayTrackerFixture(overrides?: GoalTrackerFixtureOverrides): GoalTracker;
export function buildSnappedMonthTrackerFixture(overrides?: GoalTrackerFixtureOverrides): GoalTracker;
export function buildArchivedTrackerFixture(overrides?: GoalTrackerFixtureOverrides): GoalTracker;
export function buildMetricGoalFixture(trackerId?: string): Goal;
export function buildAchievedGoalFixture(trackerId?: string): Goal;
export function buildDroppedGoalFixture(trackerId?: string): Goal;
export function buildPlannedCheckInFixture(overrides?: GoalCheckInFixtureOverrides): GoalCheckIn;
export function buildCheckInHistoryFixture(goalId?: string): GoalCheckIn[];
export function buildCleanCheckInHistoryFixture(goalId?: string): GoalCheckIn[];
export function buildNaturalKeyDuplicatesFixture(goalId?: string): GoalCheckIn[];
export function buildGoalFixtureSet(overrides?: GoalFixtureSetOverrides): GoalFixtureSet;
```

Builders call the real #133 factories. Fixed creation instant is
`2026-09-20T12:00:00.000Z`; today `2026-11-02`; snapped today `2026-12-15`;
weekly every-other-Sunday anchor `2026-10-04`; monthly Sunday and snapped nominal
December anchor `2026-11-29`. Date-sensitive tests pass local date literals/grid
inputs; a noon UTC instant is not a universal host-local-date guarantee.
`createdAt` supplies factory now; updatedAt defaults to it with optional fixed
override for dedupe tests. Every call returns fresh mutable nested cadence, metric,
planned-item, and evidence arrays, including when supplied through overrides.

The default full set contains active/metric/achieved goals and their check-ins.
With goals overridden, default check-ins are filtered to those goal IDs; an empty
goals override produces no default check-ins. Explicit dangling check-ins throw
RangeError, as do goals belonging to a different tracker in this single-tracker set.
Caller-owned override objects/arrays are cloned through factories, never returned
by reference. Clean history uses exact plain/checked did lines, no `Did <text>`
heuristic. Slip history deliberately leaves both prior plans unmet. Natural-key
duplicates have a **newer local** updatedAt than the server copy: storage tests
must still keep the server ID; pure history tests retain greatest updatedAt because
they have no provenance. These are distinct rules, not conflicting fixture claims.

## 11. Ownership and phase routing amendments

| Files/area | Owner / authorized editor | Boundary |
| --- | --- | --- |
| `src/state/types.ts`, `src/lib/goals/cadence.ts`, `factories.ts` | #133 foundation only | Frozen actual exports; cadence validates only |
| `src/lib/data/**`, staging/sync, migrations | #133; later need requires IMPL+ escalation and ORCH scope review | No ordinary lane edits |
| `docs/goals/contract.md`, `src/lib/goals/testFixtures.ts` | Delegated integrator child; ORCH sign-off | This Phase 2 materialization only; lanes import/read |
| `src/components/GoalsPage.tsx`, `src/state/GoalContext.tsx`, `src/App.tsx` | Lane A; Phase 4 IMPL+ | Includes all page mount hunks |
| `src/lib/goals/periods.ts` + test | Phase 4 IMPL+ temporarily; Phase 5 Lane B extends merged file | Phase 4 period types + resolver only; one canonical snapping implementation |
| `src/lib/goals/slips.ts` + test | Lane B #135 | No competing boundary helper |
| `src/components/goals/CheckInWizard.tsx` + test | Lane A #136 | Existing did encoding, pinned natural key |
| `TrackerDueBadge.tsx`, `GoalSlipBadge.tsx`, `GoalDueNudge.tsx` under goals components | Lane A #135 | Phase 6 future mounts |
| `CheckInEntry.tsx`, `DeckEntry.tsx` under goals components | Lane A #136/#139 | Phase 4 leaves slots/copy, not working features |
| `src/lib/goals/deck/**` | Lane B #138, export implementation #140 delegated IMPL+ | Pure plan separated from renderer/delivery |
| `src/components/goals/DeckPreview.tsx` | Lane B #139 | Lane A owns GoalsPage mount only |
| `src/lib/goals/goalSetFile.ts`, `src/components/goals/GoalSetActions.tsx` | Lane B #141 | Lane A mounts actions |
| `src/lib/goals/evidence.ts`, `src/components/goals/GoalEvidencePanel.tsx` | Lane A #137 | Ratified Phase 12: selector and wizard panel are one Lane A change |
| `docs/research/**` | RESEARCH within its configured write profile | Authorized research notes, including Phase 9 dogfood findings |
| `AGENTS.md`, `docs/FEATURES.md`, shared planning/issue docs, dependencies/lockfile, `src-tauri/**` | Authorized integrator child; IMPL+ for escalated/native/data/version work | No ordinary lane ownership or ORCH direct edits |

| Phase | Implementer | Acceptance/merge |
| --- | --- | --- |
| 1 foundation | IMPL+ | ORCH; v8 ladder already automated |
| 2 contract/fixtures | RESEARCH chat draft → IMPL+ materialization → authorized IMPL+ commit-only child | ORCH review/signature freeze; gate acceptance after independent rerun; no direct edits/ordinary commit |
| 3 bootstrap | ORCH coordinates worktrees/environment bootstrap | ORCH |
| 4 #134 + minimal #135 dependency | **IMPL+** | ORCH; limited scope amendment above |
| 5 #135 periods/slips completion | Lane B IMPL | ORCH |
| 6 #135 badge/nudge | Lane A IMPL | ORCH |
| 7 #136 wizard / #138 plan | Lane A / Lane B IMPL | ORCH; independent RESEARCH review |
| 8 milestone | ORCH integrates; children resolve/edit if needed | ORCH + human check |
| 9 real-period dogfood | User; RESEARCH writes `docs/research/goals-dogfood-1.md` | ORCH + human check |
| 10 #139 preview | Lane B IMPL, Lane A mount | ORCH |
| 11 #140 pptx/delivery | IMPL+ in main worktree | ORCH + human check |
| 12 #137 / #141 | Lane A #137 IMPL, Lane B #141 IMPL | ORCH; independent RESEARCH review |
| 13 docs/version | Delegated **IMPL+** docs and `pnpm run version` | ORCH verifies test:version, MSI, final gates, merges |
| 14 #143 then #142 | IMPL+ follow-ups | ORCH |

Normal IMPL+ edits remain **workspace-write**. The narrowly authorized
**danger-full-access commit-only exception applies specifically to IMPL+ (Codex)**,
not IMPL/OpenCode. It grants no editing, gate, push, or merge permission beyond
its separate commit brief. Children commit their own authorized branches and never
push. RESEARCH's configured profile permits writes to `docs/research/**`, including
normal authorized research notes and Phase 9 dogfood notes. Only the Phase 2
contract/fixture targets are outside that profile, so RESEARCH drafted them in chat
and IMPL+ materialized them. Do not credit research drafts to ORCH or require
IMPL+ to materialize authorized research notes.

ORCH reviews/coordinates, starts/concludes merges, pushes, and runs acceptance
gates. Conflict edits and fix-forward edits are delegated to the proper child,
not hand-written by ORCH. ORCH's only add/commit exception is concluding an
**agent-resolved merge** with `git add -A` + `git commit --no-edit` after reviewing
the complete resolved working tree. ORCH has no ordinary add/commit or version-bump
permission. No version bump before Phase 13. IMPL+ runs the delegated Phase 13
version script (which itself builds Tauri); ORCH verifies its output and reruns
final gates. No silent model switches, subagents, or cross-owner work in a lane.

Stop/report escalation triggers: two identical gate failures, a needed signature
change, any out-of-ownership file, unsettled cadence semantics, data merge/migration
correctness, runtime WebView2/pptx diagnosis, or cross-lane scope. Do not improvise,
reroute, or rebase a branch already merged into epic/goals.

## 12. Bootstrap, gates, and integration commands

Bootstrap preconditions: ORCH has reviewed/frozen the contract,
children have committed all required planning/contract/fixture files, ORCH has
merged/pushed epic/goals, and Gate 2 is accepted. Untracked docs are not available
to another worktree. Commit ownership follows the authorized branch/file scope;
blanket workflow add commands do not expand edit ownership. Phase 2 commit message:
`docs(goals): contract, shared fixtures, decisions, research, parallel workflow`.

ORCH coordinates bootstrap (from main worktree, one active agent per branch/tree):

```powershell
git fetch origin
git switch epic/goals
git pull
git worktree list
git worktree add ..\WorkTime-ui -b issue/134-goals-page epic/goals
git worktree add ..\WorkTime-engine -b issue/135-goals-periods epic/goals
Copy-Item .env.development.local ..\WorkTime-ui\
Copy-Item .env.production.local ..\WorkTime-ui\
Copy-Item .env.development.local ..\WorkTime-engine\
Copy-Item .env.production.local ..\WorkTime-engine\
```

In each lane, before feature work:

```powershell
pnpm install --frozen-lockfile
pnpm lint:app
pnpm test:unit
pnpm build
```

Build requires all three public Vite variables; canonical production app URL is an
origin without path/trailing slash. Do not print secrets or copy server credentials
to browser config. A sandbox/cache install restriction is reported, not solved by
dependency/lock changes or clearing node_modules. Phase 3 is accepted only after
both untouched lane gates pass. No Supabase/functions server is needed in lanes.

Lane work loop, **only for a branch not yet merged into epic/goals**:

```powershell
git fetch origin
git rebase origin/epic/goals
pnpm lint:app
pnpm test:unit src/lib/goals
pnpm test:unit
pnpm build
```

Children commit their owned files under their authorized commit brief and configured
sandbox. The separately authorized IMPL+ Codex commit-only exception may run:

```powershell
git add -- docs/goals/contract.md src/lib/goals/testFixtures.ts
git commit -m "docs(goals): contract, shared fixtures, decisions, research, parallel workflow"
git log -1 --format=%H
```

No child pushes. No lane runs Supabase, dev port 3000, test:integration, test:e2e,
test:pwa, test:platform, test:all, branch:check, tauri build, or version scripts.
Phase 13's specifically delegated IMPL+ version operation is the explicit later
exception, not a general lane permission.

ORCH integration in the main worktree (workflow sections 3/4, amended):

```powershell
git switch epic/goals
git fetch origin
git merge --no-ff issue/<n>-<slug>
pnpm lint:app
pnpm test:unit
pnpm build
```

If conflicted: inspect `git status` and `git diff --name-only --diff-filter=U`,
delegate resolution to the appropriate child, review its full diff, rerun relevant
unit checks and the merge gate. Only for that agent-resolved merge may ORCH conclude:

```powershell
git add -A
git commit --no-edit
```

Do not resolve semantic conflicts by deleting tests. GoalsPage Lane B changes mean
ownership violation: stop, split into a component and Lane A mount. Dependency
conflicts require delegated resolution against epic's dependencies plus install;
unplanned version changes must be removed by a child. Migrations remain #133-only.
Contract conflicts/signature drift require a reviewed delegated amendment and
notification to both lanes. Fix forward through authorized children on epic/goals;
never retro-fix/rebase a merged lane or force-push main/epic. A red gate blocks
the next phase, not independent already-authorized lane work.

| Tier | Runner | Commands/evidence |
| --- | --- | --- |
| Phase 2 implementation / lane | IMPL or delegated IMPL+ | lint:app → narrow unit → full unit → build |
| Phase 2 acceptance after commit/merge | ORCH independently reruns | lint:app → narrow unit → full unit → build |
| Epic merge acceptance | ORCH reruns | lint:app → full unit → build |
| Epic phase acceptance | ORCH main worktree | supabase:start, supabase:serve separately, test:all; platform when policy/native changed |
| Phase 13 docs/version action | Delegated IMPL+ | Shared docs, `pnpm run version minor` once; script builds Tauri |
| Final acceptance | ORCH | test:version, MSI inspection, build/unit/PWA/platform/integration/E2E/Tauri gates |

ORCH alone accepts gates and merges/pushes. RESEARCH checks are advisory; ORCH
reruns every gate relied on. Integration resets the local DB; no lane runs it.
ORCH's final verification includes `pnpm test:version` and inspecting
`src-tauri/target/release/bundle/msi/`, then final build/unit/PWA/platform/local
Supabase integration/E2E and Windows packaging smoke checks. ORCH does not run
`pnpm run version`. Only delegated Phase 13 IMPL+ edits/bump the three version
files together.

Each handoff reports branch, committed SHA (or explicitly uncommitted), owned files,
tests added, contract deviations, and the last lines/outcomes of every gate run.

## 13. Human pauses and remaining verification

Human pauses are **only Phase 8, Phase 9, and Phase 11**:

- Phase 8: real browser/Tauri check-in loop, remount persistence, second-device pull.
- Phase 9: dogfood one real period.
- Phase 11: actual installed WebView2 download report and editable PowerPoint output.

The v8→v9 ladder already has automated coverage; do not invent a manual localStorage
upgrade/clear step. Renderer direction is ORCH's freeze decision, not another human
pause or a RESEARCH conclusion. WebView2 download and PowerPoint fidelity remain
unverified until Phase 11; no present success claim. #143 CORS/aggregate integration
and #142 output enhancement are Phase 14 follow-ups, outside Phases 2–13.

Freeze authority remains ORCH; drafts remain credited to RESEARCH; authorized
children materialize/edit/commit; ORCH has only the agent-resolved merge
add-A/commit-no-edit exception.
