## Title: Configurable end-of-day for the projected finish

## Tags

Complexity Classification: T3
Severity: Low
Reason: Cross-file/cross-system: a new settings field flows through the `Settings` type, `DEFAULT_SETTINGS`, the strict staging `isSettings` validator (and its schema-version migration path), the whole-row sync merge, the Supabase settings row, the SettingsPanel UI, and the TimerPanel projection engine. Blast Radius=3 (8+ production files), Uncertainty=2 (defaulting/backfill for existing records and day-boundary semantics are open), Behavior=4 (persisted settings shape change plus complex day-boundary-aware projection logic replacing `Date.now() + totalMs`), Testing=2 (wall-clock edge cases — midnight crossing, multi-day rollover, active timer at cutoff), Reversibility=1. Total=12 → T3.
Needs research before implementation: Yes
Research needed: (1) Whether existing staging-localStorage and Supabase settings records lacking the new field are defaulted via the existing staging schemaVersion migration path (src/lib/data/staging/types.ts lines 337-374) or handled as an optional field, so `isSettings` does not reject in-flight data; (2) how the new field behaves in the whole-row sync merge comparison and the Supabase settings row write; (3) day-boundary semantics — does work resume at the next day's configured start, or is the finish clock simply clamped?

## Summary

The projected-finish computation never stops at the end of a day. Add a configurable "end of day" setting (e.g., 10:00 PM) so the projection is day-boundary aware: remaining work stops at the configured cutoff and resumes the next day, producing a realistic finish date instead of a continuous clock running past midnight.

## Steps to Reproduce Context

1. Have enough remaining pomodoros that a continuous projection finishes at, say, 11:30 PM or later.
2. Look at the "Projected finish" card on the timer page.
3. Observe that the finish time is always a single continuous wall-clock value computed from `Date.now() + totalMs`, with no notion of the day ending.

## Expected Behavior

- A global setting controls the end-of-day cutoff time (e.g., 10:00 PM), persisted through the existing settings sync path and editable in the Settings UI.
- The projected-finish computation is day-boundary aware: work stops at the configured end-of-day and resumes on the next day, so the projected finish lands on a later day/time instead of running continuously past midnight.

## Actual Behavior

- `const finishDate = new Date(Date.now() + totalMs);` (TimerPanel.tsx line 270) — purely continuous wall-clock.
- No end-of-day, work-hour, or workday concept exists anywhere in the app.

## Requirements for completed issue

1. A configurable end-of-day time exists in Settings, persists through the existing settings persistence/sync path, and is editable from the Settings UI.
2. The projected-finish computation is day-boundary aware: it stops at the configured end-of-day and resumes on the next day, so the projected finish date/time accounts for the cutoff.

## Context

- Files:
  - `src/state/types.ts` — `Settings` interface (lines 105-110); new field lands here.
  - `src/lib/data/InMemoryDataAccess.ts` — `DEFAULT_SETTINGS` (line 90).
  - `src/lib/data/staging/types.ts` — `isSettings` validator (lines 189-197) and staging schemaVersion migration path (lines 337-374).
  - `src/lib/data/sync/merge.ts` — whole-row settings comparison/merge (e.g., `mergeSingletonValue` at line 762).
  - `src/lib/data/SupabaseDataAccess.ts` — settings row parse (lines 244-296, re-parsed through `isSettings` at line 277) and push plan (lines 396-397).
  - `src/lib/data/StagedDataAccess.ts` — `updateSettings` (line 310).
  - `src/components/SettingsPanel.tsx` — settings field list (lines 38-43).
  - `src/components/TimerPanel.tsx` — `finishProjection` continuous computation (lines 270-272).
- Code Snippets:

```
// src/components/TimerPanel.tsx — continuous wall-clock projection (lines 270-272)
const finishDate = new Date(Date.now() + totalMs);
const finishDayKey = toLocalDateKey(finishDate);
const extendsPastToday = finishDayKey !== todayKey;
```

```
// src/lib/data/staging/types.ts — strict validator that will reject a new field unless handled (lines 189-197)
function isSettings(value: unknown): boolean {
    return (
        isObject(value) &&
        isFiniteNumber(value.work_minutes) &&
        isFiniteNumber(value.short_break_minutes) &&
        isFiniteNumber(value.long_break_minutes) &&
        isFiniteNumber(value.segment_length)
    );
}
```

## Notes

- Related to, but distinct from, the per-project workable-hours issue (issue-71): this is a single global cutoff; per-project availability is a Project-model change.
- The "May spill into tomorrow" warning (TimerPanel.tsx line 474) is a natural integration point but should not be considered a solution.
