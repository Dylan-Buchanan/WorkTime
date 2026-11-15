/**
 * Surface-local Timer page mode and Quick add draft.
 *
 * This is a plain in-memory store: the active mode and a half-typed draft
 * survive route navigation because the authenticated shell stays mounted, but
 * they are discarded on reload and never written to `localStorage`, `Settings`,
 * or the staging store.
 */
export type TimerPageMode = "timer" | "quick-add";

export interface QuickAddDraft {
    title: string;
    projectId: string | null;
    estimate: string;
    notes: string;
    notesOpen: boolean;
}

export const DEFAULT_QUICK_ADD_DRAFT: QuickAddDraft = {
    title: "",
    projectId: null,
    estimate: "1",
    notes: "",
    notesOpen: false,
};

type QuickAddSessionListener = () => void;

let timerPageMode: TimerPageMode = "timer";
let quickAddDraft: QuickAddDraft = { ...DEFAULT_QUICK_ADD_DRAFT };
const listeners = new Set<QuickAddSessionListener>();

function publish(): void {
    listeners.forEach((listener) => listener());
}

export function getTimerPageMode(): TimerPageMode {
    return timerPageMode;
}

export function setTimerPageMode(mode: TimerPageMode): TimerPageMode {
    if (mode !== "timer" && mode !== "quick-add") throw new Error(`Unsupported timer page mode: ${String(mode)}`);
    timerPageMode = mode;
    publish();
    return timerPageMode;
}

export function getQuickAddDraft(): QuickAddDraft {
    return quickAddDraft;
}

export function setQuickAddDraft(draft: QuickAddDraft): QuickAddDraft {
    quickAddDraft = { ...draft };
    publish();
    return quickAddDraft;
}

export function subscribeToQuickAddSession(listener: QuickAddSessionListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Clears the mode back to "timer" and the draft back to its default. */
export function resetQuickAddSession(): void {
    timerPageMode = "timer";
    quickAddDraft = { ...DEFAULT_QUICK_ADD_DRAFT };
    publish();
}
