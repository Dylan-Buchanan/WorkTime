import { describe, expect, it } from "vitest";
import { InMemoryDataAccess } from "./InMemoryDataAccess";
import { makeAppState, makeActiveTimer } from "../../test/mockTauri";

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
});
