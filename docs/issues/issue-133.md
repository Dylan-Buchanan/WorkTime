# Title: Goals domain foundation — types, staging schema v9, sync pipeline, and SQL

## Tags

Complexity Classification: T4
Classification Reason: New three-entity owner-scoped domain wired through the entire staged-sync stack: staging schema bump 8→9 with a migration ladder step, three DataAccess implementations, merge/push-plan/coordinator wiring, and two Supabase migrations including an `apply_staged_sync` signature swap. Blast radius spans ~10 files plus SQL, mirroring the pet domain effort. Uncertainty is low (the pet/habits patterns are established), but the touch-point count is high and every one is required for correctness.

Severity: Medium
Severity Reason: Enhancement (no existing behavior is broken), but it blocks the entire Goals epic (#134–#143); nothing else can land without it.

Needs research before implementation: No — decided in `docs/plans/issue-133-decisions.md`.

### Decisions already made

All open questions are closed in `docs/plans/issue-133-decisions.md`; that document is binding and this issue reflects it. In short:

- Merge strategy is whole-row LWW (`mergeVersionedCollection`), not `mergeHabits` — the habits field comparator is reference equality and is wrong for `metric`/`planned`.
- Check-ins carry a natural-key dedupe on `(goalId, periodStart)` in addition to the transport id.
- Nothing is hard-deleted in v1, so tombstone maps are structural only: no provenance, no cascade guard.
- Cadence is a discriminated union of calendar rules plus a `cadenceAnchorAt` parity epoch.
- Periods are an anchored `LocalDateKey` grid; `periodEnd` is derived, not stored.
- `lastBuiltPeriodStart` stores the built period key and never moves backwards.

## Summary

Add the data layer for the Goals domain (umbrella issue #129): user-created **trackers** (e.g. "Work — every other Sunday", "Life — first Sunday monthly"), **goals** belonging to a tracker, and per-period **check-ins** that accumulate as each goal's timeline. This issue is the pet-domain-shaped foundation: types, pure factories, cadence validation, staging store fields, sync merge/push, and SQL. **No UI.** Every UI issue (#134–#141) depends on this.

Key design constraint: **no deck is ever stored.** The only period-related state is `lastBuiltPeriodStart` on the tracker; the period grid is derived from the cadence rule and the check-in timeline is the entire history. Both people run multiple trackers (a work tracker and a life tracker each), so multiple trackers per owner is a baseline requirement.

## Steps to Reproduce Context

1. Open `src/state/types.ts` and observe the existing domain entities (`Habit`, `HabitCompletion`, `PetProfile`, etc.) — there is no Goal/Tracker entity.
2. Open `src/lib/data/staging/types.ts` and observe `STAGING_SCHEMA_VERSION = 8` and the habits/pet slices on `StagedOwnerRecord` — there is no goals slice.
3. Run `ls supabase/migrations` and observe there is no `goal*` migration.
4. Observe that `src/lib/data/DataAccess.ts` has no goal load/save contract.

## Expected Behavior

- `GoalTracker`, `Goal`, and `GoalCheckIn` types exist in `src/state/types.ts` with pure factories and cadence-rule validation in a new `src/lib/goals/` module (no I/O, no wall clock, no random IDs — follow `src/lib/pets/factories.ts`).
- The three collections persist through the per-owner staging store and sync through the existing pull → merge → `apply_staged_sync` pipeline with LWW stamps and tombstones, exactly like the pet collections.
- Period boundaries are local calendar date keys computed from the cadence rule, so two devices always agree on a check-in's identity without a timezone conversion.
- Supabase has three owner-RLS tables and the RPC accepts goal payloads. Goals data is preserved across a full wipe (same as habits/pets).
- `InMemoryDataAccess` supports the new methods so context tests can run without network.

## Actual Behavior

No Goals domain exists anywhere in the app. There is no way to persist a tracker, goal, or check-in.

## Requirements for completed issue

1. Types added to `src/state/types.ts`, plus cadence validation in `src/lib/goals/cadence.ts`:
   - `GoalCadence` — discriminated union, exhaustively switchable, mirroring the `TodoRule` conventions: `{ kind: "every-n-weeks"; weekday: 0-6; intervalWeeks: number }` ("every other Sunday") and `{ kind: "monthly-weekday"; weekday: 0-6 }` ("first Sunday of the month", with the documented Mon/Tue snap-backward rule). `normalizeGoalCadence` / `isValidGoalCadence` follow `src/lib/todos/recurrence.ts` (throw `RangeError` on malformed rules).
   - `GoalTracker` — `id`, `name`, `purpose` (one line), `cadence: GoalCadence`, `cadenceAnchorAt: LocalDateKey` (parity epoch, reset whenever the rule changes), `color`, `sortOrder`, `isArchived`, `lastBuiltPeriodStart: LocalDateKey | null`, `createdAt`, `updatedAt`.
   - `Goal` — `id`, `trackerId`, `title`, `notes`, `projectId: string | null`, `metric: GoalMetric | null` (one metric max: `{ label, target, current, unit, source: "manual" | "liftingtracker", overridePinned }`), `lifecycle: "active" | "achieved" | "dropped"`, `achievedAt: string | null`, `droppedAt: string | null`, `sortOrder`, `createdAt`, `updatedAt`. Note: `source: "liftingtracker"` is typed now but only `"manual"` is reachable until #143.
   - `GoalCheckIn` — `id`, `goalId`, `periodStart: LocalDateKey`, `did`, `current`, `planned: { text, dueDate: LocalDateKey | null }[]`, `statusPill: "on-track" | "at-risk" | "blocked"`, `missReason`, `isFocus`, `evidenceTaskIds: string[]`, `createdAt`, `updatedAt`. **No `periodEnd` field** — it is derived as the next boundary.
   - `LocalDateKey` is imported from `src/lib/todos/types.ts`; date math reuses `src/lib/todos/calendar.ts` (`localDateKey`, `localDateFromKey`, `localDateAtNoon`, `addLocalDays`, `daysInMonth`, `compareLocalDates`) rather than reimplementing it.
2. Staging schema bumped `8 → 9`: nine new fields on `StagedOwnerRecord` and `SyncSnapshot` — `goalTrackers`, `goals`, `goalCheckIns`, their three `*UpdatedAt` maps, and their three tombstone maps — plus `freshRecord()` defaults, `REQUIRED_FIELD_CHECKS` predicates, accepted-version list, and a `v8→v9` ladder step injecting empty maps into both the record and `lastSynced`.
3. `countPending` and `discardPendingChanges` in `src/lib/data/staging/LocalStagingStore.ts` extended for the new collections.
4. `DataAccess` contract extended (`loadGoals` / `saveGoals`) and implemented in `StagedDataAccess` (stamp + tombstone diffing, zero network), `InMemoryDataAccess`, and `SupabaseDataAccess` (row serializers, validators, pull, push kwargs). `saveGoals(trackers, goals, checkIns)` is a **full-desired-set** writer: it always receives the complete set including archived trackers and achieved/dropped goals, and it refuses to move `lastBuiltPeriodStart` backwards.
5. `src/lib/data/sync/merge.ts` + `sync/types.ts` + `SyncCoordinator.ts`: `EMPTY_SNAPSHOT`, `mergePulledSnapshot`, `buildPushPlan`, `isPlanNonEmpty`, and `pushedSnapshotFromPlan` extended; goal data preserved in the full-wipe branch. Trackers, goals, and check-ins all use `mergeVersionedCollection`, plus a check-in natural-key dedupe keyed by `goalId` + `periodStart` (port the `bucketOwner` shape from `mergeHabitCompletions`). The tracker merge takes the later `lastBuiltPeriodStart`.
6. Two migrations: `20261030000000_goals.sql` (three tables following the habits template: `unique (owner_id, id)`, composite child FKs `on delete cascade`, `unique (owner_id, goal_id, period_start)` idempotency key on check-ins, `metric`/`planned`/`evidence_task_ids` as `jsonb`, indexes, revoke/grant, four RLS policies each, `touch_updated_at` triggers) and `20261031000000_goal_staged_sync_rpc.sql` (six new positional arguments, 36 → 42, using the pet private/public wrapper pattern).
7. Parent rows push before child rows in the RPC (trackers → goals → check-ins), and check-in upserts use `on conflict (owner_id, goal_id, period_start)`, matching the habit/completion ordering and idempotency precedent.
8. Tombstone maps exist structurally but stay empty in v1: trackers are archive-only, goals move through lifecycle only, and check-ins are upsert-only. No cascade provenance and no tombstone-guard migration (see decision 4).
9. No UI, no route, no provider in this issue.

### Testing

- `src/lib/goals/` factory/type tests (pure).
- `src/lib/goals/cadence.test.ts`: rule validation and normalization, rejection of malformed rules, and (shared with #135) boundary resolution for the Mon/Tue snap-backward policy and every-N-weeks parity.
- `LocalStagingStore.test.ts`: v8→v9 ladder upgrades a legacy record; pending counts; discard restores goal baseline.
- `StagedDataAccess.test.ts`: saves stamp only changed rows, creates tombstones when a desired-set entry is omitted, clears a tombstone on re-add, owner isolation, and refuses a backwards `lastBuiltPeriodStart`.
- `merge.test.ts`: LWW matrix, tombstone vs remote `updatedAt`, first-pull bootstrap, push-plan/commit parity, check-in natural-key dedupe when two ids claim `(goalId, periodStart)`, and monotonic `lastBuiltPeriodStart`.
- Integration (`integration/localFirstSync.integration.test.ts`, `SupabaseDataAccess.integration.test.ts`): real round-trip, LWW gating, wipe preservation, check-in idempotency on `(goal_id, period_start)`.

## Context

Code Source: `src/lib/data/staging/types.ts`
Code Description: `StagedOwnerRecord` (habits slice at ~L112–193), `SyncSnapshot` (~L53–71), `STAGING_SCHEMA_VERSION = 8`, `REQUIRED_FIELD_CHECKS`, and the migration ladder — every goal field must be added here first.

Code Source: `src/lib/data/StagedDataAccess.ts`
Code Description: `saveHabits` (~L447–509) is the canonical "full desired set" writer with stamps and tombstones; `savePetCollection` (~L636–684) is the generic per-collection version to copy.

Code Source: `src/lib/data/sync/merge.ts`
Code Description: `mergeVersionedCollection` (~L739) — the decided whole-row LWW merge for all three collections, plus `mergeHabitCompletions` (~L590-645) for the natural-key dedupe shape; `buildPushPlan` (~L1353) and `mergePulledSnapshot` (~L1019–1142) are the assembly points.

Code Source: `src/lib/todos/types.ts`, `src/lib/todos/calendar.ts`, `src/lib/todos/recurrence.ts`
Code Description: `LocalDateKey`, the timezone-free date helpers, and the discriminated-union rule conventions (`normalizeRule`/`isValidRule` throwing `RangeError`, `nextOccurrence` returning local-noon dates to avoid DST midnight shifts) that `cadence.ts` must mirror.

Code Source: `supabase/migrations/20260803000000_habits.sql`, `supabase/migrations/20260920000000_pet_domain.sql`, `supabase/migrations/20260920010000_pet_staged_sync_rpc.sql`
Code Description: Table/RLS template, the loop-generated policies variant, and the RPC signature-swap pattern respectively.

The habits completion idempotency key precedent:

```sql
constraint habit_completions_habit_bucket_unique unique (habit_id, bucket)
```

The goal equivalent is `unique (owner_id, goal_id, period_start)` so a re-opened wizard can upsert rather than duplicate.

## Notes

- A check-in's `periodStart` is the boundary of the **anchored period grid** (`cadenceAnchorAt` + the cadence rule), not `lastBuiltPeriodStart ?? createdAt`. `lastBuiltPeriodStart` records which period was last built; it does not define the grid. The wizard pins its period at open — that behavior is #136; this issue only needs the fields and the rule.
- The first period starts at the first boundary **strictly after** `createdAt`, so a fresh tracker has no open period until that boundary passes. `cadenceAnchorAt` is the parity epoch and may sit earlier; it is not necessarily a period start. There is no backfill and no partial first period in v1.
- `achievedAt`/`droppedAt` are dedicated authored-once stamps, deliberately not `updatedAt`, because "appears in the recap of the period it was achieved" needs a reliable boundary.
- Period length is variable (a `monthly-weekday` period runs roughly 27–35 days depending on the chosen weekday), so nothing may treat a cadence as a fixed duration.
- Umbrella issue: #129. Implementation order: this issue first; #134 and #138 can proceed in parallel once it lands.
