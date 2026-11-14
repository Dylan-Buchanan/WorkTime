# Title: Tracker project write path and header chip

## Tags

Complexity Classification: T1
Classification Reason: One form field, one header chip, and a mechanical extraction of an existing page-local helper into a shared component.

Severity: Medium
Severity Reason: Without it the stored tracker project cannot be set, but no existing behaviour is put at risk.

Needs research before implementation: No

## Summary

The tracker project column exists after the model foundation issue, but nothing can set it. This issue adds a project select to the tracker form, shows the tracker's linked project as a muted chip in the tracker header, and extracts the existing goal-row `GoalProjectLink` into a shared component so the chip and the goal row use one implementation.

That single component is also the only place where a linked project's condition — healthy or dangling — is rendered.

Depends on the model foundation issue (tracker `projectId`).

## Steps to Reproduce Context

1. Open Goals and select a tracker.
2. Click Edit on the tracker (`TrackerForm`, `src/components/GoalsPage.tsx:521`). The form submits `{ name, purpose, cadence, color }` only (line 535) and has no project control.
3. The tracker header (`GoalsPage.tsx:328-345`) shows name, an archived badge, and cadence pills; there is nowhere to see a project even if one were stored.
4. The only project display in the page is the local `GoalProjectLink` (`GoalsPage.tsx:586-592`), used by `GoalRow` at line 656, which reads `pm.state.projects[projectId]` and renders "Linked project is missing" when absent.

## Requirements for completed issue

1. `TrackerForm` has a project select listing existing projects, plus "No project", and a static hint line explaining that goals inherit the tracker project unless they override it.
2. Saving the form writes the tracker's project (create and edit paths) through `GoalContext`.
3. The tracker header shows a muted chip with the linked project's name, or "Linked project is missing" when the stored id does not resolve.
4. `GoalProjectLink` is extracted from `GoalsPage.tsx` into a shared component used by both the tracker chip and the goal row. Its rendered copy and styling stay consistent between the two call sites.
5. Archived projects still count as valid links. Dangling links are never cleared by editing the form, by project deletion, or by project archiving.
6. Changing the tracker project does not touch any goal row and does not clear or move `lastBuiltPeriodStart`.

## Expected Behavior

- A user can link a tracker to a project in one place, and the header states which project the tracker is about.
- With no projects yet, the select offers only "No project" and saving is still possible.
- A link whose project was deleted or archived out of existence keeps rendering "Linked project is missing" until the user changes it.

## Actual Behavior

- Trackers cannot store or display a project; the form has no project control and the header has no project chip.
- The missing-project copy only exists inside the page-local goal-row helper.

### Testing

1. `src/components/GoalsPage.test.tsx` — creating and editing a tracker with a project persists it; saving with "No project" stores null.
2. Header chip renders the project name; rename the project and confirm the chip follows; point the tracker at a non-existent id and confirm "Linked project is missing".
3. Zero-projects case renders a select with only "No project".
4. Changing the tracker project leaves goal rows, goal project links, and the built stamp untouched.
5. Archiving the linked project keeps the chip showing its name (valid link).
6. `pnpm test:unit` and `pnpm run build`.

## Issue Context

### New Files

`src/components/goals/ProjectLink.tsx` — shared project-link display, moved from `GoalsPage.tsx:586-592`.

```tsx
export const ProjectLink: React.FC<{ projectId: string }> = ({ projectId }) => {
    const pm = usePM();
    const project = pm.state.projects[projectId];
    return project
        ? <span className="text-xs text-neutral-400">{project.name}</span>
        : <span className="text-xs text-neutral-500">Linked project is missing</span>;
};
```

### Remove Files

None.

### Change Files

#### Tracker form

Code Source: `src/components/GoalsPage.tsx`
Code Description: `TrackerForm` (line 521) holds name, purpose, cadence, weekday, interval, colour; `onSave({ name, purpose, cadence, color })` at line 535. `NewGoalTrackerInput` (`src/state/GoalContext.tsx:22`) has no project field; `createGoalTracker` (`src/lib/goals/factories.ts:41`) defaults every optional field.
Code Change Description: Add project state initialised from `tracker?.projectId`, a select of `pm.state.projects` sorted like `GoalEditor` does (line 674), the static hint line, and include `projectId` in the saved input. Extend `NewGoalTrackerInput` and the creator default to null. `updateTracker`'s patch type (`GoalContext.tsx:42`) already admits `projectId`.

#### Tracker header chip

Code Source: `src/components/GoalsPage.tsx`
Code Description: Tracker identity header, lines 328-345.
Code Change Description: Render the shared `<ProjectLink projectId={tracker.projectId} />` as a muted chip when `tracker.projectId !== null`, alongside the cadence pills.

#### Shared project link

Code Source: `src/components/GoalsPage.tsx` (`GoalProjectLink`, line 586, used at line 656)
Code Description: Page-local helper reading `usePM()`.
Code Change Description: Replace both the helper and its goal-row usage with the shared component. The goal row's call site becomes the deviation-aware usage from the next issue.

## Notes

- The tracker project is a plain string id with no foreign key; projects live in PM state, not a table, so there is nothing to cascade.
- Provisional issue number; GitHub assigns the final number on creation.
