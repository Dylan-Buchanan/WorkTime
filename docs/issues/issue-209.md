# Title: Reminder identity and deferred nudges for blocked pet occurrences

## Tags

Complexity Classification: T3
Classification Reason: Changes a persisted notification-identity key and adds a deferred-nudge state machine inside a provider that ticks every second with baseline dedupe refs. Blast radius covers the reminder provider, the entry contract added in #206, the persisted mark type, and every surface that must keep naming the obligation.

Severity: Medium
Severity Reason: Affects care reminders the user relies on: a wrong identity re-fires or silences nudges, and a bad deferral either interrupts mid-meeting or loses an obligation. No data loss or credential exposure, and marks remain local and recoverable.

Needs research before implementation: Yes

### Research Needed

The identity change touches persisted notification marks, and the deferral logic must integrate with the existing due/overdue baselines without double-firing or losing a nudge. Verify these before implementing:

- How existing persisted `PetReminderMark` rows (`id`, `itemId`, `dueAt`) relate to today's resolved start, so existing marks really stay valid under an unshifted identity.
- Whether the open-time baseline in `src/state/PetReminderContext.tsx` still suppresses a held nudge when the app is opened after a busy run ended.
- What timer/notification harness `src/state/PetReminderContext.test.tsx` provides for fire-at-a-time notifications, and whether fake timers are already in use.
- How pending nudges should be recomputed each second when a busy run shrinks or disappears.
- Which consumers read `entry.start` for tone/banner/hero copy today (`PetOverdueBanner.tsx`, `PetHeroStatus.tsx`, `PetScheduleDeck.tsx`) so only the interrupt channel changes.

## Summary

`petOccurrenceId` in `src/state/PetReminderContext.tsx` keys an occurrence on `itemId` plus its resolved `start`, and persisted marks reuse that id. Shifting is derived and re-evaluated every second, so a start-keyed identity re-fires an already-reminded occurrence whenever reflow moves it — and once #206 can move occurrences because of calendar busy time, that becomes constant.

This issue changes the identity to the unshifted occurrence start and then defers, rather than suppresses, nudges for blocked occurrences: a due or overdue nudge for an entry with `blockedBy` is held until the block clears and collapsed per busy run. Deferral is the noise-discipline half of the design — it stops toasts landing mid-meeting without absolving the user, because the card tone, overdue banner and hero keep naming the obligation throughout.

This is issue 4 of 4 in dependency order and requires #206 and #207. It can land in parallel with #208.

## Steps to Reproduce Context

1. Complete #206 and #207 so a busy run can move a scheduled occurrence.
2. Add a flexible "Walk" item due at 10:00 and put a 10:00–10:30 meeting on the selected calendar.
3. Keep the app open with notifications allowed through the 10:00 boundary.
4. Observe: the reminder fires based on the moved start, a fresh move produces a new id, and there is no mechanism to hold a toast until the meeting ends.

## Requirements for completed issue

1. `petOccurrenceId` keys on the unshifted occurrence start (the field added to `PetScheduleEntry` in #206) instead of the resolved start, so derived reflow never rewrites identity.
2. Existing persisted marks stay valid: no format change, no migration and no cleanup pass.
3. A due or overdue nudge for an entry with `blockedBy` set is held instead of fired.
4. The held nudge fires once at `min(blockEnd, dayEnd)`.
5. Held nudges collapse per busy run into a single notification naming the affected items and the block.
6. The reminder mark is written at fire time, not at hold time.
7. Nothing else changes: card tone, the overdue banner and the hero keep naming the obligation throughout the hold.
8. A run ending after `dayEnd` fires at `dayEnd`, after which the schedule-day entries are excluded anyway.
9. The app opening after a run already ended stays silent, respecting the existing due/overdue open-time baseline and never catching up.
10. A run that shrinks or disappears between refreshes recomputes the pending target from the current snapshot, so exactly one nudge still fires.
11. An item fulfilled during the run drops its pending nudge; an occurrence that becomes blocked while already reminded produces no second nudge.
12. A nap-paused item is neither announced nor deferred.

## Expected Behavior

- Reflowing an occurrence (nap, post-wake, busy) does not change its reminder identity and does not re-fire an existing reminder.
- Several items blocked by the same busy run produce one toast at the end of the run naming the items and the block, instead of one per item.
- A blocked due item produces no toast while the meeting is running; its card stays red and the overdue banner keeps naming it.
- If the app is opened after a run has already ended, no catch-up toast appears.
- A run that is shortened or removed while a nudge is pending still produces exactly one nudge at the recomputed time.
- An item fulfilled mid-run produces no toast; an already-reminded item that becomes blocked is not announced again.
- Paused (napping) items stay silent and are not deferred.

## Actual Behavior

- `petOccurrenceId(entry)` is `${itemId}:${entry.start.toISOString()}`, so any derived reflow changes the identity and re-arms the reminder.
- There is no deferral path: due and overdue toasts fire as soon as the entry crosses the boundary, including mid-meeting.
- Reminder marks are written at announce time only; nothing models a pending, not-yet-fired nudge.

### Testing

- `pnpm test:unit` with new cases in `src/state/PetReminderContext.test.tsx`:
  - identity is stable across a nap shift and across a busy shift for the same occurrence.
  - existing marks keyed the old way remain honoured (no duplicate notification after upgrade).
  - blocked due entry produces no immediate toast.
  - nudge fires once at block end, with the collapsed per-run notification naming items and block.
  - run ending after `dayEnd` fires at `dayEnd`.
  - app opened after the run ended stays silent.
  - run shrinking/disappearing while pending fires exactly once at the recomputed time.
  - fulfilled during the run drops the pending nudge.
  - already-reminded then blocked produces no second nudge.
  - nap-paused blocked entry is neither announced nor deferred.
  - mark is persisted at fire time, not hold time.
- Fake timers plus the existing notification mock must cover the held-fire path.
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/state/PetReminderContext.tsx` — identity and deferral

Code Source: `src/state/PetReminderContext.tsx:20-22` (`petOccurrenceId`), `:69-76` (schedule memo), `:78-138` (due/overdue effect)
Code Description: `petOccurrenceId` returns `${itemId}:${start.toISOString()}`. The effect filters due and overdue entries, baselines `previousDueRef`/`previousOverdueRef` on first run and on settings change, shows overdue toasts, then notifies new due entries and persists marks.
Code Change Description: Build the id from the unshifted occurrence start, and add a pending-nudge queue keyed by busy run so blocked entries are held and fired once at `min(blockEnd, dayEnd)`, collapsing per run and writing the mark at fire time.

```tsx
/** Item id plus unshifted start so derived reflow never re-arms the reminder. */
export function petOccurrenceId(entry: Pick<PetScheduleEntry, "itemId" | "unshiftedStart">): string {
    return `${entry.itemId}:${entry.unshiftedStart.toISOString()}`;
}
```

```tsx
const dueEntries = schedule.entries.filter((entry) =>
    !entry.fulfilled && !entry.paused && entry.start.getTime() <= now.getTime(),
);
const overdueEntries = schedule.entries.filter((entry) =>
    !entry.fulfilled && !entry.paused && entry.overdueMinutes > 0,
);
```

#### `src/lib/pets/types.ts` — entry contract from #206

Code Source: `src/lib/pets/types.ts:121-147`
Code Description: `PetScheduleEntry` carries `start`, `end`, `windowEnd`, `shift`, plus `blockedBy` and the unshifted bounds added by #206.
Code Change Description: No new fields expected here beyond #206; this issue only consumes `unshiftedStart` and `blockedBy`.

```ts
export interface PetScheduleEntry {
    // ...
    blockedBy: { start: Date; end: Date } | null;
    unshiftedStart: Date;
}
```

#### `src/state/types.ts` — reminder mark

Code Source: `src/state/types.ts:234-241`
Code Description: `PetReminderMark` stores `{ id, itemId, dueAt, remindedAt }` as a local persisted dedupe marker.
Code Change Description: Keep the shape. Existing rows must remain valid under the unshifted identity; if `dueAt` semantics change, only its meaning is documented, not its format.

```ts
export interface PetReminderMark {
    /** Stable occurrence identity: schedule item id plus its unshifted due time. */
    id: string;
    itemId: string;
    dueAt: string;
    remindedAt: string;
}
```

#### `src/components/pets/PetOverdueBanner.tsx` and `src/components/pets/PetHeroStatus.tsx` — unchanged behaviour

Code Source: `src/components/pets/PetOverdueBanner.tsx`, `src/components/pets/PetHeroStatus.tsx`
Code Description: Persistent surfaces that keep naming overdue obligations.
Code Change Description: Expected to need no change; verify they keep naming blocked entries during the hold and do not adopt the nudge timing.

## Notes

- Dependencies: #206 (busy reflow, `blockedBy`, unshifted bounds), #207 (busy snapshot so the reminder provider can see a run end). Can run in parallel with #208.
- A collapsed per-run nudge means one interruption per meeting rather than one per blocked item.
- Deliberately out of scope: event titles or any events-API dependency, a settings toggle, persisting shifts, pushing pet items to the calendar, Start-of-Day planner awareness in either direction, pet-vs-pet blocking, and background polling.
