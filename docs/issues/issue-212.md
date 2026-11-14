# Title: Distinguish nothing workable from nothing at all when completing the occupant

## Tags

Complexity Classification: T1
Classification Reason: One new pure export beside `isWhatsNextCandidate` in `src/lib/whatsNext.ts` plus tests in `src/lib/whatsNext.test.ts`. The only real work is keeping the classifier's exclusion set identical to the existing predicate and defining a deterministic reason precedence; no component, state or timer code changes.

Severity: Low
Severity Reason: The output only feeds the notice text in branch 4 of the completion controller. A wrong count or reason changes wording, never the timer or task state, and branch 4's behaviour (pause, commit, open the sheet) is unchanged either way.

Needs research before implementation: No

## Summary

`isWhatsNextCandidate` in `src/lib/whatsNext.ts:63-75` collapses every exclusion into a single boolean. Its filter set is: archived PM task, `status === "Done"`, `status === "Blocked"`, `waitingOf(task) !== null`, the current occupant, a backend task with `completed_at` or `archived`, and a project that `isProjectWorkableOnDate` rejects for the reference date.

The completion controller in #211 needs to tell two very different situations apart when the occupant is completed: "there is genuinely nothing else to do" and "there are plenty of tasks, none of which can be worked on right now". A Saturday with Friday-only projects and a dozen backlog tasks is not "you have nothing to do", and silently ending a valid work window there reads as a bug.

This issue adds a pure classifier beside `isWhatsNextCandidate` that reports whether any non-archived, non-Done PM task exists outside the occupant, and why the rest were filtered out. Branch 4 of the controller opens the sheet with zero candidates and a notice naming the dominant reason.

This is issue 3 of 5 and requires #210. It can proceed in parallel with #211, #213 and #214.

## Steps to Reproduce Context

1. Have one task owning the running work window, plus a dozen backlog tasks whose only project is scheduled for Friday.
2. On a Saturday, complete the occupying task.
3. Observe: ranking returns no candidates, so the completion path has no way to distinguish this from an empty board and falls back to "Nothing else to switch to".
4. Complete the occupant when it is genuinely the only PM task.
5. Observe: the same empty ranking result, so both situations are presented identically.

## Requirements for completed issue

1. A pure classifier exported from `src/lib/whatsNext.ts` beside `isWhatsNextCandidate`, reporting whether any non-archived, non-Done PM task exists outside the occupant.
2. It reports per-reason counts for the reasons that excluded each non-occupant task, drawn only from the existing filter set: project not workable on the reference date, `Blocked`, `waiting`, backend completed/archived. Counts must not introduce reasons the predicate does not enforce.
3. It reports which reason is dominant, with a documented, deterministic precedence when a task matches several filters.
4. It is a pure function of `pmTasks`, `backendTasks`, `projects`, `currentOccupantId` and the reference `Date`; no clock reads and no dependency on input array order.
5. It is consistent with `isWhatsNextCandidate`: a task the predicate accepts is never counted as excluded, and a task the predicate rejects is counted exactly once.
6. The occupant itself is excluded from the counts.
7. Branch 4 of #211 can open the sheet with zero candidates and a notice naming the dominant reason.
8. The notice coexists with the sheet's existing empty state instead of duplicating it: the sheet already renders "Nothing else to switch to" when `top` and `continuation` are both empty (`src/components/SwitchSheet.tsx:176`), so the user sees one message, not two.
9. Unit tests in `src/lib/whatsNext.test.ts` cover the above.

## Expected Behavior

- When every non-occupant task is filtered out because its project is not workable on the reference date, the result says so and names that as the dominant reason.
- When every non-occupant task is `Blocked`, `waiting`, or backend-completed/archived, the result names the corresponding dominant reason.
- When only the occupant exists, the classifier reports that nothing else exists at all, and the controller ends the window atomically.
- When at least one workable candidate exists, the classifier reports availability and the controller opens the sheet with candidates as usual.
- The reason counts add up to the number of non-occupant, non-archived, non-Done tasks, with a fixed precedence deciding each task's single bucket.

## Actual Behavior

- `isWhatsNextCandidate` returns only `true`/`false` per task (`src/lib/whatsNext.ts:63-75`), so callers cannot tell an empty board from a filtered one.
- `rankWhatsNext` returns empty `top`/`continuation` arrays in both cases.
- Nothing in the codebase names why a task was excluded.

### Testing

- `pnpm test:unit` with new cases in `src/lib/whatsNext.test.ts`:
  - only the occupant exists → reports nothing at all, with zero non-occupant tasks counted.
  - every other task is archived or `Done` → reports nothing at all.
  - every other task is filtered by project schedule → reports tasks exist, with the project-schedule reason dominant and the correct count.
  - mixed `Blocked`/`waiting`/backend-completed tasks → per-reason counts are correct and the documented precedence decides the dominant reason.
  - a task matching several filters is counted once, in the precedence-defined bucket.
  - a workable candidate present → availability is reported and no reason dominates.
  - input array order does not change the result.
  - classifier agreement: for a sample of tasks, `isWhatsNextCandidate` acceptance excludes them from counts.
  - reference-date boundary: a task whose project becomes unworkable after midnight is classified by the supplied reference, not by the wall clock.
- `pnpm run build` passes.

## Issue Context

### Change Files

#### `src/lib/whatsNext.ts` — classifier beside the predicate

Code Source: `src/lib/whatsNext.ts:62-75`
Code Description: `isWhatsNextCandidate` applies the full exclusion set in one expression: PM archive/Done/Blocked/waiting, current occupant, backend `completed_at`/`archived`, and `isProjectWorkableOnDate`.
Code Change Description: Add an exported classifier that mirrors this exclusion set exactly and buckets each rejected non-occupant task by reason. Keep `isWhatsNextCandidate` as the single source of truth for eligibility; the classifier must not diverge from it.

```ts
export function isWhatsNextCandidate(task: PMTask | undefined, input: {
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    currentOccupantId: string | null;
    reference: Date;
}): boolean {
    if (!task || task.isArchived || task.status === "Done" || task.status === "Blocked" || waitingOf(task) !== null) return false;
    if (input.currentOccupantId !== null && task.id === input.currentOccupantId) return false;
    const backend = task.appTaskId ? input.backendTasks[task.appTaskId] : undefined;
    if (backend?.completed_at || backend?.archived) return false;
    const project = task.projectId ? input.projects[task.projectId] : undefined;
    return !project || isProjectWorkableOnDate(project, input.reference);
}
```

Expected shape (names are the implementer's call, the fields are the contract):

```ts
export type WhatsNextExclusionReason = "project-not-workable" | "blocked" | "waiting" | "backend-closed";

export interface WhatsNextAvailability {
    /** Any non-occupant, non-archived, non-Done PM task exists. */
    hasAnything: boolean;
    /** Any non-occupant task passes `isWhatsNextCandidate`. */
    hasWorkable: boolean;
    /** Rejected non-occupant task count per reason. */
    counts: Readonly<Record<WhatsNextExclusionReason, number>>;
    /** Highest-count reason, ties broken by the documented precedence. */
    dominantReason: WhatsNextExclusionReason | null;
}
```

#### `src/components/SwitchSheet.tsx` — no change expected, empty state already exists

Code Source: `src/components/SwitchSheet.tsx:174-176`
Code Description: The sheet renders `notice` when supplied and its own "Nothing else to switch to" placeholder when both `result.top` and `result.continuation` are empty.
Code Change Description: None expected. The caller must ensure branch 4 produces a single message; if both are shown, the sheet's placeholder should be suppressed when a notice explaining emptiness is present.

```tsx
{notice && <p role="status" className="mb-3 rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-3 py-2 text-sm text-indigo-300">{notice}</p>}
{error && <p role="alert" className="mb-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}
{result.top.length === 0 && result.continuation.length === 0 && <p className="rounded-lg border border-dashed border-neutral-700/70 px-3 py-6 text-center text-sm text-neutral-500">Nothing else to switch to</p>}
```

## Notes

- Dependencies: #210. Consumed by #211 branch 4; this issue can land before or alongside #211.
- Reason precedence must be written down in the module, not left implicit, because it decides the notice wording at runtime.
- Deliberately out of scope: any change to `rankWhatsNext` ordering, the sheet's visual design, and any new exclusion reason.
