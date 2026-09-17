## Title: Pet notable events timeline

## Tags

Complexity Classification: T1
Severity: Low
Reason: Comparatively contained: append-plus-correct records with auto age stamps, a Timeline tab with date-range filtering, and distinctness guarantees from mechanical activity records. Blast Radius=2 (record type, DataAccess pair, single tab component, page wiring), Uncertainty=1 (clear spec, established patterns), Behavior=2 (simple append/correct logic and filtering), Testing=1 (standard tests, low-moderate impact), Reversibility=1 (additive). Total=7. Medium confidence only because it adds DataAccess surface like its T2 siblings but with simpler logic.
Needs research before implementation: No

## Summary

Add the Timeline tab of the `/pet` page: manually created notable-event records (first reliable "sit", met the neighbor's dog, first hike), each auto-stamped with the pet's age at the time of the event, displayed chronologically with date-range filtering. Mechanical activity records (potties, naps, weight) are explicitly excluded from this timeline.

## Steps to Reproduce Context

1. The `/pet` page has a placeholder Timeline tab (from Issue B) with no backing model or UI.
2. There is no way to record or review notable moments in the pet's life, and no record ties an event to how old the pet was.

## Expected Behavior

The user can add a notable event with a title/note; the record auto-computes the pet's age at the event time (weeks/months rule). The Timeline tab shows events chronologically with their age annotations and supports filtering by date range. Events can be corrected (append-plus-correct) but not deleted.

## Actual Behavior

The tab is a placeholder; no notable-event model exists.

## Requirements for completed issue

1. **Notable-event record**: manual, user-created entries (title/text, optional longer note, event timestamp) with house-standard `id`/`createdAt`/`updatedAt`.
2. **Auto age stamp**: the pet's age at the event is *computed* (Issue A's age-display rule: weeks until 6 months, months after) and shown with every event — never stored as a redundant field.
3. **Append-plus-correct, no deletion**: events can be edited (title/text/timestamp) but there is no delete; the timeline is curated history.
4. **Timeline tab UI**: chronological list (newest first or oldest first — pick and stay consistent), each entry showing the event text and the age annotation ("at 14 weeks: first reliable sit"). Date-range filtering over the event list.
5. **Strict lane separation**: potty records, nap records, weight log entries, and training status changes must NOT appear in this timeline. This timeline is notable events only — that exclusivity is a requirement, not an accident of filtering.
6. **Persistence**: add `savePetNotableEvents/load...` (naming per house style) to the `DataAccess` interface, implemented in `InMemoryDataAccess` and `StagedDataAccess` following `saveHabits`. Schema fields and Supabase tables are Issue G; this issue implements the interface pair.
7. House conventions: record types in `src/state/types.ts` via the pet barrel; factories `(input, now, id)`; logic co-located and tested with fixed dates.
8. Tests: unit tests for age-stamping at event time (including the 6-month unit switch) and date-range filtering; context/data-access tests per house pattern; light UI tests for the tab.

## Context

- Files:
  - `src/lib/habits/factories.ts` — factory conventions to follow.
  - `src/lib/data/DataAccess.ts` — save/load pair pattern to mirror.
  - `/pet` page component from Issue B — where the Timeline tab mounts.
  - Issue A's age-display formatting function — reused for every age stamp.
- Code Snippets:

  Age display rule (Issue A requirement being reused here):
  ```ts
  // weeks until the pet is 6 months old, months only afterward — pure, engine-tested
  ```

## Notes

- This is the "look back and see her progress at certain points in her life" feature — age documentation is the point; every event must carry it.
- Keeping the timeline to manual notable events (decided) avoids the potty-log-spam problem entirely; mechanical records live in their own lanes and may power a future patterns/analytics view instead.
