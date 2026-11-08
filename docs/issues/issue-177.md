# Title: Pure "what's next" ranking with one-per-tier promotion

## Tags

Complexity Classification: T2
Classification Reason: Additive pure-module work with a colocated unit test. It deliberately does not modify `collectEligibleProjectionTasks` or its two consumers, so blast radius is one new `src/lib` module. The complication is an external dependency on open issue #172 for the shared "project workable today" predicate.

Severity: Medium
Severity Reason: No data model, migration, auth or persistence surface is touched and nothing consumes the module yet, so a defect cannot corrupt state or lose work. Once wired to a surface, a mis-ranking would misdirect the user's prioritisation, which is a visible correctness problem rather than a cosmetic one.

Needs research before implementation: Yes

### Research Needed

- Issue #172 has not landed. Capture the exact shared "project workable on this date" predicate it introduces — name, signature, location — because this module must import and reuse it rather than duplicate the rule.
- Confirm the priority rank mapping for `High | Medium | Low` and whether the new collector should reuse `parseDueDateKey` (`src/lib/timer.ts:20-28`), the estimate floor at `:106-107`, and the missing-project → `null` resolution at `:108`.
- Define the "due soon" boundary for the next-up tier and confirm whether it reuses `classifyDueScope` / `getLocalWeekWindow` (`src/lib/timer.ts:124-138`, `:30-44`) or a new day offset.
- Confirm the "current occupant" input shape (an active work task id, or an explicit task id) and that no UI wiring is in scope.

## Summary

The switch/waiting sheet needs a short, opinionated list of what to do next. A strict waterfall ("highest priority, then closest due, then shortest") lets a single high-priority long task fill the whole top of the list, so a quick win never surfaces when the user is under time pressure.

This issue adds a pure ranking module that promotes one candidate per tier:

- **Top pick** — priority plus closest due.
- **Quick win** — smallest remaining pomodoros.
- **Next up** — best of due-soon / high-priority.

The module is driven by its own candidate collector so it does not change the documented contract of `collectEligibleProjectionTasks`, which the projected-finish card and the Today surface both depend on. In particular, this module must *not* start including no-estimate tasks in the shared collector — the un-estimated tail lives only in this module's continuation list.

## Steps to Reproduce Context

1. Look for any function in `src/lib` that answers "what should I work on next" for the timer page.
2. Observe: none exists. The only shared task-selection helper is `collectEligibleProjectionTasks`, which is a scope definition, not a ranking.
3. Observe: ranking by the existing sort keys alone (bucket → due → title) produces a flat list with no promotion.

## Requirements for completed issue

1. A new pure module returns a top three plus a continuation list, with the reference date injected and no wall-clock reads.
2. Candidates come from a new collector owned by this module. `collectEligibleProjectionTasks` and its documented invariant are unchanged.
3. Candidates exclude `Done`, `Blocked`, archived, waiting, and the current occupant.
4. Candidates also exclude tasks whose project is not workable on the reference date, reusing the predicate introduced by #172. This issue is blocked on #172 and must not duplicate that rule.
5. The three top slots are promoted one per tier, so one candidate cannot fill more than one slot: top pick, quick win, next up.
6. Quick win means smallest remaining `estimate - worked`, with no window-remainder awareness in ranking.
7. Tiebreaks inside each tier, in order: priority rank, due key ascending with nulls last, remaining pomodoros, `sortOrder`, title.
8. The continuation list continues the same chain, deduped against the top three, with un-estimated tasks as an unknown-length tail.
9. An empty pool returns an explicit empty result the sheet can render without special-casing.
10. Un-estimated tasks never enter the top three.
11. Over-estimated tasks inherit the existing floor of `1`.
12. A missing project resolves to `null` rather than excluding the task (subject to requirement 4).
13. The output is deterministic: identical inputs always produce an identical ordering.

## Expected Behavior

- Given a pool with a high-priority long task and a small low-priority task, the top three contain the long task in one tier and the small task in the quick-win tier.
- Given a pool of one task, the top three contain that task once and the continuation is empty.
- Given a pool with no eligible tasks, the result is an explicit empty result.
- Given the same inputs twice, the ordering is byte-identical.
- An un-estimated task appears only in the continuation tail.

## Actual Behavior

- No ranking module exists.
- `collectEligibleProjectionTasks` (`src/lib/timer.ts:80-122`) filters by due scope only and is explicitly documented as the shared scope definition, so it cannot be repurposed for ranking without breaking the Today/projection agreement.

### Testing

- `pnpm test:unit` — a new colocated `src/lib/*.test.ts` covering: one-per-tier promotion, each tier's tiebreak chain in isolation, dedupe between top three and continuation, the un-estimated tail, the empty pool, the `1` floor for over-estimated tasks, missing-project → `null`, and determinism across repeated runs.
- Exclusion coverage: `Done`, `Blocked`, archived, waiting, current occupant, and non-workable-project tasks are absent.
- Regression: `src/lib/timer.test.ts` and `src/lib/today.test.ts` remain unchanged and passing, proving the shared collector contract was not touched.

## Issue Context

### New Files

- A new pure module under `src/lib/` (for example `src/lib/whatsNext.ts`) with a colocated test. It exports the result types (top three slots plus continuation) and a single ranking function taking the PM tasks, backend tasks, projects, the current occupant id, and the injected reference date.

```ts
export type PromotionTier = "top-pick" | "quick-win" | "next-up";

export interface RankedCandidate {
    task: PMTask;
    projectId: string | null;
    dueDate: string | null;
    dueKey: string | null;
    remainingPomodoros: number;
    tier: PromotionTier | null; // null = continuation entry
}

export interface WhatsNextResult {
    top: RankedCandidate[];        // at most three, one per tier
    continuation: RankedCandidate[];
}

export function rankWhatsNext(input: {
    pmTasks: readonly PMTask[];
    backendTasks: Readonly<Record<string, Task>>;
    projects: Readonly<Record<string, Project>>;
    currentOccupantId: string | null;
    reference: Date;
}): WhatsNextResult;
```

### Remove Files

None.

### Change Files

None in existing production code. The module must not alter:

- `src/lib/timer.ts:80-122` — `collectEligibleProjectionTasks`, whose contract is documented at `:75-79`.
- `src/lib/today.ts:78` — the Today builder consumer.
- `src/components/TimerPanel.tsx:376-384` — the projected-finish consumer.

The workable-today predicate itself is delivered by #172; this module imports it.

## Notes

- **Blocked on #172.** The project-workable-today rule is introduced there and has not landed. Implement this issue after #172 so the predicate can be imported rather than reimplemented; otherwise the picker reintroduces exactly the bug #172 fixes.
- `PMTask.waiting` (issue 3 in this series) must exist before the waiting exclusion can be implemented.
- Keep the module free of I/O, `Date.now`, and randomness so it stays unit-testable.
