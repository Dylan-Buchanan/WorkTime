# Title: Goal-set v2 with portable project names

## Tags

Complexity Classification: T3
Classification Reason: Changes the exported file contract (version, key sets, tracker and goal fields), import matching against local projects, and the warning copy, over two large existing suites.

Severity: High
Severity Reason: A format change stops every previously exported v1 file from importing, and a serializer/parser mismatch strands goal sets after export.

Needs research before implementation: Yes

### Research Needed

Project names are not unique, so the matching rule must be settled before the parse and materialize path is written.

- Pin down name matching: case and whitespace sensitivity, duplicate names, and whether archived projects are eligible.
- Confirm the same rule applies to the tracker project and to goal overrides, and what happens when a name matches nothing.
- Files: `src/lib/goals/goalSetFile.ts`, `src/components/goals/GoalSetActions.tsx`, `src/state/GoalContext.tsx`, `src/state/types.ts` (`Project`, line 19), `src/lib/goals/goalSetFile.test.ts`, `src/components/goals/GoalSetActions.test.tsx`.

## Summary

Goal-set export currently writes raw project ids. Because import always creates a new tracker with fresh ids, those ids are already dead links on any other account. This issue makes a goal set portable by exporting project names instead: the tracker gains a project name, each goal gains a flat `projectMode` plus project-name pair, and import matches names against local projects.

`GOAL_SET_VERSION` becomes 2 and v1 files are rejected through the existing version gate.

Depends on the model foundation, resolution contract, and goal row display issues (the link union and its deviation rule).

## Steps to Reproduce Context

1. Export a goal set from a tracker with goals linked to projects (`GoalSetActions.runExport`, `src/components/goals/GoalSetActions.tsx:113-125`).
2. The file is produced by `serializeGoalSet(tracker, goals)` (`src/lib/goals/goalSetFile.ts:207-232`), which writes `projectId` and `GOAL_SET_VERSION = 1` (line 9). Key sets are `TRACKER_KEYS` and `GOAL_KEYS` (lines 58-59).
3. Import on another account: `parseGoalSet` (`goalSetFile.ts:235`) then `confirmImport` (`GoalSetActions.tsx:144-188`), which drops any id not in the local project set and reports it via `projectLinkLabel` (line 37) shown in `ImportReview` (line 74).
4. `materializeGoalSet` (`goalSetFile.ts:266-295`) creates the new tracker and fresh goal ids.

Exported ids never match another account's projects, so every link is silently (well, reported) dropped, and the tracker's own project cannot be expressed at all.

## Requirements for completed issue

1. `GOAL_SET_VERSION` is 2, and a v1 document is rejected through the existing `unsupported-version` error.
2. `TRACKER_KEYS`, `GOAL_KEYS`, and `GOAL_SET_VERSION` change together; the tracker definition gains a nullable project name, and each goal definition gains `projectMode` (`inherit` | `none` | `project`) plus a nullable project name.
3. Validation is strict per mode: `project` requires a non-empty name, `inherit` and `none` require a null name, and unknown or missing keys remain field errors.
4. `serializeGoalSet` resolves local ids to names and its output round-trips through `readGoalSet`/`parseGoalSet`.
5. Import matches names against local projects. An unmatched tracker project is dropped with a warning; an unmatched goal override falls back to `inherit`, never to `none`.
6. The existing `projectLinkLabel` copy pattern is extended to distinguish a tracker-level drop from goal-level drops.
7. Warnings are post-parse notes in the import review and never block the import.

## Expected Behavior

- A goal set exported here can be imported into a different account and the project links that match by name survive; ones that do not are reported and downgraded safely.
- Re-exporting an imported goal set produces a file that parses cleanly.
- A v1 file is refused with the existing "version this app does not support" message.

## Actual Behavior

- Export writes raw ids and version 1.
- Import silently cannot match another account's ids, and the tracker has no project to export.
- A goal whose project is missing loses its link entirely rather than inheriting.

### Testing

1. `src/lib/goals/goalSetFile.test.ts` — version 2 written; v1 rejected with `unsupported-version`; strict key sets (missing key, unknown key) for tracker and goal; per-mode validation; serialize → parse round trip including inherit, none, and explicit names.
2. Import cases in `src/components/goals/GoalSetActions.test.tsx` — tracker project name matches and is kept; unmatched tracker project is dropped and reported; matched goal override kept; unmatched override becomes inherit; warnings appear as notes and do not block Create tracker.
3. Confirm the created tracker and goals use fresh ids and that the created link modes match the file.
4. Confirm no import path merges, replaces, or edits an existing tracker.
5. `pnpm test:unit` and `pnpm run build`.

## Issue Context

### New Files

None.

### Remove Files

None.

### Change Files

#### Goal-set contract

Code Source: `src/lib/goals/goalSetFile.ts`
Code Description: `GOAL_SET_VERSION = 1` (line 9); `GoalSetGoalDefinition.projectId` (line 20); `GoalSetTrackerDefinition` (line 26); `TRACKER_KEYS`/`GOAL_KEYS` (lines 58-59); `readTracker` (line 138); `readGoal` (line 151); `readGoalSet` version gate (line 177); `serializeGoalSet` (line 207); `materializeGoalSet` (line 266).
Code Change Description: Bump the version, replace the id fields with names plus mode, re-key the definitions, and resolve names during materialization. `readGoalSet` remains the single canonical validator for both parsed and in-memory values.

```ts
export const GOAL_SET_VERSION = 2 as const;
const TRACKER_KEYS = ["name", "purpose", "cadence", "color", "project"] as const;
const GOAL_KEYS = ["title", "notes", "projectMode", "project", "metric", "lifecycle", "sortOrder"] as const;

export interface GoalSetGoalDefinition {
    title: string;
    notes: string;
    projectMode: "inherit" | "none" | "project";
    project: string | null;
    metric: GoalSetMetricDefinition | null;
    lifecycle: Goal["lifecycle"];
    sortOrder: number;
}
```

#### Import review and warnings

Code Source: `src/components/goals/GoalSetActions.tsx`
Code Description: `projectLinkLabel` (lines 37-39) handles a single count of cleared goal links; `ImportReview` computes `clearedLinks` from `knownProjectIds` (lines 74-85); `confirmImport` (lines 144-188) writes `projectId` or null per goal.
Code Change Description: Match names instead of ids, pass the tracker project through, and extend the copy to distinguish tracker-level and goal-level drops. Keep the review's button enabled regardless of warnings.

#### Goal creation inputs

Code Source: `src/state/GoalContext.tsx` / `src/lib/goals/factories.ts`
Code Description: `createTracker` (line 241) and `createGoal` (line 262) take the model inputs, which now carry the link union and the tracker project.
Code Change Description: Pass the resolved link from the import path; no new storage behaviour.

## Notes

- Fallback is `inherit`, not `none`, so an imported goal keeps tracking something visible.
- v1 files stop importing; accepted.
- Provisional issue number; GitHub assigns the final number on creation.
