import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AppStateProvider, resetNotifyForTesting, useAppState } from "./AppStateContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { stagingKey } from "../lib/data/staging/LocalStagingStore";
import { makeAppState, makeActiveTimer } from "../test/mockTauri";

vi.mock("@tauri-apps/plugin-notification", () => {
    throw new Error("native notifications are unavailable in the browser test");
});

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
