# Issue #133 — Goals foundation decisions (binding)

Status: **signed off** (research and decisions phase complete).
Authority: ORCH signs; IMPL/IMPL+ implement; RESEARCH may not change these.
Supersedes: the "Research Needed" section and the derivation Notes in `docs/issues/issue-133.md`.

These decisions close the two questions the issue raised (merge strategy, tombstone cascade) and
six additional questions that surfaced while reading the code. Each one would have been expensive
to change after #133 lands, because #133 owns the types, the staging schema version, and the
`apply_staged_sync` signature that every later issue builds on.

---

## 1. Merge strategy: whole-row LWW for all three collections

**Decision.** Use `mergeVersionedCollection` (`src/lib/data/sync/merge.ts:739`) for trackers, goals,
and check-ins. Do not port `mergeHabits`.

**Why.** `mergeVersionedCollection` is already generic and is used by all seven pet collections, so
adopting it is three call sites plus assembly in `buildPushPlan`/`mergePulledSnapshot`. The habits
field-level merge is not a safe template to copy: `mergeHabitRow` compares fields with
`localHabit[field] !== base[field]` (`merge.ts:362-363`), which is reference comparison. That works
for the primitive-only `Habit` shape, but `Goal.metric` (object) and `GoalCheckIn.planned` (array)
would report "changed on both branches" for every record, so a copy-paste would silently degrade to
remote-wins on those fields. Field-level merging is only correct after the comparator becomes
`valuesEqual` per field, which is more code and more risk in the highest-stakes issue of the epic.

**Consequence.** Concurrent edits to different fields of the same goal lose one side. Accepted for
single-owner data. Field-level merge is not revisited unless multi-user collaboration appears.

## 2. `lastBuiltPeriodStart` is a period key, not an export timestamp, and is monotonic

**Decision.** `GoalTracker.lastBuiltPeriodStart: LocalDateKey | null` stores the **period start of
the last built deck**. It is guarded to never move backwards, in two places:

- the merge takes the later of local and remote (lexicographic max on the date key);
- `saveGoals` refuses to write a value earlier than the one already staged.

**Why.** The field is written by the export subsystem (#140), while every other tracker field is
written by the tracker editor (#134). Under whole-row LWW, a stale device renaming a tracker would
otherwise push its old (null or earlier) copy of the field and un-consume the period, so the due
badge would fire again and the same period could be built twice. Storing a period key rather than an
ISO timestamp makes this nearly free: two devices that export the same period write the **identical**
value, so there is nothing for LWW to resolve, and the guard reduces to a string comparison.

**Consequence.** The export timestamp is no longer recorded anywhere. That is consistent with the
"no deck archive" rule — the only durable export effect is which period was built.

## 3. Check-ins need a natural-key dedupe, not just whole-row LWW

**Decision.** Check-in identity is `(goalId, periodStart)` in addition to the transport `id`. Port
the `bucketOwner` dedupe shape from `mergeHabitCompletions` (`merge.ts:613-637`), keyed by
`goalId` + `periodStart`, and upsert in SQL with `on conflict (owner_id, goal_id, period_start)`.

**Why.** Whole-row LWW merges by `id` only. Two devices that each create a check-in for the same
period hold two different ids, so a merge would keep both and the RPC would raise a unique
violation on `(owner_id, goal_id, period_start)` — a permanent sync failure, not a transient error.
Habits hit the identical problem with `(habit_id, bucket)` and solved it in both places: TS dedupe
(`merge.ts:613-637`) and `on conflict (habit_id, bucket)` in the RPC
(`20260804000000_habit_staged_sync_rpc.sql:273`). Adopt the same pattern rather than inventing one.

**Consequence.** The server's row wins a natural-key collision and the local ghost id is dropped, so
pending state converges. The local id can only be a ghost if it was never pushed, because the
unique constraint prevents the push.

## 4. No tombstone provenance and no cascade guard, because nothing is hard-deleted in v1

**Decision.** Trackers are archive-only (`isArchived`), goals move through
`active | achieved | dropped` and are never removed, and check-ins are upsert-only. Tombstone maps
for all three collections exist **structurally** — `mergeVersionedCollection` and `buildPushPlan`
require them, and `countPending` reads them — but they stay empty in v1. No `trackerId`/`goalId`
provenance, and no SQL guard migration.

**Why.** The habits cascade needed provenance because deleting a habit cascaded completion
tombstones, and a concurrent parent update could revive the habit while its history was being
erased (`supabase/migrations/20260805000000_habit_completion_tombstone_guard.sql:1-12`). With no
delete affordance, that race cannot be created: every row that exists locally also exists remotely,
and nothing is ever omitted from the desired set except by a bug.

**Re-opens if** #134 (or any later issue) adds a hard-delete affordance for a tracker, goal, or
check-in. At that point the two-level cascade must land together: provenance on the child
tombstone, a merge rule that drops a provenanced tombstone when the parent survived
(`merge.ts:604` is the one-level precedent), and a SQL guard mirroring `20260805000000`. Split
across those layers, the guard is useless: deleting the parent row cascades in Postgres regardless
of what the child tombstone says.

**Consequence.** `StagedDataAccess.test.ts` has no "cascade behavior" case to write. Do not add a
placeholder test for it.

## 5. Cadence is a discriminated union of calendar rules, not an enum

**Decision.** Replace `cadence: "bi-weekly" | "monthly"` with a rule union, plus a parity epoch:

```ts
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type GoalCadence =
    | { kind: "every-n-weeks"; weekday: Weekday; intervalWeeks: number } // every other Sunday
    | { kind: "monthly-weekday"; weekday: Weekday };                     // first Sunday of the month
```

`GoalTracker.cadenceAnchorAt: LocalDateKey` is the snapped boundary date that acts as the parity
epoch for `every-n-weeks` and as the reset point whenever the cadence rule changes.

`monthly-weekday` resolves to: the first matching weekday of the month; **except** when the 1st of
that month is a Monday or Tuesday, in which case the matching weekday **on or before** the 1st is
used. For "first Sunday" that means the boundary lands in the previous month whenever the 1st is a
Monday or Tuesday, which is the point: it prevents waiting 5–6 days into the month for the first
Sunday. That is the "Mon/Tue snap-backward" policy, hardcoded in the boundary function and
documented in the contract.

Note the trigger is the **weekday of the 1st**, not the length of the gap. For a weekday other than
Sunday the two framings diverge (with a Monday the 1st and a Wednesday cadence, snap-forward waits
only two days but the rule still snaps backward), so implement the weekday check, not a day-gap
threshold. If the chosen weekday is the same as the 1st's weekday, "on or before" resolves to the
1st itself.

**Why.** The user needs "first Sunday of the month" and "every other Sunday", neither of which an
enum expresses. A discriminated union keeps each variant switchable and exhaustively testable, and
is the convention already used by `TodoRule` (`src/lib/todos/types.ts:41`). An RRULE string was
rejected: it needs a parser, admits untrusted expressions, and adds a dependency to the foundation
issue for no v1 benefit. Flat optional fields were rejected because invalid combinations become
representable and must be guarded at runtime.

**Consequence.** Period length is no longer constant. `monthly-weekday` periods are roughly 27–35
days depending on the chosen weekday (28–35 for a Sunday cadence), so period math must iterate the
rule rather than add a fixed duration. Any code that assumed "bi-weekly means 14 days" is wrong.

## 6. Periods are an anchored local-date grid; `periodEnd` is derived

**Decision.** Period boundaries are `LocalDateKey` values (`YYYY-MM-DD`), reusing
`src/lib/todos/calendar.ts` and the `LocalDateKey` type from `src/lib/todos/types.ts`.
`GoalCheckIn.periodStart: LocalDateKey` is stored; **`periodEnd` is removed from the type** and
derived as the next boundary. The grid is computed from `cadenceAnchorAt` + the cadence rule, never
from `lastBuiltPeriodStart`. The first period starts at the first boundary **strictly after**
`createdAt`; `cadenceAnchorAt` may sit earlier (it is the parity epoch, not necessarily a period
start). No backfill and no partial first period.

**Why local date keys.** `periodStart` is the check-in identity key, so it must not shift with a
timezone or a DST boundary. The todos domain already solved this: `localDateKey` is tested as
"ignores timezone", `nextOccurrence` deliberately returns **local-noon** dates to avoid DST midnight
changes (`src/lib/todos/recurrence.ts:196-209`), and `todo.dueDate` is a `LocalDateKey`. ISO
instants would make "Sunday" mean UTC Sunday and move the identity key under DST.

**Why derived `periodEnd`.** A persisted `periodEnd` becomes wrong the moment the cadence rule
changes, and would then contradict the grid for every historical check-in. Deriving it from the rule
keeps history consistent by construction.

**Why anchored rather than `lastBuiltPeriodStart`-derived.** The issue text derived `periodStart`
from `lastBuiltPeriodStart ?? createdAt`. Because that value is per-device until sync converges, two
devices could compute different `periodStart` values for the same real period — and no natural-key
dedupe can collapse two genuinely different keys. Anchoring the grid to a synced field removes the
drift entirely.

**Consequence.** Between tracker creation and the first boundary there is **no open period**. The
wizard (#136) needs an explicit "no open period yet" state, the due badge (#135) must stay silent,
and #134 needs copy for it. Also: a label for a snapped-backward monthly period must be derived from
the period's month, not from the `periodStart` string's month, or October will render as September.

## 7. Storage and transport shapes

**Decision.**

- **Nine flat staging fields** on `StagedOwnerRecord`/`SyncSnapshot`, matching the pet slices:
  `goalTrackers`, `goals`, `goalCheckIns`, plus `goalTrackerUpdatedAt`, `goalUpdatedAt`,
  `goalCheckInUpdatedAt`, plus `goalTrackerTombstones`, `goalTombstones`, `goalCheckInTombstones`.
- **Staging schema v8 → v9** with a ladder step injecting empty maps into both the record and
  `lastSynced`, plus `REQUIRED_FIELD_CHECKS` entries and `countPending`/`discardPendingChanges`
  coverage.
- **`metric`, `planned`, and `evidence_task_ids` are jsonb columns.** One column per value keeps the
  whole-row-overwrite model consistent with LWW, and #143 can rewrite `metric.current` without a
  schema change.
- **`apply_staged_sync` grows six positional arguments** (upserts + tombstones per collection,
  36 → 42), following the pet wrapper pattern. No bundled `p_goals_data` blob in v1.
- **Parent rows push before child rows** (trackers → goals → check-ins).

**Why.** Every one of these follows an established precedent that reviewers can diff against. The
bundle-vs-positional choice is the only close call; positional wins because the private/public
wrapper chain is generated by matching the previous signature exactly, and a bundled argument would
make the goals migration read differently from the seven that came before it.

**Count correction (ORCH authorized).** Independently verified existing public/private SQL and frontend transport have 36 inputs; adding exactly six gives 42. ORCH authorized this correction using the user's explicit instruction to choose what is best for the end user. No padding inputs are introduced.

**Consequence.** 42 positional arguments is near the practical limit of readability. If a later
issue adds a fourth collection, that is the trigger to refactor the whole RPC to a bundled payload —
recorded here so it is a decision, not a drift.

## 8. `saveGoals` always receives the complete set, including archived rows

**Decision.** `saveGoals(trackers, goals, checkIns)` is a full-desired-set writer, exactly like
`saveHabits` (`src/lib/data/StagedDataAccess.ts:447`). Callers must always pass the complete set,
including archived trackers and achieved/dropped goals. Filtering for display is a derivation
concern (`#135`, `#138`) and must never reach the writer.

**Why.** The writer tombstones anything omitted. With archive-only semantics, a page that filters
archived trackers before saving would look identical to a mass delete — and, once a delete
affordance exists, would trip the cascade described in decision 4. This is the single rule most
likely to cause silent data corruption if a lane gets it wrong, which is why it belongs in the
contract and not only in the issue.

**Consequence.** The contract must state it, and `#134`'s provider must derive its save payload from
the full `loadGoals()` result rather than from the currently visible tracker.

---

## Forward hazards recorded here

- **`metric.current` (#143)** is written by the integration subsystem, not the goal editor. Under
  whole-row LWW it will clobber a concurrent goal edit exactly like `lastBuiltPeriodStart` would
  have. When #143 lands, apply the same monotonic/field-specific treatment or accept the risk
  explicitly — do not rediscover it in Phase 14.
- **Cadence rule change** re-anchors the grid from `cadenceAnchorAt` forward. Historical
  `periodStart` values are preserved verbatim and may no longer align to the new grid, so slip
  counting must walk stored check-ins in period order and must not assume grid alignment.
- **Duplicate check-in content** is possible when two devices create the same period while offline
  and the natural-key dedupe keeps the server row (decision 3): the losing device's typed content is
  dropped in favour of the server's. Accepted; #136 may surface a "duplicate periods" hint later.
