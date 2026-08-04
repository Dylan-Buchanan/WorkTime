import { describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "./InMemoryDataAccess";
import { defaultSettings, makeAppState, makeActiveTimer } from "../../test/mockTauri";
import type { Habit, HabitCompletion } from "../../state/types";

function H(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: `Habit ${id}`,
        description: "",
        color: "#ffffff",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function HC(id: string, habitId: string, overrides: Partial<HabitCompletion> = {}): HabitCompletion {
    return {
        id,
        habitId,
        bucket: "2026-01-01",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("InMemoryDataAccess", () => {
    it("returns cloned state and keeps PM ui out of the server slice", async () => {
        const data = new InMemoryDataAccess();
        const created = await data.createTask("Task", 2);
        created.value.name = "mutated";
        expect((await data.fetchState()).state.tasks[created.value.id].name).toBe("Task");
        await data.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "now" } });
        expect(await data.loadPMState()).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "now" } });
    });

    it("allows one winner for concurrent completion", async () => {
        const state = makeAppState({
            active_task: "t1",
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
            timer: makeActiveTimer({ task_id: "t1", ends_at: "2026-01-01T00:00:10.000Z" }),
        });
        const options = { now: () => new Date("2026-01-01T00:01:00.000Z"), createLogId: () => "log-winner" };
        const store = { state, pmState: null, completed: false } as any;
        const first = new InMemoryDataAccess(store, options);
        const second = new InMemoryDataAccess(store, options);
        const results = await Promise.all([first.completeTimer(), second.completeTimer()]);
        expect(results.filter((result) => result.applied)).toHaveLength(1);
        expect(store.state.logs).toHaveLength(1);
        expect(store.state.logs[0].id).toBe("log-winner");
    });

    it("reconciles an expired timer once and ignores paused timers", async () => {
        const initial = makeAppState({ active_task: "t1", tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } }, timer: makeActiveTimer({ ends_at: "2026-01-01T00:00:10.000Z" }) });
        const data = new InMemoryDataAccess(initial, { now: () => new Date("2026-01-01T00:01:00.000Z"), createLogId: () => "log-reconciled" });
        expect((await data.fetchState()).reconciledTimer?.applied).toBe(true);
        expect(data.store.state.logs).toHaveLength(1);
        expect(data.store.state.logs[0].id).toBe("log-reconciled");
        expect((await data.fetchState()).reconciledTimer).toBeNull();
        const paused = new InMemoryDataAccess({ ...initial, timer: makeActiveTimer({ ends_at: "2026-01-01T00:00:10.000Z", paused: true }) }, { now: () => new Date("2026-01-01T00:01:00.000Z") });
        expect((await paused.fetchState()).reconciledTimer).toBeNull();
    });

    it("records sync calls, reports pending, and resets pending on success", async () => {
        const onSync = vi.fn();
        const data = new InMemoryDataAccess(makeAppState(), { onSync });
        expect(data.isInitialized()).toBe(true);
        expect(data.pendingCount()).toBe(0);

        await data.createTask("Task", 1);
        expect(data.pendingCount()).toBe(1);

        const result = await data.sync({ reason: "manual" });
        expect(onSync).toHaveBeenCalledWith({ reason: "manual" });
        expect(data.syncCalls).toEqual([{ reason: "manual" }]);
        expect(result.initialized).toBe(true);
        expect(result.pendingCount).toBe(0);
        expect(data.pendingCount()).toBe(0);
    });

    it("keeps pending when onSync rejects and passes best-effort flags through", async () => {
        const onSync = vi.fn(() => {
            throw new Error("network down");
        });
        const data = new InMemoryDataAccess(makeAppState(), { onSync });
        await data.updateSettings({ ...defaultSettings, work_minutes: 30 });
        await expect(data.sync({ reason: "pagehide", bestEffort: true })).rejects.toThrow("network down");
        expect(data.syncCalls).toEqual([{ reason: "pagehide", bestEffort: true }]);
        expect(data.pendingCount()).toBe(1);
    });

    it("notifies subscribers after local commands and on reloadFromStorage", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const listener = vi.fn();
        const unsubscribe = data.subscribe(listener);

        await data.createTask("Task", 1);
        expect(listener).toHaveBeenCalledTimes(1);

        data.reloadFromStorage();
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        await data.createTask("Again", 1);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("deletes tasks and logs through the extended interface", async () => {
        const log = { id: "log-1", task_id: "t1", duration_minutes: 25, finished_at: "2026-01-01T00:25:00.000Z", was_break: false, break_skipped: false };
        const data = new InMemoryDataAccess(makeAppState({ tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } }, logs: [log] }));

        await data.deleteTask("t1");
        expect((await data.fetchState()).state.tasks.t1).toBeUndefined();

        await data.deletePomodoroLog("log-1");
        expect((await data.fetchState()).state.logs).toHaveLength(0);

        await expect(data.deletePomodoroLog("missing")).rejects.toThrow(/Log not found/);
    });

    it("applies PM staging without touching the PM UI slice", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePMState({ projects: {}, tasks: {}, meta: { initializedAt: "now" } });
        expect(data.pendingCount()).toBe(1);
        await data.sync({ reason: "bootstrap" });
        expect(data.pendingCount()).toBe(0);
        expect(await data.loadPMState()).toEqual({ projects: {}, tasks: {}, meta: { initializedAt: "now" } });
    });

    it("round-trips habits and completions as clones with one pending item and one notification", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const listener = vi.fn();
        const unsubscribe = data.subscribe(listener);

        await data.saveHabits(
            [H("h1", { name: "Morning" })],
            [HC("c1", "h1", { bucket: "2026-01-02" })],
        );
        expect(listener).toHaveBeenCalledTimes(1);
        expect(data.pendingCount()).toBe(1);

        const loaded = await data.loadHabits();
        expect(loaded.habits).toEqual([H("h1", { name: "Morning" })]);
        expect(loaded.completions).toEqual([HC("c1", "h1", { bucket: "2026-01-02" })]);
        // Fresh clones: mutating the loaded arrays cannot mutate the store.
        loaded.habits[0].name = "mutated";
        loaded.completions[0].bucket = "mutated";
        expect(await data.loadHabits()).toEqual({
            habits: [H("h1", { name: "Morning" })],
            completions: [HC("c1", "h1", { bucket: "2026-01-02" })],
        });

        // A second save replaces the arrays and notifies exactly once.
        await data.saveHabits([], [HC("c2", "h1", { bucket: "2026-01-03" })]);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(data.pendingCount()).toBe(2);
        expect(await data.loadHabits()).toEqual({
            habits: [],
            completions: [HC("c2", "h1", { bucket: "2026-01-03" })],
        });

        unsubscribe();
        await data.saveHabits([], []);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
