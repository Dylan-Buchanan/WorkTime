# Title: Add optional descriptions to to-do items

## Tags

Complexity Classification: T3
Classification Reason: Additive feature that still crosses the domain type, the to-do state layer, the To-dos page UI, the sync merge field list, the local staging validator, and the Supabase schema plus the staged-sync RPC chain. The shape of the work matches the existing `estimate` / `current_task_id` precedent, but several field lists are easy to miss and the RPC body now lives deep in the renamed helper chain.

Severity: Medium
Severity Reason: No destructive or security impact — the column is additive and existing rows are unaffected. However, a missed field list or a broken RPC rewrite silently drops or fails to persist user notes across devices, and the touched paths are shared by every to-do user.

Needs research before implementation: Yes

### Research Needed

The to-do record is validated and merged through several independent field lists, and the sync RPC body has been renamed/rewrapped several times. Confirm all of the following before editing.

- The current staged-sync function chain and which function still owns the `insert into public.todos` body (see `supabase/migrations/20260811000000_todos.sql`, `20260811010000_todo_pomodoro_links.sql`, `20260811020000_todo_completions.sql`, `20260812050000_use_invoker_rpc_boundaries.sql`, `20260920010000_pet_staged_sync_rpc.sql`, `20261031000000_goal_staged_sync_rpc.sql`).
- Whether `description` is required or optional on the `Todo` type, since that determines churn across every to-do fixture.
- The canonical empty representation (`null` vs `""` vs omitted) so save-diffing and push planning do not produce perpetual churn.
- Whether legacy rows missing the column should be tolerated by `validateTodo` and `isTodo`.
- Whether a maximum length or truncation rule is needed.

## Summary

To-do items currently support only a short title. There is nowhere to record why a to-do exists, what "done" means, or any context needed by future-you. Add an optional free-form description to each to-do that is editable in the create/edit form, shown on the to-do card, and persisted through the normal local-staging and Supabase sync paths.

## Steps to Reproduce Context

1. Open the app and navigate to the To-dos page (`src/components/TodosPage.tsx`).
2. Click **Add to-do**.
3. Observe the form fields: Title, Estimate (pomodoros), and Schedule only. There is no field for notes or elaboration.
4. Create the to-do and observe the card: it renders the title plus a due-date/schedule/estimate line, with no place for notes.

## Requirements for completed issue

1. A `Todo` carries an optional description and `NewTodoInput` accepts it; both are exported from `src/lib/todos/index.ts` as before.
2. The create/edit form on the To-dos page has an optional multi-line description field, and creating or editing a to-do persists the entered description.
3. The description is cleared when the field is emptied, without leaving a stale value on the to-do.
4. The to-do card shows the description when present and renders cleanly when absent (no empty gap or stray separator). Archived to-dos keep showing their description.
5. The description survives a reload: it is normalized on hydrate (`normalizeTodo`), accepted by the staging validator (`isTodo`), and included in the sync field list (`TODO_FIELDS`).
6. The description round-trips through Supabase: a new forward-only migration adds the column and updates the staged-sync upsert body, and `todoRow` / `validateTodo` map it both directions.
7. Existing to-dos created before this change still load and save without errors and read as having no description.
8. No change to pomodoro task creation or to other surfaces (Today menu, task panel) — the description stays on the To-dos page.

## Expected Behavior

- The to-do form offers an optional multiline description beneath the title.
- Saving the form stores the description with the to-do, and reopening the form shows the stored text.
- The to-do card renders the description as secondary text under the title when one exists.
- The description persists across a page reload and appears on a second device after sync.
- An empty or whitespace-only description is stored as empty and simply not rendered.

## Actual Behavior

- The to-do form has only title, estimate, and schedule fields.
- The to-do card renders title and metadata only.
- `Todo` has no description property, and the `public.todos` table has no matching column, so no note text can be stored.

### Testing

1. `pnpm test:unit` — extend `src/state/TodoContext.test.tsx` to cover creating a to-do with a description, editing it, and clearing it.
2. `pnpm test:unit` — extend `src/components/TodosPage.test.tsx` to cover entering a description in the form, showing it on the card, and hiding it when blank.
3. `pnpm test:unit` — extend `src/lib/data/SupabaseDataAccess.test.ts` (the `maps to-do rows and tombstones to the extended RPC` case, around lines 246-271) to assert the row includes the new column; extend `src/lib/data/sync/merge.test.ts` and `src/lib/data/staging/LocalStagingStore.test.ts` fixtures for the new field.
4. `pnpm test:unit` — verify `normalizeTodo` and `isTodo` accept a legacy to-do object with no description.
5. `pnpm test:integration` — add a to-do description round-trip to `integration/localFirstSync.integration.test.ts` (its `todo()` helper at line ~110 builds the fixtures) confirming a pushed description is pulled back, and confirm `integration/rpcPrivileges.integration.test.ts` still passes.
6. `pnpm run build` — confirm no type errors.

## Issue Context

### New Files

`supabase/migrations/<timestamp>_todo_descriptions.sql` — forward-only migration that adds the column and replaces the staged-sync function body that performs the to-do upsert. Follow the precedent in `supabase/migrations/20260811010000_todo_pomodoro_links.sql`:

```sql
alter table public.todos
    add column description text not null default '';

comment on column public.todos.description is
    'Optional free-form notes attached to the to-do';
```

Then `create or replace` the function that currently owns the insert. Verified by grep, `insert into public.todos` only appears in `20260811000000_todos.sql` and `20260811010000_todo_pomodoro_links.sql`; the 18-argument body was renamed to `public.apply_staged_sync_without_todo_completions` by `20260811020000_todo_completions.sql` and has not been redefined since. Confirm this before rewriting, then update:

- the insert column list, the values list, and the `do update set` list (currently `title, rule, due_date, estimate, current_task_id, position, is_archived, created_at, updated_at`);
- the trailing `revoke` / `grant` / `comment` statements so the signature and privileges still match.

### Remove Files

None.

### Change Files

#### To-do domain type

Code Source: `src/lib/todos/types.ts`
Code Description: The persisted to-do shape and the create input.
Code Change Description: Add an optional description to `Todo` and to `NewTodoInput`. Note the existing comment style documenting per-field meaning.
Files Using: `src/state/TodoContext.tsx`, `src/components/TodosPage.tsx`, `src/lib/data/**`, `src/lib/todos/index.ts`

```ts
export interface Todo {
    id: string;
    title: string;
    rule: TodoRule | null;
    dueDate: LocalDateKey | null;
    /** Planned work for each occurrence, in pomodoros. */
    estimate: number;
    /** Pomodoro task for the currently pending occurrence, if one exists. */
    currentTaskId: string | null;
    position: number;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface NewTodoInput {
    title: string;
    rule?: TodoRule | null;
    dueDate?: LocalDateKey | null;
    position?: number;
    estimate?: number;
}
```

#### To-do state provider

Code Source: `src/state/TodoContext.tsx`
Code Description: `normalizeTodo` rebuilds each to-do field-by-field from persisted data, so any field not handled here is dropped on hydrate. `createTodo` builds the record from `NewTodoInput`.
Code Change Description: Normalize the description with a safe default in `normalizeTodo` (around lines 47-64) and copy it in `createTodo` (around lines 175-187). Editing already flows through `updateTodo(id, patch: Partial<Todo>)`, so no change is needed there.
Files Using: `src/components/TodosPage.tsx`

```ts
return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "Untitled to-do",
    rule,
    dueDate: /* ... */,
    estimate: normalizeTodoEstimate(value.estimate),
    currentTaskId: /* ... */,
    position: /* ... */,
    isArchived: Boolean(value.isArchived),
    createdAt,
    updatedAt: /* ... */,
};
```

#### To-dos page

Code Source: `src/components/TodosPage.tsx`
Code Description: `TodoDraft` holds the editable form fields; `blankDraft` seeds them, `draftFromTodo` hydrates them from an existing to-do, `submitForm` writes them, `TodoForm` renders them, and `TodoCard` displays them.
Code Change Description: Add `description` to `TodoDraft`, `blankDraft()`, `draftFromTodo()`, the `createTodo` / `updateTodo` calls in `submitForm()`, a labeled textarea in `TodoForm` (next to the `#todo-title` input), and secondary text in `TodoCard` (beneath the `<h3>` title, above/below the metadata line at line ~370).
Files Using: `src/components/TodosPage.test.tsx`

```ts
type TodoDraft = {
    title: string;
    estimate: number;
    schedule: ScheduleType;
    date: string;
    weekdays: number[];
    monthlyDays: number[];
    monthlyLastDayOffset: number | null;
    yearlyDates: YearlyDate[];
};

function blankDraft(): TodoDraft {
    return { title: "", estimate: 1, schedule: "none", date: "", weekdays: [], monthlyDays: [], monthlyLastDayOffset: null, yearlyDates: [{ month: 1, day: 1 }] };
}
```

```ts
// submitForm()
updateTodo(editingId, { title, estimate: draft.estimate, rule, dueDate: recomputedDueDate });
// ...
else createTodo({ title, estimate: draft.estimate, rule, dueDate });
```

#### Supabase row mapping and validation

Code Source: `src/lib/data/SupabaseDataAccess.ts`
Code Description: `todoRow` maps the camelCase `Todo` to the snake_case RPC payload; `validateTodo` strictly validates a pulled row and throws `invalid to-do row` on unexpected shapes; the remote snapshot is built around lines 474-477.
Code Change Description: Add the description to both directions. Keep the strict check permissive for legacy rows missing the column.
Files Using: `src/lib/data/SupabaseDataAccess.test.ts` (asserts the exact payload around lines 246-271)

```ts
function todoRow(todo: Todo, updatedAt?: string) {
    return {
        id: todo.id,
        title: todo.title,
        rule: todo.rule,
        due_date: todo.dueDate,
        estimate: todo.estimate,
        current_task_id: todo.currentTaskId,
        position: todo.position,
        is_archived: todo.isArchived,
        created_at: todo.createdAt,
        updated_at: updatedAt ?? todo.updatedAt,
    };
}
```

#### Sync field-level merge

Code Source: `src/lib/data/sync/merge.ts`
Code Description: `TODO_FIELDS` lists every field that participates in field-level last-writer-wins merging in `mergeTodoRow` (lines 499-528). A field omitted here silently loses remote changes.
Code Change Description: Add `"description"` to `TODO_FIELDS` (lines 85-94).
Files Using: `src/lib/data/sync/merge.test.ts`

```ts
const TODO_FIELDS: ReadonlyArray<keyof Todo> = [
    "title",
    "rule",
    "dueDate",
    "estimate",
    "currentTaskId",
    "position",
    "isArchived",
    "createdAt",
];
```

#### Local staging validator

Code Source: `src/lib/data/staging/types.ts`
Code Description: `isTodo` type-guards to-do objects read back from the `worktime:staging:v1:*` localStorage store; an unrecognized shape invalidates the stored record.
Code Change Description: Accept the optional description (lines 321-335), tolerating its absence so existing local data still validates.
Files Using: `src/lib/data/staging/LocalStagingStore.test.ts`

#### Data access layers with no per-field code

Code Source: `src/lib/data/InMemoryDataAccess.ts` (`saveTodos`/`loadTodos`, lines ~336-345) and `src/lib/data/StagedDataAccess.ts` (lines ~518-556)
Code Description: Both store whole `Todo` objects and deep-clone them, so they need no field-specific edit — but their fixtures and assertions should be checked.

## Notes

- Tests live at `src/lib/todos/todos.test.ts`, `src/state/TodoContext.test.tsx`, and `src/components/TodosPage.test.tsx`; there is currently no Playwright to-do spec in `e2e/`.
- Keep this scoped to the To-dos page: `startPomodoro` intentionally calls `app.createTask(todo.title, todo.estimate)` and should keep using the title only.
- The `todos_touch_updated_at` trigger already advances `updated_at` on update, so the new column needs no extra timestamp handling.
