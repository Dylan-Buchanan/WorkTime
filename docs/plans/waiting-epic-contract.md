# Epic #159 frozen contract — waiting state and mid-window task switching

Status: epic #159 is complete and released in 0.14.0.

Frozen. Lanes implement against this; changes require ORCH authorization.

Scope: epic #159 and sub-issues #173–#179. Evidence is preserved verbatim in
[the research report](../research/epic-159-research.md). References such as
“research A7” identify its numbered sections. The decisions below freeze the
open choices and refine the issue wording where the research found conflicts.

## 1. User decisions (made by the product owner; binding)

- **D1 — Finalize banks the partial.** When the finalized task owns a live Work
  window, finalize credits the elapsed slice (`clampFraction(elapsed/workSecs)`
  on `completed_pomodoros`) and writes one log of elapsed minutes, only when
  `elapsed > 0`, stamped with the window id, before archiving. Then
  `timer = null`, with no cycle increment. If that window had already expired
  unreconciled (`now >= ends_at`, not paused), finalize applies completion
  accounting instead: full capped credit, log `planned/60`,
  `current_cycle_pomodoros += 1`, and `timer = null`. AppState runs the normal
  post-completion progression, so a break starts. Signature gains `logId`:
  `finalizeTask(state, taskId, now, logId)`. Evidence: research A1, A7, B3.

- **D2 — Expired-window switch is natural completion.** Switching when
  `now >= ends_at` (not paused) credits the outgoing task with completion
  accounting, using the same numbers as `completeTimer`, increments the cycle
  exactly once, nulls the timer, and sets `active_task = incoming`. AppState then
  runs ordinary post-completion progression so the normal break starts, with
  `task_id = active_task = incoming`. “No new timer opens” in #173 means “no new
  WORK timer opens”. Evidence: research A7, A21, B1.

- **D3 — Progress ring and Today active fraction are WINDOW-relative.** For Work
  timers, `fraction = 1 - remainingSecs / max(work_minutes*60, planned_secs)`.
  Unswitched windows are numerically unchanged; a switch does not reset the ring
  or change Today “Np left”. Evidence: research A16, B4.

- **D4 — Due soon means due this local week.** For the #177 next-up tier,
  `classifyDueScope(dueDate, reference)` is `"due"` or `"thisWeek"`: overdue,
  today, or by the end of the local week. No new setting. Evidence: research A18,
  B5.

- **D5 — Selection during a break lines up next.** Selecting a task in the #178
  sheet while a break timer is live (for example, the window expired with the
  sheet open) calls `setActiveTask(id)` only. The break and its `timer.task_id`
  are untouched; the next Work window opens on the chosen task when the break
  ends. Show a short notice. `startTaskWork` still refuses during a break
  (#173 requirement 8). Evidence: research A21, B6.

- **D6 — The sheet is a separate modal overlay.** The #178 sheet uses
  `fixed inset-0 z-50`, `role="dialog"`, `aria-modal="true"`, a label, and Esc
  to close, modelled on `src/components/GithubIntegrationCard.tsx` around line
  725. It is not rendered inside the TimerPanel details aside and must not
  disturb `todayDetailsTaskId` or `autoSelectedTaskRef`. Evidence: research A16,
  A22.

## 2. Technical decisions (binding)

- **T1 — Window identity.** `ActiveTimer.window_started_at?: string` is set only
  for Work timers by `startWorkTimer` to now as an ISO string, and preserved on
  every switch, pause, and resume within the window. Breaks never carry it.
  `windowStartedAt(timer)` returns
  `timer.window_started_at ?? ISO(started_at - accumulated_secs)`.
  Evidence: research A3, A6, A8.

- **T2 — End-time semantics.** `ends_at` is fixed while the window is running; a
  switch never moves it while running. Pause freezes progress; resume rebuilds
  `ends_at = now + paused_remaining_secs` (existing behaviour). A switch while
  paused stays paused and sets `planned_secs = remainder`,
  `paused_remaining_secs = remainder`, `accumulated_secs = 0`, and
  `started_at = now`. Evidence: research A1, A7; research Risks item 2.

- **T3 — Switch algebra.** For `setActiveTask` on a live Work window with a
  different task, `elapsed = elapsedTimerSecs(timer, now)` (clamped to at least
  zero) and `remainder = planned_secs - elapsed`. If `remainder <= 0` or
  `(!paused && now >= ends_at)`, take D2's expired branch. This includes a
  sub-second remainder: a window always yields exactly one cycle increment
  unless ended via End focus / `stopWorkTimer`. Otherwise credit the outgoing
  task exactly as today: only when `elapsed > 0`, apply clamped fractional
  credit if the task still exists, and always log elapsed minutes when
  `elapsed > 0`. Set the incoming timer to:

  ```ts
  {
      ...timer,
      task_id: incoming,
      planned_secs: remainder,
      accumulated_secs: 0,
      started_at: now,
      ends_at: running ? timer.ends_at : now + remainder,
      paused_remaining_secs: paused ? remainder : 0,
  }
  ```

  The same task id is an engine no-op. Conservation: total credit and logged
  work minutes per window are at most `work_minutes`. Evidence: research A1,
  A7, B2. D1 explicitly defines the mid-window finalize exit's no-increment
  accounting.

- **T4 — Retire partial-progress persistence.** Delete `inProgressPomodoros`
  everywhere: remove `pomodoroProgress.ts`, the `EngineResult` field, command
  parameters, and every DataAccess/store/staging/merge field. Signatures are
  `startWorkTimer(state, now)`, `setActiveTask(state, taskId, now, logId)`,
  `completeTimer(state, now, logId)`, `stopWorkTimer(state, now, logId)`,
  `finalizeTask(state, taskId, now, logId)`, and `resetAppState(state)`.
  `deleteTask` and `archiveTask` lose the map parameter. Evidence: research A2.

- **T5 — Shared join predicate and work-start path.** In
  `src/lib/engine/core.ts`, export:

  ```ts
  export type WorkStartOccupation = "free" | "join" | "blocked";
  export function workStartOccupation(timer: ActiveTimer | null): WorkStartOccupation;
  export function windowStartedAt(timer: ActiveTimer): string;
  export function windowRemainingSecs(timer: ActiveTimer, now: Date): number;
  export function isWorkWindowLive(timer: ActiveTimer | null, now: Date): boolean;
  ```

  `workStartOccupation`: null → `free`, Work → `join`, break → `blocked`.
  `isWorkWindowLive`: Work and (`paused` or `ends_at > now`). AppState exposes
  `startTaskWork(id): Promise<"started" | "joined">`: free calls `setActiveTask`
  then `startWorkTimer`; join calls `setActiveTask` only (the engine hands over;
  if that closed an expired window, run normal progression per D2); blocked
  throws. `startWorkTimer` gains a defensive guard that throws
  `EngineError("A timer is already running")` when `state.timer` is set. The
  “A timer is already running” refusals in AppStateContext, TodoContext, and
  TodaySurface become join-or-refuse-on-break. Label the timer discard button
  “End focus”; behaviour is unchanged. Evidence: research A8, A9.

- **T6 — Staging v9 → v10.** Set `STAGING_SCHEMA_VERSION = 10`. The v9 step
  drops `inProgressPomodoros` and backfills `window_started_at` on a live Work
  `state.timer` that lacks it, using `started_at - accumulated_secs`. Do not
  rewrite `pendingCompletions` or `lastSynced` baselines. `isTimer` accepts
  optional string `window_started_at`. Remove `isInProgressPomodoroMap`, its
  `REQUIRED_FIELD_CHECKS` entry, and the v5→v6 install of the field; the v5→v6
  step must still produce a valid record for later steps. LocalStagingStore
  loses all handling of the field. Update the v8 fixture in
  `goalsFoundation.test.tsx`. Evidence: research A2, A3, A5, A6.

- **T7 — No timer containment SQL change.** `timer_state` is stored verbatim;
  no SQL change is needed for its containment guard. Never strip
  `window_started_at` from `p_expected_timer`. Evidence: research A4, A25.

- **T8 — Waiting type and normalization.** `PMTask.waiting` is optional in the
  type, with the frozen shared declarations below. Its runtime invariant is
  “always `PMTaskWaiting | null` after `normalizeState`”. Pure helpers in
  `src/lib/pm/waiting.ts` are
  `normalizeWaiting(value: unknown): PMTaskWaiting | null` and
  `waitingOf(task: PMTask): PMTaskWaiting | null`. Missing, malformed,
  unknown-type, or unparseable-`since` values normalize to null. `normalizeState`
  clears waiting when `status === "Done"` or `isArchived`. Concurrent toggles
  follow existing whole-blob `pm_state` LWW: an accepted limitation, with no
  merge work. Evidence: research A13–A15.

  Frozen additive shared declarations in `src/state/types.ts`:

  ```ts
  /** Orthogonal to `status`: a task can be In Progress or Blocked and also waiting. */
  export interface PMTaskWaiting {
      type: "agent" | "person";
      /** ISO timestamp when the wait started. Drives the waiting-duration display. */
      since: string;
  }

  // On PMTask, immediately after relatedTo:
  /**
   * Waiting on an agent or person; orthogonal to `status`. Optional in the type so
   * pre-existing blobs and fixtures stay valid; after ProjectManagerContext
   * normalization it is always `PMTaskWaiting | null`.
   */
  waiting?: PMTaskWaiting | null;

  // On PomodoroLogEntry, immediately after break_skipped:
  /** Identity of the Work window (its ISO `window_started_at`); null/absent for historical, break and break-skip rows. */
  work_window_id?: string | null;

  // On ActiveTimer, immediately after accumulated_secs:
  /** Work-window identity: ISO time the window started. Set on Work timers only; preserved across switch/pause/resume. Absent on break timers. */
  window_started_at?: string;
  ```

  `PMTaskWaiting` is placed immediately before `export interface PMTask`.
  No other shared type changes are part of F0.

- **T9 — One work-start enforcement point (#174 and #175 requirement 4).**
  Pure helpers in `src/lib/pm/workStart.ts`:
  - `applyWorkStart(task: PMTask, nowIso: string): PMTask`: Backlog/Next become
    `"In Progress"` with `updatedAt = nowIso`; In Progress/Blocked/Done retain
    their status; waiting becomes null. Return the SAME object reference when
    nothing changes.
  - `findPMTaskByAppTaskId(tasks: Readonly<Record<string, PMTask>>, appTaskId: string): PMTask | null`:
    deterministic selection by lowest `sortOrder`, then `createdAt`, then `id`.
  - `workOccupantKey(timer: ActiveTimer | null): string | null`: null unless
    `kind === "Work"`; otherwise `${task_id}|${window_started_at ?? ""}`.
    Never include `paused`, `started_at`, or `ends_at`.

  ProjectManagerContext gains `recordWorkStart(taskId: string, at?: string): void`
  applying `applyWorkStart` inside a functional `persist((prev) => ...)` updater.
  `updateTask` also becomes functional over `prev`, with no render-closure read.
  StateSyncBridge holds ONE effect that, when `workOccupantKey(appState.timer)`
  changes to a non-null key, finds the linked PM task and calls
  `recordWorkStart`. It remembers the last applied key in a ref and retries
  when the PM row appears later. Re-starting the same occupant in the same
  window does not re-apply, so a waiting flag set on the running occupant
  survives until it becomes an occupant again. Evidence: research A10–A12, B7.

- **T10 — Inspector start routing.** TaskInspector Start routes through
  `app.startTaskWork(appId)` for both existing-link and create-then-link branches.
  This fixes the create branch never activating the new task. Evidence:
  research A8, A10; research Risks item 12.

- **T11 — Log identity (#179).** `work_window_id = windowStartedAt(timer)`,
  the ISO string verbatim, on switch logs, `completeTimer` work logs (including
  no-switch completions), `stopWorkTimer` logs, and finalize logs. It is null on
  break logs and `skipBreak` logs. `appendLog` gains a trailing
  `workWindowId: string | null = null`. `isLog` accepts optional string/null;
  there is no staging bump beyond v10. One new SQL migration adds nullable
  `work_window_id text` to `public.pomodoro_logs`, with no backfill and no index,
  and uses CREATE OR REPLACE for exactly the three live insert bodies:
  `public.persist_transition` and `public.complete_timer` from
  `20260802010000_staged_sync_rpc.sql`, and
  `public.apply_staged_sync_without_todos` from
  `20260805000000_habit_completion_tombstone_guard.sql`. Read
  `nullif(v_log ->> 'work_window_id', '')`. SupabaseDataAccess `validateLog`
  carries the field; the `e2e/helpers.ts` log mapping must tolerate it.
  Evidence: research A23–A25.

- **T12 — Ranking (#177).** New pure module `src/lib/whatsNext.ts` exports
  `PromotionTier`, `RankedCandidate`, `WhatsNextResult`, and `rankWhatsNext(input)`
  exactly as in [issue #177](../issues/issue-177.md), plus `PRIORITY_RANK`
  (High 0, Medium 1, Low 2, missing 3). `currentOccupantId` is a PM task id.
  Exclude Done, Blocked, `isArchived`, `waitingOf(task) !== null`, the current
  occupant, and tasks whose project is not workable, using
  `isProjectWorkableOnDate` from `src/lib/projectSchedule.ts`. Effective estimate
  is PM `estimatePomos` if numeric, else backend `target_pomodoros`, else 0.
  Estimate ≤ 0 means the un-estimated tail; estimated tasks use the existing
  collector floor: `remaining = estimate - worked > EPSILON ? estimate - worked
  : 1` (a fractional remainder is kept; only a non-positive remainder becomes
  1). Reuse `parseDueDateKey` and
  `classifyDueScope` from `src/lib/timer.ts`. Do not modify
  `collectEligibleProjectionTasks`. Evidence: research A18, A19, B5, B8.
  Corrected by ORCH after #177 merge to match the existing collector floor.

- **T13 — Waiting presentation (#176).** Agent pill:
  `text-violet-300 bg-violet-400/15`; person pill:
  `text-amber-300 bg-amber-500/10`. No `dark:` classes. The dot has `role="img"`,
  `aria-label="Waiting on agent"` or `"Waiting on person"`, and a `title`.
  Today pins waiting first, then bucket → due → title; `remainingPomodoros` is
  unchanged. Clear `todayDetailsTaskId` when its task becomes Done, archived,
  or absent. Evidence: research A16, A17.

- **T14 — Linker observability (#178).** PM context exposes
  `linkingTaskIds: ReadonlySet<string>`,
  `linkFailures: Readonly<Record<string, string>>`, and
  `retryLink(pmTaskId: string): void`, driven by StateSyncBridge. Do not
  reimplement create/link. Evidence: research A20.

## 3. Lane plan and merge order

- **F0 foundation (this lane):** merge first.
- **Lane 1:** #173 (IMPL+) then #179 (IMPL+), sequential.
- **Lane 2:** #174 (IMPL+) then #175 (IMPL), sequential; parallel with lane 1.
- **Lane 3:** #177 (IMPL), parallel with lanes 1–2.
- **#176:** after #173 and #175 are merged.
- **#178:** last, after #173–#177.

File ownership:

| Owner | Files and scoped edits |
| --- | --- |
| Lane 1 | `src/lib/engine/**`, `src/lib/data/**` (except nothing else), `src/lib/timer.ts`, `src/state/AppStateContext.tsx`, `src/state/TodoContext.tsx`, the TodaySurface start guard, the TimerPanel label/ring, `supabase/migrations/<new>` |
| Lane 2 | `src/lib/pm/**`, `src/state/ProjectManagerContext.tsx`, `src/state/StateSyncBridge.tsx`, `src/components/ProjectManager/TaskInspector.tsx` |
| Lane 3 | `src/lib/whatsNext.ts` and its test |
| F0 | `src/state/types.ts`, frozen by this foundation lane |

Evidence: research Lane plan (Q26) and its contention inventory. The binding
merge order and frozen F0 type ownership above govern implementation lanes.

## 4. Gates

- **Lane (child, before commit):** `pnpm lint:app` → narrow Vitest for touched
  files → `pnpm test:unit` → `pnpm build`.
- **Merge (ORCH, epic worktree):** `pnpm lint:app` → `pnpm test:unit` →
  `pnpm build`.
- **Phase (ORCH):** after #179 and #178, local Supabase plus
  `pnpm test:integration` and `pnpm test:e2e`. Final: `pnpm test:all`,
  `pnpm test:pwa`, `pnpm test:platform`, and `pnpm tauri build`.
- **Release note to carry:** users with a saved partial-pomodoro resume
  position lose only that resume position on upgrade; credit already in
  `completed_pomodoros` is untouched. Evidence: research A5, A6.

F0's required gate is `pnpm lint:app` → `pnpm test:unit` → `pnpm build`, in
that order, with output tails reported. F0 changes only the verbatim research
copy, this contract, and the additive optional shared types. F0 does not run
Supabase commands, DB resets, a dev server, E2E, integration, platform, Tauri,
version scripts, or installs.


## 5. Post-review corrections (ORCH-authorized)

These corrections supersede the corresponding statements above.

- **D3 correction:** the progress ring stays window-relative:
  `1 - remaining / max(work_minutes*60, planned_secs)`. The Today/projection
  active fraction and the active task's per-task "completed" display instead
  use the segment fraction `elapsedTimerSecs(timer, now) / (work_minutes*60)`,
  clamped to 0..1. The outgoing task is already credited at a switch. An
  unswitched window has the same numerical progress as before. This preserves
  the product decision: a switch neither resets the ring nor changes Today
  "Np left" (A and B estimated at 1p each: 1.6p before/after switching at 10m).
- **D7 (product owner decision):** the Today pomodoro summary counts WINDOWS.
  Group today's non-break logs by `work_window_id`; each null/absent-id log
  counts as its own pomodoro so history is unchanged. Minutes still sum all
  today's non-break logs, and session details retain each segment.
- **T9 refinement:** `workOccupantKey` uses `windowStartedAt(timer)` (the derived
  fallback), rather than `window_started_at ?? ""`. Work pause/resume stamp
  `window_started_at = windowStartedAt(timer)` before changing accumulation or
  timestamps when absent, so legacy identity does not change mid-window.
  For a legacy timer resumed before upgrade, this derived value is an opaque
  identity, not necessarily its true window start; this limitation is accepted.
  Baselines are not backfilled: restoring an unchanged legacy baseline still
  derives the same key as its backfilled counterpart.
- **Journal key:** completion-journal generation keys ignore
  `window_started_at`, so pre/post-v10 shapes of the same timer dedupe.
  `expectedTimer` is never rewritten; the RPC CAS keeps the stored shape.
  Existing persisted keys are compared through their normalized expected timer
  as well, preserving replay protection for keys written before this fix.
- **Engine-internal completion:** expired switch/finalize transitions journal
  the natural-completion snapshot atomically with local accounting, using the
  explicit completion path's CAS payload and mask semantics. The subsequent
  selection/finalize edits remain local changes for ordinary push after replay.

### Review fix log

| Finding | Resolution |
| --- | --- |
| R1-#1 | Fixed: segment fraction for task progress/projections; window ring retained. |
| R1-#2 | Fixed: shape-stable generation keys and migrated pending-completion regression. |
| R1-#3 | Fixed: engine-internal completions enter the completion journal and local guard. |
| R1-#4 | Fixed: finish sound/notification deduped by Work-window identity. |
| R1-#5 | Fixed: serialized work starts, post-await occupation check, pending Inspector Start guard. |
| R1-#6 | Fixed: derived occupant keys and legacy identity stamped before pause/resume; documented: pre-upgrade resumed identity may be opaque. |
| R1-#7 | Fixed: ranking eligibility uses normalized `waitingOf`. |
| R1-#8 | Fixed: Today comparator ends with an id tie-break. |
| R1-#9 | Fixed in issue/159-d7-window-count: Today pomodoro count is derived from work windows (D7); `today.workWindow.test.ts` row-count assertion updated. |
| R1-#10 | Fixed: Inspector break preflight reaches the existing AppState error path before create/link. |
| R2-#1 | Fixed: evict a cached linker id if the current staged app state no longer contains it. |
| R2-#2 | Fixed: refresh open-sheet candidates with its open-time date and revalidate pending/awaited selections. |
| R2-#3 | Fixed: catch row-activation rejection while preserving the AppState banner. |

Nothing is deferred; all review items are fixed.
