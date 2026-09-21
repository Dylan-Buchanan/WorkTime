## Title: Skill-tagged training sessions (persist skill tags on activity records + tagging UI)

## Tags

Complexity Classification: T4
Severity: High
Reason: Persisted data-model change: an optional `skillIds` field on `PetActivityRecord` that must flow through the pure engine, context, staging validator/storage, all `DataAccess` implementations, the Supabase row mapper/validator, the merge pipeline, and an additive SQL migration plus the explicit-column `apply_staged_sync` upsert — alongside new tagging UX in two tabs. Blast Radius=4 (10+ files across engine, state, data layer, sync, Supabase, SQL, and UI), Uncertainty=1 (surface verified, existing patterns to follow), Behavior=4 (entity data model + DB schema/query change), Testing=2 (cross-pipeline persistence with high data-loss impact if tags are dropped on sync), Reversibility=2 (additive migration, but revert needs column/migration coordination). Total=13 sits in the T3 band, but Behavior=4 (data model/database) is the defining dimension; the optional/backward-compatible design keeps reversibility low. 
Needs research before implementation: No

## Summary

There is currently no association between a training activity and the skills it covered, so per-skill session history cannot exist. Let a logged training session be tagged with one or more skills, stored on the existing activity record and synced like any other activity field. Tagging is available from both the Training tab (a dedicated log-session flow) and the Today tab (an optional tag step after the one-tap training log).

## Steps to Reproduce Context

1. Open `/pet` and log a training activity from the Today tab (one tap).
2. Observe the resulting record carries only type, timestamp, and creation time — nothing about which skills were practiced.
3. Open the Training tab and observe there is nowhere to record that a training session covered a particular skill.

## Expected Behavior

A logged training session can be associated with zero or more skills. A user can log a session from the Training tab and pick the skills covered, and can optionally tag the skills after a one-tap training log from the Today tab. Existing tags can be edited. Tags persist through reload and sync, and existing untagged sessions remain valid.

## Actual Behavior

`PetActivityRecord` has no skill field; `pet_activity_records` has no skill column; no tagging UI exists.

## Requirements for completed issue

1. A training session can be associated with zero or more skills.
2. A user can log a training session from the Training tab and choose the skills it covered.
3. After a one-tap training log, a user can optionally tag the skills covered (and can skip tagging entirely).
4. Tags on an existing training session can be edited.
5. The new association persists through the staging store and Supabase sync exactly like other activity-record fields, and existing stored records without the field remain valid.
6. Tags are historical: they are unaffected by advancing, regressing, reopening, or resolving a skill.
7. Sessions with no tags remain valid and simply do not count toward any skill.
8. Tests cover the data flow (engine, staging, Supabase sync) and the tagging UI.

## Context

- Files:
  - `src/state/types.ts` (lines ~221–230) — `PetActivityRecord` (the entity being extended).
  - `src/lib/pets/types.ts` (lines ~54–58) — `NewPetActivityRecordInput`.
  - `src/lib/pets/factories.ts` (lines ~87–101) — `createPetActivityRecord`.
  - `src/lib/pets/activityLog.ts` (lines ~40–51) — the pure `logActivity` command.
  - `src/state/PetActivityContext.tsx` — `logActivity`, `undoActivity`, `correctActivityTimestamp`, `canCorrectActivity` (the context API to extend for tagging/edit-tags).
  - `src/components/pets/PetTodayTab.tsx` (lines ~114–117) — `logCareActivity`, the one-tap write path.
  - `src/components/pets/PetScheduleDeck.tsx` / `PetOverdueBanner.tsx` — the one-tap training log entry points.
  - `src/lib/data/DataAccess.ts` (lines ~127–128) — `savePetActivityRecords` / `loadPetActivityRecords`.
  - `src/lib/data/StagedDataAccess.ts` (lines ~535–577) — full-set LWW + tombstone persistence.
  - `src/lib/data/InMemoryDataAccess.ts` (lines ~339–347) — test double.
  - `src/lib/data/staging/types.ts` (lines ~324–337) — `isPetActivityRecord` validator; schema version is 7.
  - `src/lib/data/SupabaseDataAccess.ts` (lines ~101–103, ~293–298) — `petActivityRow` mapper and `validatePetActivity`.
  - `src/lib/data/sync/merge.ts` — generic `mergeVersionedCollection` LWW merge.
  - `supabase/migrations/20260920000000_pet_domain.sql` (lines ~21–27) — `pet_activity_records` table.
  - `supabase/migrations/20260920010000_pet_staged_sync_rpc.sql` (line ~56) — `apply_staged_sync` explicit-column upsert.
  - `src/components/AnalyticsPage.tsx` (lines ~549–642) — exported `MultiSelect`, a reusable multi-value selector.
- Code Snippets:

  The entity to extend (`src/state/types.ts`):
  ```ts
  export interface PetActivityRecord {
      id: string;
      activityType: PetActivityType;
      timestamp: string;
      durationMinutes?: number;
      createdAt: string;
  }
  ```

  The staging validator that must tolerate the new optional field (`src/lib/data/staging/types.ts`):
  ```ts
  function isPetActivityRecord(value: unknown): boolean {
      return (
          isObject(value) &&
          typeof value.id === "string" &&
          isPetActivityType(value.activityType) &&
          typeof value.timestamp === "string" &&
          (value.durationMinutes === undefined || (isFiniteNumber(value.durationMinutes) && value.durationMinutes >= 0)) &&
          typeof value.createdAt === "string"
      );
  }
  ```

  The explicit-column RPC upsert that must include the new column (`supabase/migrations/20260920010000_pet_staged_sync_rpc.sql`):
  ```sql
  insert into public.pet_activity_records(owner_id,id,activity_type,occurred_at,duration_minutes,created_at,updated_at) values(...) on conflict (owner_id,id) do update set ... where excluded.updated_at > public.pet_activity_records.updated_at;
  ```

## Notes

- Decided: reuse the existing activity record rather than introducing a new training-session entity — one column instead of a whole new collection and RPC parameters.
- Decided: make the skill association optional/backward-compatible to avoid a staging schema version bump and keep existing stored records valid.
- Session tags may reference skills that are later resolved or deleted; the read side must tolerate unknown ids.
- Per `AGENTS.md`, keep everything browser-side using the public Vite variables (no service-role credentials, no new Tauri `invoke` data paths), and do not put this data anywhere other than the existing staging/sync pipeline.
