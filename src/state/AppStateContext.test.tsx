import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppStateProvider, resetNotifyForTesting, useAppState } from "./AppStateContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { stagingKey } from "../lib/data/staging/LocalStagingStore";
import { makeAppState, makeActiveTimer } from "../test/mockTauri";
import { useLayoutEffect } from "react";
import type { TimerTransitionEvent } from "./timerTransitions";
import { windowStartedAt } from "../lib/engine";

// These tests subscribe before hydration, and drive the real engine through the
// context. Only Date is faked: React effects and waitFor keep their normal clock.
describe("timer transition events", () => {
    const W = "2026-11-09T14:00:00.000Z";
    const at = (minutes: number) => new Date(Date.parse(W) + minutes * 60_000).toISOString();
    const time = (minutes: number) => vi.setSystemTime(new Date(at(minutes)));
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); time(0); });
    afterEach(() => vi.useRealTimers());

    async function setup(kind: "Work" | "ShortBreak" | "LongBreak" | null = "Work", paused = false,
        prepare?: (data: ContextFakeDataAccess) => void | Promise<void>) {
        let id = 0;
        const data = new ContextFakeDataAccess(makeAppState({
            tasks: Object.fromEntries(["A", "B", "C"].map(taskId => [taskId, {
                id: taskId, name: taskId, target_pomodoros: 4, completed_pomodoros: 0,
                created_at: W, completed_at: null, break_skips: 0, archived: false,
            }])), active_task: "A",
        }), { createLogId: () => `transition-log-${++id}`, createTaskId: () => `created-${++id}` });
        if (kind === "Work") await data.startWorkTimer();
        if (kind === "ShortBreak" || kind === "LongBreak") {
            if (kind === "LongBreak") data.store.state.current_cycle_pomodoros = 4;
            await data.startBreakTimer();
        }
        if (paused) await data.pauseTimer();
        await prepare?.(data);
        const events: TimerTransitionEvent[] = [];
        let current!: ReturnType<typeof useAppState>;
        function Capture() {
            current = useAppState();
            const subscribe = current.subscribeTimerTransitions;
            useLayoutEffect(() => subscribe(event => events.push(event)), [subscribe]);
            return null;
        }
        const view = render(wrap(data, <Capture />));
        await waitFor(() => expect(current.state).not.toBeNull());
        return { data, events, app: () => current, ...view };
    }

    it("publishes pause after its real same-tab revision refresh adopts the committed timer first", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            active_task: "A", timer: makeActiveTimer({ task_id: "A", started_at: W, window_started_at: W, ends_at: at(25) }),
        }));
        const events: TimerTransitionEvent[] = [];
        let current!: ReturnType<typeof useAppState>;
        let pending!: Promise<void>;
        function Capture() {
            current = useAppState();
            const subscribe = current.subscribeTimerTransitions;
            useLayoutEffect(() => subscribe(event => events.push(event)), [subscribe]);
            return <button onClick={() => { pending = current.pauseTimer(); }}>pause with revision</button>;
        }
        render(wrap(data, <Capture />));
        await waitFor(() => expect(current.state?.timer?.paused).toBe(false));
        const pause = data.pauseTimer.bind(data);
        const fetch = vi.spyOn(data, "fetchState");
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(data, "pauseTimer").mockImplementation(async () => {
            const result = await pause(); // Real data subscriber -> SyncProvider revision -> refresh.
            await gate;
            return result;
        });
        time(3);
        fireEvent.click(screen.getByRole("button", { name: "pause with revision" }));
        // No explicit refresh: the command's own revision adopts its paused
        // result while the publisher still holds the running "before" timer.
        await waitFor(() => expect(current.state?.timer?.paused).toBe(true));
        expect(fetch).toHaveBeenCalled();
        expect(events).toEqual([]);
        await act(async () => { release(); await pending; });
        expect(events).toEqual([{ type: "leave", taskId: "A", reason: "pause", at: at(3), windowId: W }]);
    });

    it("publishes a pause scheduled by a switch-enter listener between command continuations", async () => {
        const c = await setup();
        const retainedPause = c.app().pauseTimer;
        let pendingPause: Promise<void> | undefined;
        c.app().subscribeTimerTransitions(event => {
            if (event.type === "enter" && event.reason === "switch") {
                queueMicrotask(() => { pendingPause = retainedPause(); });
            }
        });
        time(3);
        await act(async () => {
            await c.app().setActiveTask("B");
            await pendingPause;
        });
        expect(c.events).toEqual([
            { type: "leave", taskId: "A", reason: "switch", at: at(3), windowId: W },
            { type: "enter", taskId: "B", reason: "switch", at: at(3), windowId: W, fromTaskId: "A" },
            { type: "leave", taskId: "B", reason: "pause", at: at(3), windowId: W },
        ]);
        expect(c.app().state?.timer?.paused).toBe(true);
    });

    it.each(["started_at", "ends_at"] as const)("discards a pause episode when a sub-second remote re-pause changes %s", async field => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        const paused = { ...c.data.store.state.timer! };
        c.data.store.state.timer![field] = new Date(Date.parse(paused[field]) + 100).toISOString();
        await act(async () => { await c.app().refresh(); });
        expect(c.app().state?.timer).toMatchObject({
            window_started_at: W, paused: true,
            accumulated_secs: paused.accumulated_secs,
            paused_remaining_secs: paused.paused_remaining_secs,
        });
        c.events.length = 0;
        await act(async () => { await c.app().stopWork(); });
        expect(c.events).toEqual([{ type: "leave", taskId: "A", reason: "stop", at: at(3), windowId: W }]);
    });

    it("silences a stale stop captured before an unawaited switch", async () => {
        const c = await setup();
        time(3);
        await act(async () => {
            await Promise.all([c.app().setActiveTask("B"), c.app().stopWork()]);
        });
        expect(c.events.filter(event => event.reason === "stop")).toEqual([]);
        expect(c.app().state?.timer).toBeNull();
    });

    it("carries pausedAt after handoff resume's real same-tab revision refresh adopts running Work first", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: Object.fromEntries(["A", "B"].map(id => [id, {
                id, name: id, target_pomodoros: 4, completed_pomodoros: 0,
                created_at: W, completed_at: null, break_skips: 0, archived: false,
            }])),
            active_task: "A", timer: makeActiveTimer({ task_id: "A", started_at: W, window_started_at: W, ends_at: at(25) }),
        }));
        const events: TimerTransitionEvent[] = [];
        let current!: ReturnType<typeof useAppState>;
        let pending!: Promise<void>;
        function Capture() {
            current = useAppState();
            const subscribe = current.subscribeTimerTransitions;
            useLayoutEffect(() => subscribe(event => events.push(event)), [subscribe]);
            return <button onClick={() => { pending = current.resumeTimer({ handoff: true }); }}>handoff with revision</button>;
        }
        render(wrap(data, <Capture />));
        await waitFor(() => expect(current.state?.timer?.paused).toBe(false));
        time(3);
        await act(async () => { await current.pauseTimer(); });
        expect(events).toEqual([{ type: "leave", taskId: "A", reason: "pause", at: at(3), windowId: W }]);
        events.length = 0;
        const resume = data.resumeTimer.bind(data);
        const fetch = vi.spyOn(data, "fetchState");
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(data, "resumeTimer").mockImplementation(async () => {
            const result = await resume();
            await gate;
            return result;
        });
        time(4);
        fireEvent.click(screen.getByRole("button", { name: "handoff with revision" }));
        await waitFor(() => expect(current.state?.timer?.paused).toBe(false));
        expect(fetch).toHaveBeenCalled();
        expect(events).toEqual([]);
        await act(async () => { release(); await pending; });
        expect(events).toEqual([]);
        time(5);
        await act(async () => { await current.setActiveTask("B"); });
        expect(events).toEqual([
            { type: "leave", taskId: "A", reason: "switch", at: at(5), windowId: W, pausedAt: at(3) },
            { type: "enter", taskId: "B", reason: "switch", at: at(5), windowId: W, fromTaskId: "A" },
        ]);
    });

    it.each(["pause", "resume", "handoff-resume", "stop", "start"] as const)(
        "keeps %s current when refresh adopts identical and own-write state before adoption", async command => {
            const c = await setup(command === "start" ? null : "Work");
            if (command.includes("resume")) {
                time(2);
                await act(async () => { await c.app().pauseTimer(); });
                c.events.length = 0;
            }
            const method = { pause: "pauseTimer", resume: "resumeTimer", "handoff-resume": "resumeTimer", stop: "stopWorkTimer", start: "startWorkTimer" }[command] as
                "pauseTimer" | "resumeTimer" | "stopWorkTimer" | "startWorkTimer";
            let release!: () => void;
            let invoked!: () => void;
            let commit!: () => void;
            let committed!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const invokedGate = new Promise<void>(resolve => { invoked = resolve; });
            const commitGate = new Promise<void>(resolve => { commit = resolve; });
            const committedGate = new Promise<void>(resolve => { committed = resolve; });
            const deferred = <T,>(run: () => Promise<T>) => async () => {
                invoked();
                await commitGate;
                const result = await run();
                committed();
                await gate;
                return result;
            };
            const pause = c.data.pauseTimer.bind(c.data);
            const resume = c.data.resumeTimer.bind(c.data);
            const stop = c.data.stopWorkTimer.bind(c.data);
            const start = c.data.startWorkTimer.bind(c.data);
            if (method === "pauseTimer") vi.spyOn(c.data, method).mockImplementation(deferred(pause));
            if (method === "resumeTimer") vi.spyOn(c.data, method).mockImplementation(deferred(resume));
            if (method === "stopWorkTimer") vi.spyOn(c.data, method).mockImplementation(deferred(stop));
            if (method === "startWorkTimer") vi.spyOn(c.data, method).mockImplementation(deferred(start));
            time(3);
            await act(async () => {
                const app = c.app();
                const pending = command === "handoff-resume" ? app.resumeTimer({ handoff: true }) :
                    { pause: app.pauseTimer, resume: app.resumeTimer, stop: app.stopWork, start: app.startWork, "handoff-resume": app.resumeTimer }[command]();
                await invokedGate;
                await c.app().refresh(); // Identical pre-command state.
                commit();
                await committedGate;
                await c.app().refresh(); // This command's own committed state.
                expect(c.events).toEqual([]);
                release();
                await pending;
            });
            const reason = command === "handoff-resume" ? null : command;
            expect(c.events).toEqual(reason ? [{
                type: command === "pause" || command === "stop" ? "leave" : "enter",
                taskId: "A", reason, at: at(3), windowId: command === "start" ? at(3) : W,
            }] : []);
            if (command === "handoff-resume") {
                time(5);
                await act(async () => { await c.app().setActiveTask("B"); });
                expect(c.events[0]).toMatchObject({ type: "leave", taskId: "A", reason: "switch", pausedAt: at(2) });
            }
        });

    it("publishes exactly one leave for A across overlapping switches", async () => {
        const c = await setup();
        time(3);
        await act(async () => {
            await Promise.all([c.app().setActiveTask("B"), c.app().setActiveTask("C")]);
        });
        expect(c.events.filter(event => event.type === "leave" && event.taskId === "A")).toHaveLength(1);
        expect(c.events).toHaveLength(2);
        expect(c.app().state?.timer?.task_id).toBe("C");
    });

    it("does not publish a second switch pair for an overlapping unrelated finalize", async () => {
        const c = await setup();
        time(3);
        await act(async () => {
            await Promise.all([c.app().setActiveTask("B"), c.app().finalizeTask("C")]);
        });
        expect(c.events).toEqual([
            { type: "leave", taskId: "A", reason: "switch", at: at(3), windowId: W },
            { type: "enter", taskId: "B", reason: "switch", at: at(3), windowId: W, fromTaskId: "A" },
        ]);
        expect(c.app().state?.tasks.C.archived).toBe(true);
    });

    it.each(["pause", "resume", "handoff-resume", "stop", "start"] as const)(
        "silences %s when refresh replaces its timer before adoption", async command => {
            const c = await setup(command === "start" ? null : "Work");
            if (command.includes("resume")) {
                time(2);
                await act(async () => { await c.app().pauseTimer(); });
                c.events.length = 0;
            }
            const method = { pause: "pauseTimer", resume: "resumeTimer", "handoff-resume": "resumeTimer", stop: "stopWorkTimer", start: "startWorkTimer" }[command] as
                "pauseTimer" | "resumeTimer" | "stopWorkTimer" | "startWorkTimer";
            let release!: () => void;
            let committed!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const committedGate = new Promise<void>(resolve => { committed = resolve; });
            const deferred = <T,>(run: () => Promise<T>) => async () => {
                const result = await run();
                committed();
                await gate;
                return result;
            };
            if (method === "pauseTimer") {
                const run = deferred(c.data.pauseTimer.bind(c.data));
                vi.spyOn(c.data, method).mockImplementation(run);
            }
            if (method === "resumeTimer") {
                const run = deferred(c.data.resumeTimer.bind(c.data));
                vi.spyOn(c.data, method).mockImplementation(run);
            }
            if (method === "stopWorkTimer") {
                const run = deferred(c.data.stopWorkTimer.bind(c.data));
                vi.spyOn(c.data, method).mockImplementation(run);
            }
            if (method === "startWorkTimer") {
                const run = deferred(c.data.startWorkTimer.bind(c.data));
                vi.spyOn(c.data, method).mockImplementation(run);
            }
            time(3);
            await act(async () => {
                const app = c.app();
                const pending = command === "handoff-resume" ? app.resumeTimer({ handoff: true }) :
                    { pause: app.pauseTimer, resume: app.resumeTimer, stop: app.stopWork, start: app.startWork, "handoff-resume": app.resumeTimer }[command]();
                await committedGate;
                c.data.store.state.timer = makeActiveTimer({ task_id: "B", started_at: W, window_started_at: W, ends_at: at(25) });
                await c.app().refresh();
                release();
                await pending;
            });
            expect(c.events).toEqual([]);
            expect(c.app().state?.timer?.task_id ?? null).toBe(command === "stop" ? null : "A");
            if (command === "pause") {
                await act(async () => { await c.app().stopWork(); });
                expect(c.events[0]).not.toHaveProperty("pausedAt");
            }
            if (command === "handoff-resume") {
                c.data.store.state.timer = structuredClone(c.app().state!.timer);
                time(5);
                await act(async () => { await c.app().refresh(); await c.app().setActiveTask("C"); });
                expect(c.events[0]).toMatchObject({ type: "leave", taskId: "A", reason: "switch" });
                expect(c.events[0]).not.toHaveProperty("pausedAt");
            }
        });

    it.each(["task-start", "break-end"] as const)("silences a stale %s direct adoption", async origin => {
        const c = await setup(origin === "task-start" ? null : "ShortBreak");
        const start = c.data.startWorkTimer.bind(c.data);
        let release!: () => void;
        let committed!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const committedGate = new Promise<void>(resolve => { committed = resolve; });
        vi.spyOn(c.data, "startWorkTimer").mockImplementation(async () => {
            const result = await start();
            committed();
            await gate;
            return result;
        });
        time(5);
        await act(async () => {
            const pending = origin === "task-start" ? c.app().startTaskWork("A") : c.app().completeTimer();
            await committedGate;
            c.data.store.state.timer!.task_id = "B";
            await c.app().refresh();
            release();
            await pending;
        });
        expect(c.events).toEqual([]);
    });

    it("does not resurrect a handoff episode invalidated by an in-flight archive", async () => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        const resume = c.data.resumeTimer.bind(c.data);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(c.data, "resumeTimer").mockImplementation(async () => {
            await gate;
            return resume();
        });
        time(4);
        await act(async () => {
            const pending = c.app().resumeTimer({ handoff: true });
            await c.app().archiveTask("C");
            release();
            await pending;
        });
        c.events.length = 0;
        time(5);
        await act(async () => { await c.app().setActiveTask("B"); });
        expect(c.events).toHaveLength(2);
        expect(c.events[0]).toMatchObject({ type: "leave", taskId: "A", reason: "switch" });
        expect(c.events[0]).not.toHaveProperty("pausedAt");
    });

    it.each(["accumulated_secs", "paused_remaining_secs"] as const)("discards a pause episode when refresh changes %s", async field => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        c.data.store.state.timer![field]! += 30;
        await act(async () => { await c.app().refresh(); });
        c.events.length = 0;
        await act(async () => { await c.app().stopWork(); });
        expect(c.events).toHaveLength(1);
        expect(c.events[0]).toMatchObject({ reason: "stop", taskId: "A" });
        expect(c.events[0]).not.toHaveProperty("pausedAt");
    });

    it("publishes the worked pause/resume payloads through retained callbacks in the adopted window", async () => {
        const c = await setup();
        const { pauseTimer, resumeTimer, subscribeTimerTransitions } = c.app();
        time(3);
        await act(async () => { await pauseTimer(); await pauseTimer(); });
        time(4);
        await act(async () => { await resumeTimer(); await resumeTimer(); });
        expect(c.events).toEqual([
            { type: "leave", taskId: "A", reason: "pause", at: at(3), windowId: W },
            { type: "enter", taskId: "A", reason: "resume", at: at(4), windowId: W },
        ]);
        expect(c.app().state?.timer).toMatchObject({ paused: false, window_started_at: W });
        expect(c.app().subscribeTimerTransitions).toBe(subscribeTimerTransitions);
    });

    it.each(["ShortBreak", "LongBreak"] as const)("keeps %s pause, resume, selection and skip silent", async kind => {
        const c = await setup(kind);
        await act(async () => {
            await c.app().pauseTimer(); await c.app().resumeTimer();
            await c.app().setActiveTask("B"); await c.app().skipBreak();
        });
        expect(c.events).toEqual([]);
    });

    it.each([false, true])("stops zero-elapsed Work with paused=%s", async paused => {
        const c = await setup("Work", paused);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events).toEqual([{ type: "leave", taskId: "A", reason: "stop", at: W, windowId: W }]);
    });

    it.each([false, true])("stops positive-elapsed Work with paused=%s", async paused => {
        const c = await setup();
        time(3);
        if (paused) await act(async () => { await c.app().pauseTimer(); });
        c.events.length = 0;
        time(5);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events).toEqual([{
            type: "leave", taskId: "A", reason: "stop", at: at(5), windowId: W,
            ...(paused ? { pausedAt: at(3) } : {}),
        }]);
    });

    it.each(["stop", "start", "pause", "resume"] as const)("keeps rejected %s silent and preserves its error behavior", async command => {
        const c = await setup(command === "start" ? null : "Work", command === "resume");
        const method = { stop: "stopWorkTimer", start: "startWorkTimer", pause: "pauseTimer", resume: "resumeTimer" }[command] as
            "stopWorkTimer" | "startWorkTimer" | "pauseTimer" | "resumeTimer";
        vi.spyOn(c.data, method).mockRejectedValue(new Error(`${command} failed`));
        const before = c.app().state;
        await act(async () => {
            const pending = { stop: c.app().stopWork, start: c.app().startWork, pause: c.app().pauseTimer, resume: c.app().resumeTimer }[command]();
            if (command === "pause" || command === "resume") await expect(pending).rejects.toThrow(`${command} failed`);
            else await expect(pending).resolves.toBeUndefined();
        });
        expect(c.events).toEqual([]);
        expect(c.app().state).toBe(before);
        expect(c.app().error).toBe(`${command} failed`);
    });

    it("publishes one start from public startWork using the returned Work timer", async () => {
        const c = await setup(null);
        time(6);
        await act(async () => { await c.app().startWork(); });
        expect(c.events).toEqual([{ type: "enter", taskId: "A", reason: "start", at: at(6), windowId: at(6) }]);
    });

    it("publishes only actual transitions for simultaneous queued free starts", async () => {
        const c = await setup(null);
        const start = vi.spyOn(c.data, "startWorkTimer");
        await act(async () => {
            expect(await Promise.all([c.app().startTaskWork("B"), c.app().startTaskWork("C"), c.app().startTaskWork("C")]))
                .toEqual(["started", "joined", "joined"]);
        });
        expect(start).toHaveBeenCalledOnce();
        expect(c.events).toEqual([
            { type: "enter", taskId: "B", reason: "start", at: W, windowId: W },
            { type: "enter", taskId: "C", reason: "switch", at: W, windowId: W, fromTaskId: "B" },
        ]);
    });

    it.each([false, true])("orders a positive-elapsed switch pair and preserves paused=%s", async paused => {
        const c = await setup();
        time(3);
        if (paused) await act(async () => { await c.app().pauseTimer(); });
        c.events.length = 0;
        time(5);
        const start = vi.spyOn(c.data, "startWorkTimer");
        await act(async () => { expect(await c.app().startTaskWork("B")).toBe("joined"); });
        expect(c.events).toEqual([
            { type: "leave", taskId: "A", reason: "switch", at: at(5), windowId: W, ...(paused ? { pausedAt: at(3) } : {}) },
            { type: "enter", taskId: "B", reason: "switch", at: at(5), windowId: W, fromTaskId: "A" },
        ]);
        expect(start).not.toHaveBeenCalled();
        expect(c.app().state?.timer?.paused).toBe(paused);
        c.events.length = 0;
        await act(async () => { await c.app().setActiveTask("B"); await c.app().startTaskWork("B"); });
        expect(c.events).toEqual([]);
        // B cannot inherit A's pause even though this handover remains paused.
        await act(async () => { await c.app().stopWork(); });
        expect(c.events[0]).not.toHaveProperty("pausedAt");
    });

    it.each([false, true])("publishes only an enter on a zero-elapsed switch with paused=%s", async paused => {
        const c = await setup();
        if (paused) await act(async () => { await c.app().pauseTimer(); });
        c.events.length = 0;
        await act(async () => { await c.app().setActiveTask("B"); });
        expect(c.events).toEqual([{ type: "enter", taskId: "B", reason: "switch", at: W, windowId: W, fromTaskId: "A" }]);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events[1]).not.toHaveProperty("pausedAt");
    });

    it.each(["other-task", "break", "other-window", "reused-id", "no-growth", "old-prefix"])(
        "does not qualify %s log evidence as outgoing Work", async evidence => {
            const c = await setup();
            const before = structuredClone(c.app().state!);
            const row = { id: "existing", task_id: "A", duration_minutes: 3, finished_at: at(3), was_break: false, break_skipped: false, work_window_id: W };
            c.data.store.state.logs = [row];
            await act(async () => { await c.app().refresh(); });
            const after = structuredClone(c.app().state!);
            after.timer = { ...before.timer!, task_id: "B" };
            after.active_task = "C"; // Incoming identity must come from timer, not selection.
            const candidate = { ...row, id: "new" };
            if (evidence === "other-task") candidate.task_id = "C";
            if (evidence === "break") candidate.was_break = true;
            if (evidence === "other-window") candidate.work_window_id = at(1);
            if (evidence === "reused-id") candidate.id = "existing";
            if (evidence === "old-prefix") { after.logs[0] = { ...candidate }; candidate.task_id = "C"; }
            if (evidence !== "no-growth") after.logs.push(candidate);
            vi.spyOn(c.data, "setActiveTask").mockResolvedValue({ state: after, value: undefined });
            await act(async () => { await c.app().setActiveTask("B"); });
            expect(c.events).toEqual([{ type: "enter", taskId: "B", reason: "switch", at: W, windowId: W, fromTaskId: "A" }]);
        });

    it.each([false, true])("keeps depleted handover silent and starts one break with paused=%s", async paused => {
        const c = await setup("Work", paused);
        if (paused) {
            c.data.store.state.timer!.accumulated_secs = 1500;
            c.data.store.state.timer!.paused_remaining_secs = 0;
            await act(async () => { await c.app().refresh(); });
        } else time(25);
        const breaks = vi.spyOn(c.data, "startBreakTimer");
        await act(async () => { await c.app().startTaskWork("B"); });
        expect(c.events).toEqual([]);
        expect(breaks).toHaveBeenCalledOnce();
        expect(c.app().state?.timer?.kind).toBe("ShortBreak");
    });

    it.each([0, 3, 25])("keeps finalize on live Work silent at %s minutes", async minutes => {
        const c = await setup();
        time(minutes);
        await act(async () => { await c.app().finalizeTask("A"); });
        expect(c.events).toEqual([]);
        expect(c.app().state?.tasks.A.archived).toBe(true);
    });

    it("keeps create, archive, reset and opening a break silent", async () => {
        const c = await setup(null);
        await act(async () => {
            await c.app().createTask("New", 2); await c.app().archiveTask("B");
            await c.app().startBreak(); await c.app().resetAll();
        });
        expect(c.events).toEqual([]);
    });

    it.each(["live", "paused", "expired-work", "expired-break"])("keeps the mounted %s snapshot silent", async snapshot => {
        const c = await setup(snapshot === "expired-break" ? "ShortBreak" : "Work", snapshot === "paused", () => {
            if (snapshot.startsWith("expired")) time(25);
        });
        await waitFor(() => expect(c.app().state?.timer?.kind).toBe(snapshot === "expired-work" ? "ShortBreak" : "Work"));
        expect(c.events).toEqual([]);
    });

    it("keeps revision refresh and break reconciliation auto-start silent", async () => {
        const c = await setup("ShortBreak");
        c.data.store.state.active_task = "B";
        time(5);
        act(() => c.data.bumpRevision());
        await waitFor(() => expect(c.app().state?.timer).toMatchObject({ kind: "Work", task_id: "B" }));
        expect(c.events).toEqual([]);
    });

    it("keeps natural Work completion silent, then publishes the selected next task at local break-end", async () => {
        const c = await setup();
        time(25);
        await act(async () => { await c.app().completeTimer(); });
        expect(c.events).toEqual([]);
        expect(c.app().state?.timer?.kind).toBe("ShortBreak");
        await act(async () => { await c.app().setActiveTask("B"); });
        time(30);
        await act(async () => { await c.app().completeTimer(); });
        expect(c.events).toEqual([{ type: "enter", taskId: "B", reason: "break-end", at: at(30), windowId: at(30) }]);
    });

    it.each(["ShortBreak", "LongBreak"] as const)("publishes one local %s completion enter", async kind => {
        const c = await setup(kind);
        const minutes = kind === "ShortBreak" ? 5 : 20;
        time(minutes);
        await act(async () => { await c.app().completeTimer(); });
        expect(c.events).toEqual([{ type: "enter", taskId: "A", reason: "break-end", at: at(minutes), windowId: at(minutes) }]);
    });

    it.each(["failure", "wrong-task", "no-work", "loser"])("keeps break auto-start %s silent", async outcome => {
        const c = await setup("ShortBreak");
        time(5);
        if (outcome === "failure") vi.spyOn(c.data, "startWorkTimer").mockRejectedValue(new Error("auto-start failed"));
        if (outcome === "wrong-task" || outcome === "no-work") {
            const start = c.data.startWorkTimer.bind(c.data);
            vi.spyOn(c.data, "startWorkTimer").mockImplementation(async () => {
                const result = await start();
                if (outcome === "wrong-task") result.state.timer!.task_id = "B";
                else result.state.timer = null;
                return result;
            });
        }
        if (outcome === "loser") {
            const complete = c.data.completeTimer.bind(c.data);
            vi.spyOn(c.data, "completeTimer").mockImplementation(async timer => ({ ...await complete(timer), applied: false }));
        }
        await act(async () => { await c.app().completeTimer(); });
        expect(c.events).toEqual([]);
        if (outcome === "failure") expect(c.app().error).toBe("auto-start failed");
    });

    it("uses a historical Work window fallback across pause and resume", async () => {
        const c = await setup("Work", false, data => {
            delete data.store.state.timer!.window_started_at;
            data.store.state.timer!.started_at = at(1);
            data.store.state.timer!.accumulated_secs = 60;
            time(3);
        });
        expect(windowStartedAt(c.app().state!.timer!)).toBe(W);
        await act(async () => { await c.app().pauseTimer(); await c.app().resumeTimer(); });
        expect(c.events.map(event => event.windowId)).toEqual([W, W]);
    });

    it("does not manufacture a pause reference for a cold paused timer", async () => {
        const c = await setup("Work", true);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events[0]).not.toHaveProperty("pausedAt");
    });

    it("clears a plain-resume episode and replaces it with a later pause", async () => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        time(4);
        await act(async () => { await c.app().resumeTimer(); });
        expect(c.events[1]).toEqual({ type: "enter", taskId: "A", reason: "resume", at: at(4), windowId: W });
        time(5);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events[2]).not.toHaveProperty("pausedAt");
        time(6);
        await act(async () => { await c.app().startWork(); });
        time(7);
        await act(async () => { await c.app().pauseTimer(); });
        time(8);
        await act(async () => { await c.app().resumeTimer(); });
        time(9);
        await act(async () => { await c.app().pauseTimer(); await c.app().stopWork(); });
        expect(c.events[c.events.length - 1]).toMatchObject({ reason: "stop", pausedAt: at(9), windowId: at(6) });
    });

    it.each(["task", "window", "resumed"])("discards obsolete pause linkage after a %s refresh", async changed => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        if (changed === "task") c.data.store.state.timer!.task_id = "B";
        if (changed === "window") c.data.store.state.timer!.window_started_at = at(1);
        if (changed === "resumed") c.data.store.state.timer!.paused = false;
        await act(async () => { await c.app().refresh(); });
        // Return to A/W paused; snapshot adoption must not resurrect the episode.
        c.data.store.state.timer = { ...c.data.store.state.timer!, task_id: "A", window_started_at: W, paused: true };
        await act(async () => { await c.app().refresh(); await c.app().stopWork(); });
        expect(c.events).toHaveLength(2);
        expect(c.events[1]).not.toHaveProperty("pausedAt");
    });

    it("preserves a pause reference through failed resume, stop and switch commands", async () => {
        const c = await setup();
        time(3);
        vi.spyOn(c.data, "pauseTimer").mockRejectedValueOnce(new Error("pause failed"));
        await act(async () => { await expect(c.app().pauseTimer()).rejects.toThrow("pause failed"); });
        expect(c.events).toEqual([]);
        await act(async () => { await c.app().pauseTimer(); });
        vi.spyOn(c.data, "resumeTimer").mockRejectedValueOnce(new Error("resume failed"));
        vi.spyOn(c.data, "stopWorkTimer").mockRejectedValueOnce(new Error("stop failed"));
        vi.spyOn(c.data, "setActiveTask").mockRejectedValueOnce(new Error("switch failed"));
        await act(async () => {
            await expect(c.app().resumeTimer()).rejects.toThrow("resume failed");
            await c.app().stopWork();
            await expect(c.app().setActiveTask("B")).rejects.toThrow("switch failed");
        });
        expect(c.events).toHaveLength(1);
        time(5);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events[1]).toMatchObject({ reason: "stop", pausedAt: at(3) });
    });

    it("carries the worked pause episode through a silent handoff resume into a positive join", async () => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        c.events.length = 0;
        time(4);
        await act(async () => { await c.app().resumeTimer({ handoff: true }); });
        expect(c.events).toEqual([]);
        // Same-view refresh is permitted between the handoff's two commands.
        await act(async () => { await c.app().refresh(); });
        time(5);
        await act(async () => { expect(await c.app().startTaskWork("B")).toBe("joined"); });
        expect(c.events).toEqual([
            { type: "leave", taskId: "A", reason: "switch", at: at(5), windowId: W, pausedAt: at(3) },
            { type: "enter", taskId: "B", reason: "switch", at: at(5), windowId: W, fromTaskId: "A" },
        ]);
    });

    it("discards a cancelled handoff episode when running Work is later stopped", async () => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); await c.app().resumeTimer({ handoff: true }); });
        c.events.length = 0;
        time(5);
        await act(async () => { await c.app().stopWork(); });
        expect(c.events).toEqual([{ type: "leave", taskId: "A", reason: "stop", at: at(5), windowId: W }]);
    });

    it.each(["zero", "same-occupant", "archive", "create", "settings", "different-window", "different-task"])(
        "discards a carried episode after %s before a later switch", async intervening => {
            const c = await setup();
            if (intervening !== "zero") time(3);
            await act(async () => { await c.app().pauseTimer(); await c.app().resumeTimer({ handoff: true }); });
            c.events.length = 0;
            await act(async () => {
                if (intervening === "zero") await c.app().setActiveTask("B");
                if (intervening === "same-occupant") await c.app().setActiveTask("A");
                if (intervening === "archive") await c.app().archiveTask("C");
                if (intervening === "create") await c.app().createTask("New", 1);
                if (intervening === "settings") await c.app().updateSettings(c.app().state!.settings);
                if (intervening === "different-window" || intervening === "different-task") {
                    if (intervening === "different-window") c.data.store.state.timer!.window_started_at = at(1);
                    else c.data.store.state.timer!.task_id = "B";
                    await c.app().refresh();
                }
            });
            if (intervening === "zero") expect(c.events).toEqual([
                { type: "enter", taskId: "B", reason: "switch", at: W, windowId: W, fromTaskId: "A" },
            ]);
            c.events.length = 0;
            time(4);
            await act(async () => { await c.app().setActiveTask("C"); });
            expect(c.events).toHaveLength(2);
            expect(c.events[0]).not.toHaveProperty("pausedAt");
        });

    it("retains the handoff-carried pause across a failed transition", async () => {
        const c = await setup();
        time(3);
        await act(async () => { await c.app().pauseTimer(); await c.app().resumeTimer({ handoff: true }); });
        vi.spyOn(c.data, "setActiveTask").mockRejectedValueOnce(new Error("failed join"));
        await act(async () => { await expect(c.app().startTaskWork("B")).rejects.toThrow("failed join"); });
        c.events.length = 0;
        await act(async () => { await c.app().startTaskWork("B"); });
        expect(c.events[0]).toMatchObject({ reason: "switch", pausedAt: at(3) });
    });

    it.each(["completion", "handover"])("keeps a Work progression race silent when %s wins", async winner => {
        const c = await setup();
        time(25);
        const original = c.data.completeTimer.bind(c.data);
        let release!: () => void;
        let committed!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const committedGate = new Promise<void>(resolve => { committed = resolve; });
        vi.spyOn(c.data, "completeTimer").mockImplementation(async timer => {
            if (winner === "completion") {
                const result = await original(timer);
                committed(); await gate; return result;
            }
            committed(); await gate; return original(timer);
        });
        const breaks = vi.spyOn(c.data, "startBreakTimer");
        await act(async () => {
            const completion = c.app().completeTimer();
            await committedGate;
            await c.app().setActiveTask("B");
            release(); await completion;
        });
        await waitFor(() => expect(c.app().state?.timer?.kind).toBe("ShortBreak"));
        expect(breaks).toHaveBeenCalledOnce();
        expect(c.data.store.state.logs).toHaveLength(1);
        expect(c.events).toEqual([]);
    });

    it("dispatches the immediate switch pair before a later command can complete its window", async () => {
        const c = await setup();
        time(3);
        const order: string[] = [];
        c.app().subscribeTimerTransitions(event => { order.push(`${event.type}:${event.reason}`); });
        await act(async () => {
            await c.app().setActiveTask("B");
            order.push("switch settled");
        });
        await act(async () => {
            time(25);
            await c.app().completeTimer();
            order.push("break opened");
        });
        await act(async () => {
            time(30);
            await c.app().completeTimer();
        });
        expect(order).toEqual(["leave:switch", "enter:switch", "switch settled", "break opened", "enter:break-end"]);
    });

    it("snapshots subscriptions, isolates listener exceptions and cleans up on unmount", async () => {
        const c = await setup();
        const deliveries: string[] = [];
        const subscribe = c.app().subscribeTimerTransitions;
        let removeSecond = () => {};
        const late = () => { deliveries.push("late"); };
        subscribe(() => { deliveries.push("first"); removeSecond(); subscribe(late); throw new Error("consumer failed"); });
        removeSecond = subscribe(() => { deliveries.push("second"); });
        time(3);
        await act(async () => { await expect(c.app().pauseTimer()).resolves.toBeUndefined(); });
        expect(deliveries).toEqual(["first", "second"]);
        removeSecond(); removeSecond();
        await act(async () => { await c.app().resumeTimer(); });
        expect(deliveries).toEqual(["first", "second", "first", "late"]);
        const retainedPause = c.app().pauseTimer;
        c.unmount();
        await act(async () => { await retainedPause(); });
        expect(deliveries).toHaveLength(4);
    });

    it("dispatches both switch halves synchronously after ref adoption and before progression can await", async () => {
        const c = await setup();
        time(3);
        const order: string[] = [];
        const retainedPause = c.app().pauseTimer;
        const pause = vi.spyOn(c.data, "pauseTimer");
        c.app().subscribeTimerTransitions(event => {
            order.push(event.type);
            // Consumers must defer commands. This microtask runs before the outer
            // adoptResult continuation, and the retained pause must already see
            // the returned paused timer rather than the running before-timer.
            queueMicrotask(() => { void retainedPause(); });
        });
        c.events.length = 0;
        time(5);
        const original = c.data.setActiveTask.bind(c.data);
        vi.spyOn(c.data, "setActiveTask").mockImplementation(async taskId => {
            const result = await original(taskId);
            // Also trigger the progression guard's cycle condition: a genuine
            // handover still has Work, so it must not await any progression.
            result.state.current_cycle_pomodoros += 1;
            result.state.timer!.paused = true;
            result.state.timer!.paused_remaining_secs = result.state.timer!.planned_secs;
            return result;
        });
        const complete = vi.spyOn(c.data, "completeTimer");
        const breaks = vi.spyOn(c.data, "startBreakTimer");
        await act(async () => { await c.app().setActiveTask("B"); order.push("settled"); });
        expect(order).toEqual(["leave", "enter", "settled"]);
        expect(pause).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled(); expect(breaks).not.toHaveBeenCalled();
        expect(c.app().state?.timer?.task_id).toBe("B");
    });
});

vi.mock("@tauri-apps/plugin-notification", () => {
    throw new Error("native notifications are unavailable in the browser test");
});

const sound = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("../hooks/useSounds", () => ({ useSounds: () => sound }));
const OWNER = "owner-1";

/**
 * In-memory DataAccess with a manually-driven same-tab revision path. Local
 * commands still update the store but never notify subscribers, so the context
 * tests can assert that commands adopt their staged results with no follow-up
 * `fetchState`. The revision (`bumpRevision`/`reloadFromStorage`) is driven by
 * the test to simulate the sync/cross-tab write path that `SyncProvider` owns
 * in production.
 */
class ContextFakeDataAccess extends InMemoryDataAccess {
    private readonly revisionListeners = new Set<() => void>();

    subscribe(listener: () => void): () => void {
        this.revisionListeners.add(listener);
        return () => this.revisionListeners.delete(listener);
    }

    reloadFromStorage(): void {
        this.notifyRevision();
    }

    bumpRevision(): void {
        this.notifyRevision();
    }

    private notifyRevision(): void {
        for (const listener of [...this.revisionListeners]) {
            try {
                listener();
            } catch {
                // A subscriber failure must not break the revision reload.
            }
        }
    }
}

function Probe() {
    const {
        state,
        remainingMs,
        tick,
        error,
        createTask,
        startWork,
        startBreak,
        pauseTimer,
        resumeTimer,
        stopWork,
        skipBreak,
        completeTimer,
        updateSettings,
        finalizeTask,
        resetAll,
    } = useAppState();
    return <div>
        <div data-testid="status">{state ? "loaded" : "loading"}</div>
        <div data-testid="task-count">{state ? Object.keys(state.tasks).length : 0}</div>
        <div data-testid="timer-kind">{state?.timer?.kind ?? "none"}</div>
        <div data-testid="error">{error ?? ""}</div>
        <div data-testid="remaining">{remainingMs()}</div>
        <div data-testid="tick">{tick}</div>
        <button onClick={() => { void createTask("New Task", 3).catch(() => undefined); }}>create</button>
        <button onClick={() => startWork()}>start</button>
        <button onClick={() => startBreak()}>break</button>
        <button onClick={() => pauseTimer()}>pause</button>
        <button onClick={() => resumeTimer()}>resume</button>
        <button onClick={() => stopWork()}>stop</button>
        <button onClick={() => skipBreak()}>skip</button>
        <button onClick={() => completeTimer()}>complete</button>
        <button onClick={() => updateSettings({ work_minutes: 1, short_break_minutes: 1, long_break_minutes: 1, segment_length: 4, start_of_day: "00:00", end_of_day: "22:00" })}>settings</button>
        <button onClick={() => finalizeTask("t1")}>finalize</button>
        <button onClick={() => resetAll()}>reset</button>
    </div>;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>{children}</AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

beforeEach(() => localStorage.clear());

afterEach(() => {
    resetNotifyForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (document as unknown as { hidden?: boolean }).hidden;
});

describe("AppStateContext", () => {
    it("awaits pause/resume adoption and reads current state even through retained callbacks", async () => {
        const data = new ContextFakeDataAccess(makeAppState({ timer: makeActiveTimer({ task_id: "t1" }) }));
        let current!: ReturnType<typeof useAppState>;
        function Commands() { current = useAppState(); return <span>{current.state?.timer?.paused ? "paused" : "running"}</span>; }
        render(wrap(data, <Commands />));
        await waitFor(() => expect(current.state?.timer).toBeTruthy());
        const { pauseTimer, resumeTimer } = current;
        const originalPause = data.pauseTimer.bind(data);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        vi.spyOn(data, "pauseTimer").mockImplementation(async () => { await gate; return originalPause(); });
        const resume = vi.spyOn(data, "resumeTimer");
        let settled = false;
        let pause!: Promise<void>;
        act(() => { pause = pauseTimer(); void pause.then(() => { settled = true; }); });
        expect(pause).toBeInstanceOf(Promise);
        expect(settled).toBe(false);
        await act(async () => { release(); await pause; });
        expect(settled).toBe(true);
        expect(current.state?.timer?.paused).toBe(true);
        // This resume callback was captured while running. It must consult
        // stateRef and see the adopted pause, even in the same async sequence.
        await act(async () => {
            const promise = resumeTimer();
            expect(promise).toBeInstanceOf(Promise);
            await promise;
            await pauseTimer();
            await resumeTimer();
        });
        expect(resume).toHaveBeenCalledTimes(2);
        expect(current.state?.timer?.paused).toBe(false);
        expect(screen.getByText("running")).toBeVisible();
    });
    it("loads staged local state on mount", async () => {
        const state = makeAppState({ tasks: { t1: { id: "t1", name: "Backend task", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } } });
        const data = new ContextFakeDataAccess(state);
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("computes remainingMs from ends_at", async () => {
        const data = new ContextFakeDataAccess(makeAppState({ timer: makeActiveTimer({ ends_at: new Date(Date.now() + 600_000).toISOString() }) }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(Number(screen.getByTestId("remaining").textContent)).toBeGreaterThan(0));
    });

    it("auto-progresses an expired work timer into a break exactly once", async () => {
        const data = new ContextFakeDataAccess(makeAppState({
            active_task: "t1",
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
            timer: makeActiveTimer({ task_id: "t1", ends_at: new Date(Date.now() - 1000).toISOString(), planned_secs: 1500 }),
        }));
        const completeSpy = vi.spyOn(data, "completeTimer");
        const startBreakSpy = vi.spyOn(data, "startBreakTimer");
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.store.state.timer?.kind).toBe("ShortBreak"));
        expect(screen.getByTestId("timer-kind")).toHaveTextContent("ShortBreak");
        expect(data.store.state.logs).toHaveLength(1);
        // The expired generation completes exactly once; no second loop starts.
        expect(completeSpy).toHaveBeenCalledTimes(1);
        expect(startBreakSpy).toHaveBeenCalledTimes(1);
    });

    it("surfaces an automatic break start failure after clearing the expired timer", async () => {
        const data = new ContextFakeDataAccess(makeAppState({
            active_task: "t1",
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
            timer: makeActiveTimer({ task_id: "t1", ends_at: new Date(Date.now() - 1000).toISOString() }),
        }));
        vi.spyOn(data, "startBreakTimer").mockRejectedValue(new Error("break storage failed"));

        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("timer-kind")).toHaveTextContent("none"));
        await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("break storage failed"));
        expect(data.store.state.logs).toHaveLength(1);
    });

    it("creates a task and adopts its result with no follow-up fetch", async () => {
        const data = new ContextFakeDataAccess(makeAppState(), { createTaskId: () => "new-id" });
        const fetchSpy = vi.spyOn(data, "fetchState");
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        await act(async () => screen.getByText("create").click());
        await waitFor(() => expect(screen.getByTestId("task-count")).toHaveTextContent("1"));
        expect(data.store.state.tasks["new-id"]?.name).toBe("New Task");
        // The command updated the view from its own staged result; the local
        // fetch happened only for the initial mount read.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("starts a work timer and adopts the result with no follow-up fetch", async () => {
        const data = new ContextFakeDataAccess(makeAppState({
            active_task: "t1",
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        const fetchSpy = vi.spyOn(data, "fetchState");
        const startWorkSpy = vi.spyOn(data, "startWorkTimer");
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        await act(async () => screen.getByText("start").click());
        await waitFor(() => expect(screen.getByTestId("timer-kind")).toHaveTextContent("Work"));
        expect(startWorkSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not register its own focus/visibility refresh triggers", async () => {
        const data = new ContextFakeDataAccess(makeAppState());
        const fetchSpy = vi.spyOn(data, "fetchState");
        render(wrap(data, <Probe />));
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
        act(() => window.dispatchEvent(new Event("focus")));
        act(() => document.dispatchEvent(new Event("visibilitychange")));
        // SyncProvider handles lifecycle triggers; this provider never refetches.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("reloads the local view when a sync revision changes the staged store", async () => {
        const data = new ContextFakeDataAccess(makeAppState());
        const fetchSpy = vi.spyOn(data, "fetchState");
        render(wrap(data, <Probe />));
        await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
        // Simulate a remote pull that replaced the store (cross-tab storage event
        // path the SyncProvider owns) and bumped the revision.
        data.store.state.tasks["remote-1"] = {
            id: "remote-1", name: "Remote", target_pomodoros: 1, completed_pomodoros: 0,
            created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false,
        };
        act(() => {
            window.dispatchEvent(new StorageEvent("storage", { key: stagingKey(OWNER), newValue: "{}" }));
        });
        await waitFor(() => expect(screen.getByTestId("task-count")).toHaveTextContent("1"));
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("keeps the last persisted state and surfaces a command failure", async () => {
        const data = new ContextFakeDataAccess(makeAppState({
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
        vi.spyOn(data, "updateSettings").mockRejectedValue(new Error("storage failed"));
        await act(async () => screen.getByText("settings").click());
        expect(screen.getByTestId("error")).toHaveTextContent("storage failed");
        // A failed local persistence never updates React state optimistically.
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("keeps the last persisted state and surfaces a createTask failure", async () => {
        const data = new ContextFakeDataAccess(makeAppState({
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
        vi.spyOn(data, "createTask").mockRejectedValue(new Error("create failed"));
        await act(async () => screen.getByText("create").click());
        expect(screen.getByTestId("error")).toHaveTextContent("create failed");
        // The failed create leaves the staged view untouched and rethrows to
        // callers (the probe swallows the rethrow to avoid an unhandled rejection).
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("keeps the last persisted state and surfaces a resetAll failure", async () => {
        const data = new ContextFakeDataAccess(makeAppState({
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
        }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
        vi.spyOn(data, "resetAppState").mockRejectedValue(new Error("reset failed"));
        await act(async () => screen.getByText("reset").click());
        expect(screen.getByTestId("error")).toHaveTextContent("reset failed");
        // A failed reset never replaces the visible staged state.
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("falls back to Web Notifications when the native adapter is unavailable", async () => {
        const notifications: Array<{ title: string; options?: { body?: string } }> = [];
        class MockNotification {
            static permission = "granted";
            static requestPermission = vi.fn(async () => "granted");
            constructor(title: string, options?: { body?: string }) { notifications.push({ title, options }); }
        }
        vi.stubGlobal("Notification", MockNotification);
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        vi.spyOn(document, "hasFocus").mockReturnValue(false);
        const data = new ContextFakeDataAccess(makeAppState({
            active_task: "t1",
            tasks: { t1: { id: "t1", name: "Browser task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
            timer: makeActiveTimer({ task_id: "t1", ends_at: new Date(Date.now() - 1000).toISOString(), planned_secs: 1500 }),
        }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(notifications.some((item) => item.title === "Pomodoro Complete")).toBe(true));
    });
});


describe("deferred finalize", () => {
    const W = "2026-11-09T14:00:00.000Z";
    const at = (minutes: number) => new Date(Date.parse(W) + minutes * 60_000).toISOString();
    const time = (minutes: number) => vi.setSystemTime(new Date(at(minutes)));
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); time(0); sound.play.mockClear(); });
    afterEach(() => vi.useRealTimers());

    async function mount(data: ContextFakeDataAccess) {
        const events: TimerTransitionEvent[] = [];
        let current!: ReturnType<typeof useAppState>;
        function Capture() {
            current = useAppState();
            const subscribe = current.subscribeTimerTransitions;
            useLayoutEffect(() => subscribe(event => events.push(event)), [subscribe]);
            return null;
        }
        const view = render(wrap(data, <Capture />));
        await waitFor(() => expect(current.state).not.toBeNull());
        return { data, events, app: () => current, ...view };
    }

    async function setup(kind: "Work" | "ShortBreak" | null = "Work") {
        let logId = 0;
        const data = new ContextFakeDataAccess(makeAppState({
            tasks: Object.fromEntries(["A", "B", "C"].map(id => [id, {
                id, name: id, target_pomodoros: 4, completed_pomodoros: 0,
                created_at: W, completed_at: null, break_skips: 0, archived: false,
            }])), active_task: "A",
        }), { createLogId: () => `deferred-log-${++logId}` });
        if (kind === "Work") await data.startWorkTimer();
        if (kind === "ShortBreak") await data.startBreakTimer();
        return mount(data);
    }

    it("defers the running Work owner without touching its timer or backend task", async () => {
        const c = await setup();
        const timer = structuredClone(c.app().state!.timer);
        const finalize = vi.spyOn(c.data, "finalizeTask");
        await act(async () => { expect(await c.app().requestFinalize("A")).toBe("deferred"); });
        expect(c.app().state?.timer).toEqual(timer);
        expect(c.app().state?.timer).toMatchObject({ kind: "Work", task_id: "A", paused: false, window_started_at: W });
        expect(c.data.store.state.tasks.A).toMatchObject({ completed_at: null, archived: false });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        expect(finalize).not.toHaveBeenCalled();
        expect(c.events).toEqual([]);
    });

    it("immediately finalizes a non-owner and leaves the running Work window untouched", async () => {
        const c = await setup();
        const timer = structuredClone(c.app().state!.timer);
        time(3);
        await act(async () => { expect(await c.app().requestFinalize("B")).toBe("finalized"); });
        expect(c.data.store.state.tasks.B).toMatchObject({ completed_at: at(3), archived: true });
        expect(c.app().state?.tasks.B).toEqual(c.data.store.state.tasks.B);
        expect(c.app().state?.timer).toEqual(timer);
        expect(c.data.store.state.timer).toEqual(timer);
        expect(c.app().state?.active_task).toBe("A");
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().state?.logs).toEqual([]);
    });

    it("keeps one queue entry for simultaneous requests through a retained callback", async () => {
        const c = await setup();
        const request = c.app().requestFinalize;
        await act(async () => {
            expect(await Promise.all([request("A"), request("A")])).toEqual(["deferred", "deferred"]);
        });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        expect(c.data.store.state.tasks.A.completed_at).toBeNull();
    });

    it("rejects an immediate finalize failure and leaves the queue empty", async () => {
        const c = await setup();
        await act(async () => { await expect(c.app().requestFinalize("missing")).rejects.toThrow("Task not found"); });
        expect(c.app().error).toBe("Task not found");
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().state?.timer).toMatchObject({ kind: "Work", task_id: "A" });
    });

    it.each(["tick", "completeTimer", "reconciliation"] as const)(
        "logs Work and opens the break before flushing on %s, then never restarts the finalized task", async completion => {
            const c = await setup();
            await act(async () => { await c.app().requestFinalize("A"); });
            const finalize = c.data.finalizeTask.bind(c.data);
            const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
                expect(c.data.store.state.timer).toMatchObject({ kind: "ShortBreak", task_id: "A" });
                expect(c.data.store.state.logs).toEqual([expect.objectContaining({
                    task_id: "A", duration_minutes: 25, was_break: false, work_window_id: W,
                })]);
                expect(c.data.store.state.tasks.A.completed_at).toBeNull();
                return finalize(id);
            });
            const startWork = vi.spyOn(c.data, "startWorkTimer");
            time(25);
            if (completion === "completeTimer") await act(async () => { await c.app().completeTimer(); });
            if (completion === "reconciliation") await act(async () => { await c.app().refresh(); });
            await waitFor(() => expect(c.app().state?.tasks.A.completed_at).toBe(at(25)), { timeout: 2500 });
            expect(c.app().state?.timer?.kind).toBe("ShortBreak");
            expect(c.app().state?.tasks.A.archived).toBe(true);
            expect(c.app().state?.active_task).toBeNull();
            expect(c.app().pendingFinalizeTaskIds).toEqual([]);
            expect(finalizeSpy).toHaveBeenCalledExactlyOnceWith("A");
            expect(c.events).toEqual([]);
            time(30);
            await act(async () => { await c.app().completeTimer(); });
            expect(c.app().state?.timer).toBeNull();
            expect(startWork).not.toHaveBeenCalled();
            expect(c.app().state?.logs).toHaveLength(2);
            expect(c.app().error).toBeNull();
        });

    it("logs elapsed work before stopWork flushes the owner", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        const finalize = c.data.finalizeTask.bind(c.data);
        const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
            expect(c.data.store.state.timer).toBeNull();
            expect(c.data.store.state.logs).toEqual([expect.objectContaining({
                task_id: "A", duration_minutes: 3, was_break: false, work_window_id: W,
            })]);
            expect(c.data.store.state.tasks.A.completed_at).toBeNull();
            expect(c.events).toEqual([{ type: "leave", taskId: "A", reason: "stop", at: at(3), windowId: W }]);
            return finalize(id);
        });
        time(3);
        await act(async () => { await c.app().stopWork(); });
        expect(c.app().state?.tasks.A).toMatchObject({ completed_at: at(3), archived: true, completed_pomodoros: 3 / 25 });
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(finalizeSpy).toHaveBeenCalledExactlyOnceWith("A");
        expect(c.app().error).toBeNull();
    });

    it.each(["startTaskWork", "setActiveTask"] as const)("logs the outgoing task before %s flushes after a join", async command => {
        const c = await setup();
        const timer = structuredClone(c.app().state!.timer!);
        await act(async () => { await c.app().requestFinalize("A"); });
        const finalize = c.data.finalizeTask.bind(c.data);
        const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
            expect(c.data.store.state.timer).toMatchObject({ task_id: "B", window_started_at: W, ends_at: timer.ends_at });
            expect(c.data.store.state.logs).toEqual([expect.objectContaining({
                task_id: "A", duration_minutes: 3, was_break: false, work_window_id: W,
            })]);
            expect(c.data.store.state.tasks.A.completed_at).toBeNull();
            expect(c.events).toEqual([
                { type: "leave", taskId: "A", reason: "switch", at: at(3), windowId: W },
                { type: "enter", taskId: "B", reason: "switch", at: at(3), windowId: W, fromTaskId: "A" },
            ]);
            return finalize(id);
        });
        time(3);
        await act(async () => {
            const result = await c.app()[command]("B");
            if (command === "startTaskWork") expect(result).toBe("joined");
        });
        expect(c.app().state?.tasks.A).toMatchObject({ completed_at: at(3), archived: true, completed_pomodoros: 3 / 25 });
        expect(c.app().state?.timer).toMatchObject({ kind: "Work", task_id: "B", window_started_at: W, ends_at: timer.ends_at });
        expect(c.app().state?.active_task).toBe("B");
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(finalizeSpy).toHaveBeenCalledExactlyOnceWith("A");
        expect(c.app().error).toBeNull();
    });

    it("keeps a paused Work owner pending through pause, resume, and another request", async () => {
        const c = await setup();
        const finalize = vi.spyOn(c.data, "finalizeTask");
        await act(async () => { await c.app().requestFinalize("A"); });
        time(3);
        await act(async () => { await c.app().pauseTimer(); });
        expect(c.app().state?.timer).toMatchObject({ kind: "Work", task_id: "A", paused: true, window_started_at: W });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        expect(c.data.store.state.tasks.A.completed_at).toBeNull();
        await act(async () => { await c.app().resumeTimer(); });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        await act(async () => { await c.app().pauseTimer(); });
        await act(async () => { expect(await c.app().requestFinalize("A")).toBe("deferred"); });
        expect(finalize).not.toHaveBeenCalled();
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
    });

    it("also defers a task first requested while its Work window is paused", async () => {
        const c = await setup();
        await act(async () => { await c.app().pauseTimer(); });
        const timer = structuredClone(c.app().state!.timer);
        await act(async () => { expect(await c.app().requestFinalize("A")).toBe("deferred"); });
        expect(c.app().state?.timer).toEqual(timer);
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        expect(c.data.store.state.tasks.A.completed_at).toBeNull();
    });

    it.each(["finalized", "deleted"] as const)("drops an already %s pending task without double-applying or setting an error", async terminal => {
        const c = await setup();
        const finalize = vi.spyOn(c.data, "finalizeTask");
        await act(async () => { await c.app().requestFinalize("A"); });
        time(3);
        await act(async () => {
            if (terminal === "finalized") await c.app().finalizeTask("A");
            else {
                await c.data.deleteTask("A");
                await c.app().refresh();
            }
        });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        time(4);
        await act(async () => { await c.app().setActiveTask("B"); });
        if (terminal === "finalized") {
            expect(c.data.store.state.tasks.A.completed_at).toBe(at(3));
            expect(finalize).toHaveBeenCalledExactlyOnceWith("A");
        } else {
            expect(c.app().state?.tasks.A).toBeUndefined();
            expect(finalize).not.toHaveBeenCalled();
        }
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().error).toBeNull();
    });

    it("replays a reconciliation queued while progression is awaiting a pending finalize", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        const finalize = c.data.finalizeTask.bind(c.data);
        let release!: () => void;
        let committed!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const committedGate = new Promise<void>(resolve => { committed = resolve; });
        const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
            const result = await finalize(id);
            committed();
            await gate;
            return result;
        });
        const complete = vi.spyOn(c.data, "completeTimer");
        const breaks = vi.spyOn(c.data, "startBreakTimer");
        const startWork = vi.spyOn(c.data, "startWorkTimer");
        time(25);
        await act(async () => {
            const progression = c.app().completeTimer();
            await committedGate;
            expect(c.data.store.state.timer?.kind).toBe("ShortBreak");
            time(30);
            // fetchState reconciles the expired break and refresh queues its
            // notice behind the still-running Work progression.
            await c.app().refresh();
            expect(c.data.store.state.timer).toBeNull();
            expect(sound.play.mock.calls.map(([kind]) => kind)).toEqual(["pomodoroFinish"]);
            release();
            await progression;
        });
        await waitFor(() => expect(sound.play.mock.calls.map(([kind]) => kind)).toEqual(["pomodoroFinish", "breakOver"]));
        expect(complete).toHaveBeenCalledTimes(2);
        expect(breaks).toHaveBeenCalledOnce();
        expect(startWork).not.toHaveBeenCalled();
        expect(finalizeSpy).toHaveBeenCalledExactlyOnceWith("A");
        expect(c.app().state?.timer).toBeNull();
        expect(c.app().state?.tasks.A).toMatchObject({ completed_at: at(25), archived: true });
        expect(c.app().state?.logs.map(log => log.was_break)).toEqual([false, true]);
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().error).toBeNull();
        expect(c.events).toEqual([]);
    });

    it.each(["stopWork", "setActiveTask", "startTaskWork", "completeTimer"] as const)(
        "publishes exactly the same events for %s with and without a pending finalize", async command => {
            const run = async (pending: boolean) => {
                time(0);
                const c = await setup();
                if (pending) await act(async () => { await c.app().requestFinalize("A"); });
                time(command === "completeTimer" ? 25 : 3);
                await act(async () => {
                    if (command === "setActiveTask" || command === "startTaskWork") await c.app()[command]("B");
                    else await c.app()[command]();
                });
                expect(c.app().pendingFinalizeTaskIds).toEqual([]);
                if (pending) expect(c.app().state?.tasks.A.archived).toBe(true);
                c.unmount();
                return c.events;
            };
            expect(await run(true)).toEqual(await run(false));
        });

    it("removes all claimed ids before awaiting finalize and prevents overlapping flushes from applying them twice", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        time(1);
        await act(async () => {
            await c.data.setActiveTask("B");
            await c.app().refresh(); // A revision can move ownership without a command flush.
            await c.app().requestFinalize("B");
        });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A", "B"]);
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const enteredGate = new Promise<void>(resolve => { entered = resolve; });
        const finalize = c.data.finalizeTask.bind(c.data);
        const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
            if (id === "A") { entered(); await gate; }
            return finalize(id);
        });
        let switchTask!: Promise<void>;
        time(3);
        await act(async () => { switchTask = c.app().setActiveTask("C"); await enteredGate; });
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(finalizeSpy.mock.calls).toEqual([["A"]]);
        await act(async () => { await c.app().setActiveTask("C"); });
        expect(finalizeSpy.mock.calls).toEqual([["A"]]);
        await act(async () => { release(); await switchTask; });
        expect(finalizeSpy.mock.calls).toEqual([["A"], ["B"]]);
        expect(c.app().state?.tasks.A.archived).toBe(true);
        expect(c.app().state?.tasks.B.archived).toBe(true);
        expect(c.app().error).toBeNull();
    });

    it("continues flushing sequentially after a finalize error without rethrowing or retrying the claimed id", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        time(1);
        await act(async () => {
            await c.data.setActiveTask("B"); await c.app().refresh(); await c.app().requestFinalize("B");
        });
        const finalize = c.data.finalizeTask.bind(c.data);
        const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
            if (id === "A") throw new Error("finalize storage failed");
            return finalize(id);
        });
        time(3);
        await act(async () => { await c.app().setActiveTask("C"); });
        expect(finalizeSpy.mock.calls).toEqual([["A"], ["B"]]);
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().state?.tasks.A.completed_at).toBeNull();
        expect(c.app().state?.tasks.B).toMatchObject({ completed_at: at(3), archived: true });
        expect(c.app().error).toBe("finalize storage failed");
        await act(async () => { await c.app().setActiveTask("C"); });
        expect(finalizeSpy).toHaveBeenCalledTimes(2);
    });

    it("keeps the owner queued after a failed stopWork", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        vi.spyOn(c.data, "stopWorkTimer").mockRejectedValue(new Error("stop failed"));
        const finalize = vi.spyOn(c.data, "finalizeTask");
        await act(async () => { await c.app().stopWork(); });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        expect(c.app().state?.tasks.A.completed_at).toBeNull();
        expect(c.app().state?.timer?.task_id).toBe("A");
        expect(finalize).not.toHaveBeenCalled();
        expect(c.app().error).toBe("stop failed");
    });

    it("does not flush after setActiveTask rejects", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        time(1);
        await act(async () => { await c.data.setActiveTask("B"); await c.app().refresh(); });
        const finalize = vi.spyOn(c.data, "finalizeTask");
        await act(async () => { await expect(c.app().setActiveTask("missing")).rejects.toThrow("Task not found"); });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        expect(finalize).not.toHaveBeenCalled();
        expect(c.app().state?.tasks.A.completed_at).toBeNull();
    });

    it("flushes after startTaskWork starts from a free timer slot", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        time(3);
        await act(async () => { await c.data.stopWorkTimer(); await c.app().refresh(); });
        const finalize = c.data.finalizeTask.bind(c.data);
        const finalizeSpy = vi.spyOn(c.data, "finalizeTask").mockImplementation(async id => {
            expect(c.events).toEqual([{ type: "enter", taskId: "B", reason: "start", at: at(3), windowId: at(3) }]);
            expect(c.data.store.state.timer).toMatchObject({ kind: "Work", task_id: "B", window_started_at: at(3) });
            return finalize(id);
        });
        await act(async () => { expect(await c.app().startTaskWork("B")).toBe("started"); });
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().state?.tasks.A).toMatchObject({ completed_at: at(3), archived: true });
        expect(finalizeSpy).toHaveBeenCalledExactlyOnceWith("A");
    });

    it("keeps the queue memory-only and loses it when the provider remounts", async () => {
        const c = await setup();
        const storage = { ...localStorage };
        const backend = structuredClone(c.data.store);
        await act(async () => { await c.app().requestFinalize("A"); });
        expect({ ...localStorage }).toEqual(storage);
        expect(c.data.store).toEqual(backend);
        c.unmount();
        const remounted = await mount(c.data);
        expect(remounted.app().pendingFinalizeTaskIds).toEqual([]);
        expect(remounted.app().state?.tasks.A.completed_at).toBeNull();
        expect(remounted.app().state?.timer).toMatchObject({ kind: "Work", task_id: "A", window_started_at: W });
    });

    it("empties the queue on resetAll", async () => {
        const c = await setup();
        await act(async () => { await c.app().requestFinalize("A"); });
        expect(c.app().pendingFinalizeTaskIds).toEqual(["A"]);
        const finalize = vi.spyOn(c.data, "finalizeTask");
        await act(async () => { await c.app().resetAll(); });
        expect(c.app().pendingFinalizeTaskIds).toEqual([]);
        expect(c.app().state?.tasks).toEqual({});
        expect(c.app().state?.timer).toBeNull();
        expect(finalize).not.toHaveBeenCalled();
    });
});

describe("task work window joins", () => {
    async function setupWindow(kind: "Work" | "ShortBreak" | null) {
        let clock = new Date();
        const data = new InMemoryDataAccess(makeAppState(), { now: () => clock });
        const first = (await data.createTask("First", 2)).value;
        const second = (await data.createTask("Second", 2)).value;
        await data.setActiveTask(first.id);
        if (kind === "Work") await data.startWorkTimer();
        if (kind === "ShortBreak") await data.startBreakTimer();
        let app!: ReturnType<typeof useAppState>;
        function Capture() { app = useAppState(); return null; }
        render(wrap(data, <Capture />));
        await waitFor(() => expect(app.state).not.toBeNull());
        return { data, first, second, app: () => app, advance: (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); } };
    }

    it("serializes simultaneous free starts so the second call joins without an error", async () => {
        const context = await setupWindow(null);
        const start = vi.spyOn(context.data, "startWorkTimer");
        let outcomes: PromiseSettledResult<string>[] = [];
        await act(async () => {
            const startTaskWork = context.app().startTaskWork;
            outcomes = await Promise.allSettled([startTaskWork(context.second.id), startTaskWork(context.second.id)]);
        });
        expect(outcomes).toEqual([{ status: "fulfilled", value: "started" }, { status: "fulfilled", value: "joined" }]);
        expect(start).toHaveBeenCalledOnce();
        expect(context.app().error).toBeNull();
    });

    it("notifies once when a tick completion and handoff close the same window", async () => {
        const context = await setupWindow("Work");
        context.advance(1500);
        const notifications: string[] = [];
        class MockNotification {
            static permission = "granted";
            constructor(title: string) { notifications.push(title); }
        }
        resetNotifyForTesting();
        vi.stubGlobal("Notification", MockNotification);
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        sound.play.mockClear();
        const original = context.data.completeTimer.bind(context.data);
        let release!: () => void;
        let committed!: () => void;
        const committedGate = new Promise<void>(r => { committed = r; });
        const gate = new Promise<void>(r => { release = r; });
        vi.spyOn(context.data, "completeTimer").mockImplementation(async (...args) => {
            const result = await original(...args);
            committed();
            await gate;
            return result;
        });
        let completion!: Promise<void>;
        await act(async () => {
            completion = context.app().completeTimer();
            await committedGate;
            await context.app().setActiveTask(context.second.id);
            release();
            await completion;
        });
        await waitFor(() => expect(context.app().state?.timer?.kind).toBe("ShortBreak"));
        expect(sound.play.mock.calls.filter(([kind]) => kind === "pomodoroFinish")).toHaveLength(1);
        expect(notifications.filter(t => t === "Pomodoro Complete")).toHaveLength(1);
    });

    it("starts when free and reports started", async () => {
        const context = await setupWindow(null);
        let outcome: string | undefined;
        await act(async () => { outcome = await context.app().startTaskWork(context.second.id); });
        expect(outcome).toBe("started");
        expect(context.data.store.state.timer).toMatchObject({ kind: "Work", task_id: context.second.id, planned_secs: 1500 });
    });

    it("joins a live Work window and reports joined without moving its end", async () => {
        const context = await setupWindow("Work");
        const original = context.data.store.state.timer!;
        context.advance(600);
        let outcome: string | undefined;
        const start = vi.spyOn(context.data, "startWorkTimer");
        await act(async () => { outcome = await context.app().startTaskWork(context.second.id); });
        expect(outcome).toBe("joined");
        expect(start).not.toHaveBeenCalled();
        expect(context.data.store.state.timer).toMatchObject({ task_id: context.second.id, planned_secs: 900, ends_at: original.ends_at, window_started_at: original.window_started_at });
    });

    it("refuses to start work during a break", async () => {
        const context = await setupWindow("ShortBreak");
        const original = structuredClone(context.data.store.state);
        await act(async () => { await expect(context.app().startTaskWork(context.second.id)).rejects.toThrow(/break is running/i); });
        expect(context.data.store.state).toEqual(original);
    });

    it("starts the normal break exactly once after an expired-window join", async () => {
        const context = await setupWindow("Work");
        const captured = context.data.store.state.timer!;
        context.advance(1500);
        const startBreak = vi.spyOn(context.data, "startBreakTimer");
        await act(async () => { expect(await context.app().startTaskWork(context.second.id)).toBe("joined"); });
        await waitFor(() => expect(context.app().state?.timer?.kind).toBe("ShortBreak"));
        expect(startBreak).toHaveBeenCalledTimes(1);
        expect(context.data.store.state.timer?.task_id).toBe(context.second.id);
        expect((await context.data.completeTimer(captured)).applied).toBe(false);
        expect(context.data.store.state.logs).toHaveLength(1);
        expect(context.data.store.state.current_cycle_pomodoros).toBe(1);
    });

    it("banks and progresses an expired finalized window", async () => {
        const context = await setupWindow("Work");
        context.advance(1500);
        const startBreak = vi.spyOn(context.data, "startBreakTimer");
        await act(async () => { await context.app().finalizeTask(context.first.id); });
        await waitFor(() => expect(context.app().state?.timer?.kind).toBe("ShortBreak"));
        expect(startBreak).toHaveBeenCalledTimes(1);
        expect(context.data.store.state.tasks[context.first.id]).toMatchObject({ archived: true, completed_pomodoros: 1 });
        expect(context.data.store.state.logs).toHaveLength(1);
        expect(context.data.store.state.current_cycle_pomodoros).toBe(1);
    });

    it("serializes a switch winner with an in-flight automatic completion loser", async () => {
        const context = await setupWindow("Work");
        context.advance(1500);
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const original = context.data.completeTimer.bind(context.data);
        vi.spyOn(context.data, "completeTimer").mockImplementation(async expected => {
            await blocked;
            return original(expected);
        });
        const startBreak = vi.spyOn(context.data, "startBreakTimer");
        await act(async () => {
            const ticking = context.app().completeTimer();
            await context.app().startTaskWork(context.second.id);
            release();
            await ticking;
        });
        await waitFor(() => expect(context.app().state?.timer?.kind).toBe("ShortBreak"));
        expect(startBreak).toHaveBeenCalledTimes(1);
        expect(context.data.store.state.logs).toHaveLength(1);
        expect(context.data.store.state.current_cycle_pomodoros).toBe(1);
        expect(context.data.store.state.timer?.task_id).toBe(context.second.id);
    });
});
