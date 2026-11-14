# Title: Goal row display and tri-state project control

## Tags

Complexity Classification: T2
Classification Reason: Contained to the Goals page row and editor plus the shared link component, but the editor must model three link states while preserving a dangling override — real state logic.

Severity: Medium
Severity Reason: A wrong deviation rule or a lost dangling override changes what the page claims about a goal without touching stored history.

Needs research before implementation: No

## Summary

A goal rows shows a project only when its resolved project differs from the tracker's project — the same deviation rule the deck uses. The goal editor's project select is replaced with a three-way control: use the tracker project, no project, or an explicit project. Quick-add continues to create inheriting goals.

This keeps a tracker of eight goals from repeating one muted project name eight times, and makes the shared resolver's result visibly consistent between the Goals page and the deck.

Depends on the resolution contract issue (`resolveGoalProject`) and the tracker write path issue (shared project link component).

## Steps to Reproduce Context

1. Open Goals and select a tracker whose goals all point at the same project.
2. Each row renders the same project name: `{goal.projectId !== null && <GoalProjectLink projectId={goal.projectId} />}` (`src/components/GoalsPage.tsx:656`).
3. Click Edit goal. The project control is a single select (`src/components/GoalsPage.tsx:803-807`) with "No project", a synthetic "Missing project" option for a dangling stored id (line 805), and every project.
4. Save writes the raw id: `onSave({ title, notes, projectId: projectId || null, metric: nextMetric })` (line 788).
5. Quick add creates a goal with no project: `goals.createGoal({ trackerId: tracker.id, title, notes })` (lines 437-439).

There is no way to say "use the tracker's project" and no way to see that a goal differs from its tracker.

## Requirements for completed issue

1. A goal row renders the project name only when the goal's resolved project deviates from the tracker's resolved project. Identical ids render nothing.
2. Deviation is decided by id comparison, not by mode: an explicit project equal to the tracker's project renders nothing.
3. A goal overriding to a project while the tracker has no project is a deviation and shows the name.
4. An inheriting goal in a project-less tracker renders nothing.
5. The goal editor exposes three choices — use the tracker project, no project, explicit project — and saves the matching `projectLink` branch.
6. The synthetic "Missing project" option remains available for a dangling override, so editing another field cannot silently clear or rewrite it.
7. Quick-add creates `{ mode: "inherit" }`.
8. The goal row and the editor both use the shared project-link component and the shared resolver; no local copy of the missing-project copy.

## Expected Behavior

- A goal row shows a project only when it is worth flagging: the goal deviates from its tracker.
- The editor states plainly which of the three link states is active and preserves a dangling override until the user changes it.
- A newly added goal inherits the tracker project without the user doing anything.

## Actual Behavior

- Every goal with a stored project repeats that name on its row, including when it matches the tracker.
- The editor offers only "project or no project", with no inheritance and no inheritance intent.
- There is no visual signal that a goal differs from its tracker.

### Testing

1. `src/components/GoalsPage.test.tsx` — row shows no project when the goal inherits and the tracker has one; shows the name when the goal overrides; shows nothing for inherit with a project-less tracker; shows the name when both are set to different projects.
2. Editor: switching between the three states saves `inherit`, `none`, and `project`; saving an unrelated edit on a goal with a dangling override keeps the override.
3. Quick-add creates an inheriting goal and no project is written.
4. Dangling override renders "Linked project is missing" in the row via the shared component.
5. `pnpm test:unit` and `pnpm run build`.

## Issue Context

### New Files

None.

### Remove Files

None.

### Change Files

#### Goal row

Code Source: `src/components/GoalsPage.tsx`
Code Description: `GoalRow` (line 640) renders the project link unconditionally on a non-null id (line 656).
Code Change Description: Accept the tracker (or its resolved project id), resolve the goal, and render `<ProjectLink />` only when the resolved ids differ. Keep the row layout otherwise unchanged.

#### Goal editor

Code Source: `src/components/GoalsPage.tsx`
Code Description: `GoalEditor` (line 671) initialises `const [projectId, setProjectId] = useState(goal.projectId ?? "")` (line 678), computes `missingProject` (line 679), and renders the select at lines 803-807 with the synthetic option at line 805.
Code Change Description: Replace the single select with a mode control plus a project select that is only enabled or shown for explicit mode. Preserve the missing-project option for a dangling explicit id. Save the `projectLink` union instead of a raw id.

```tsx
const [link, setLink] = useState<GoalProjectLink>(goal.projectLink);
const missingProject = link.mode === "project" && !projects.some(p => p.id === link.projectId);
// ...
onSave({ title, notes, projectLink: link, metric: nextMetric });
```

#### Quick add

Code Source: `src/components/GoalsPage.tsx`
Code Description: Quick-add call site, lines 437-440.
Code Change Description: No product change expected; confirm the created goal is `{ mode: "inherit" }` once the creator default lands.

#### Context input types

Code Source: `src/state/GoalContext.tsx`
Code Description: `NewGoalInput` (line 29) currently takes `projectId?: string | null`; `updateGoal` (line 46) patches `Partial<Omit<Goal, ...>>`.
Code Change Description: Replace the input field with the link union so callers cannot pass a half-state.

## Notes

- Goals that inherit one tracker project intentionally share a single task pool; overlapping evidence between them is by design.
- Provisional issue number; GitHub assigns the final number on creation.
