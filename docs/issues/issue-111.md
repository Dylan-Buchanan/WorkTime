# Title: Add a quick-log Training button beside Potty

## Tags

Complexity Classification: T1
Classification Reason: A focused Today-view UI change that can use the existing activity-log and quick-training tag-dialog flows. Interval schedule timing already derives from activity records, so this should not require a separate schedule mechanism.

Severity: Low
Severity Reason: This is a convenience feature; users can already log training through existing schedule actions or the Training tab.

Needs research before implementation: No

## Summary

Add a persistent Training button beside the Potty button on the pet Today tab. Pressing it should log a spontaneous training activity through the existing activity log, open the optional skill-tag dialog used by quick training logs, and cause interval-based training schedule items to recalculate from the new activity timestamp.

## Steps to Reproduce Context

1. Open `/pet` and select the Today tab.
2. Configure a training schedule item with interval recurrence.
3. Look at the persistent bottom action bar and observe that it provides a Potty button but no equivalent quick action for spontaneous training.

## Expected Behavior

- The persistent bottom action bar displays Training beside Potty.
- Selecting Training records a training activity through the existing activity-log path and offers the optional skill-tag dialog.
- Matching interval-based training schedule items use the new training record as their latest activity anchor, updating their due/overdue timing. Undoing the record restores the schedule derived from the remaining log.

## Actual Behavior

- The persistent bottom action bar only offers a Potty action, so there is no equivalent quick action for spontaneous training.

## Requirements for completed issue

1. The persistent Today action bar displays Potty and Training actions alongside each other.
2. The Training action creates a training record through the shared activity-log path and opens the existing optional skill-tag dialog.
3. Logging and undoing training updates interval-based training schedule timing based on the activity log, without introducing a separate schedule state or reset path.
4. Existing Potty quick-log behavior remains unchanged.

### Testing

- Add or update `PetPage` tests to verify the Training action appears beside Potty, creates a training record, and opens the optional skill-tag dialog.
- Verify that using the new action re-anchors an interval-based training schedule item to the new record and that undoing the record restores the prior derived schedule.
- Verify the existing Potty action continues to log and re-anchor potty intervals as before.

## Context

- `src/components/pets/PetPottyBar.tsx` — persistent bottom bar currently renders only the Potty button.
- `src/components/pets/PetTodayTab.tsx` — renders the bar and provides `logCareActivity`, which calls the shared activity logger and opens the optional tag dialog for training.
- `src/state/PetActivityContext.tsx` — shared activity-log path appends a record and exposes Undo; schedule state derives from these records.
- `src/lib/pets/schedule.ts` — `resolveIntervalWindow` anchors an interval schedule item to the latest matching activity record at or before the current time.
- `src/components/pets/PetPage.test.tsx` — existing tests cover the Potty bar behavior and optional skill tagging for quick training logs.

```ts
// src/components/pets/PetTodayTab.tsx
const logCareActivity = (activityType: PetScheduleEntry["activityType"]): void => {
    const record = activity.logActivity({ activityType, timestamp: now });
    if (activityType === "training") setTrainingTagPrompt({ recordId: record.id, skillIds: [] });
};
```

## Notes

- The new quick action is requested alongside the existing Potty button on the Today tab; the full training-session form remains available on the Training tab.
