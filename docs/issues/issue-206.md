# Title: Pet schedule reflows around calendar busy time

## Tags

Complexity Classification: T3
Classification Reason: An algorithmic rewrite plus derived-data-model additions inside a pure engine that several systems key off: schedule, entries, reflow preview, the shared busy helper and three test files. The uncertainty is in the interacting edge cases (interval max-close fit, compounding nap and busy shifts, anchored `windowEnd` and fulfilment) rather than in the code volume.

Severity: Medium
Severity Reason: Mis-scheduled or mis-anchored occurrences erode trust in the deck and can attribute fulfilment to the wrong occurrence. Everything is derived and unpersisted, so a defect is fully reversible and nothing is lost.

Needs research before implementation: Yes

### Research Needed

The fulfilment and grouping anchors change from shifted to unshifted bounds, which silently moves data other systems read. Check these before implementing:

- `firstMatchingRecord()` in `src/lib/pets/schedule.ts` matches on `entry.start`/`entry.windowEnd`, so anchoring to unshifted bounds changes fulfilment attribution and the `[start, next start)` window. Confirm whether explicit `scheduleOccurrenceStart` logs (`PetTodayTab.logCareActivity`) still match after a move.
- Which consumers depend on today's shifted `windowEnd` and `start`: deck card keys in `src/components/pets/PetScheduleDeck.tsx`, reminder identity in `src/state/PetReminderContext.tsx`, and the overdue banner/hero.
- That extracting the helper from `mergePlannerBusyIntervals` leaves planner behaviour byte-identical (`calculateWorkBudget` in `src/lib/engine/plannerContext.ts`).
- How an interval occurrence's post-nap max close should be recomputed when a busy shift moves its start.

## Summary

`buildPetSchedule` (`src/lib/pets/schedule.ts`) resolves each pet schedule occurrence from the item's own recurrence and naps only, so a walk can be placed at 10:00 while the user is in a standup. This issue adds an optional caller-supplied `busyIntervals` input to the pure engine and reflows movable future occurrences around occupied time.

Occupied time raises pressure rather than excusing it: unlike a nap (which pauses or pulls an occurrence forward), a busy block never makes an obligation go away. A movable occurrence moves to the earliest free slot in the day; an occurrence that cannot fit keeps its original time and is marked as blocked so the UI and reminders can surface it.

This is issue 1 of 4 and has no dependencies. It must land with unit tests. It is consumed by #207 (busy snapshot), #208 (deck markers) and #209 (deferred reminders), which rely on the new `blockedBy` and unshifted-bounds data on the entry.

## Steps to Reproduce Context

1. Connect Google Calendar and configure a calendar whose selected events include a 10:00–10:30 standup.
2. Open Pet → Today with `start_of_day` `07:00` and `end_of_day` `22:00`.
3. Add a flexible fixed-time schedule item "Walk" at `10:00`.
4. Observe the deck: the Walk card sits at 10:00 with no indication that the slot is already occupied, and nothing about the schedule accounts for the meeting.

## Requirements for completed issue

1. `buildPetSchedule` accepts an optional `busyIntervals` input. When it is absent or empty, the returned schedule is identical to today's output for the same inputs.
2. Busy intervals are clipped to the resolved `[dayStart, dayEnd]` and merged, and that clip-and-merge logic exists in exactly one place: a shared helper extracted from `mergePlannerBusyIntervals` in `src/lib/engine/plannerContext.ts`, used by both the planner and the pet engine.
3. A single pass in unshifted-start order places each movable occurrence at the earliest slot where `[slot, slot + itemWindowLength]` is entirely free of occupancy and ends at or before `dayEnd`, where occupancy is the merged busy runs plus the ranges of occurrences already placed later in the same pass.
4. Only occurrences whose unshifted start is still after `now` may move; anything already due keeps its time.
5. Movable means: `flexibility === "flexible"` fixed-time items (unbounded within the day), and interval occurrences only while the shifted start still fits before their post-nap max-interval close. `fixed` items never move and never occupy time.
6. A successful move sets `shift` with a new `busy` reason and a `walk +30m — busy 10:00–10:30` description. A move composes with an existing nap shift: both causes appear on one line, nap cause first, in chronological order.
7. A failed move keeps the original start and sets a new `blockedBy: { start, end } | null` field. `blockedBy` is also populated for already-due occurrences that sit inside a busy run.
8. Fulfilment matching and `windowEnd` grouping stay anchored to the unshifted bounds, which are added to the entry. `overdueMinutes` continues to accrue from the shifted `end`.
9. `proposeNapReflow` accepts the same busy input so its preview can show nap-then-busy displacement. `applyNapReflow` continues to write nap displacement only and must not write busy displacement.
10. New types are exported from `src/lib/pets/index.ts` and the engine stays synchronous, deterministic and I/O-free.
11. Unit tests cover every edge case listed in Expected Behavior.

## Expected Behavior

- A flexible item at 10:00 with a 10:00–10:30 busy run is placed at 10:30 and shows a `busy` shift indicator reading `walk +30m — busy 10:00–10:30`.
- An item already due when it overlaps a busy run is not moved; it keeps its start and gains `blockedBy`.
- An item that cannot fit before `dayEnd` keeps its start and gains `blockedBy` for the run that defeated it.
- An interval occurrence that cannot be pushed past its post-nap max-interval close is not moved and gains `blockedBy`.
- A nap-shifted occurrence that is then moved by a busy run shows both causes in one line, nap first.
- Two flexible items that resolve to the same free slot stack at that slot, matching today's same-start behaviour.
- Two flexible items competing for a single free slot are placed sequentially, occupying each other's time.
- Busy runs that extend past `dayEnd` or lie entirely in the past are clipped away; overnight and equal-boundary days clip to the resolved day edges, never to midnight.
- A multi-day timed event covering the whole schedule day marks every movable occurrence as `blockedBy` and throws nothing.
- `now` inside a busy run does not move already-due occurrences and does not create a negative-length slot.
- A zero-length item can slide exactly onto `dayEnd`.
- DST transitions across an overnight day do not create gaps or overlaps in the placed times.
- An absent or empty `busyIntervals` produces output byte-identical to today's.

## Actual Behavior

- `buildPetSchedule` has no busy-time concept; occurrences ignore the calendar entirely.
- `PetScheduleEntry` has no blocked or unshifted-bound information, so no caller can tell that an occurrence could not be placed.
- `mergePlannerBusyIntervals` is the only busy clip-and-merge implementation and is private to the PM planner context.

### Testing

- `pnpm test:unit` with new cases in `src/lib/pets/schedule.test.ts`:
  - empty/absent `busyIntervals` output-identical regression test against a fixed fixture.
  - single flexible fixed-time move, with the exact `shift.description` string.
  - already-due overlap → unchanged start plus `blockedBy`.
  - no-fit-before-`dayEnd` → unchanged start plus `blockedBy`.
  - interval item clipped by its max-interval close → unchanged start plus `blockedBy`.
  - nap shift plus busy shift composing on one line, nap first.
  - two flexible items competing for one free slot, and two items resolving to the same slot.
  - run spanning midnight / clipped to a resolved non-midnight `dayStart`, and equal start/end boundaries.
  - run entirely in the past, run extending past `dayEnd`, full-day event.
  - `now` inside a busy run; zero-length item landing exactly on `dayEnd`.
  - fulfilment still attributed on the unshifted window while overdue accrues from the shifted end.
  - DST-crossing overnight day.
- `pnpm test:unit` with new cases in `src/lib/pets/reflow.test.ts`: `proposeNapReflow` preview includes busy displacement; `applyNapReflow` writes nap deltas only when a busy shift is present in the proposal.
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/lib/engine/plannerContext.ts` — extract the shared clip-and-merge helper

Code Source: `src/lib/engine/plannerContext.ts:103`
Code Description: Clips intervals to `[now, workUntil]`, drops empty ones, sorts, and merges overlaps.
Code Change Description: Move the clip-and-merge body into a shared pure helper and have `mergePlannerBusyIntervals` delegate to it, so the pet engine does not need a second copy. Keep `mergePlannerBusyIntervals`'s existing signature and behaviour unchanged.
Files Using: `src/lib/engine/plannerContext.ts` (internal `calculateWorkBudget`); new consumer `src/lib/pets/schedule.ts`.

```ts
export function mergePlannerBusyIntervals(
    intervals: readonly PlannerBusyInterval[],
    now: Date,
    workUntil: Date,
): Array<{ start: Date; end: Date }> {
    const windowStart = now.getTime();
    const windowEnd = workUntil.getTime();
    const normalized = intervals.flatMap((interval) => {
        const rawStart = intervalDate(interval.start)?.getTime();
        const rawEnd = intervalDate(interval.end)?.getTime();
        if (rawStart === undefined || rawEnd === undefined) return [];
        const start = Math.max(windowStart, rawStart);
        const end = Math.min(windowEnd, rawEnd);
        return end > start ? [[start, end] as const] : [];
    }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of normalized) {
        const previous = merged[merged.length - 1];
        if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
        else merged.push([start, end]);
    }
    return merged.map(([start, end]) => ({ start: new Date(start), end: new Date(end) }));
}
```

#### `src/lib/pets/types.ts` — busy input and entry fields

Code Source: `src/lib/pets/types.ts:22`, `:121-158`
Code Description: `PetShiftReason` is `"nap" | "post-wake"`; `PetScheduleEntry` carries `start`, `end`, `windowEnd`, `shift`; `BuildPetScheduleInput` and `ProposeNapReflowInput` take `now`, day edges, items, records and naps.
Code Change Description: Add a `busy` shift reason; add `blockedBy` and the unshifted bounds to `PetScheduleEntry`; add optional `busyIntervals` to `BuildPetScheduleInput` and `ProposeNapReflowInput`.

```ts
export type PetShiftReason = "nap" | "post-wake" | "busy";

export interface PetBusyInterval {
    start: string | Date;
    end: string | Date;
}

export interface PetScheduleEntry {
    // ...existing fields
    /** Busy run that kept this occurrence from fitting, or null. */
    blockedBy: { start: Date; end: Date } | null;
    /** Start before any derived reflow; fulfilment and windowEnd grouping anchor here. */
    unshiftedStart: Date;
    /** Exclusive close used for unshifted-window grouping. */
    unshiftedWindowEnd: Date;
}

export interface BuildPetScheduleInput {
    // ...existing fields
    /** Calendar busy time for the resolved schedule day; optional and never persisted. */
    busyIntervals?: readonly PetBusyInterval[];
}
```

#### `src/lib/pets/schedule.ts` — placement pass

Code Source: `src/lib/pets/schedule.ts:327-388` (`buildEntry`), `:413-443` (`buildPetSchedule`), `:288-318` (`formatShiftIndicator`)
Code Description: `buildEntry` builds one entry per item; `buildPetSchedule` sorts with `compareEntries`, rewrites `windowEnd` per same-start group, then computes `fulfilled`/`overdueMinutes`.
Code Change Description: Expose the unshifted start/end from `buildEntry`, run one placement pass over the sorted entries before the `windowEnd` grouping, and extend `formatShiftIndicator` (or the busy path) to emit the composed nap-then-busy description. Keep `windowEnd` grouping and `firstMatchingRecord` anchored to unshifted bounds.

```ts
function buildEntry(
    item: PetScheduleItem,
    input: BuildPetScheduleInput,
    dayStart: Date,
    dayEnd: Date,
    now: Date,
): PetScheduleEntry | null { /* unchanged shape, plus unshiftedStart/unshiftedWindowEnd/blockedBy */ }

export function buildPetSchedule(input: BuildPetScheduleInput): PetDaySchedule {
    const now = assertValidDate(input.now, "pet schedule now");
    const { dayStart, dayEnd } = resolvePetScheduleDay(now, input.startOfDay, input.endOfDay);
    // entries are sorted, then one placement pass, then existing windowEnd grouping
}
```

```ts
export function formatShiftIndicator(
    item: Pick<PetScheduleItem, "id" | "activityType" | "label">,
    deltaMinutes: number,
    reason: PetShiftReason,
    nap: PetNapRecord | readonly PetNapRecord[] | null,
    now: Date,
): PetShiftIndicator
```

#### `src/lib/pets/reflow.ts` — preview parity only

Code Source: `src/lib/pets/reflow.ts:21-80` (`proposeNapReflow`), `:93-121` (`applyNapReflow`)
Code Description: `proposeNapReflow` returns proposal data only; `applyNapReflow` writes flexible fixed-time deltas only.
Code Change Description: Thread `busyIntervals` through `proposeNapReflow` so its preview matches the reflowed schedule. Leave `applyNapReflow` writing nap displacement only.

#### `src/lib/pets/index.ts` — exports

Code Source: `src/lib/pets/index.ts:92-101`
Code Description: Barrel re-exports of the schedule and reflow APIs plus pet types.
Code Change Description: Re-export the new busy interval and entry types.

### New Files

None required unless the shared clip-and-merge helper is placed in its own module rather than remaining in `plannerContext.ts`.

## Notes

- Dependencies: none. Must land with unit tests.
- Deliberately out of scope: event titles or any events-API dependency, a settings toggle, persisting shifts, pushing pet items to the calendar, Start-of-Day planner awareness in either direction, pet-vs-pet blocking, and background polling.
- `fixed` items not occupying time is intentional: a fixed care time is an obligation, not a resource reservation.
