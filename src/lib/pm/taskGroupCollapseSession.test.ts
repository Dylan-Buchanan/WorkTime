import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getCollapsedTaskGroups,
    resetTaskGroupCollapseSession,
    subscribeToTaskGroupCollapseSession,
    toggleTaskGroupCollapsed,
} from "./taskGroupCollapseSession";

beforeEach(() => {
    resetTaskGroupCollapseSession();
    vi.restoreAllMocks();
});

describe("taskGroupCollapseSession", () => {
    it("starts with an empty map so every group renders expanded", () => {
        expect(getCollapsedTaskGroups()).toEqual({});
    });

    it("round-trips a group key through two toggles", () => {
        expect(toggleTaskGroupCollapsed("p1")).toEqual({ p1: true });
        expect(getCollapsedTaskGroups()).toEqual({ p1: true });

        expect(toggleTaskGroupCollapsed("p1")).toEqual({ p1: false });
        expect(getCollapsedTaskGroups()).toEqual({ p1: false });
    });

    it("keeps independent keys from interfering with each other", () => {
        toggleTaskGroupCollapsed("p1");

        expect(toggleTaskGroupCollapsed("p2")).toEqual({ p1: true, p2: true });
        expect(toggleTaskGroupCollapsed("__no_project__")).toEqual({ p1: true, p2: true, __no_project__: true });

        toggleTaskGroupCollapsed("p1");
        expect(getCollapsedTaskGroups()).toEqual({ p1: false, p2: true, __no_project__: true });
    });

    it("notifies subscribers on change and stops after unsubscribe", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToTaskGroupCollapseSession(listener);

        toggleTaskGroupCollapsed("p1");
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        toggleTaskGroupCollapsed("p2");
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("resets every key and publishes once", () => {
        toggleTaskGroupCollapsed("p1");
        toggleTaskGroupCollapsed("__no_project__");
        const listener = vi.fn();
        subscribeToTaskGroupCollapseSession(listener);

        resetTaskGroupCollapseSession();

        expect(getCollapsedTaskGroups()).toEqual({});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("never reads or writes browser storage", () => {
        const getItem = vi.spyOn(Storage.prototype, "getItem");
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        const removeItem = vi.spyOn(Storage.prototype, "removeItem");

        toggleTaskGroupCollapsed("p1");
        toggleTaskGroupCollapsed("__no_project__");
        resetTaskGroupCollapseSession();

        expect(getItem).not.toHaveBeenCalled();
        expect(setItem).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
    });
});
