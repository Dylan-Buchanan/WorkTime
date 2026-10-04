# Title: No way to remove scheduled pet items

## Tags

Complexity Classification: T2
Classification Reason: This is a focused frontend feature involving the schedule UI and existing schedule-item state/persistence paths. No new storage mechanism or schema change is indicated.

Severity: Low
Severity Reason: Users can still add and use scheduled items, but cannot remove ones they no longer use. This is a missing management capability rather than a failure of existing scheduling or care-history behavior.

Needs research before implementation: No

## Summary

Users can add scheduled pet items on the Pet page, but there is no way to remove an item that is no longer being used. Users need to be able to remove an item from the schedule so it no longer has future occurrences. Removing a scheduled item must not delete historical care activity records.

## Steps to Reproduce Context

1. Open `/pet` and go to the Today tab.
2. Ensure a pet profile and at least one schedule item exist.
3. Inspect the schedule item cards (use **Show full day** if needed).
4. Observe that there is no action to remove an item; the available card action is to log a due activity.

## Expected Behavior

- A user can remove a scheduled pet item that is no longer being used.
- The removed item no longer produces future schedule occurrences.
- Existing care activity history remains available after the schedule item is removed.

## Actual Behavior

- Users can add schedule items, but the schedule UI provides no way to remove an existing item.
- `PetScheduleDeck` only exposes the log action for due items.

## Requirements for completed issue

1. Users can remove an existing item from their pet schedule.
2. Removed items no longer appear in the saved schedule or generate future occurrences, while other schedule items remain intact.
3. Removing a scheduled item does not delete historical care activity records.

### Testing

- Verify a user can remove a scheduled item and that it disappears from the schedule while other items remain.
- Verify the removal persists after reloading the pet schedule.
- Verify historical care activity records remain unchanged after removing their corresponding schedule item.

## Context

- `src/components/pets/PetTodayTab.tsx` (`addScheduleItem`, lines 123–128) creates and appends a schedule item, then updates the collection with `pets.setScheduleItems`. The same component renders `PetScheduleDeck` with an `onCheck` callback but no removal callback (lines 232–241). Activity logging is handled separately by `logCareActivity` (lines 134–138).
- `src/components/pets/PetScheduleDeck.tsx` (`ScheduleCard`, lines 50–89) renders the schedule card and its due-item Log action; it has no item-removal action.
- `src/components/pets/PetScheduleItemForm.tsx` (lines 7–10) exposes an add-only `onAddItem` callback.
- `src/state/PetContext.tsx` exposes `setScheduleItems` (lines 254–260) and persists schedule-item collection changes with `data.savePetScheduleItems` (lines 193–200).
- `src/components/pets/PetPage.test.tsx` (lines 202–222) already covers adding the first schedule item and can provide relevant UI-test context.

```tsx
const addScheduleItem = (input: NewPetScheduleItemInput): string | null => {
    const item = createPetScheduleItem(input, now, pets.uuid());
    const next = [...scheduleItems, item];
    pets.setScheduleItems(next);
    return null;
};
```
