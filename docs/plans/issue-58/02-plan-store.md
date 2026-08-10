# Task: Add versioned Start-of-Day plan storage

## Classification

Type: T1: isolated persistence utility
Reasoning: Versioned localStorage serialization with validation and unit tests follows snapshot-store conventions. Blast Radius=1, Uncertainty=1, Behavior=2, Testing=1, Reversibility=1. Total=6.

## Goal

Persist and safely read the final approved Start-of-Day plan for End-of-Day comparison without syncing it through staging.

## Files to Modify

| File | Action (create/update/delete) |
| --- | --- |
| `src/lib/agent/startOfDayPlanStore.ts` | create |
| `src/lib/agent/index.ts` | update |
| `AGENTS.md` | update |

## Step-by-Step Instructions

### 1. Add storage schema and helpers

**File:** `src/lib/agent/startOfDayPlanStore.ts`

Define `AGENT_START_OF_DAY_PLAN_STORAGE_KEY`, a version-1 record containing project, timestamps, work window/budget, summary, ordered proposed plan, and approved change summaries. Add save/get/clear helpers using injectable `StorageLike`, defensive cloning, and corruption-safe parsing.

### 2. Export and document the key

**Files:** `src/lib/agent/index.ts`, `AGENTS.md`

Export the helpers/types and document the plan as a second scoped, unsynced `worktime:agent:*` exception.

## Edge Cases to Handle

- Unavailable storage, malformed JSON, wrong version, and invalid nested plan tasks.
- New/split proposal tasks without IDs.

## Related Files (read-only context)

- `src/lib/agent/snapshotStore.ts`
- `src/lib/data/staging/LocalStagingStore.test.ts`

