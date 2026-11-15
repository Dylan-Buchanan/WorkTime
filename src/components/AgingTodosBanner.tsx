import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Todo, TodoCompletion } from "../lib/todos";
import { selectAgingUndatedTodos, summarizeAgingTodos } from "../lib/todos/agingTodos";
import {
    dismissAgingTodo,
    getAgingTodoDismissals,
    type AgingTodoDismissalState,
} from "../lib/todos/agingTodoDismissals";

const NO_TODOS: Record<string, Todo> = {};
const NO_COMPLETIONS: Record<string, TodoCompletion> = {};

export interface AgingTodosBannerProps {
    todos?: Record<string, Todo>;
    completions?: Record<string, TodoCompletion>;
    /** False until to-do state hydrates, or when no to-do provider is mounted. */
    enabled?: boolean;
}

/**
 * Dismiss-only timer-page banner that surfaces incomplete to-dos with no due
 * date once they reach the creation-anchored aging cadence. Eligibility is
 * evaluated against the instant the banner mounts (the "page load"); dismissals
 * are surface-local and re-read only after a successful write.
 */
export function AgingTodosBanner({
    todos = NO_TODOS,
    completions = NO_COMPLETIONS,
    enabled = false,
}: AgingTodosBannerProps) {
    const [reference] = useState(() => new Date());
    const [dismissals, setDismissals] = useState<AgingTodoDismissalState>(getAgingTodoDismissals);
    const qualifying = useMemo(
        () => (enabled ? selectAgingUndatedTodos(todos, completions, dismissals.dismissals, reference) : []),
        [completions, dismissals, enabled, reference, todos],
    );
    const summary = useMemo(() => summarizeAgingTodos(qualifying), [qualifying]);

    const dismiss = useCallback(() => {
        const dismissedAt = new Date().toISOString();
        let stored = false;
        for (const todo of qualifying) {
            if (dismissAgingTodo(todo.id, dismissedAt)) stored = true;
        }
        if (stored) setDismissals(getAgingTodoDismissals());
    }, [qualifying]);

    if (summary.count === 0) return null;

    const heading = summary.count === 1
        ? "1 to-do has no due date and is getting stale"
        : `${summary.count} to-dos have no due date and are getting stale`;
    const names = summary.titles.map((title) => `"${title}"`).join(", ");
    const detail = `Still open: ${names}${summary.more > 0 ? ` and ${summary.more} more` : ""}`;

    return (
        <section
            role="region"
            aria-label="Aging to-dos"
            data-testid="aging-todos-banner"
            className="w-full rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-left text-xs text-amber-100"
        >
            <div className="flex min-w-0 items-start gap-3">
                <div className="min-w-0 flex-1">
                    <p className="font-medium">{heading}</p>
                    <p className="mt-0.5 break-words text-amber-200/80">{detail}</p>
                </div>
                <button
                    type="button"
                    aria-label="Dismiss aging to-dos banner"
                    onClick={dismiss}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-[11px] font-medium leading-none text-amber-200 transition-colors hover:border-amber-400/60 hover:bg-amber-900/50 hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    Dismiss
                </button>
            </div>
        </section>
    );
}
