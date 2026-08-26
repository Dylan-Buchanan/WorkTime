## Title: Working past a task's estimated pomodoro count resets its progress and rewrites the estimate

## Tags

Complexity Classification: T3
Severity: Medium
Reason: The bug is real and cross-cutting rather than display-only. Root causes span the pure engine (which mutates `target_pomodoros` upward), the sync layer (which then overwrites `PMTask.estimatePomos`), and two display surfaces plus the projection logic. The upward-mutation behavior is currently asserted in engine tests, so those tests must be intentionally revised. The desired overage semantics and handling of already-inflated persisted data are still open, which is why research is needed before implementation.
Needs research before implementation: Yes — define the desired overage semantics (e.g., whether overage should be shown against the original estimate and/or require a separate stored "original estimate"), decide how to treat previously persisted tasks whose `target_pomodoros`/`estimatePomos` were already inflated, and trace all consumers of `estimatePomos`/`target_pomodoros` (agent start-of-day handoff, weekly/day projections, tooltips) to preserve prediction quality.

Answer to research questions:

- Overage should be shown against the original estimate
- Previous tasks can be ignored

## Summary

Completing more pomodoros than a task's estimate causes the app to lose the original estimate and clamp visible progress back to the goal, so overage work is hidden and the stored estimate is permanently inflated — degrading the data used for future time prediction.

## Steps to Reproduce Context

1. Create a task with an estimated target of 2 pomodoros.
2. Complete the first and second pomodoros without completing the task (task remains unfinished, so the estimate/target stays at 2).
3. Start a third work pomodoro on the same task.
4. Observe the focus progress summary and the task's stored estimate.

## Expected Behavior

When working past a task's estimated pomodoro count, the worked amount should continue to count beyond the estimate (e.g., showing something like "2.1" or "2.5" worked against a still-visible original goal of 2, or otherwise surfacing the true overage). The original estimate used for planning and future prediction should be preserved and not silently rewritten, and over-estimate tasks should remain visible in projections rather than being dropped.

## Actual Behavior

- The engine inflates the stored target when work exceeds it: `completeTimer` (`src/lib/engine/timerCommands.ts`), `stopWorkTimer` (same file), `setActiveTask` (`src/lib/engine/taskCommands.ts`), and `finalizeTask` (same file) all set `target_pomodoros = Math.ceil(completed_pomodoros)` once `completed_pomodoros` exceeds `target_pomodoros`. A task estimated at 2 becomes a task estimated at 3.
- `src/state/StateSyncBridge.tsx` then syncs `PMTask.estimatePomos = backendTask.target_pomodoros`, so the project-manager estimate is overwritten with the inflated value and the original estimate (2) is lost.
- The focus progress display clamps completed work to the target (`src/components/TimerPanel.tsx` renders "X done · Y left (goal Z)"), hiding the overage.
- The weekly/day finish projections exclude tasks once `estimate - worked` reaches zero (`src/components/TimerPanel.tsx`), so tasks that went over the estimate disappear from the planned work.

This is likely why progress appears to "reset back" to the estimate and why tasks that exceeded the estimate are no longer surfaced.

## Requirements for completed issue

1. A task that receives more pomodoros than its original estimate must keep counting worked pomodoros beyond the estimate instead of resetting or clamping its visible progress.
2. The original estimate used for prediction must be preserved when work exceeds it; the estimate must not be silently rewritten or lost when a task goes over (this includes the timer engine's `target_pomodoros` mutation and the `StateSyncBridge` estimate sync).
3. Tasks that have gone over their estimate must remain visible in the relevant task lists and projections rather than being dropped.
4. Existing behavior tests asserting the current "inflate estimate to match overage" behavior must be updated to reflect the corrected semantics.

## Context

- Files:
    - `src/lib/engine/timerCommands.ts` — `completeTimer` (lines 81-83), `stopWorkTimer` (lines 105-107) inflate `target_pomodoros` past the estimate.
    - `src/lib/engine/taskCommands.ts` — `setActiveTask` (lines 29-31), `finalizeTask` (line 81) inflate `target_pomodoros`.
    - `src/lib/engine/core.ts` — `clampFraction`, `normalizePositiveInteger` helpers; `Task` shape in `src/state/types.ts`.
    - `src/state/StateSyncBridge.tsx` — overwrites `PMTask.estimatePomos` from `backendTask.target_pomodoros` (lines 320-321); also derives `workedPomos`/`timeSpentMinutes`.
    - `src/components/TimerPanel.tsx` — focus progress summary clamps completed to target (line 497, rendered at lines 629-635); projections drop over-estimate tasks (lines 381-382).
    - `src/components/TaskPanel.tsx` — renders `(completed/estimate)` (line 332).
    - `src/state/types.ts` — `Task.completed_pomodoros` "includes partials" (line 5); `PMTask.estimatePomos` "estimated pomodoros" (line 40); `PMTask.workedPomos` derived from timer logs (line 42).
    - `src/lib/engine/engine.test.ts` — asserts the current inflation behavior (e.g., lines 140-143, 166-167); these tests must be updated.

- Code Snippets:
    - `src/lib/engine/timerCommands.ts` (`completeTimer`):
        ```ts
        task.completed_pomodoros += fraction;
        if (task.completed_at === null && task.completed_pomodoros > task.target_pomodoros) {
            task.target_pomodoros = Math.ceil(task.completed_pomodoros);
        }
        ```
    - `src/state/StateSyncBridge.tsx`:
        ```ts
        if (!shouldSkipEstimateUpdate && pmTask.estimatePomos !== backendTask.target_pomodoros) {
            patch.estimatePomos = backendTask.target_pomodoros;
        }
        ```
    - `src/components/TimerPanel.tsx` (focus summary clamps to target):
        ```ts
        const withActive = Math.min(target, Math.max(0, completed + activeFractionComplete));
        ```
    - `src/components/TimerPanel.tsx` (projection drops over-estimate tasks):
        ```ts
        const remaining = Math.max(0, estimate - worked);
        if (remaining <= EPSILON) return;
        ```
    - `src/components/TaskPanel.tsx`:
        ```tsx
        {t.name} ({Math.round(t.completed_pomodoros * 10) / 10}/{pmTask?.estimatePomos ?? t.target_pomodoros})
        ```

## Notes

- `Task.completed_pomodoros` already supports fractional values ("includes partials"), so the data model can represent overage without an immediate schema change.
- `PMTask.estimatePomos` (and the agent start-of-day planner, `src/lib/engine/plannerContext.ts`, `src/lib/engine/startOfDay.ts`, `src/lib/engine/endOfDay.ts`) consume the estimate for prediction; any change must preserve that estimate for future-planning quality.
- Resolution may choose between keeping the original estimate visible against the inflated target, or introducing a separate stored original-estimate value — this decision requires the pre-implementation research called out in the Tags section.
