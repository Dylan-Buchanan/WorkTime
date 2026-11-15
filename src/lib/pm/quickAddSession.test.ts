import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_QUICK_ADD_DRAFT,
    getQuickAddDraft,
    getTimerPageMode,
    resetQuickAddSession,
    setQuickAddDraft,
    setTimerPageMode,
    subscribeToQuickAddSession,
} from "./quickAddSession";

beforeEach(() => {
    resetQuickAddSession();
    vi.restoreAllMocks();
});

describe("quickAddSession", () => {
    it("starts on the timer tab with an empty default draft", () => {
        expect(getTimerPageMode()).toBe("timer");
        expect(getQuickAddDraft()).toEqual(DEFAULT_QUICK_ADD_DRAFT);
        expect(DEFAULT_QUICK_ADD_DRAFT).toEqual({
            title: "",
            projectId: null,
            estimate: "1",
            notes: "",
            notesOpen: false,
        });
    });

    it("round-trips the mode and draft and notifies subscribers", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToQuickAddSession(listener);

        expect(setTimerPageMode("quick-add")).toBe("quick-add");
        expect(getTimerPageMode()).toBe("quick-add");

        const draft = { title: "Write report", projectId: "p1" as string | null, estimate: "3", notes: "Draft note", notesOpen: true };
        expect(setQuickAddDraft(draft)).toEqual(draft);
        expect(getQuickAddDraft()).toEqual(draft);
        expect(listener).toHaveBeenCalledTimes(2);

        setTimerPageMode("timer");
        expect(listener).toHaveBeenCalledTimes(3);
        unsubscribe();
    });

    it("keeps a null project id distinct from an absent one", () => {
        setQuickAddDraft({ ...DEFAULT_QUICK_ADD_DRAFT, projectId: null });
        expect(getQuickAddDraft().projectId).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(getQuickAddDraft(), "projectId")).toBe(true);
    });

    it("stops notifying after unsubscribe", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToQuickAddSession(listener);
        unsubscribe();
        setTimerPageMode("quick-add");
        expect(listener).not.toHaveBeenCalled();
        expect(getTimerPageMode()).toBe("quick-add");
    });

    it("resets the mode to timer and the draft to its default", () => {
        setTimerPageMode("quick-add");
        setQuickAddDraft({ title: "Half typed", projectId: "p1", estimate: "5", notes: "Keep me?", notesOpen: true });
        const listener = vi.fn();
        subscribeToQuickAddSession(listener);

        resetQuickAddSession();

        expect(getTimerPageMode()).toBe("timer");
        expect(getQuickAddDraft()).toEqual(DEFAULT_QUICK_ADD_DRAFT);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("never reads or writes browser storage", () => {
        const getItem = vi.spyOn(Storage.prototype, "getItem");
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        const removeItem = vi.spyOn(Storage.prototype, "removeItem");

        setTimerPageMode("quick-add");
        setQuickAddDraft({ title: "Task", projectId: "p1", estimate: "2", notes: "Notes", notesOpen: true });
        resetQuickAddSession();

        expect(getItem).not.toHaveBeenCalled();
        expect(setItem).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
    });
});
