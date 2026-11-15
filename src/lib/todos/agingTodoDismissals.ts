/**
 * Surface-local, unsynced dismissals for the timer page's aging to-do banner.
 *
 * This key lives only in the current browser/Tauri profile. Every owner who
 * signs in on the same profile shares it (in parity with the other scoped
 * surface-local keys), and it never enters the staging store, Supabase, or
 * `Settings`. Entries are keyed by to-do id and only exist for to-dos the user
 * dismissed; stale entries are harmless and are matched by exact id.
 */
export const AGING_TODO_DISMISSAL_STORAGE_KEY = "worktime:todo-banner:v1";

export interface AgingTodoDismissal {
    /** ISO timestamp of the dismissal; only its local calendar date is significant. */
    dismissedAt: string;
}

export type AgingTodoDismissals = Record<string, AgingTodoDismissal>;

export interface AgingTodoDismissalState {
    version: 1;
    dismissals: AgingTodoDismissals;
}

export type AgingTodoDismissalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const RESERVED_TODO_IDS = new Set(["__proto__", "constructor", "prototype"]);

function defaultStorage(): AgingTodoDismissalStorage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function isValidTodoId(todoId: unknown): todoId is string {
    return typeof todoId === "string" && todoId.length > 0 && !RESERVED_TODO_IDS.has(todoId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isDateString(value: unknown): value is string {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function emptyState(): AgingTodoDismissalState {
    return { version: 1, dismissals: {} };
}

function parseDismissal(value: unknown): AgingTodoDismissal | null {
    if (!isPlainObject(value) || !isDateString(value.dismissedAt)) return null;
    return { dismissedAt: value.dismissedAt };
}

function parseState(raw: string | null): AgingTodoDismissalState {
    if (raw === null) return emptyState();

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return emptyState();
    }

    if (!isPlainObject(parsed) || parsed.version !== 1 || !isPlainObject(parsed.dismissals)) {
        return emptyState();
    }

    const dismissals: AgingTodoDismissals = {};
    for (const [todoId, entry] of Object.entries(parsed.dismissals)) {
        if (!isValidTodoId(todoId)) continue;
        const dismissal = parseDismissal(entry);
        if (dismissal) dismissals[todoId] = dismissal;
    }
    return { version: 1, dismissals };
}

type StateRead = { ok: true; state: AgingTodoDismissalState } | { ok: false };

function readState(storage: AgingTodoDismissalStorage | undefined): StateRead {
    if (!storage) return { ok: false };
    let raw: string | null;
    try {
        raw = storage.getItem(AGING_TODO_DISMISSAL_STORAGE_KEY);
    } catch {
        return { ok: false };
    }
    return { ok: true, state: parseState(raw) };
}

export function getAgingTodoDismissals(
    storage: AgingTodoDismissalStorage | undefined = defaultStorage(),
): AgingTodoDismissalState {
    const read = readState(storage);
    return read.ok ? read.state : emptyState();
}

/** Records (or replaces) the dismissal for one to-do. Returns false when storage is unavailable. */
export function dismissAgingTodo(
    todoId: string,
    dismissedAt: string,
    storage: AgingTodoDismissalStorage | undefined = defaultStorage(),
): boolean {
    if (!isValidTodoId(todoId) || !isDateString(dismissedAt)) return false;

    const read = readState(storage);
    if (!read.ok || !storage) return false;

    read.state.dismissals[todoId] = { dismissedAt };
    try {
        storage.setItem(AGING_TODO_DISMISSAL_STORAGE_KEY, JSON.stringify(read.state));
    } catch {
        return false;
    }
    return true;
}

export function clearAgingTodoDismissals(storage: AgingTodoDismissalStorage | undefined = defaultStorage()): void {
    try {
        storage?.removeItem(AGING_TODO_DISMISSAL_STORAGE_KEY);
    } catch {
        // Storage can be blocked; clearing is best-effort and never throws.
    }
}
