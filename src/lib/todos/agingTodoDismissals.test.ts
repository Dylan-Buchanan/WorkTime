import { describe, expect, it, vi } from "vitest";
import {
    AGING_TODO_DISMISSAL_STORAGE_KEY,
    clearAgingTodoDismissals,
    dismissAgingTodo,
    getAgingTodoDismissals,
    type AgingTodoDismissalState,
    type AgingTodoDismissalStorage,
} from "./index";

const DISMISSED_AT = "2026-08-07T14:00:00.000Z";
const EMPTY_STATE: AgingTodoDismissalState = { version: 1, dismissals: {} };

const OTHER_KEYS = [
    "worktime:agent:startOfDayPlan:v1",
    "worktime:resume:v1",
    "worktime:theme:v1",
    "worktime:staging:v1:x",
];

function createStorage(initial: Record<string, string> = {}): AgingTodoDismissalStorage {
    const data = new Map<string, string>(Object.entries(initial));
    return {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value);
        },
        removeItem: (key) => {
            data.delete(key);
        },
    };
}

function throwingStorage(): AgingTodoDismissalStorage {
    return {
        getItem: () => {
            throw new Error("storage blocked");
        },
        setItem: () => {
            throw new Error("storage blocked");
        },
        removeItem: () => {
            throw new Error("storage blocked");
        },
    };
}

function storedState(storage: AgingTodoDismissalStorage): unknown {
    const raw = storage.getItem(AGING_TODO_DISMISSAL_STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
}

describe("aging to-do dismissal store", () => {
    it("starts empty when nothing has been stored or storage is unavailable", () => {
        expect(getAgingTodoDismissals(createStorage())).toEqual(EMPTY_STATE);
        expect(getAgingTodoDismissals(undefined)).toEqual(EMPTY_STATE);
        expect(getAgingTodoDismissals(throwingStorage())).toEqual(EMPTY_STATE);
    });

    it("records a dismissal and reads it back", () => {
        const storage = createStorage();
        expect(dismissAgingTodo("todo-1", DISMISSED_AT, storage)).toBe(true);
        expect(getAgingTodoDismissals(storage)).toEqual({
            version: 1,
            dismissals: { "todo-1": { dismissedAt: DISMISSED_AT } },
        });
    });

    it("preserves the other to-do dismissals when writing one", () => {
        const storage = createStorage({
            [AGING_TODO_DISMISSAL_STORAGE_KEY]: JSON.stringify({
                version: 1,
                dismissals: { "todo-1": { dismissedAt: DISMISSED_AT } },
            }),
        });

        expect(dismissAgingTodo("todo-2", "2026-08-08T09:00:00.000Z", storage)).toBe(true);
        expect(getAgingTodoDismissals(storage).dismissals).toEqual({
            "todo-1": { dismissedAt: DISMISSED_AT },
            "todo-2": { dismissedAt: "2026-08-08T09:00:00.000Z" },
        });
    });

    it("replaces a previous dismissal for the same to-do", () => {
        const storage = createStorage();
        dismissAgingTodo("todo-1", DISMISSED_AT, storage);
        dismissAgingTodo("todo-1", "2026-08-09T09:00:00.000Z", storage);
        expect(getAgingTodoDismissals(storage).dismissals["todo-1"]).toEqual({
            dismissedAt: "2026-08-09T09:00:00.000Z",
        });
    });

    it("rejects invalid ids and timestamps without writing", () => {
        const storage = createStorage();
        expect(dismissAgingTodo("", DISMISSED_AT, storage)).toBe(false);
        expect(dismissAgingTodo("__proto__", DISMISSED_AT, storage)).toBe(false);
        expect(dismissAgingTodo("constructor", DISMISSED_AT, storage)).toBe(false);
        expect(dismissAgingTodo("prototype", DISMISSED_AT, storage)).toBe(false);
        expect(dismissAgingTodo("todo-1", "not-a-date", storage)).toBe(false);
        expect(storage.getItem(AGING_TODO_DISMISSAL_STORAGE_KEY)).toBeNull();
    });

    it("returns false and leaves state untouched when the write throws", () => {
        expect(dismissAgingTodo("todo-1", DISMISSED_AT, throwingStorage())).toBe(false);
    });

    it.each([
        ["malformed JSON", "{not json"],
        ["a non-object value", JSON.stringify("nope")],
        ["an array", JSON.stringify([])],
        ["a wrong version", JSON.stringify({ version: 2, dismissals: { "todo-1": { dismissedAt: DISMISSED_AT } } })],
        ["missing dismissals", JSON.stringify({ version: 1 })],
        ["non-object dismissals", JSON.stringify({ version: 1, dismissals: [] })],
    ])("tolerates %s by falling back to an empty state", (_label, raw) => {
        const storage = createStorage({ [AGING_TODO_DISMISSAL_STORAGE_KEY]: raw });
        expect(getAgingTodoDismissals(storage)).toEqual(EMPTY_STATE);
    });

    it("drops only malformed entries during a partial read", () => {
        const storage = createStorage({
            [AGING_TODO_DISMISSAL_STORAGE_KEY]:
                `{"version":1,"dismissals":{` +
                `"todo-1":{"dismissedAt":"${DISMISSED_AT}"},` +
                `"todo-2":{"dismissedAt":"not-a-date"},` +
                `"todo-3":{},` +
                `"todo-4":"nope",` +
                `"":{"dismissedAt":"${DISMISSED_AT}"},` +
                `"__proto__":{"dismissedAt":"${DISMISSED_AT}"}` +
                `}}`,
        });

        expect(getAgingTodoDismissals(storage)).toEqual({
            version: 1,
            dismissals: { "todo-1": { dismissedAt: DISMISSED_AT } },
        });
    });

    it("ignores prototype-polluting ids entirely", () => {
        const storage = createStorage({
            [AGING_TODO_DISMISSAL_STORAGE_KEY]:
                `{"version":1,"dismissals":{"__proto__":{"dismissedAt":"${DISMISSED_AT}"}}}`,
        });

        const read = getAgingTodoDismissals(storage);
        expect(read).toEqual(EMPTY_STATE);
        expect(({} as Record<string, unknown>).dismissedAt).toBeUndefined();
        expect(dismissAgingTodo("__proto__", DISMISSED_AT, storage)).toBe(false);
    });

    it("clears only its own key and never throws when storage is blocked", () => {
        const storage = createStorage({
            [AGING_TODO_DISMISSAL_STORAGE_KEY]: JSON.stringify({
                version: 1,
                dismissals: { "todo-1": { dismissedAt: DISMISSED_AT } },
            }),
            ...Object.fromEntries(OTHER_KEYS.map((key) => [key, "keep"])),
        });

        clearAgingTodoDismissals(storage);

        expect(storage.getItem(AGING_TODO_DISMISSAL_STORAGE_KEY)).toBeNull();
        for (const key of OTHER_KEYS) expect(storage.getItem(key)).toBe("keep");
        expect(() => clearAgingTodoDismissals(throwingStorage())).not.toThrow();
        expect(() => clearAgingTodoDismissals(undefined)).not.toThrow();
    });

    it("writes only its own key", () => {
        const storage = createStorage();
        const setItem = vi.spyOn(storage, "setItem");
        dismissAgingTodo("todo-1", DISMISSED_AT, storage);
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(setItem).toHaveBeenCalledWith(AGING_TODO_DISMISSAL_STORAGE_KEY, expect.any(String));
        expect(storedState(storage)).toEqual({
            version: 1,
            dismissals: { "todo-1": { dismissedAt: DISMISSED_AT } },
        });
    });
});
