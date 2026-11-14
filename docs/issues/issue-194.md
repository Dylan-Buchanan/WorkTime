# Title: Open switch panel instead of ending the timer when completing the active task

## Tags

Complexity Classification: T3
Classification Reason: Epic index for five reviewable slices. The whole change introduces a provider above the authenticated route shell, relocates the single `SwitchSheet`, adds an engine command and a pure classifier, and settles overlay ownership, so the aggregated blast radius covers the engine, data layer, controller, timer panel and overlays. Each slice is classified in its own issue.

Severity: Medium
Severity Reason: Today completing the active task ends a valid pomodoro and loses its remaining time, which is a daily workflow mismatch rather than data loss. The change itself must not strand a window or leave a PM-Done task with an open backend twin, so it needs care but is recoverable.

Needs research before implementation: No (each child issue carries its own research section)

## Summary

Pressing Complete on the active task while a pomodoro is running currently ends the timer outright. `finalizeTask` (`src/lib/engine/taskCommands.ts:73-89`) stops or completes the work window solely because `timer.task_id === taskId`, and both completion entry points route through it or through `requestFinalize`, which defers the finalize for the occupant into `pendingFinalizeRef`.

Completing a task usually means moving on to other work, not stopping for the day. The intended behaviour is that completing the active task opens the switch panel first, so the running work window survives, and choosing a next task hands that window and its remaining time to the new task.

That cannot be expressed today: `finalizeDeferredTask` refuses owners (`src/lib/engine/pendingFinalize.ts:21`), and a deferred finalize held only in `pendingFinalizeRef` is lost on reload, leaving a PM-Done task whose backend twin stays open forever and keeps rendering in the sidebar with no ACTIVE badge.

This epic is split into five issues so the pure engine work, the routing, the explanation content, the presentation and the overlay integration can each be reviewed and tested on their own.

## Decision table

The completion controller introduced in #211 implements exactly this table:

| # | Situation | Behaviour |
| --- | --- | --- |
| 1 | Task is not the window occupant | Today's `finalizeTask` |
| 2 | Occupant, `windowRemainingSecs <= 0` | `finalizeTask` + progression |
| 3 | Occupant with a workable candidate | Pause, hold memo, owner-safe commit, open the sheet |
| 4 | Occupant with tasks but none workable | As (3) plus a notice naming the dominant reason |
| 5 | Occupant with nothing else | `finalizeTask` + progression, no sheet |

Dismissing the sheet needs no cleanup: the commit is already durable and the window simply stays paused on a completed task, which #213 explains in the panel.

## Child issues

Ordered; #210 must land before #211. #212, #213 and #214 can proceed in parallel afterwards.

1. #210 — Owner-safe task completion in the engine. Adds `completeTaskKeepingWindow` and its data-layer wrapper: commit the task without touching `state.timer`. (T1)
2. #211 — Completion controller and single sheet host. Provider exposing `completeTask(pmTaskId)`, owning the decision table and the single `SwitchSheet` mount; the sidebar active row and Today surface route into it. (T3, needs research)
3. #212 — Distinguish "nothing workable" from "nothing at all". Pure classifier beside `isWhatsNextCandidate` with per-reason counts and a deterministic dominant reason, used by branch 4. (T1)
4. #213 — Presenting a completed occupant. A `Completed` badge and a "Pick next" primary action, with `Resume` routing into the sheet. (T2, needs research)
5. #214 — Overlay ownership for the global switch sheet. Z-order and Escape ownership against the `z-40` overlays, plus focus restore when the invoker unmounted. (T2, needs research)

## Expected Behavior

- Completing the active task while its window has time left pauses the clock, commits the task, and offers a switch.
- Choosing a next task hands the paused window and its remaining time to that task, producing one log for the window.
- Dismissing the sheet leaves the clock paused on a completed task, and the timer panel shows a `Completed` badge and a "Pick next" action so the state is explained.
- Completing a task that is not the occupant, or completing the occupant when nothing else can be worked on, still ends the window as today.
- Completing during a break only completes the task, with no sheet.
- One Escape closes exactly one overlay layer.

## Actual Behavior

- `finalizeTask` ends the window whenever the task owns it, so the remaining time is lost.
- `requestFinalize` defers the occupant's finalize into `pendingFinalizeRef`, which does not survive a reload.
- The switch sheet is mounted inside `TimerPanel`, so it is only reachable from the timer route and never coexists with a PM drawer.
- The task chip and primary action have no notion of a completed occupant, so a paused-on-completed-task state is indistinguishable from a normal pause.

### Testing

- Each child issue carries its own `pnpm test:unit` cases and build check.
- End-to-end acceptance for the epic: start a pomodoro, complete the occupant from the sidebar and from the Today surface, pick a next task from the sheet, and confirm one log for the window with the remaining time carried over.
- Confirm the recovery path: dismiss the sheet after completing, reload, and verify the task stays committed and archived with no backend twin left open.
- `pnpm run build` passes; run `pnpm test:unit` at minimum on every slice.

## Issue Context

This issue is a tracking index. All code context, file references, snippets and per-slice requirements live in the child issues listed above.

Key existing anchors:

- `src/lib/engine/taskCommands.ts:73-89` — `finalizeTask`, which ends the window when the task is the occupant.
- `src/lib/engine/pendingFinalize.ts:16-29` — `finalizeDeferredTask` returns `"owner"` for the occupant; `ownsWorkWindow` is the shared owner check.
- `src/lib/whatsNext.ts:63-75` — `isWhatsNextCandidate`, the single eligibility definition.
- `src/components/TimerPanel.tsx:270-283,786-798` — the sheet's current local state and mount.
- `src/components/TaskPanel.tsx:340-352` — the sidebar active-row Complete button.
- `src/components/TodaySurface.tsx:198-208` — `handleCompleteTask`.
- `src/App.tsx:159-194` — the authenticated provider graph and route shell.
- `src/components/SwitchSheet.tsx:136` and the `z-40` overlays — the overlay tier this epic must arbitrate.

## Notes

- Dependency: #210 first, then #211. #212, #213 and #214 are parallel.
- No Tauri `invoke` data path, no server-side change and no new synced state are introduced by this epic.
- Deliberately out of scope: per-task partial window resume state (the retired `inProgressPomodoros` map), any change to pomodoro log shape, and a general overlay/layer-manager abstraction.
