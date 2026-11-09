# Title: Resume-note store and schema

Part of #160.

## Tags

Complexity Classification: T1
Classification Reason: One new pure module modelled line-for-line on an existing store (`src/lib/agent/startOfDayPlanStore.ts`), a barrel `index.ts`, one unit-test file, and a single sentence in `AGENTS.md`. Nothing in the app reads the key yet, so the blast radius is new files only and the persisted shape and every edge case are already specified.

Severity: Medium
Severity Reason: Every other issue in the epic depends on this shape, but nothing consumes it yet. A defect here silently loses notes instead of breaking the timer, and the key is surface-local so a bad write cannot corrupt synced data.

Needs research before implementation: No

## Summary

Add a pure, frontend-owned module that stores one exit memo ("where I am", "next action", optional blocker) per app task id, under a single versioned localStorage key `worktime:resume:v1`.

This is the shared foundation for the rest of #160: the capture form writes to it, the resume card reads from it, and the End-of-Day brief quotes it. Keeping it surface-local avoids a staging schema revision, a Supabase migration and merge/LWW conflict work, and reuses the exception pattern the repo has already established for `worktime:agent:projectSnapshot:v1`, `worktime:agent:startOfDayPlan:v1` and `worktime:theme:v1`.

## Steps to Reproduce Context

1. Start a Work pomodoro on a task, work for a while, and pause or switch tasks.
2. Nothing about "where I am" or "what is next" is captured anywhere; the timer and task records carry no such field.
3. `Settings` (`src/state/types.ts`), the staging store (`src/lib/data/staging/`) and the Supabase schema have no column for it, and `AGENTS.md` forbids adding one without an explicitly registered exception.
4. Closing the app and reopening it therefore loses all reconstruction context.

## Requirements for completed issue

1. New module `src/lib/resume/resumeNoteStore.ts`, exported through `src/lib/resume/index.ts`, containing the storage key constant, the entry type, the state type and the read/write API.
2. The key is exactly `worktime:resume:v1` and the persisted shape is `{ version: 1, notes: Record<appTaskId, { whereIAm: string; nextAction: string; blocker?: string; savedAt: string; dismissedAt?: string }> }`.
3. Structure mirrors `src/lib/agent/startOfDayPlanStore.ts`: an injected `StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">`, a defensive `defaultStorage()` that returns `undefined` when `localStorage` is missing or throws, hand-rolled per-entry validation, and a clone on every read so callers cannot mutate the stored value.
4. The API supports, at minimum: save/upsert the note for one task id, read the note for one task id, read all notes, dismiss one task's note (set `dismissedAt` without touching the memo fields), and clear the whole key. Issue 4 cannot be implemented with a whole-blob save-and-read API alone.
5. Any save/upsert for a task clears that task's `dismissedAt`, so a new memo always re-appears after a dismissal.
6. `whereIAm`, `nextAction` and `blocker` are clamped to 140 characters on write and on read. Clamping must not reject or drop the surrounding entry.
7. Corrupt or partially corrupt JSON is handled per entry: invalid entries are dropped, valid entries are kept. A top-level blob that is not an object, or that carries an unknown `version`, is treated as empty rather than partially salvaged.
8. Missing or throwing `localStorage` (private mode, Tauri startup race) degrades to no-ops and never throws into React. A `setItem` quota failure is swallowed by the store and surfaced to the caller through its error/return surface so the in-memory value is not lost mid-typing.
9. Writes preserve other tasks' entries in the same blob (a write for task A must not delete a stale-but-valid entry for task B).
10. `AGENTS.md` gains one sentence in the scoped local-key exceptions paragraph (`AGENTS.md:22`) registering `worktime:resume:v1` as a surface-local resume-note exception that must not be synced, added to `Settings`, or written to the staging store.
11. Unit tests cover: round-trip save/read, per-entry corruption, unknown version, missing storage, quota failure, clamp on write and read, dismiss, dismissal cleared by a later save, and key isolation from the other local keys.

## Expected Behavior

- A note saved for an app task id is returned verbatim (as a clone) after a reload.
- A corrupted entry for one task does not erase notes for other tasks.
- A dismissed note stays invisible until a new save for that task clears `dismissedAt`.
- Nothing about the module ever throws into a React render or an event handler because storage is unavailable.
- The rest of the app is unaffected: no synced schema, no `Settings` field, no staging-store change.

## Actual Behavior

- No resume-note storage exists; `worktime:resume:v1` is not read or written anywhere.
- The local-key exception list in `AGENTS.md` does not mention resume notes.

### Testing

1. `pnpm test:unit` passes with a new `src/lib/resume/resumeNoteStore.test.ts` using a fake storage object in the style of `src/lib/agent/startOfDayPlanStore.test.ts`.
2. Fake-storage case: missing `getItem`/`setItem` implementation or a storage whose methods throw → reads return empty, writes return without throwing.
3. Fake-storage case: `setItem` throws a quota error → the caller sees the failure and the module keeps working on the next call.
4. Blob contains one valid and one malformed entry → only the malformed entry is discarded.
5. Blob contains `version: 2` → the whole key reads as empty and is not overwritten until the next write.
6. 200-character input is stored and read back as 140 characters, and the rest of the record (including `savedAt`) survives.
7. Dismiss then save → `dismissedAt` is absent from the read-back value.
8. `pnpm run build` passes.

## Issue Context

### New Files

`src/lib/resume/resumeNoteStore.ts` — the store implementation.

Suggested exported surface (names may change as long as the behaviour above holds):

```ts
export const RESUME_NOTE_STORAGE_KEY = "worktime:resume:v1";
export const RESUME_NOTE_MAX_LENGTH = 140;

export interface ResumeNote {
    whereIAm: string;
    nextAction: string;
    blocker?: string;
    /** ISO timestamp of the write that produced this value. */
    savedAt: string;
    /** ISO timestamp at which the resume card was dismissed. Cleared by any later write. */
    dismissedAt?: string;
}

export interface ResumeNoteState {
    version: 1;
    notes: Record<string, ResumeNote>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getResumeNote(taskId: string, storage?: StorageLike): ResumeNote | null;
export function getResumeNotes(storage?: StorageLike): ResumeNoteState;
export function saveResumeNote(taskId: string, input: { whereIAm: string; nextAction: string; blocker?: string; savedAt: string }, storage?: StorageLike): ResumeNote;
export function dismissResumeNote(taskId: string, dismissedAt: string, storage?: StorageLike): boolean;
export function clearResumeNotes(storage?: StorageLike): void;
```

`src/lib/resume/index.ts` — re-exports the above, matching the barrel pattern of `src/lib/agent/index.ts` and `src/lib/theme/index.ts`.

`src/lib/resume/resumeNoteStore.test.ts` — unit tests listed under Testing.

### Remove Files

None.

### Change Files

#### Local-key exception list

Code Source: `AGENTS.md` line 22 (the paragraph beginning "The per-owner localStorage staging store…")

Code Description: Enumerates the scoped localStorage exceptions (`worktime:agent:projectSnapshot:v1`, `worktime:agent:startOfDayPlan:v1`, `worktime:theme:v1`) and states that none of them may be synced, added to `Settings`, or written to the staging store.

Code Change Description: Add `worktime:resume:v1` (implemented in `src/lib/resume/`) as a fourth scoped exception with the same constraints, in one sentence.

#### Store pattern to mirror

Code Source: `src/lib/agent/startOfDayPlanStore.ts`

```ts
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

export function getAgentStartOfDayPlan(
    storage: StorageLike | undefined = defaultStorage(),
): AgentStartOfDayPlan | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(AGENT_START_OF_DAY_PLAN_STORAGE_KEY);
        return raw ? parsePlan(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}
```

The resume store must follow this defensive shape, but parse each entry independently so a single bad entry does not null out the whole state.

## Notes

- Multiple owners in one browser profile share this key. That is accepted for v1, in parity with the existing agent keys, and should be stated in a code comment rather than left implicit.
- The key must not grow its own revision/merge system. Per-entry preservation on write (requirement 9) is the only concurrency concession.
- Do not add this key to `Settings`, to the staging store, or to any Supabase migration.
