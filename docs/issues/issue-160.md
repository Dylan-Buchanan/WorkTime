# Title: Resume notes: exit memos and a resume card (epic)

## Idea

Prompt me for a short resume note when a pomodoro is paused, when I End focus, and when I switch tasks. The note records:

- Where I am
- Next action
- Open question or blocker (optional)

One current note per task, replaced by the next note. When I return to that task, the note is shown near the timer so restarting needs no reconstruction from memory.

## Motivation

Reduce friction when starting work again after a break or interruption instead of re-deriving context. The same note is later quoted in the End-of-Day brief so the summary can state the actual next action instead of inferring it from statuses and estimates.

## Resolved questions

- **Which task a note is saved against on a switch?** The outgoing task. The switch frame also shows the incoming task's existing note (or a "starting fresh" line), so the memo reads as a record of the past.
- **Saved at pause time or at the following transition?** At the transition. The timer command commits first, then the capture form opens, so abandoning the form never leaves the timer in a wrong state.
- **Is capture guaranteed?** No. It is strongly encouraged but dismissible; the resume card's empty state covers a missed memo.
- **Where does the data live?** A surface-local, unsynced localStorage key, `worktime:resume:v1`, in the same scoped-exception family as `worktime:agent:projectSnapshot:v1` and `worktime:agent:startOfDayPlan:v1`. No staging schema revision, no Supabase migration, no merge work.

## Breakdown

Five issues, ordered so each is independently shippable and testable. #182 and #183 both depend on #180 and #181; #184 depends only on #180.

- [ ] #180 — Resume-note store and schema (foundation, no consumers)
- [ ] #181 — Leave and enter event plumbing (publishes the intent to leave/enter a task; no UI)
- [ ] #182 — Exit memo capture form (depends on #180, #181)
- [ ] #183 — Resume card with empty state (depends on #180, #181)
- [ ] #184 — Quote exit memos in the end-of-day brief (depends on #180)

### Dependency notes

- The event payload defined in #181 is the contract for #182 and #183 and must be frozen before either starts.
- #180 must expose save/upsert, get, dismiss and clear; a save-only API cannot support the resume card's dismissal.
- "Task is gone" is defined once: `completed_at`, `archived`, or an archived/absent linked PM task via `findPMTaskByAppTaskId`.
