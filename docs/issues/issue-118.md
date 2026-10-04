# Title: Fixed-time pet items remain due after logging

## Tags

Complexity Classification: T2
Classification Reason: This is a focused pet-scheduling bug spanning schedule fulfillment and two UI actions that share the same activity logging path.

Severity: Medium
Severity Reason: The activity record is saved, but the corresponding scheduled care item remains due, so users cannot reliably mark fixed-time care as completed.

Needs research before implementation: Yes

### Research Needed

Determine why a saved activity does not fulfill a schedule item when it has both a fixed-time recurrence and fixed flexibility. Confirm the fulfillment behavior across the schedule card and overdue banner; both actions currently use the same logging callback.

- Inspect fulfillment matching in `src/lib/pets/schedule.ts`.
- Trace activity logging and both UI actions in `src/components/pets/PetTodayTab.tsx`, `src/components/pets/PetScheduleDeck.tsx`, and `src/components/pets/PetOverdueBanner.tsx`.
- Add or update the relevant integration coverage in `src/components/pets/PetPage.test.tsx`.

## Summary

When a pet schedule item has a fixed-time recurrence and fixed flexibility, pressing **Log** from either the schedule card or overdue banner saves an activity record, but the scheduled item remains due. The issue should be resolved so logging the care activity also fulfills its scheduled item.

## Steps to Reproduce Context

1. Open `/pet` and go to the Today tab with a pet profile and schedule item available.
2. Add or use an item with a fixed-time recurrence and fixed flexibility, and wait until it is due or overdue.
3. Press **Log** on the schedule card or on the overdue banner.
4. Observe that the activity record is saved but the scheduled item remains due.

## Expected Behavior

- Logging the activity fulfills the corresponding fixed-time schedule item.
- The fulfilled item no longer appears as due or overdue.
- The activity remains available in the pet activity history.

## Actual Behavior

- The Log action saves an activity record.
- The corresponding fixed-time item remains due or overdue after logging, whether the action is used from the schedule card or overdue banner.

## Requirements for completed issue

1. Logging a due fixed-time item with fixed flexibility marks the corresponding schedule occurrence fulfilled.
2. The fulfilled item is no longer presented as due or overdue on either logging surface.
3. Existing activity logging and history behavior remains intact.

### Testing

- Add integration coverage for logging a due fixed-time item with fixed flexibility from the schedule card; verify the activity record is saved and the item becomes fulfilled.
- Add integration coverage for the overdue banner action with the same item configuration; verify the overdue item is cleared after logging.
- Confirm existing logging behavior for other schedule items and the shared activity log still passes.

## Context

- `src/components/pets/PetTodayTab.tsx` (`logCareActivity`, lines 134–138) sends the selected activity type and current time to `activity.logActivity`. It passes this handler to the overdue banner (line 223) and schedule deck (line 240).
- `src/components/pets/PetScheduleDeck.tsx` (`ScheduleCard`, lines 50–89) renders the inline Log button for due entries and calls `onCheck(entry)`.
- `src/components/pets/PetOverdueBanner.tsx` (lines 23–35) renders the overdue Log button and calls `onLog(entry)`.
- `src/state/PetActivityContext.tsx` (`logActivity`, lines 227–239) appends the record to provider state and displays the Logged toast; persistence is handled by the activity-record save effect (lines 171–190).
- `src/lib/pets/schedule.ts` builds fixed-time entries in `buildEntry` (lines 334–363). Fulfillment is derived from matching activity records in `firstMatchingRecord` and `buildPetSchedule` (lines 390–402 and 431–435). The schedule assigns each entry's `windowEnd` to the next entry's start (lines 421–428).
- `src/components/pets/PetPage.test.tsx` includes fixed-time logging and overdue logging coverage (approximately lines 314–365), but does not assert that logging a fixed-time item fulfills it across both actions.

```ts
function firstMatchingRecord(entry: PetScheduleEntry, records: readonly PetActivityRecord[], nowMs: number): Date | null {
    const startMs = entry.start.getTime();
    const endMs = entry.windowEnd.getTime();
    let best: number | null = null;
    for (const record of records) {
        if (record.activityType !== entry.activityType) continue;
        const time = new Date(record.timestamp).getTime();
        if (Number.isNaN(time) || time > nowMs || time < startMs || time >= endMs) continue;
        if (best === null || time < best) best = time;
    }
    return best === null ? null : new Date(best);
}
```
