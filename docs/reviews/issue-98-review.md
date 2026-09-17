# Branch Review: main

**Date**: 2026-09-17
**Scope**: Unstaged changes (12 files changed: 1 modified, 11 added)

## Summary

Seven warning-level findings were identified. All seven have now been addressed in the working tree, with regression coverage added; the full unit suite and production build pass. The findings below are retained as the review record that motivated the fixes.

## Warnings

### Date-only birth dates change calendar day in negative UTC offsets

- **Severity**: Warning
- **File(s)**: [`src/state/types.ts:170`](../../src/state/types.ts#L170), [`src/lib/pets/factories.ts:55`](../../src/lib/pets/factories.ts#L55)
- **Description**: The profile contract stores a birth date as an ISO timestamp, and the factory accepts a date-only string by passing it through `new Date(value).toISOString()`.
- **Evidence**: JavaScript parses `"2026-01-10"` as UTC midnight. In `America/New_York`, reading the stored value produces Jan 9 locally, so `derivePetAge` uses Jan 9 and computes the six-month transition on Jul 9. The existing test passes a locally constructed `Date`, so it does not exercise the normal date-input string path.
- **Impact**: A pet's age and six-month display transition can be one day early for users in the Americas, and the stored birthday can change when viewed in another timezone.
- **Recommendation**: Define `birthDate` as a timezone-free `YYYY-MM-DD` calendar date, validate that shape in the factory, and parse it with explicit local-calendar semantics. Add a test that starts with a date-only string in a negative UTC offset.

### Week age is undercounted across spring DST

- **Severity**: Warning
- **File(s)**: [`src/lib/pets/age.ts:41`](../../src/lib/pets/age.ts#L41), [`src/lib/pets/age.test.ts:9`](../../src/lib/pets/age.test.ts#L9)
- **Description**: `derivePetAge` calculates calendar days by subtracting local-noon instants and dividing by 24 hours.
- **Evidence**: In `America/New_York`, local noon on Mar 7 to local noon on Mar 14, 2026 is 167 hours because DST begins during the interval. The function therefore returns `totalDays: 6`, `weeks: 0` for a pet that is seven calendar days old. Local noon avoids midnight transitions but does not make elapsed milliseconds equal calendar days.
- **Impact**: Week-based ages are one day low from the spring DST transition until the offset changes again, including incorrect week labels at exact boundaries.
- **Recommendation**: Compute the difference from calendar-date components (for example, UTC-normalized Y/M/D values or the repository's calendar bucket helpers), and add spring/fall DST tests.

### Month-end six-month transition can display five months

- **Severity**: Warning
- **File(s)**: [`src/lib/pets/age.ts:20`](../../src/lib/pets/age.ts#L20), [`src/lib/pets/age.ts:31`](../../src/lib/pets/age.ts#L31), [`src/lib/pets/age.test.ts:15`](../../src/lib/pets/age.test.ts#L15)
- **Description**: The six-month boundary clamps month-end birthdays, but `completedMonths` uses a different, unclamped day-of-month rule.
- **Evidence**: For an Aug 31, 2025 birth and Feb 28, 2026 reference, `addLocalMonths` identifies Feb 28 as the six-month date and switches the unit to months, while `completedMonths` subtracts one because `28 < 31`. The public result is therefore `unit: "months", value: 5` and formats as `"5 months"` on the computed six-month birthday.
- **Impact**: Pets born near the end of a month can show an internally contradictory and incorrect age at the exact required transition.
- **Recommendation**: Derive completed months using the same clamped-anniversary rule as `addLocalMonths`, and cover 29th/30th/31st birthdays across shorter months.

### Future records can fulfill an obligation before `now`

- **Severity**: Warning
- **File(s)**: [`src/lib/pets/schedule.ts:263`](../../src/lib/pets/schedule.ts#L263), [`src/lib/pets/schedule.ts:284`](../../src/lib/pets/schedule.ts#L284), [`src/lib/pets/schedule.test.ts:186`](../../src/lib/pets/schedule.test.ts#L186)
- **Description**: Fulfillment searches the entire activity-record list without limiting candidate timestamps to the caller-supplied `now`.
- **Evidence**: Building at 12:00 with a training item at 11:00, a next item at 13:00, and a training record timestamped 12:30 marks the 11:00 item fulfilled at 12:30 even though that event is still in the future. Interval anchoring already excludes records after `now`, so the two paths apply inconsistent temporal rules.
- **Impact**: Historical/replay views and schedules containing corrected or clock-skewed timestamps can report obligations as completed before the activity occurred, which also changes `nextDue` and `freeUntil` results.
- **Recommendation**: Pass `now` into fulfillment matching and require `recordTime <= now`, with a fixed-date future-record regression test.

### Equal-start items create an empty fulfillment window

- **Severity**: Warning
- **File(s)**: [`src/lib/pets/schedule.ts:280`](../../src/lib/pets/schedule.ts#L280), [`src/lib/pets/schedule.test.ts:186`](../../src/lib/pets/schedule.test.ts#L186)
- **Description**: After priority sorting, every entry's fulfillment window ends at the next entry's start. When two items share a start, the earlier-priority entry receives `[start, start)` and can never be fulfilled.
- **Evidence**: Two 11:00 items produce an empty window for the first item. Even a matching record exactly at 11:00 fails the `time >= endMs` check. The issue explicitly requires ordering/priority, making same-time entries a supported rather than hypothetical case.
- **Impact**: One or more valid obligations at a shared scheduled time remain permanently unfulfilled and can stay in `nextDue` indefinitely.
- **Recommendation**: Define “next item start” for tied occurrences (for example, the next strictly later start) and add same-start tests covering priority and different activity types.

### Overlapping nap records double-count paused time

- **Severity**: Warning
- **File(s)**: [`src/lib/pets/schedule.ts:51`](../../src/lib/pets/schedule.ts#L51), [`src/lib/pets/schedule.ts:136`](../../src/lib/pets/schedule.ts#L136), [`src/lib/pets/schedule.test.ts:157`](../../src/lib/pets/schedule.test.ts#L157)
- **Description**: `totalPauseMs` sums each nap's overlap independently instead of taking the union of nap ranges.
- **Evidence**: Naps from 10:10–10:40 and 10:20–10:50 contain 40 unique paused minutes, but the engine adds 30 + 30 and shifts the interval by 60 minutes. The public input and record factories do not enforce a no-overlap invariant. The emitted indicator then attributes the full `+60m` to only the latest 30-minute nap.
- **Impact**: Imported, corrected, duplicated, or otherwise overlapping nap rows produce late due times, suppressed overdue time, and misleading shift explanations.
- **Recommendation**: Normalize valid nap bounds into a merged interval union before calculating pause time, or explicitly validate and reject overlapping records at the domain boundary. Add overlap and duplicate-record tests.

### Fixed-time reflow conflicts with the literal issue contract

- **Severity**: Warning
- **File(s)**: [`src/lib/pets/reflow.ts:42`](../../src/lib/pets/reflow.ts#L42), [`src/lib/pets/reflow.test.ts:26`](../../src/lib/pets/reflow.test.ts#L26), [`src/state/types.ts:179`](../../src/state/types.ts#L179)
- **Description**: The proposal engine deliberately moves recurrence entries whose mode is `fixed-time` whenever their separate `flexibility` field is `flexible`.
- **Evidence**: The original issue text defined fixed-time items as “clock-anchored, never move,” while the test requires fixed-time playtime/training entries to shift by 40 minutes. The model permits every cross-product, including `fixed-time + flexible` and `interval + fixed`, without documenting which combinations are valid.
- **Impact**: Downstream consumers cannot know whether `mode: "fixed-time"` is an immovable guarantee or merely a clock-based anchor. Implementations following the issue literally will disagree with the tested API.
- **Recommendation**: Resolve the product terminology before merge. If clock-based flexible suggestions are intended (as the “training at 3:45, flexible” example suggests), rename/document the recurrence axis and state the allowed combinations explicitly; otherwise, exclude all fixed-time items from reflow and update the test.

## Files Reviewed

| File | Status | Issues |
| ---- | ------ | ------ |
| [`src/state/types.ts`](../../src/state/types.ts) | Modified | 2 warnings |
| [`src/lib/pets/age.test.ts`](../../src/lib/pets/age.test.ts) | Added | 2 warnings |
| [`src/lib/pets/age.ts`](../../src/lib/pets/age.ts) | Added | 2 warnings |
| [`src/lib/pets/factories.test.ts`](../../src/lib/pets/factories.test.ts) | Added | None |
| [`src/lib/pets/factories.ts`](../../src/lib/pets/factories.ts) | Added | 1 warning |
| [`src/lib/pets/format.ts`](../../src/lib/pets/format.ts) | Added | None |
| [`src/lib/pets/index.ts`](../../src/lib/pets/index.ts) | Added | None |
| [`src/lib/pets/reflow.test.ts`](../../src/lib/pets/reflow.test.ts) | Added | 1 warning |
| [`src/lib/pets/reflow.ts`](../../src/lib/pets/reflow.ts) | Added | 1 warning |
| [`src/lib/pets/schedule.test.ts`](../../src/lib/pets/schedule.test.ts) | Added | 3 warnings |
| [`src/lib/pets/schedule.ts`](../../src/lib/pets/schedule.ts) | Added | 3 warnings |
| [`src/lib/pets/types.ts`](../../src/lib/pets/types.ts) | Added | None |
