import { localDateFromKey, localDateKey } from "./calendar";
import type { AgingTodoDismissals } from "./agingTodoDismissals";
import { todoCompletionBucket } from "./integration";
import type { Todo, TodoCompletion } from "./types";

/** Whole-day age (creation date being day 0) at which an undated to-do first surfaces. */
export const AGING_TODO_FIRST_DAY = 7;
/** After a dismissal, the banner re-raises every this many days after creation: day 7, 10, 13, … */
export const AGING_TODO_CADENCE_DAYS = 3;
/** How many titles the combined banner lists before summarising the remainder. */
export const AGING_TODO_MAX_TITLES = 3;

const MS_PER_DAY = 86_400_000;
const COMPLETION_KEY_SEPARATOR = "\u0000";

function localDayStartTime(date: Date): number | null {
    if (Number.isNaN(date.getTime())) return null;
    try {
        // Noon-normalizing the local date keeps the difference stable across DST shifts.
        return localDateFromKey(localDateKey(date)).getTime();
    } catch {
        return null;
    }
}

function wholeDaysBetween(from: Date, to: Date): number | null {
    const fromTime = localDayStartTime(from);
    const toTime = localDayStartTime(to);
    if (fromTime === null || toTime === null) return null;
    return Math.round((toTime - fromTime) / MS_PER_DAY);
}

/** Whole-day age of a to-do's creation date relative to the reference date, or null when unparseable. */
export function todoAgeDays(createdAt: string, reference: Date): number | null {
    if (typeof createdAt !== "string" || createdAt === "") return null;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return null;
    return wholeDaysBetween(created, reference);
}

/** The first creation-anchored cadence day strictly after the day a to-do was dismissed. */
export function nextAgingTodoCadenceDay(dismissedAgeDays: number): number {
    const steps = Math.max(
        0,
        Math.floor((dismissedAgeDays - AGING_TODO_FIRST_DAY) / AGING_TODO_CADENCE_DAYS) + 1,
    );
    return AGING_TODO_FIRST_DAY + steps * AGING_TODO_CADENCE_DAYS;
}

/**
 * Day-level visibility rule. A to-do is eligible from day 7. Without a dismissal
 * it stays eligible every day; a dismissal only silences it until the next
 * creation-anchored cadence day (7 + 3n) strictly after the dismissal day.
 * A null dismissal age means "treat as never dismissed".
 */
export function isAgingTodoDueAtAge(ageDays: number, dismissedAgeDays: number | null): boolean {
    if (!Number.isFinite(ageDays) || ageDays < AGING_TODO_FIRST_DAY) return false;
    if (dismissedAgeDays === null || !Number.isFinite(dismissedAgeDays)) return true;
    return ageDays >= nextAgingTodoCadenceDay(dismissedAgeDays);
}

export function agingTodoTitle(todo: Todo): string {
    const title = typeof todo.title === "string" ? todo.title.trim() : "";
    return title || "Untitled to-do";
}

function dismissalAgeDays(createdAt: string, dismissedAt: string): number | null {
    const dismissed = new Date(dismissedAt);
    if (Number.isNaN(dismissed.getTime())) return null;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return null;
    return wholeDaysBetween(created, dismissed);
}

function completionKey(todoId: string, bucket: string): string {
    return `${todoId}${COMPLETION_KEY_SEPARATOR}${bucket}`;
}

function compareAgingTodos(left: Todo, right: Todo): number {
    const leftCreated = Date.parse(left.createdAt);
    const rightCreated = Date.parse(right.createdAt);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    const byTitle = agingTodoTitle(left).localeCompare(agingTodoTitle(right));
    return byTitle !== 0 ? byTitle : left.id.localeCompare(right.id);
}

/**
 * Returns every incomplete, unarchived to-do with no due date whose whole-day
 * age has reached the banner cadence, oldest first. Pure: the caller supplies
 * the reference date and the stored dismissals.
 */
export function selectAgingUndatedTodos(
    todos: Record<string, Todo>,
    completions: Record<string, TodoCompletion>,
    dismissals: AgingTodoDismissals,
    reference: Date,
): Todo[] {
    const completed = new Set<string>();
    for (const completion of Object.values(completions)) {
        if (!completion || typeof completion.todoId !== "string" || typeof completion.bucket !== "string") continue;
        completed.add(completionKey(completion.todoId, completion.bucket));
    }

    const qualifying: Todo[] = [];
    for (const todo of Object.values(todos)) {
        if (!todo || todo.dueDate || todo.isArchived) continue;
        const ageDays = todoAgeDays(todo.createdAt, reference);
        if (ageDays === null) continue;
        const dismissal = dismissals[todo.id];
        const dismissedAgeDays = dismissal ? dismissalAgeDays(todo.createdAt, dismissal.dismissedAt) : null;
        if (!isAgingTodoDueAtAge(ageDays, dismissedAgeDays)) continue;
        if (completed.has(completionKey(todo.id, todoCompletionBucket(todo)))) continue;
        qualifying.push(todo);
    }
    return qualifying.sort(compareAgingTodos);
}

export interface AgingTodoBannerSummary {
    count: number;
    titles: string[];
    more: number;
}

/** Builds the combined banner content from an already-filtered list. */
export function summarizeAgingTodos(
    todos: Todo[],
    maxTitles: number = AGING_TODO_MAX_TITLES,
): AgingTodoBannerSummary {
    const limit = Math.max(0, Math.trunc(maxTitles));
    const titles = todos.slice(0, limit).map(agingTodoTitle);
    return { count: todos.length, titles, more: Math.max(0, todos.length - titles.length) };
}
