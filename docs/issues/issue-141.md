# Title: Goal-set file — portable export and import-into-new-tracker

## Tags

Complexity Classification: T2
Classification Reason: A versioned JSON export (tracker metadata + goal definitions) and a create-new-tracker-from-file import, reusing the download helper from #140. No schema changes, no sync changes, no new dependencies. Moderate surface: format definition, validation on import, and error handling for malformed files.

Severity: Low
Severity Reason: Enhancement; optional convenience path, nothing blocks on it.

Needs research before implementation: No

## Summary

The escape hatch for shared structure without shared storage: export a tracker's **goal structure** as a portable, human-diffable file — titles, notes, project links, metric targets, tracker metadata — and import it as a **new tracker**. Deliberately excluded: current metric values and any check-in history. This is how "two people track the same goals" happens — a file exchange, not a workspace — and it doubles as backup and as a way to start a tracker from an existing skeleton.

Decision already made: **import always creates a new tracker**. No merge, no replace — nothing local is ever at risk, no conflict resolution to design, and "start from a shared skeleton" is the actual use case.

## Steps to Reproduce Context

1. Open `/goals` — there is no export or import affordance on any tracker.
2. Observe the download helper from #140 — it exists only for the pptx export path.
3. Observe that nothing in the app imports data from user-provided files today.

## Expected Behavior

- Export writes a versioned, human-diffable JSON file (e.g. `goals-work-2026-10-30.json`) containing: format version, tracker metadata (name, purpose, cadence rule, color), and goals (title, notes, projectId, metric label/target/unit, lifecycle, sortOrder). **Not** included: metric current values, `overridePinned`, check-ins, `lastBuiltPeriodStart`, `cadenceAnchorAt`, timestamps.
- Import accepts a file, validates it against the format (version check, field validation), shows a review summary of what will be created, and on confirmation creates a **new tracker** with fresh IDs and the file's goals in their file order.
- A malformed or wrong-version file produces a clear error and imports nothing.
- Progress stays private by construction — the file cannot carry it.

## Actual Behavior

No portable representation of a tracker exists.

## Requirements for completed issue

1. Pure module (suggested `src/lib/goals/goalSetFile.ts`): `serializeGoalSet(tracker, goals)` and `parseGoalSet(json)` with a versioned format and strict validation; unit-testable, no I/O (file read/write happens in the component).
2. Export action on the tracker (reuse #140's download delivery path for the blob).
3. Import action: file picker → validate → review summary (tracker name, goal count, cadence) → confirm → new tracker created via GoalProvider with remapped IDs.
4. New IDs generated through the provider's factory path (no ID collisions with the source tracker, including on the same device that exported it).
5. Error states: unreadable file, invalid JSON, unsupported version, empty goal list — each with actionable copy, nothing imported.

### Testing

- `goalSetFile.test.ts`: round-trip (export → import produces equivalent definitions with new IDs), exclusion assertions (no values/history/`lastBuiltPeriodStart`/`cadenceAnchorAt` in the payload), cadence-rule round-trip for both variants, version rejection, malformed-field rejection, empty list handling.
- Component tests: export produces a download with the expected filename shape; import review summary renders; confirm creates a new tracker; each error state renders its message and creates nothing.

## Context

Code Source: `src/lib/goals/types.ts`, `factories.ts` (#133)
Code Description: Entity shapes the format mirrors; factories provide the remapped-ID creation path on import.

Code Source: `src/lib/goals/deck/render.ts` / the #140 download helper
Code Description: The blob-download delivery path to reuse for the export file.

Code Source: `src/state/GoalContext.tsx` (#134)
Code Description: `createTracker`/`createGoal` mutations the import confirmation drives.

## Notes

- Depends on #133, #134; #140 only for the shared download helper (or implement a small local one if this lands first — keep it in one place either way).
- Starter scaffolds (fitness, reading, shipping-a-feature) and a merged-deck-from-two-exports were brainstorm directions deliberately deferred; the format's version field is the seam for them later.
- The file is deliberately human-diffable (stable key order, no minified blobs) so a bad import is reviewable before it lands.
