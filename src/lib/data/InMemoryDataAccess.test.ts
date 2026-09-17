import { describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "./InMemoryDataAccess";
import { defaultSettings, makeAppState, makeActiveTimer } from "../../test/mockTauri";
import type {
    Habit,
    HabitCompletion,
    PetFixation,
    PetNapRecord,
    PetProfile,
    PetScheduleItem,
    PetTrainingSkill,
    PetWeightEntry,
} from "../../state/types";

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

    it("mirrors saved-progress resume and preserves local progress on discard", async () => {
        let now = new Date("2026-01-01T00:00:00.000Z");
        const state = makeAppState({
            active_task: "t1",
            tasks: {
                t1: {
                    id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0.4,
                    created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false,
                },
            },
        });
        const store = {
            state,
            inProgressPomodoros: { t1: 600, other: 300 },
            pmState: null,
            habits: [],
            habitCompletions: [],
            todos: [],
            todoCompletions: [],
            petActivityRecords: [],
            petProfile: null,
            petScheduleItems: [],
            petNapRecords: [],
            petWeightEntries: [],
            petTrainingSkills: [],
            petFixations: [],
            completed: false,
        };
        const data = new InMemoryDataAccess(store, {
            now: () => now,
            createLogId: () => "log-resumed",
        });

        const started = await data.startWorkTimer();
        expect(started.value.planned_secs).toBe(900);
        expect(data.store.inProgressPomodoros).toEqual({ t1: 600, other: 300 });
        now = new Date("2026-01-01T00:15:00.000Z");
        expect((await data.completeTimer(started.value)).applied).toBe(true);
        expect(data.store.state.tasks.t1.completed_pomodoros).toBe(1);
        expect(data.store.inProgressPomodoros).toEqual({ other: 300 });

        data.store.inProgressPomodoros = { retained: 450 };
        await data.discardPendingChanges();
        expect(data.store.inProgressPomodoros).toEqual({ retained: 450 });
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

    it("round-trips pet activity records as clones with one pending item", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const listener = vi.fn();
        data.subscribe(listener);
        const petRecord = {
            id: "pa1",
            activityType: "potty" as const,
            timestamp: "2026-01-01T10:00:00.000Z",
            createdAt: "2026-01-01T10:00:00.000Z",
        };

        await data.savePetActivityRecords([petRecord]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(data.pendingCount()).toBe(1);
        expect(await data.loadPetActivityRecords()).toEqual([petRecord]);

        const loaded = await data.loadPetActivityRecords();
        loaded[0].activityType = "feeding";
        expect((await data.loadPetActivityRecords())[0].activityType).toBe("potty");

        await data.savePetActivityRecords([]);
        expect(await data.loadPetActivityRecords()).toEqual([]);
    });

    it("round-trips the pet profile, schedule items, naps, and weight log as clones", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        expect(await data.loadPetProfile()).toBeNull();
        expect(await data.loadPetScheduleItems()).toEqual([]);
        expect(await data.loadPetNapRecords()).toEqual([]);
        expect(await data.loadPetWeightEntries()).toEqual([]);

        const profile: PetProfile = {
            id: "p1",
            name: "Whitney",
            birthDate: "2026-07-10",
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-01T10:00:00.000Z",
        };
        const item: PetScheduleItem = {
            id: "s1",
            activityType: "potty",
            label: "Potty",
            flexibility: "flexible",
            priority: 0,
            recurrence: { mode: "interval", minMinutes: 60, maxMinutes: 90 },
            isActive: true,
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-01T10:00:00.000Z",
        };
        const nap: PetNapRecord = {
            id: "n1",
            start: "2026-01-01T13:00:00.000Z",
            end: null,
            createdAt: "2026-01-01T13:00:00.000Z",
            updatedAt: "2026-01-01T13:00:00.000Z",
        };
        const weight: PetWeightEntry = {
            id: "w1",
            timestamp: "2026-01-01T10:00:00.000Z",
            weight: 4.2,
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-01T10:00:00.000Z",
        };

        await data.savePetProfile(profile);
        await data.savePetScheduleItems([item]);
        await data.savePetNapRecords([nap]);
        await data.savePetWeightEntries([weight]);

        const loadedProfile = await data.loadPetProfile();
        loadedProfile!.name = "Mutated";
        expect((await data.loadPetProfile())!.name).toBe("Whitney");

        const loadedItems = await data.loadPetScheduleItems();
        loadedItems[0].label = "Mutated";
        expect((await data.loadPetScheduleItems())[0].label).toBe("Potty");

        const loadedNaps = await data.loadPetNapRecords();
        loadedNaps[0].end = "2026-01-01T23:59:00.000Z";
        expect((await data.loadPetNapRecords())[0].end).toBeNull();

        const loadedWeights = await data.loadPetWeightEntries();
        loadedWeights[0].weight = 99;
        expect((await data.loadPetWeightEntries())[0].weight).toBe(4.2);

        // Full-set saves replace; null clears the profile.
        await data.savePetScheduleItems([]);
        await data.savePetNapRecords([]);
        await data.savePetWeightEntries([]);
        await data.savePetProfile(null);
        expect(await data.loadPetScheduleItems()).toEqual([]);
        expect(await data.loadPetNapRecords()).toEqual([]);
        expect(await data.loadPetWeightEntries()).toEqual([]);
        expect(await data.loadPetProfile()).toBeNull();
    });

    it("round-trips training skills and fixations as clones", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        expect(await data.loadPetTrainingSkills()).toEqual([]);
        expect(await data.loadPetFixations()).toEqual([]);

        const skill: PetTrainingSkill = {
            id: "k1",
            label: "Sit",
            notes: "",
            status: "introduced",
            resolvedAt: null,
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-01T10:00:00.000Z",
        };
        const fixation: PetFixation = {
            id: "f1",
            label: "Chasing the vacuum",
            notes: "",
            resolvedAt: null,
            resolutionNote: "",
            createdAt: "2026-01-01T10:00:00.000Z",
            updatedAt: "2026-01-01T10:00:00.000Z",
        };

        await data.savePetTrainingSkills([skill]);
        await data.savePetFixations([fixation]);

        const loadedSkills = await data.loadPetTrainingSkills();
        loadedSkills[0].status = "reliable";
        expect((await data.loadPetTrainingSkills())[0].status).toBe("introduced");

        const loadedFixations = await data.loadPetFixations();
        loadedFixations[0].label = "Mutated";
        expect((await data.loadPetFixations())[0].label).toBe("Chasing the vacuum");

        await data.savePetTrainingSkills([]);
        await data.savePetFixations([]);
        expect(await data.loadPetTrainingSkills()).toEqual([]);
        expect(await data.loadPetFixations()).toEqual([]);
    });
});
