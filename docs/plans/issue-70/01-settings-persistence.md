# Task: Extend and migrate settings persistence

## Classification

Type: T2: moderate cross-module data-shape change
Reasoning: Shared settings parsing plus local and remote persistence boundaries affect four files but follow existing patterns. Blast Radius=2, Uncertainty=1, Behavior=4, Testing=2, Reversibility=1. Total=10.

## Goal

Ensure all in-memory settings contain a valid `end_of_day`, while old localStorage and Supabase rows continue loading safely.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/state/types.ts` | update |
| `src/lib/settings.ts` | create |
| `src/lib/engine/core.ts` | update |
| `src/lib/data/staging/types.ts` | update |
| `src/lib/data/SupabaseDataAccess.ts` | update |

## Step-by-Step Instructions

### 1. Define and default the setting

**Files:** `src/state/types.ts`, `src/lib/settings.ts`, `src/lib/engine/core.ts`

Add `end_of_day: string`, a `22:00` constant, strict `HH:mm` validation, and a parser that accepts legacy four-field persisted settings while returning a complete `Settings`. Include the default in `DEFAULT_SETTINGS`.

### 2. Migrate local records

**File:** `src/lib/data/staging/types.ts`

Bump `STAGING_SCHEMA_VERSION` and `StagedOwnerRecord.schemaVersion` to 5. During v4-to-v5 migration, inject the default into both `state.settings` and a non-null `lastSynced.settings.value`; require a valid full shape afterward.

### 3. Normalize remote rows

**File:** `src/lib/data/SupabaseDataAccess.ts`

Parse settings rows with the shared parser and return the normalized value in the snapshot. Reject malformed numeric fields and malformed present cutoffs.

## Edge Cases to Handle

- Missing cutoff on legacy local and remote rows.
- Invalid or out-of-range `HH:mm` strings.
- Null settings snapshot values.

## Related Files (read-only context)

- `src/lib/data/sync/merge.ts` — whole-row settings merge and push are unchanged.
