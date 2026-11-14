# Title: Deck surfaces moved and blocked pet occurrences

## Tags

Complexity Classification: T2
Classification Reason: Component-level presentation with conditional and grouped rendering plus a header status control reusing the #207 snapshot. Scoped to the deck, its tab wiring and component tests; no engine, data or server change.

Severity: Low
Severity Reason: Purely presentational. A wrong marker is visible and annoying but cannot lose data, change scheduling, or affect notifications, and the change is trivially revertible.

Needs research before implementation: No

## Summary

After #206 the engine can move a pet occurrence because of calendar busy time and can mark one it could not place. Neither is visible today: `ScheduleCard` in `src/components/pets/PetScheduleDeck.tsx` already renders `↺ {entry.shift.description}` for nap shifts, but there is no blocked marker and no calendar status anywhere in the deck.

These two markers are the whole visible grammar of the policy: the arrow says the app already handled it, the cross says it is the user's move. This issue adds the `⛔` line, a deck-header explanation, and a compact calendar status line with a refresh control driven by the #207 snapshot, so automation is explainable and staleness is honest without a settings panel.

This is issue 3 of 4 in dependency order and requires #206 and #207.

## Steps to Reproduce Context

1. Connect Google Calendar with a 10:00–10:30 recurring meeting and configure the Pet schedule day as `07:00`–`22:00`.
2. Add a flexible fixed-time "Walk" item at `10:00` and enough flexible items to fill the rest of the day.
3. Open Pet → Today.
4. Observe: no card explains that the walk was moved, no card explains that an item could not be placed, the header does not mention calendar awareness, and there is no way to tell when busy time was last refreshed.

## Requirements for completed issue

1. A card for a moved occurrence shows `↺ {shift.description}` in the existing slot, including the composed nap-then-busy line produced by #206.
2. A card with `blockedBy` set shows a new `⛔` line whose copy distinguishes "couldn't fit before dayEnd" from "can't push past this interval's limit".
3. Both lines may appear on one card.
4. Fulfilled entries and occurrences well in the past show neither line.
5. Adjacent cards blocked by the same busy run collapse into one grouped row naming the affected items and the run, so a fully bookended day stays informative rather than demoralising.
6. The deck header carries a one-line explanatory hint about calendar-aware placement.
7. A compact `Calendar · refreshed 2m ago` status line with a refresh control drives the #207 provider's manual refresh, and the same slot is reused for the unavailable notice.
8. `↺` and `⛔` are exposed with text alternatives; screen readers never receive only a decorative glyph.
9. The snapshot is consumed referentially: the one-second tick re-renders cards but does not re-fetch, and an unchanged snapshot reference does not cause avoidable re-render churn.
10. Long labels truncate without pushing the shift or blocked line out of the card on narrow widths.

## Expected Behavior

- A walk moved from 10:00 to 10:30 shows `↺ walk +30m — busy 10:00–10:30`.
- The same walk after a nap shift shows both causes on one line, nap first, chronologically.
- An item that could not fit before `dayEnd` shows `⛔` with dayEnd wording; an interval item clipped by its max close shows `⛔` with interval-limit wording.
- A card that is both overdue and blocked stays red, shows the `⛔` line, and offers no calming copy.
- A day with several items blocked by one run shows a single grouped row listing them and naming the block.
- The header explains calendar-aware placement once, and the status line shows relative freshness with a working refresh control.
- When the snapshot is unavailable the status line shows the unavailable notice in place of the freshness text, and the deck does not visibly un-shift.
- A screen reader announces the shift and blocked markers as meaningful text, not as bare glyphs.

## Actual Behavior

- `ScheduleCard` renders only `↺ {entry.shift.description}` for existing nap shifts; `blockedBy` has no representation.
- The deck header (`src/components/pets/PetScheduleDeck.tsx:139-159`) has toggles and a schedule-window line but no calendar hint, no freshness status and no refresh control.
- Nothing in the deck can express that a busy snapshot is stale or unavailable.

### Testing

- `pnpm test:unit` with new cases in `src/components/pets/PetPage.test.tsx` (or a new `PetScheduleDeck` test):
  - moved card renders the `↺` line with the composed nap-then-busy description.
  - blocked card renders the `⛔` line with dayEnd wording and with interval-limit wording.
  - both lines together on one card.
  - fulfilled and long-past entries render neither line.
  - adjacent cards blocked by the same run collapse into one grouped row.
  - overdue-and-blocked card keeps the overdue tone.
  - header hint, `refreshed Nm ago` status, refresh control invoking the provider refresh, and unavailable notice replacing the status text.
  - text alternatives present for both markers (accessible name assertions).
- Manual check at narrow widths for truncation of the shift and blocked lines.
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/components/pets/PetScheduleDeck.tsx` — card markers, header hint, status line

Code Source: `src/components/pets/PetScheduleDeck.tsx:52-108` (`ScheduleCard`), `:139-159` (deck header)
Code Description: `ScheduleCard` renders the clock, icon, label, an optional `↺ {entry.shift.description}` line, the status chip, and the due/remove buttons. The header renders the title, expand/manage toggles, and the schedule-window paragraph.
Code Change Description: Add the `⛔` line from `entry.blockedBy`, group adjacent same-run blocked cards, and add the one-line hint plus the calendar status/refresh/unavailable slot to the header. Keep the existing `↺` markup and tone vocabulary.

```tsx
{entry.shift && (
    <p className="truncate text-[11px] text-neutral-400">↺ {entry.shift.description}</p>
)}
```

```tsx
const statusChip = (entry: PetScheduleEntry, now: Date) => { /* done | due | overdue | paused | upcoming */ };
const CHIP_TONES: Record<"done" | "due" | "overdue" | "paused" | "upcoming", string>;
```

#### `src/state/CalendarBusyContext.tsx` — consume the snapshot

Code Source: new file from #207
Code Description: exposes `{ snapshot, refresh() }` with `status`, `refreshedAt`, `intervals`.
Code Change Description: Read the snapshot in the deck (or via `PetTodayTab`) to render freshness, the refresh control and the unavailable notice. Do not fetch from the deck itself.

#### `src/components/pets/PetTodayTab.tsx` — pass-through

Code Source: `src/components/pets/PetTodayTab.tsx:64-74`, `:245-256`
Code Description: `PetTodayTab` builds the schedule on a one-second tick and renders `PetScheduleDeck` with schedule, items, counts, naps, `now` and handlers.
Code Change Description: Pass the calendar busy state (or render the deck inside a consumer of the provider) and forward `busyIntervals` into `buildPetSchedule`. Keep the one-second tick driving `now` only.

```tsx
const schedule = useMemo(
    () => buildPetSchedule({
        now,
        scheduleItems,
        activityRecords,
        naps,
        startOfDay: app.state?.settings.start_of_day,
        endOfDay: app.state?.settings.end_of_day,
    }),
    [now, scheduleItems, activityRecords, naps, app.state?.settings.start_of_day, app.state?.settings.end_of_day],
);
```

### New Files

None required; extend `PetScheduleDeck.tsx` and optionally extract small presentational helpers next to it.

## Notes

- Dependencies: #206 (busy reflow and `blockedBy`), #207 (busy snapshot provider).
- Deliberately out of scope: event titles or any events-API dependency, a settings toggle, persisting shifts, pushing pet items to the calendar, Start-of-Day planner awareness in either direction, pet-vs-pet blocking, and background polling.
