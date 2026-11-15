import { describe, expect, it } from "vitest";
import {
    AGING_TODO_FIRST_DAY,
    isAgingTodoDueAtAge,
    nextAgingTodoCadenceDay,
    selectAgingUndatedTodos,
    summarizeAgingTodos,
    todoAgeDays,
    todoCompletionBucket,
    type AgingTodoDismissals,
    type Todo,
    type TodoCompletion,
} from "./index";

const CREATED_AT = "2026-03-01T12:00:00.000Z";
const DAY_MS = 86_400_000;

function ageDate(days: number): Date {
    return new Date(Date.parse(CREATED_AT) + days * DAY_MS);
}

function dismissalAtAge(days: number): AgingTodoDismissals {
    return { "todo-1": { dismissedAt: ageDate(days).toISOString() } };
}

function makeTodo(overrides: Partial<Todo> & Pick<Todo, "id">): Todo {
    return {
        title: "Aging item",
        rule: null,
        dueDate: null,
        estimate: 1,
        currentTaskId: null,
        position: 0,
        isArchived: false,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        ...overrides,
    };
}

function completionFor(todo: Todo, bucket = todoCompletionBucket(todo)): TodoCompletion {
    return {
        id: `completion-${todo.id}-${bucket}`,
        todoId: todo.id,
        bucket,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
    };
}

function ids(todos: Todo[]): string[] {
    return todos.map((todo) => todo.id);
}

function select(
    todos: Todo[],
    options: { reference?: Date; dismissals?: AgingTodoDismissals; completions?: TodoCompletion[] } = {},
): Todo[] {
    return selectAgingUndatedTodos(
        Object.fromEntries(todos.map((todo) => [todo.id, todo])),
        Object.fromEntries((options.completions ?? []).map((completion) => [completion.id, completion])),
        options.dismissals ?? {},
        options.reference ?? ageDate(AGING_TODO_FIRST_DAY),
    );
}

describe("aging undated to-do eligibility", () => {
    it("stays silent through day 6 and becomes eligible on day 7", () => {
        const todo = makeTodo({ id: "todo-1" });
        expect(select([todo], { reference: ageDate(0) })).toEqual([]);
        expect(select([todo], { reference: ageDate(6) })).toEqual([]);
        expect(ids(select([todo], { reference: ageDate(7) }))).toEqual(["todo-1"]);
        expect(ids(select([todo], { reference: ageDate(8) }))).toEqual(["todo-1"]);
    });

    it("measures age in whole local calendar days and ignores the time of day", () => {
        const created = new Date(2026, 3, 10, 23, 30, 0);
        const createdIso = created.toISOString();
        expect(todoAgeDays(createdIso, new Date(2026, 3, 10, 23, 59, 0))).toBe(0);
        expect(todoAgeDays(createdIso, new Date(2026, 3, 11, 0, 5, 0))).toBe(1);
        expect(todoAgeDays(createdIso, new Date(2026, 3, 17, 12, 0, 0))).toBe(7);
    });

    it("never qualifies a future creation date or an unparseable timestamp", () => {
        expect(select([makeTodo({ id: "wide-1" })], { reference: ageDate(-1) })).toEqual([]);
        expect(todoAgeDays("garbage", ageDate(7))).toBeNull();
        expect(todoAgeDays("", ageDate(7))).toBeNull();
        expect(select([makeTodo({ id: "wide-1", createdAt: "garbage" })])).toEqual([]);
        expect(select([makeTodo({ id: "wide-1", createdAt: "" })])).toEqual([]);
    });

    it("excludes dated and archived to-dos", () => {
        const todos = [
            makeTodo({ id: "undated" }),
            makeTodo({ id: "dated", dueDate: "2026-03-02" }),
            makeTodo({ id: "archived", isArchived: true }),
            makeTodo({ id: "empty-due", dueDate: "" as Todo["dueDate"] }),
        ];
        expect(ids(select(todos))).toEqual(["empty-due", "undated"]);
    });

    it("excludes a to-do whose current occurrence is completed", () => {
        const todo = makeTodo({ id: "todo-1" });
        expect(select([todo], { completions: [completionFor(todo)] })).toEqual([]);
        // A different bucket belongs to another occurrence and must not suppress the banner.
        expect(ids(select([todo], { completions: [completionFor(todo, "2026-03-02")] }))).toEqual(["todo-1"]);
        // A completion for a different to-do must not leak across ids.
        const other = makeTodo({ id: "todo-2" });
        expect(ids(select([todo, other], { completions: [completionFor(other)] }))).toEqual(["todo-1"]);
    });

    it("stops qualifying as soon as the to-do is deleted from the map", () => {
        const todo = makeTodo({ id: "todo-1" });
        expect(select([todo])).toHaveLength(1);
        expect(select([], { completions: [completionFor(todo)] })).toEqual([]);
        expect(select([])).toEqual([]);
    });
});

describe("aging undated to-do dismissal cadence", () => {
    it("silences a day-7 dismissal on days 8 and 9 and re-raises on the next cadence days", () => {
        const todo = makeTodo({ id: "todo-1" });
        const dismissals = dismissalAtAge(7);
        expect(select([todo], { reference: ageDate(7), dismissals })).toEqual([]);
        expect(select([todo], { reference: ageDate(8), dismissals })).toEqual([]);
        expect(select([todo], { reference: ageDate(9), dismissals })).toEqual([]);
        expect(ids(select([todo], { reference: ageDate(10), dismissals }))).toEqual(["todo-1"]);
        expect(ids(select([todo], { reference: ageDate(13), dismissals }))).toEqual(["todo-1"]);
        expect(ids(select([todo], { reference: ageDate(16), dismissals }))).toEqual(["todo-1"]);
    });

    it("anchors reappearance to creation, not to the dismissal date", () => {
        const todo = makeTodo({ id: "todo-1" });
        const dismissals = dismissalAtAge(8);
        expect(select([todo], { reference: ageDate(8), dismissals })).toEqual([]);
        expect(select([todo], { reference: ageDate(9), dismissals })).toEqual([]);
        expect(ids(select([todo], { reference: ageDate(10), dismissals }))).toEqual(["todo-1"]);
    });

    it("re-raises on the following cadence day after each dismissal", () => {
        const todo = makeTodo({ id: "todo-1" });
        const dismissals = dismissalAtAge(10);
        expect(select([todo], { reference: ageDate(10), dismissals })).toEqual([]);
        expect(select([todo], { reference: ageDate(11), dismissals })).toEqual([]);
        expect(select([todo], { reference: ageDate(12), dismissals })).toEqual([]);
        expect(ids(select([todo], { reference: ageDate(13), dismissals }))).toEqual(["todo-1"]);
        expect(ids(select([todo], { reference: ageDate(15), dismissals }))).toEqual(["todo-1"]);
    });

    it("treats a corrupt dismissal timestamp as no dismissal", () => {
        const todo = makeTodo({ id: "todo-1" });
        expect(ids(select([todo], { dismissals: { "todo-1": { dismissedAt: "not-a-date" } } }))).toEqual(["todo-1"]);
    });

    it("ignores dismissals recorded for other to-do ids", () => {
        const todo = makeTodo({ id: "todo-1" });
        const dismissals = { "todo-2": { dismissedAt: ageDate(7).toISOString() } };
        expect(ids(select([todo], { dismissals }))).toEqual(["todo-1"]);
    });
});

describe("aging cadence helpers", () => {
    it("computes the first cadence day strictly after a dismissal day", () => {
        expect(nextAgingTodoCadenceDay(0)).toBe(7);
        expect(nextAgingTodoCadenceDay(6)).toBe(7);
        expect(nextAgingTodoCadenceDay(7)).toBe(10);
        expect(nextAgingTodoCadenceDay(8)).toBe(10);
        expect(nextAgingTodoCadenceDay(9)).toBe(10);
        expect(nextAgingTodoCadenceDay(10)).toBe(13);
        expect(nextAgingTodoCadenceDay(16)).toBe(19);
    });

    it("exposes the day-level rule directly", () => {
        expect(isAgingTodoDueAtAge(6, null)).toBe(false);
        expect(isAgingTodoDueAtAge(7, null)).toBe(true);
        expect(isAgingTodoDueAtAge(9, 7)).toBe(false);
        expect(isAgingTodoDueAtAge(10, 7)).toBe(true);
        expect(isAgingTodoDueAtAge(8, 9)).toBe(false);
        expect(isAgingTodoDueAtAge(7, Number.NaN)).toBe(true);
    });
});

describe("aging banner summary", () => {
    it("sorts qualifying to-dos oldest first and lists at most three titles", () => {
        const todos = [
            makeTodo({ id: "age-7", title: "D", createdAt: ageDate(-7).toISOString() }),
            makeTodo({ id: "age-10", title: "A", createdAt: ageDate(-10).toISOString() }),
            makeTodo({ id: "age-8", title: "C", createdAt: ageDate(-8).toISOString() }),
            makeTodo({ id: "age-9", title: "B", createdAt: ageDate(-9).toISOString() }),
        ];

        const selected = select(todos, { reference: ageDate(0) });
        expect(ids(selected)).toEqual(["age-10", "age-9", "age-8", "age-7"]);
        expect(summarizeAgingTodos(selected)).toEqual({ count: 4, titles: ["A", "B", "C"], more: 1 });
        expect(summarizeAgingTodos(selected.slice(0, 1))).toEqual({ count: 1, titles: ["A"], more: 0 });
        expect(summarizeAgingTodos(selected, 2)).toEqual({ count: 4, titles: ["A", "B"], more: 2 });
    });

    it("falls back to a placeholder title for blank values", () => {
        const selected = select([makeTodo({ id: "todo-1", title: "   " })]);
        expect(summarizeAgingTodos(selected)).toEqual({ count: 1, titles: ["Untitled to-do"], more: 0 });
    });
});
