# Title: Single project resolution contract and evidence flow-through

## Tags

Complexity Classification: T2
Classification Reason: One new pure module plus three deterministic consumers (the evidence selector, the wizard mount gate, and six panel reads), with existing suites already covering that surface.

Severity: High
Severity Reason: Mis-resolved inheritance silently hides evidence for every inheriting goal, and the panel's freeze/prefill refs key on the raw field, so the wrong source produces a subtle prefill bug.

Needs research before implementation: No

## Summary

Once a goal can inherit its tracker's project, the effective project has to be computed in exactly one place. This issue adds a pure resolver, `resolveGoalProject(goal, tracker)`, returns the effective project id and where it came from (`inherit`, `override`, `none`), and switches evidence generation, the check-in panel mount gate, and every raw project read in the evidence panel to the resolved value.

Evidence is the only reason inheritance matters, and the panel's freeze/prefill refs key on the raw field today, which makes it the most likely place for a subtle prefill bug.

Depends on the model foundation issue (tracker `projectId`, goal `projectLink` union).

## Steps to Reproduce Context

1. Create a tracker and a goal that inherits the tracker project (after the model foundation issue).
2. Open the check-in wizard for that goal (`src/components/goals/CheckInWizard.tsx:301`). The evidence panel is gated on `goal.projectId !== null`.
3. `GoalEvidencePanel` (`src/components/goals/GoalEvidencePanel.tsx`) reads `goal.projectId` directly at lines 41, 66, 68, 85, 91, and 93 — for the initial frozen state, the period re-baseline, the prefill guard, the prefill effect dependency, and the render gate.
4. `buildGoalEvidence` (`src/lib/goals/evidence.ts:88-154`) also decides project membership from the raw goal field (`goal.projectId === null`, missing project lookup, task filtering, log filtering).

An inheriting goal therefore looks project-less everywhere, even though its tracker has a project.

## Requirements for completed issue

1. A pure function lives in `src/lib/goals/` and resolves one goal against one tracker, returning `{ projectId: string | null, source: "inherit" | "override" | "none" }`.
2. Resolution rules: explicit mode returns its id with source `override`; inherit mode returns the tracker's project (or null) with source `inherit`; no-project mode returns null with source `none`.
3. `buildGoalEvidence` uses the resolved id for the project-existence check, task filtering, and log filtering, and still reports `brokenProject: true` when the resolved id is not in the project list.
4. The `CheckInWizard` panel mount gate and all six `goal.projectId` reads in `GoalEvidencePanel` (including `frozenRef` initialisation and the period re-baseline effect) use the resolved value.
5. The resolver has no I/O, clock, or storage access and is unit tested for every branch and half-state.

## Expected Behavior

- An inheriting goal whose tracker has a project shows evidence for that project in the check-in wizard.
- An inheriting goal whose tracker has no project shows no evidence panel, as today.
- An overriding goal uses its own project regardless of the tracker.
- A resolved id pointing at a project that no longer exists shows the existing "Linked project no longer exists" note.
- Changing the tracker project mid-period re-baselines the Current prefill from the newly resolved project's In Progress tasks.

## Actual Behavior

- Every goal behaves as project-less unless it stores its own id.
- Resolution logic does not exist, so any future inheritance check would be duplicated at each call site.

### Testing

1. `pnpm test:unit` — new resolver tests (all three sources, null tracker project, dangling target), and `src/lib/goals/evidence.test.ts` cases for inherit, override, and missing resolved project.
2. `src/components/goals/GoalEvidencePanel.test.tsx` — panel mounts for an inheriting goal, does not mount for inherit with a project-less tracker, prefill writes once on first open, and the refs re-baseline when the resolved project changes.
3. `src/components/goals/CheckInWizard.test.tsx` — evidence section presence follows the resolved project, not the raw goal field.
4. Confirm past and future periods never auto-prefill, and that an accepted suggestion list is unchanged by the switch.
5. `pnpm run build`.

## Issue Context

### New Files

`src/lib/goals/projectLink.ts` (name at implementer's discretion) — pure resolver plus its unit test.

```ts
export type GoalProjectSource = "inherit" | "override" | "none";

export interface ResolvedGoalProject {
    projectId: string | null;
    source: GoalProjectSource;
}

export function resolveGoalProject(goal: Goal, tracker: GoalTracker): ResolvedGoalProject;
```

### Remove Files

None.

### Change Files

#### Evidence selector

Code Source: `src/lib/goals/evidence.ts`
Code Description: `EvidenceInput` carries `goal` and `projects` but not the tracker; `buildGoalEvidence` branches on `goal.projectId` (line 90) and filters tasks/logs by it (lines 91-93, 128-139).
Code Change Description: Accept the tracker (or the already-resolved id) in the input, resolve once at the top, and use the resolved id for every project comparison. An unresolvable id must keep returning `emptyEvidence(true)`.

```ts
export interface EvidenceInput {
    readonly goal: Goal;
    readonly tracker: GoalTracker;
    // ...
}
```

#### Evidence panel

Code Source: `src/components/goals/GoalEvidencePanel.tsx`
Code Description: Six raw reads, lines 41, 66, 68, 85, 91, 93; the panel returns `null` for a project-less goal at line 93.
Code Change Description: Replace each read with the resolved id, resolving from the goal plus its tracker. Keep the existing freeze/prefill semantics; only the source of the id changes.

#### Check-in wizard

Code Source: `src/components/goals/CheckInWizard.tsx`
Code Description: `{goal.projectId !== null && <GoalEvidencePanel ... />}` (line 301) decides whether the panel exists.
Code Change Description: Gate on the resolved project id instead.

#### Tracker lookup at call sites

Code Source: `src/state/GoalContext.tsx` / `src/components/goals/CheckInWizard.tsx`
Code Description: The wizard already has `trackerId` and the goals state; the panel receives only `goal` and `checkIn`.
Code Change Description: Pass the tracker (or resolved id) into the evidence panel; no new context reads outside the authenticated route shell.

## Notes

- Multiple inheriting goals intentionally share one task pool: no de-duplication and no "claimed" marker.
- A tracker project change mid-period re-baselines the prefill without confirmation; that is accepted behaviour.
- Provisional issue number; GitHub assigns the final number on creation.
