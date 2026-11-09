import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    RESUME_NOTE_MAX_LENGTH,
    RESUME_NOTE_STORAGE_KEY,
    clearResumeNotes,
    dismissResumeNote,
    getResumeNote,
    getResumeNotes,
    saveResumeNote,
    type ResumeNote,
    type ResumeNoteInput,
    type ResumeNoteState,
    type ResumeNoteStorage,
} from "./index";

const SAVED_AT = "2026-08-07T13:00:00.000Z";
const DISMISSED_AT = "2026-08-07T14:00:00.000Z";
const EMPTY_STATE: ResumeNoteState = { version: 1, notes: {} };

const OTHER_KEYS = [
    "worktime:agent:startOfDayPlan:v1",
    "worktime:theme:v1",
    "worktime:staging:v1:x",
];

function createStorage(initial: Record<string, string> = {}): ResumeNoteStorage {
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

function throwingStorage(): ResumeNoteStorage {
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

function makeInput(overrides: Partial<ResumeNoteInput> = {}): ResumeNoteInput {
    return {
        whereIAm: "Halfway through the parser",
        nextAction: "Wire the resume card",
        blocker: "Waiting on the API shape",
        savedAt: SAVED_AT,
        ...overrides,
    };
}

function makeNote(overrides: Partial<ResumeNote> = {}): ResumeNote {
    return {
        whereIAm: "Halfway through the parser",
        nextAction: "Wire the resume card",
        blocker: "Waiting on the API shape",
        savedAt: SAVED_AT,
        ...overrides,
    };
}

function writeState(
    storage: ResumeNoteStorage,
    notes: Record<string, unknown>,
    version: unknown = 1,
): void {
    storage.setItem(RESUME_NOTE_STORAGE_KEY, JSON.stringify({ version, notes }));
}

function storedState(storage: ResumeNoteStorage): ResumeNoteState {
    return JSON.parse(storage.getItem(RESUME_NOTE_STORAGE_KEY) ?? "null") as ResumeNoteState;
}

beforeEach(() => {
    localStorage.clear();
});

describe("resume note store", () => {
    it("round trips a note as a clone in the versioned shape", () => {
        const storage = createStorage();
        const result = saveResumeNote("task-1", makeInput(), storage);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.note).toEqual(makeNote());
        expect(storedState(storage)).toEqual({ version: 1, notes: { "task-1": makeNote() } });

        const note = getResumeNote("task-1", storage);
        expect(note).toEqual(makeNote());
        expect(getResumeNotes(storage)).toEqual({
            version: 1,
            notes: { "task-1": makeNote() },
        });

        expect(note).not.toBeNull();
        note!.whereIAm = "mutated";
        const state = getResumeNotes(storage);
        state.notes["task-1"].nextAction = "mutated";
        delete state.notes["task-1"].blocker;
        result.note.whereIAm = "mutated";

        expect(getResumeNote("task-1", storage)).toEqual(makeNote());
        expect(getResumeNotes(storage)).toEqual({
            version: 1,
            notes: { "task-1": makeNote() },
        });
    });

    it("drops only malformed entries from a partially corrupt blob", () => {
        const storage = createStorage();
        writeState(storage, {
            good: makeNote(),
            missingNextAction: { whereIAm: "x", savedAt: SAVED_AT },
            badNextAction: { whereIAm: "x", nextAction: 42, savedAt: SAVED_AT },
            badSavedAt: { whereIAm: "x", nextAction: "y", savedAt: "not-a-date" },
            badDismissedAt: { whereIAm: "x", nextAction: "y", savedAt: SAVED_AT, dismissedAt: "nope" },
            notAnObject: "entry",
        });

        expect(getResumeNotes(storage)).toEqual({
            version: 1,
            notes: { good: makeNote() },
        });
        expect(getResumeNote("good", storage)).toEqual(makeNote());
        expect(getResumeNote("missingNextAction", storage)).toBeNull();
        expect(getResumeNote("badSavedAt", storage)).toBeNull();
    });

    it("treats an unknown version as empty and does not rewrite it until the next save", () => {
        const storage = createStorage();
        const raw = JSON.stringify({ version: 2, notes: { "task-1": makeNote() } });
        storage.setItem(RESUME_NOTE_STORAGE_KEY, raw);

        expect(getResumeNotes(storage)).toEqual(EMPTY_STATE);
        expect(getResumeNote("task-1", storage)).toBeNull();
        expect(storage.getItem(RESUME_NOTE_STORAGE_KEY)).toBe(raw);

        const result = saveResumeNote("task-1", makeInput(), storage);
        expect(result.ok).toBe(true);
        expect(storedState(storage)).toEqual({ version: 1, notes: { "task-1": makeNote() } });
    });

    it.each([
        ["invalid JSON", "not-json"],
        ["a non-object top level", JSON.stringify([{ whereIAm: "x" }])],
        ["a null top level", "null"],
        ["missing version", JSON.stringify({ notes: { "task-1": makeNote() } })],
        ["non-object notes", JSON.stringify({ version: 1, notes: [] })],
    ])("reads %s as empty state", (_label, raw) => {
        const storage = createStorage();
        storage.setItem(RESUME_NOTE_STORAGE_KEY, raw);

        expect(getResumeNotes(storage)).toEqual(EMPTY_STATE);
        expect(getResumeNote("task-1", storage)).toBeNull();
        expect(storage.getItem(RESUME_NOTE_STORAGE_KEY)).toBe(raw);
    });

    it("degrades quietly when storage is missing or its methods throw", () => {
        const throwing = throwingStorage();
        expect(getResumeNotes(throwing)).toEqual(EMPTY_STATE);
        expect(getResumeNote("task-1", throwing)).toBeNull();

        const failed = saveResumeNote("task-1", makeInput(), throwing);
        expect(failed.ok).toBe(false);
        if (!failed.ok) {
            expect(failed.reason).toBe("unavailable");
            expect(failed.note).toEqual(makeNote());
        }
        expect(dismissResumeNote("task-1", DISMISSED_AT, throwing)).toBe(false);
        expect(() => clearResumeNotes(throwing)).not.toThrow();

        vi.stubGlobal("localStorage", undefined);
        try {
            expect(getResumeNotes()).toEqual(EMPTY_STATE);
            expect(getResumeNote("task-1")).toBeNull();
            const missing = saveResumeNote("task-1", makeInput());
            expect(missing.ok).toBe(false);
            if (!missing.ok) {
                expect(missing.reason).toBe("unavailable");
                expect(missing.note).toEqual(makeNote());
            }
            expect(dismissResumeNote("task-1", DISMISSED_AT)).toBe(false);
            expect(() => clearResumeNotes()).not.toThrow();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("reports a quota failure and keeps working on the next call", () => {
        const backing = createStorage();
        let failNextWrite = true;
        const storage: ResumeNoteStorage = {
            getItem: (key) => backing.getItem(key),
            removeItem: (key) => backing.removeItem(key),
            setItem: (key, value) => {
                if (failNextWrite) {
                    failNextWrite = false;
                    throw new DOMException("Storage quota exceeded", "QuotaExceededError");
                }
                backing.setItem(key, value);
            },
        };

        const failed = saveResumeNote("task-1", makeInput(), storage);
        expect(failed.ok).toBe(false);
        if (!failed.ok) {
            expect(failed.reason).toBe("write-failed");
            expect(failed.note).toEqual(makeNote());
        }
        expect(getResumeNote("task-1", storage)).toBeNull();

        expect(saveResumeNote("task-1", makeInput(), storage).ok).toBe(true);
        expect(getResumeNote("task-1", storage)).toEqual(makeNote());
    });

    it("clamps on write and on read while preserving savedAt and the entry", () => {
        const storage = createStorage();
        const long = "a".repeat(200);
        const clamped = "a".repeat(RESUME_NOTE_MAX_LENGTH);
        const result = saveResumeNote(
            "task-1",
            makeInput({ whereIAm: long, nextAction: long, blocker: long }),
            storage,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const expected = makeNote({ whereIAm: clamped, nextAction: clamped, blocker: clamped });
        expect(result.note).toEqual(expected);
        expect(result.note.savedAt).toBe(SAVED_AT);
        expect(getResumeNote("task-1", storage)).toEqual(expected);

        const rawLong = "b".repeat(200);
        const rawClamped = "b".repeat(RESUME_NOTE_MAX_LENGTH);
        writeState(storage, {
            raw: {
                whereIAm: rawLong,
                nextAction: rawLong,
                blocker: rawLong,
                savedAt: SAVED_AT,
            },
        });
        const read = getResumeNote("raw", storage);
        expect(read).toEqual(
            makeNote({ whereIAm: rawClamped, nextAction: rawClamped, blocker: rawClamped }),
        );
        expect(read?.savedAt).toBe(SAVED_AT);

        const exact = "c".repeat(RESUME_NOTE_MAX_LENGTH);
        writeState(storage, {
            exact: { whereIAm: exact, nextAction: "", savedAt: SAVED_AT },
        });
        expect(getResumeNote("exact", storage)).toEqual({
            whereIAm: exact,
            nextAction: "",
            savedAt: SAVED_AT,
        });
    });

    it("dismisses without touching the memo and a later save clears the dismissal", () => {
        const storage = createStorage();
        saveResumeNote("task-1", makeInput(), storage);

        expect(dismissResumeNote("missing", DISMISSED_AT, storage)).toBe(false);
        expect(getResumeNote("task-1", storage)).toEqual(makeNote());
        expect(dismissResumeNote("task-1", DISMISSED_AT, storage)).toBe(true);

        const dismissed = getResumeNote("task-1", storage);
        expect(dismissed).toEqual(makeNote({ dismissedAt: DISMISSED_AT }));
        expect(dismissed).toEqual(
            expect.objectContaining({
                whereIAm: makeNote().whereIAm,
                nextAction: makeNote().nextAction,
                blocker: makeNote().blocker,
                savedAt: SAVED_AT,
            }),
        );

        saveResumeNote("task-1", makeInput(), storage);
        const savedAgain = getResumeNote("task-1", storage);
        expect(savedAgain).toEqual(makeNote());
        expect(savedAgain && "dismissedAt" in savedAgain).toBe(false);
    });

    it("preserves a valid entry for another task when saving", () => {
        const storage = createStorage();
        saveResumeNote("task-b", makeInput({ whereIAm: "B memo" }), storage);
        saveResumeNote("task-a", makeInput({ whereIAm: "A memo" }), storage);

        expect(getResumeNotes(storage)).toEqual({
            version: 1,
            notes: {
                "task-b": makeNote({ whereIAm: "B memo" }),
                "task-a": makeNote({ whereIAm: "A memo" }),
            },
        });
    });

    it("omits an empty blocker on write and on read", () => {
        const storage = createStorage();
        const result = saveResumeNote("task-1", makeInput({ blocker: "" }), storage);

        expect(result.ok).toBe(true);
        expect("blocker" in storedState(storage).notes["task-1"]).toBe(false);
        expect(getResumeNote("task-1", storage)).toEqual({
            whereIAm: makeNote().whereIAm,
            nextAction: makeNote().nextAction,
            savedAt: SAVED_AT,
        });

        writeState(storage, {
            blank: {
                whereIAm: makeNote().whereIAm,
                nextAction: makeNote().nextAction,
                blocker: "",
                savedAt: SAVED_AT,
            },
        });
        const blank = getResumeNote("blank", storage);
        expect(blank).not.toBeNull();
        expect(blank && "blocker" in blank).toBe(false);
    });

    it("leaves the other local keys untouched", () => {
        const initial = Object.fromEntries(
            OTHER_KEYS.map((key, index) => [key, `value-${index}`]),
        );
        const storage = createStorage(initial);

        saveResumeNote("task-1", makeInput(), storage);
        dismissResumeNote("task-1", DISMISSED_AT, storage);
        for (const key of OTHER_KEYS) expect(storage.getItem(key)).toBe(initial[key]);

        clearResumeNotes(storage);
        for (const key of OTHER_KEYS) expect(storage.getItem(key)).toBe(initial[key]);
        expect(storage.getItem(RESUME_NOTE_STORAGE_KEY)).toBeNull();
    });

    it("drops reserved task ids without polluting Object.prototype", () => {
        const storage = createStorage();
        const note = makeNote();
        const raw = `{"version":1,"notes":{"__proto__":${JSON.stringify(note)},"constructor":${JSON.stringify(note)},"prototype":${JSON.stringify(note)},"good":${JSON.stringify(note)}}}`;
        storage.setItem(RESUME_NOTE_STORAGE_KEY, raw);

        const state = getResumeNotes(storage);
        expect(state.notes).toEqual({ good: note });
        expect(Object.keys(state.notes)).toEqual(["good"]);
        expect(getResumeNote("__proto__", storage)).toBeNull();
        expect(getResumeNote("constructor", storage)).toBeNull();
        expect(getResumeNote("prototype", storage)).toBeNull();
        expect(({} as Record<string, unknown>).whereIAm).toBeUndefined();
        expect(Object.prototype).not.toHaveProperty("whereIAm");

        const result = saveResumeNote("__proto__", makeInput(), storage);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("write-failed");
        expect(saveResumeNote("", makeInput(), storage).ok).toBe(false);
        expect(storage.getItem(RESUME_NOTE_STORAGE_KEY)).toBe(raw);
    });
});
