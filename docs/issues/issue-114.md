# Title: Reset pet schedule occurrences at the configured day boundary

## Tags

Complexity Classification: T2
Classification Reason: This changes derived pet scheduling behavior and its tests, using the start/end settings established by issue #113. The affected schedule and reminder paths are identifiable and have existing test coverage.
Severity: Medium
Severity Reason: Recurring potty and training items can appear overdue when a user opens the app on a new day, creating a confusing and prominent red state.

Needs research before implementation: Yes

### Research Needed

Confirm the persisted start-of-day contract from issue #113 and determine how a configured schedule day is represented when its start and end times span midnight. Verify rollover behavior for fixed-time and interval items, including how previous-day activity affects today's occurrences.

- `src/lib/pets/schedule.ts` — schedule-day boundaries, interval anchors, fulfillment, and overdue calculation.
- `src/lib/pets/schedule.test.ts` — unit coverage for schedule anchors, fulfillment, and overdue state.
- `src/state/PetReminderContext.tsx` — constructs schedules and identifies a reminder by item and resolved occurrence time.
- `src/components/pets/PetTodayTab.tsx` and `src/components/pets/PetPage.test.tsx` — display overdue entries and cover the Today schedule.
- `src/state/types.ts` — activity records are timestamped history and are not schedule occurrences themselves.

## Summary

Start a fresh set of recurring pet schedule occurrences at the configured start-of-day time and end that schedule day at the configured End of day time. Previous activity logs must remain in history but must not fulfill or anchor occurrences in the new schedule day. This issue depends on issue #113 for the start-of-day setting.

## Steps to Reproduce Context

1. Configure a start-of-day time and End of day time after completing issue #113.
2. Add recurring potty or training schedule items and log activity during one schedule day.
3. Close the app and reopen it during the next schedule day, after its configured start time.
4. Observe the scheduled items and their overdue state.

## Expected Behavior

- The schedule uses the configured start and end times to determine the current pet schedule day.
- A new schedule day begins with fresh occurrences rather than carrying forward overdue occurrences or interval anchors from the prior schedule day.
- Previous activity remains available as history but does not fulfill or anchor the new day's occurrences.

## Actual Behavior

- `buildPetSchedule` currently defines its day from local midnight to the next local midnight.
- Interval items anchor to the latest matching activity record at or before `now`, regardless of which schedule day contains that record.
- As a result, opening the app after an overnight closure can show recurring potty or training items as overdue instead of starting a fresh daily schedule.

## Requirements for completed issue

1. Pet schedule boundaries follow the configured start-of-day and End of day times.
2. Fixed-time and interval occurrences are derived for the current configured schedule day; a prior day's unfulfilled occurrence does not remain overdue as today's occurrence.
3. Activity from a previous schedule day remains in the log but does not fulfill or anchor current-day schedule occurrences.
4. Current-day activity continues to fulfill occurrences and anchor interval schedules as expected.
5. Reminder identity and overdue display remain correct for occurrences created at the new day boundary.

### Testing

- Add schedule-engine tests covering a rollover from one configured schedule day to the next for both fixed-time and interval items.
- Verify that prior-day records remain present but do not fulfill current-day occurrences or serve as their interval anchors.
- Verify that current-day activity still fulfills and re-anchors the schedule, and that occurrence overdue state is calculated from the configured day boundary.
- Test reminder behavior across rollover so a new day's occurrence can be reminded without generating catch-up alerts for time while the app was closed.
- Run the relevant pet schedule, reminder, and rendered pet-page tests.

## Context

- `src/lib/pets/schedule.ts` currently derives schedule boundaries from local midnight:

  ```ts
  const dayStart = startOfLocalDay(now);
  const dayEnd = nextLocalDay(dayStart);
  ```

- `resolveIntervalWindow` selects the latest matching activity record at or before `now` without restricting it to the current schedule day. `buildPetSchedule` also derives occurrence fulfillment and overdue state from the resulting entries.
- `src/components/pets/PetTodayTab.tsx` builds the schedule for the Today view and selects unfulfilled entries with positive `overdueMinutes` for the overdue banner.
- `src/state/PetReminderContext.tsx` builds the schedule independently for reminders. `petOccurrenceId` combines the schedule item ID with the resolved occurrence start time, so the new occurrence time must be reflected in reminder deduplication.
- `src/state/types.ts` stores pet activity as timestamped `PetActivityRecord` entries; those records should remain historical rather than being cleared at rollover.

## Notes

- Depends on issue #113 for a configurable start-of-day value.
