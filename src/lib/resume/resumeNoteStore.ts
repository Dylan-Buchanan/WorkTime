/**
 * Surface-local, unsynced resume notes keyed by app task id.
 *
 * This key lives only in the current browser/Tauri profile. Every owner who
 * signs in on the same profile shares it (accepted for v1, in parity with the
 * agent keys), and it has no revision or merge system beyond preserving the
 * other valid per-task entries whenever one task is written.
 */
export const RESUME_NOTE_STORAGE_KEY = "worktime:resume:v1";

export const RESUME_NOTE_MAX_LENGTH = 140;

export interface ResumeNote {
    whereIAm: string;
    nextAction: string;
    blocker?: string;
    /** ISO timestamp of the write that produced this value (supplied by the caller). */
    savedAt: string;
    /** ISO timestamp at which the resume card was dismissed. Cleared by any later save. */
    dismissedAt?: string;
}

export interface ResumeNoteState {
    version: 1;
    notes: Record<string, ResumeNote>;
}

export interface ResumeNoteInput {
    whereIAm: string;
    nextAction: string;
    blocker?: string;
    savedAt: string;
}

export type ResumeNoteWriteResult =
    | { ok: true; note: ResumeNote }
    | { ok: false; note: ResumeNote; reason: "unavailable" | "write-failed" };

export type ResumeNoteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const RESERVED_TASK_IDS = new Set(["__proto__", "constructor", "prototype"]);

function defaultStorage(): ResumeNoteStorage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function isValidTaskId(taskId: unknown): taskId is string {
    return typeof taskId === "string" && taskId.length > 0 && !RESERVED_TASK_IDS.has(taskId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function clampText(value: unknown): string {
    if (typeof value !== "string") return "";
    return Array.from(value).slice(0, RESUME_NOTE_MAX_LENGTH).join("");
}

function isDateString(value: unknown): value is string {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function emptyState(): ResumeNoteState {
    return { version: 1, notes: {} };
}

function cloneNote(note: ResumeNote): ResumeNote {
    return {
        whereIAm: note.whereIAm,
        nextAction: note.nextAction,
        ...(note.blocker !== undefined ? { blocker: note.blocker } : {}),
        savedAt: note.savedAt,
        ...(note.dismissedAt !== undefined ? { dismissedAt: note.dismissedAt } : {}),
    };
}

function parseNote(value: unknown): ResumeNote | null {
    if (!isPlainObject(value)) return null;
    if (typeof value.whereIAm !== "string" || typeof value.nextAction !== "string") return null;
    if (value.blocker !== undefined && typeof value.blocker !== "string") return null;
    if (!isDateString(value.savedAt)) return null;
    if (value.dismissedAt !== undefined && !isDateString(value.dismissedAt)) return null;

    const note: ResumeNote = {
        whereIAm: clampText(value.whereIAm),
        nextAction: clampText(value.nextAction),
        savedAt: value.savedAt,
    };
    if (typeof value.blocker === "string") {
        const blocker = clampText(value.blocker);
        if (blocker !== "") note.blocker = blocker;
    }
    if (value.dismissedAt !== undefined) note.dismissedAt = value.dismissedAt;
    return note;
}

function parseState(raw: string | null): ResumeNoteState {
    if (raw === null) return emptyState();

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return emptyState();
    }

    if (!isPlainObject(parsed) || parsed.version !== 1 || !isPlainObject(parsed.notes)) {
        return emptyState();
    }

    const notes: Record<string, ResumeNote> = {};
    for (const [taskId, entry] of Object.entries(parsed.notes)) {
        if (!isValidTaskId(taskId)) continue;
        const note = parseNote(entry);
        if (note) notes[taskId] = note;
    }
    return { version: 1, notes };
}

type StateRead = { ok: true; state: ResumeNoteState } | { ok: false };

function readState(storage: ResumeNoteStorage | undefined): StateRead {
    if (!storage) return { ok: false };
    let raw: string | null;
    try {
        raw = storage.getItem(RESUME_NOTE_STORAGE_KEY);
    } catch {
        return { ok: false };
    }
    return { ok: true, state: parseState(raw) };
}

function buildNote(input: ResumeNoteInput): ResumeNote {
    const note: ResumeNote = {
        whereIAm: clampText(input.whereIAm),
        nextAction: clampText(input.nextAction),
        savedAt: input.savedAt,
    };
    const blocker = clampText(input.blocker);
    if (typeof input.blocker === "string" && blocker !== "") note.blocker = blocker;
    return note;
}

export function getResumeNote(
    taskId: string,
    storage: ResumeNoteStorage | undefined = defaultStorage(),
): ResumeNote | null {
    if (!isValidTaskId(taskId)) return null;
    const read = readState(storage);
    if (!read.ok) return null;
    const note = read.state.notes[taskId];
    return note ? cloneNote(note) : null;
}

export function getResumeNotes(
    storage: ResumeNoteStorage | undefined = defaultStorage(),
): ResumeNoteState {
    const read = readState(storage);
    return read.ok ? read.state : emptyState();
}

export function saveResumeNote(
    taskId: string,
    input: ResumeNoteInput,
    storage: ResumeNoteStorage | undefined = defaultStorage(),
): ResumeNoteWriteResult {
    const note = buildNote(input);
    if (!isValidTaskId(taskId)) {
        return { ok: false, note: cloneNote(note), reason: "write-failed" };
    }

    const read = readState(storage);
    if (!read.ok || !storage) {
        return { ok: false, note: cloneNote(note), reason: "unavailable" };
    }

    read.state.notes[taskId] = note;
    try {
        storage.setItem(RESUME_NOTE_STORAGE_KEY, JSON.stringify(read.state));
    } catch {
        return { ok: false, note: cloneNote(note), reason: "write-failed" };
    }
    return { ok: true, note: cloneNote(note) };
}

export function dismissResumeNote(
    taskId: string,
    dismissedAt: string,
    storage: ResumeNoteStorage | undefined = defaultStorage(),
): boolean {
    if (!isValidTaskId(taskId)) return false;

    const read = readState(storage);
    if (!read.ok || !storage) return false;

    const note = read.state.notes[taskId];
    if (!note) return false;

    read.state.notes[taskId] = {
        whereIAm: note.whereIAm,
        nextAction: note.nextAction,
        ...(note.blocker !== undefined ? { blocker: note.blocker } : {}),
        savedAt: note.savedAt,
        dismissedAt,
    };
    try {
        storage.setItem(RESUME_NOTE_STORAGE_KEY, JSON.stringify(read.state));
    } catch {
        return false;
    }
    return true;
}

export function clearResumeNotes(storage: ResumeNoteStorage | undefined = defaultStorage()): void {
    try {
        storage?.removeItem(RESUME_NOTE_STORAGE_KEY);
    } catch {
        // Storage can be blocked; clearing is best-effort and never throws.
    }
}
