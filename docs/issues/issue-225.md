# Title: Show a dismissible banner for aging to-dos that have no due date on the timer page

## Tags

Complexity Classification: T2
Classification Reason: The behavior is fully specified (eligibility, creation-anchored cadence, combined banner content, per-to-do browser-local dismissal, page-load-only evaluation, top-of-page placement in both modes), but the work spans several areas: new pure eligibility/cadence logic in the to-dos lib, a new versioned local-only dismissal store mirroring `src/lib/resume/resumeNoteStore.ts`, a new banner component, wiring into `src/components/TimerPanel.tsx`, tests, and likely an `AGENTS.md` surface-local storage exception entry. No schema or sync change, and existing `buildTodayTodos`/`TodaySurface` behavior stays untouched.

Severity: Medium
Severity Reason: Nothing is broken and no data is at risk, but the gap affects the primary page: undated to-dos are currently invisible for their entire lifetime, so the banner changes what the main screen surfaces while adding one new local persistence key.

Needs research before implementation: Yes

### Research Needed

The behavior is agreed, but a few implementation-adjacent details are undecided and should be settled before coding.

- Decide where the per-to-do dismissal timestamps live: a new versioned surface-local key (following `src/lib/resume/resumeNoteStore.ts`) or the existing UI-only `pm_state_v1` state in `src/state/ProjectManagerContext.tsx`. Adding a new key requires updating the documented exception list in `AGENTS.md`.
- Define precisely what "evaluated on page load" means for the component (initial mount only, versus re-evaluation when the timer page remounts after navigating away and back) and which injectable "now" source tests should use.
- Verify whole-day arithmetic from the ISO `Todo.createdAt` timestamp to the current local date using `src/lib/todos/calendar.ts` helpers, so day 7/10/13/16 boundaries do not drift with UTC offsets.
- Confirm completion detection for undated to-dos via `todoCompletionBucket` (`created:${todo.createdAt}`) in `src/lib/todos/integration.ts`, and that archived is the only additional exclusion.
- Enumerate pruning/cleanup of stale dismissal entries when a to-do is deleted, completed, archived, or gains a due date.
- Identify the exact insertion point above the Timer / Quick add toggle in `src/components/TimerPanel.tsx` without disturbing the `my-auto` centered column layout.

## Summary

To-dos that have no due date never surface anywhere in the day-to-day flow: `buildTodayTodos` in `src/lib/today.ts` only lists to-dos whose `dueDate` falls in the overdue / today / this-week scope, so a to-do with `dueDate: null` is invisible on the Today card forever. This issue adds a dismissible, informational banner at the top of the timer page (`/`, rendered by `TimerPanel`) that reports incomplete no-due-date to-dos once seven whole days have passed since they were created, and re-raises itself on a fixed three-day cadence afterwards.

## Steps to Reproduce Context

1. Open the Todos page and create a to-do with schedule "No due date".
2. Complete no work on it and leave it open for seven days.
3. Open the timer page (`/`). Nothing indicates that the to-do exists or is going stale; the Today card's "To-dos" group stays empty because the to-do has no due date.

## Requirements for completed issue

1. A to-do is eligible for the banner only when it has no due date (`todo.dueDate` is `null`), is not archived (`todo.isArchived` is `false`), and has no completion for its current occurrence.
2. Eligibility uses a whole-day age measured from `todo.createdAt` to the current local date. A to-do becomes eligible on day 7 after creation (day 0 being the creation date), not before.
3. The banner is shown at the top of the timer page, above the timer ring, in both the "Timer" and "Quick add" page modes.
4. When more than one to-do qualifies, a single combined banner is shown (not one banner per to-do). It states how many to-dos qualify and includes a few of their titles.
5. The banner is informational only. Its only interaction is dismissal — no links, no "open to-do", no editing, no due-date assignment.
6. Dismissal is remembered per to-do in the current browser profile only: it survives reloads and app restarts, and is not sent to Supabase or shared with other devices/owners' synced data.
7. After dismissal the same to-do re-raises the banner on the fixed cadence anchored to its creation date: day 7, 10, 13, 16, and so on. Reappearance does not depend on the date the dismissal happened (a dismissal on day 8 still returns the banner on day 10).
8. Dismissal suppresses the banner on every day between cadence days; a to-do dismissed on day 7 is silent on days 8 and 9.
9. A to-do that gains a due date, is completed (either its current occurrence completed or archived), or is deleted stops qualifying immediately and needs no dismissal.
10. Eligibility is evaluated only on page load. A page that was already open across a day boundary does not start showing the banner; the next reload does.
11. Stored dismissal data for to-dos that are no longer relevant (deleted, completed, archived, or now dated) is harmless and must not cause the banner to appear for the wrong to-do; ids are matched exactly.
12. The dismissal state remains surface-local and must not be added to the synced staging store, Supabase tables, or `Settings`.

## Expected Behavior

- A to-do created with no due date stays completely silent for its first six days.
- From day 7 onwards, loading the timer page shows one banner at the top summarizing every qualifying to-do, with a dismiss control.
- Dismissing the banner hides it immediately and for the rest of that day and the following days until the next cadence day.
- On day 10, 13, 16, ... loading the timer page shows the banner again.
- Assigning a due date to the to-do, or completing/archiving it, removes it from the banner without any dismissal.

## Actual Behavior

- No banner exists. `TodaySurface` only renders to-dos that have a due date inside the current scope, so an undated, aging to-do is never surfaced.
- There is no per-to-do, browser-local dismissal concept for anything on the timer page other than the resume card (`src/lib/resume/resumeNoteStore.ts`).

### Testing

1. Pure unit tests covering the eligibility and cadence rule with an injected reference date and injected storage: day 6 → not eligible, day 7 → eligible, after a dismissal recorded on day 7 → ineligible on days 8 and 9, eligible again on day 10, 13, 16; dismissal recorded on day 8 → reappears on day 10.
2. Unit tests for the suppression rules: to-do with a due date, completed occurrence, archived to-do, and deleted to-do never qualify; only the current occurrence's completion is considered, using the `created:${todo.createdAt}` completion bucket for undated to-dos (`todoCompletionBucket` in `src/lib/todos/integration.ts`).
3. Component tests in `src/components/TimerPanel.test.tsx` (or a dedicated component test) confirming the banner renders at the top of the timer page in both page modes, shows a single combined banner for several to-dos, and disappears after clicking dismiss.
4. Component tests confirming the banner does not render in the first six days, does not render when the only undated to-do is archived/completed/dated, and does not render for to-dos that are not undated.
5. A reload/persistence test proving dismissal survives a remount (re-render with the same storage) and that corrupt or unexpected stored values are tolerated without throwing.
6. `pnpm test:unit` passes, plus `pnpm run build` after the change.

## Issue Context

### New Files

Likely a new pure module plus its unit test, following the existing surface-local store pattern, e.g. `src/lib/todos/bannerEligibility.ts` (or `src/lib/todoBanner/…`) — the exact name and layout are up to the implementer. It needs to expose at minimum:

- an eligibility/cadence decision that takes the to-do list, a reference date, and dismissal state, and returns the qualifying to-dos;
- a dismissal record/read operation keyed by to-do id with an injectable storage object, in the same shape as `ResumeNoteStorage` in `src/lib/resume/resumeNoteStore.ts`.

### Remove Files

None.

### Change Files

#### Eligibility and cadence computation

Code Source: `src/lib/today.ts` (`buildTodayTodos`, `getTodayDueScope`)

Code Description: `getTodayDueScope` returns `null` when `parseDueDateKey` yields no key, which is why undated to-dos never reach the Today card. `buildTodayTodos` skips to-dos with `isArchived` first.

Code Change Description: No change to `buildTodayTodos` is expected — the banner is a separate, undated-only concern. If the computed banner list is threaded through the Today overview, keep `buildTodayOverview`'s existing to-do behaviour intact and add the banner result as a new field.

```ts
export function getTodayDueScope(
    dueDate: string | null | undefined,
    project: Partial<ProjectSchedule> | undefined,
    reference: Date,
): TodayTaskBucket | null {
    const dueKey = parseDueDateKey(dueDate);
    if (!dueKey) return null;
    // ...
}
```

Files Using: `src/components/TodaySurface.tsx`, `src/lib/today.test.ts`.

#### To-do entity and completion identity

Code Source: `src/lib/todos/types.ts`, `src/lib/todos/integration.ts`

Code Description: `Todo.dueDate` is `LocalDateKey | null`; `todo.createdAt` is an ISO timestamp; `todoCompletionBucket(todo)` returns `todo.dueDate ?? \`created:${todo.createdAt}\`` so an undated to-do's completion identity is creation-derived. `completeTodoOccurrence` archives one-off to-dos on completion.

Code Change Description: No change to the entity. Read `dueDate`, `isArchived`, `createdAt`, and `state.completions` to decide eligibility.

```ts
export function todoCompletionBucket(todo: Todo): string {
    return todo.dueDate ?? `created:${todo.createdAt}`;
}
```

Files Using: `src/state/TodoContext.tsx`, `src/components/TodaySurface.tsx`, `src/components/TodosPage.tsx`.

#### Local date helpers

Code Source: `src/lib/todos/calendar.ts`

Code Description: `localDateKey(date)` yields a local date key; `localDateFromKey`, `addLocalDays`, and `compareLocalDates` support whole-day arithmetic without UTC drift. `toLocalDateKey` in `src/lib/timer` is the equivalent used by `today.ts`.

Code Change Description: Reuse these for the whole-day age calculation (local date of `createdAt` → local date of `reference`) and for the cadence day computation.

```ts
export function localDateKey(date: Date): string
export function localDateFromKey(key: string): Date
export function addLocalDays(date: Date, days: number): Date
```

Files Using: `src/lib/todos/**`, `src/components/TodosPage.tsx`, `src/lib/habits/**`.

#### Timer page placement

Code Source: `src/components/TimerPanel.tsx`

Code Description: The page is a centered `max-w-md w-full` column. The page-mode toggle ("Timer" / "Quick add") sits at the top of that column, followed by the timer ring, task badges, action buttons, `ProjectionSwitcher`, and `<TodaySurface onSelectTask={selectTaskFromToday} />`.

Code Change Description: Render the banner at the top of this column so it appears in both page modes, above the mode toggle/ring. It must be dismiss-only and must not intercept the existing timer or quick-add interactions.

```tsx
<div className="my-auto min-w-0 flex flex-col items-center gap-6 max-w-md w-full">
    <div className="flex w-full items-center justify-between gap-3">
        {/* page-mode toggle: Timer | Quick add */}
    </div>
    {/* banner belongs at the top of this column */}
    {timerPageMode === "timer" ? (
        <>
            <div className="flex flex-col items-center gap-3">
                {/* timer ring */}
```

Files Using: `src/App.tsx` (route `/`), `src/components/TimerPanel.test.tsx`.

#### To-do state access

Code Source: `src/state/TodoContext.tsx`

Code Description: `useOptionalTodos()` exposes `state.todos` and `state.completions`; `TodoProvider` is mounted by the timer page test harness. Existing `TodoCompletion` rows are keyed by `todoId` + `bucket`.

Code Change Description: Read to-dos and completions from this context for the banner. Do not add a new synced field to `Todo`.

```ts
export interface TodoState {
    todos: Record<string, Todo>;
    completions: Record<string, TodoCompletion>;
    ui: { selected: string | null };
    meta: { initializedAt: string };
}
```

Files Using: `src/components/TodaySurface.tsx`, `src/components/TodosPage.tsx`, `src/components/TimerPanel.test.tsx`.

#### Browser-local dismissal storage

Code Source: `src/lib/resume/resumeNoteStore.ts`

Code Description: Reference implementation for a surface-local, unsynced, per-entity store: exported `*_STORAGE_KEY`, versioned state object, injectable storage type, defensive parsing that returns an empty state on any malformed value, and per-entry timestamps (`savedAt` / `dismissedAt`).

Code Change Description: Follow this pattern for the banner dismissal record. `AGENTS.md` lists the only permitted surface-local localStorage keys, so a new key must be added to that documented exception list (for example alongside `worktime:resume:v1`), must not be synced, and must not be written into the staging store (`src/lib/data/staging/LocalStagingStore.ts`) or the GoTrue auth key.

```ts
export const RESUME_NOTE_STORAGE_KEY = "worktime:resume:v1";
export type ResumeNoteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
```

Files Using: `src/state/ResumeMemoContext.tsx`, `src/components/ResumeCard.tsx`.

## Notes

- "Todo" in this issue means the app's own `Todo` entity (`src/lib/todos/types.ts`), not `PMTask` and not the backend timer `Task`.
- The timer route `/` is labeled "Timer" in `TopNav`; the "Today page" in the request is that route, and the existing "Today" `TodaySurface` card is a section within it.
- Whole-day cadence summary: creation date is day 0; the banner first appears on day 7; after a dismissal it appears again on day 10, 13, 16, … (`day = 7 + 3n`) with no drift from the dismissal date.
- Because eligibility is only evaluated on page load, a session left open across midnight will not update until the next load. This is intended.
