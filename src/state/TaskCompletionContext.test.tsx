import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { TaskCompletionProvider, useOptionalTaskCompletion, useTaskCompletion } from "./TaskCompletionContext";
import { AppStateProvider, useAppState } from "./AppStateContext";
import { ProjectManagerProvider, usePM } from "./ProjectManagerContext";
import { ResumeMemoProvider, useOptionalResumeMemo } from "./ResumeMemoContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";
import type { ActiveTimer, PMTask, Project } from "./types";
import type { TimerTransitionEvent } from "./timerTransitions";

vi.mock("../hooks/useSounds", () => ({ useSounds: () => ({ play: () => {} }) }));
const W = "2026-11-09T14:00:00.000Z";
const NOW = "2026-11-09T14:05:00.000Z";
const backend = (id: string) => ({ id, name: `Task ${id.toUpperCase()}`, target_pomodoros: 2, completed_pomodoros: 0,
    created_at: W, completed_at: null, break_skips: 0, archived: false });
const pmTask = (id: string, extra: Partial<PMTask> = {}): PMTask => ({ id: `p${id}`, title: `Task ${id.toUpperCase()}`,
    appTaskId: id, projectId: null, status: "Backlog", priority: "Medium", timeSpentMinutes: 0,
    tags: [], links: [], checklist: [], sortOrder: 0, isArchived: false, relatedTo: [], createdAt: W, updatedAt: W, ...extra });
type Controls = { app: ReturnType<typeof useAppState>; pm: ReturnType<typeof usePM>;
    completion: ReturnType<typeof useTaskCompletion>; memo: ReturnType<typeof useOptionalResumeMemo> };

async function setup(options: { tasks?: PMTask[]; timer?: Partial<ActiveTimer>; memo?: boolean; projects?: Record<string, Project>;
    backendIds?: string[] } = {}) {
    const data = new InMemoryDataAccess(makeAppState({ tasks: Object.fromEntries((options.backendIds ?? ["a", "b"]).map(id => [id, backend(id)])), active_task: "a",
        timer: makeActiveTimer({ task_id: "a", started_at: W, window_started_at: W,
            ends_at: "2026-11-09T14:25:00.000Z", ...options.timer }) }));
    const tasks = options.tasks ?? [pmTask("a"), pmTask("b")];
    await data.savePMState({ tasks: Object.fromEntries(tasks.map(task => [task.id, task])), projects: options.projects ?? {}, meta: { initializedAt: W } });
    let current!: Controls;
    const events: TimerTransitionEvent[] = [];
    const pending: readonly string[][] = [];
    function Probe() {
        const app = useAppState();
        current = { app, pm: usePM(), completion: useTaskCompletion(), memo: useOptionalResumeMemo() };
        useLayoutEffect(() => app.subscribeTimerTransitions(event => events.push(event)), [app.subscribeTimerTransitions]);
        useLayoutEffect(() => { (pending as string[][]).push([...app.pendingFinalizeTaskIds]); }, [app.pendingFinalizeTaskIds]);
        return null;
    }
    const content = <TaskCompletionProvider><Probe /></TaskCompletionProvider>;
    const view = render(<TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="completion-owner">
        <AppStateProvider><ProjectManagerProvider>
            {options.memo === false ? content : <ResumeMemoProvider>{content}</ResumeMemoProvider>}
        </ProjectManagerProvider></AppStateProvider>
    </SyncProvider></DataProvider></TauriCloseProvider>);
    await waitFor(() => {
        expect(current?.app.state?.timer).toBeTruthy();
        expect(Object.keys(current.pm.state.tasks)).toHaveLength(tasks.length);
    });
    return { data, events, ...view, get current() { return current; },
        assertNoPending: () => { expect(current.app.pendingFinalizeTaskIds).toEqual([]); expect(pending.every(ids => ids.length === 0)).toBe(true); } };
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const noSheet = () => expect(screen.queryByRole("dialog", { name: "Switch task" })).not.toBeInTheDocument();
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};

describe("TaskCompletion controller", () => {
    it("guards a delayed pause when another task takes the window and finalizes the former occupant", async () => {
        const view = await setup();
        const gate = deferred();
        const pause = view.current.app.pauseTimer;
        const guardedPause = vi.spyOn(view.current.app, "pauseTimer").mockImplementation(async options => {
            await gate.promise;
            await pause(options);
        });
        const dataPause = vi.spyOn(view.data, "pauseTimer");
        const finalize = vi.spyOn(view.data, "finalizeTask");
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        const hold = view.current.memo!.holdMemoPresentation;
        const release = vi.fn();
        vi.spyOn(view.current.memo!, "holdMemoPresentation").mockImplementation(() => {
            const original = hold();
            return () => { release(); original(); };
        });
        let pending!: Promise<void>;
        act(() => { pending = view.current.completion.completeTask("pa"); });
        expect(guardedPause).toHaveBeenCalledExactlyOnceWith({ expect: { taskId: "a", windowStartedAt: W } });
        await act(async () => { await view.current.app.startTaskWork("b"); });
        await act(async () => { gate.resolve(); await pending; });
        expect(dataPause).not.toHaveBeenCalled();
        expect(finalize).toHaveBeenCalledExactlyOnceWith("a");
        expect(commit).not.toHaveBeenCalled();
        expect(view.current.app.state?.timer).toMatchObject({ task_id: "b", paused: false, window_started_at: W });
        expect(view.current.app.state?.tasks.a).toMatchObject({ completed_at: NOW, archived: true });
        expect(release).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(release).toHaveBeenCalledTimes(1);
        noSheet(); view.assertNoPending();
    });

    it("keeps completion durable without a sheet when End clears the window during the commit", async () => {
        const view = await setup();
        const gate = deferred();
        const commit = view.data.completeTaskKeepingWindow.bind(view.data);
        const pendingCommit = vi.spyOn(view.data, "completeTaskKeepingWindow").mockImplementation(async id => {
            await gate.promise;
            return commit(id);
        });
        const hold = view.current.memo!.holdMemoPresentation;
        const release = vi.fn();
        vi.spyOn(view.current.memo!, "holdMemoPresentation").mockImplementation(() => {
            const original = hold();
            return () => { release(); original(); };
        });
        let pending!: Promise<void>;
        act(() => { pending = view.current.completion.completeTask("pa"); });
        await waitFor(() => expect(pendingCommit).toHaveBeenCalledTimes(1));
        await act(async () => { await view.current.app.stopWork(); });
        expect(view.current.app.state?.timer).toBeNull();
        await act(async () => { gate.resolve(); await pending; });
        expect(view.current.app.state?.tasks.a).toMatchObject({ completed_at: NOW, archived: true });
        expect(view.data.store.state.tasks.a).toMatchObject({ completed_at: NOW, archived: true });
        expect(view.current.app.state?.timer).toBeNull();
        expect(view.current.completion.busy).toBe(false);
        expect(release).toHaveBeenCalledTimes(1);
        noSheet(); view.assertNoPending();
        act(() => view.current.memo!.openMemo("b"));
        await screen.findByRole("dialog", { name: "What were you doing in Task B?" });
        view.unmount();
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("serializes different completions, deduplicates queued and running ids, and preserves pausedAt for handoff", async () => {
        const view = await setup({ tasks: [pmTask("a"), pmTask("b"), pmTask("c")], backendIds: ["a", "b", "c"] });
        const pauseGate = deferred();
        const finalizeGate = deferred();
        const pause = view.data.pauseTimer.bind(view.data);
        vi.spyOn(view.data, "pauseTimer").mockImplementation(async () => {
            const result = await pause();
            await pauseGate.promise;
            return result;
        });
        const finalize = view.data.finalizeTask.bind(view.data);
        const finalizing = vi.spyOn(view.data, "finalizeTask").mockImplementation(async id => {
            await finalizeGate.promise;
            return finalize(id);
        });
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => { first = view.current.completion.completeTask("pa"); });
        await waitFor(() => expect(view.current.app.state?.timer?.paused).toBe(true));
        act(() => { second = view.current.completion.completeAppTask("b"); });
        await act(async () => {
            await view.current.completion.completeAppTask("a");
            await view.current.completion.completeTask("pb");
        });
        expect(view.current.completion.busy).toBe(true);
        expect(finalizing).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        await act(async () => { pauseGate.resolve(); await first; });
        expect(commit).toHaveBeenCalledExactlyOnceWith("a");
        expect(finalizing).toHaveBeenCalledExactlyOnceWith("b");
        expect(view.current.completion.busy).toBe(true);
        await act(async () => {
            await view.current.completion.completeTask("pb");
            finalizeGate.resolve(); await second;
        });
        expect(finalizing).toHaveBeenCalledTimes(1);
        expect(view.current.completion.busy).toBe(false);
        vi.setSystemTime(new Date("2026-11-09T14:08:00.000Z"));
        fireEvent.click(within(screen.getByRole("dialog", { name: "Switch task" })).getByRole("button", { name: /Task C/ }));
        await waitFor(() => expect(view.current.app.state?.timer?.task_id).toBe("c"));
        expect(view.events).toEqual([
            { type: "leave", reason: "pause", taskId: "a", windowId: W, at: NOW },
            { type: "leave", reason: "switch", taskId: "a", windowId: W, at: "2026-11-09T14:08:00.000Z", pausedAt: NOW },
            { type: "enter", reason: "switch", taskId: "c", windowId: W, at: "2026-11-09T14:08:00.000Z", fromTaskId: "a" },
        ]);
        expect(view.data.store.state.logs.filter(log => log.work_window_id === W)).toHaveLength(1);
        noSheet(); view.assertNoPending();
    });

    it("evaluates a queued task against the occupant and time at the head of the FIFO", async () => {
        const view = await setup();
        const gate = deferred();
        const finalize = view.data.finalizeTask.bind(view.data);
        const finalizing = vi.spyOn(view.data, "finalizeTask").mockImplementationOnce(async id => {
            await gate.promise;
            return finalize(id);
        });
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        const pause = vi.spyOn(view.data, "pauseTimer");
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = view.current.completion.completeTask("pb");
            second = view.current.completion.completeTask("pa");
        });
        expect(view.current.completion.busy).toBe(true);
        vi.setSystemTime(new Date("2026-11-09T14:30:00.000Z"));
        await act(async () => { gate.resolve(); await Promise.all([first, second]); });
        expect(finalizing.mock.calls).toEqual([["b"], ["a"]]);
        expect(pause).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(view.current.app.state?.timer?.kind).toBe("ShortBreak");
        expect(view.current.completion.busy).toBe(false);
        noSheet(); view.assertNoPending();
    });

    it("uses the previous completion's latest backend state for the next availability decision", async () => {
        const view = await setup();
        const gate = deferred();
        const finalize = view.data.finalizeTask.bind(view.data);
        vi.spyOn(view.data, "finalizeTask").mockImplementationOnce(async id => {
            await gate.promise;
            return finalize(id);
        });
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = view.current.completion.completeTask("pb");
            second = view.current.completion.completeTask("pa");
        });
        await act(async () => { gate.resolve(); await Promise.all([first, second]); });
        expect(screen.getByText("Nothing to switch to right now: 1 task is already finished on the timer.")).toBeVisible();
        expect(view.current.app.state?.tasks.b.archived).toBe(true);
        expect(view.current.completion.busy).toBe(false);
        view.assertNoPending();
    });

    it("rejects a failed sequence and still runs the next queued completion", async () => {
        const view = await setup();
        const gate = deferred();
        vi.spyOn(view.data, "pauseTimer").mockImplementationOnce(async () => {
            await gate.promise;
            throw new Error("Pause unavailable");
        });
        const finalize = vi.spyOn(view.data, "finalizeTask");
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = view.current.completion.completeTask("pa");
            second = view.current.completion.completeTask("pb");
        });
        expect(finalize).not.toHaveBeenCalled();
        await act(async () => {
            const failure = expect(first).rejects.toThrow("Pause unavailable");
            gate.resolve();
            await failure;
            await second;
        });
        expect(finalize).toHaveBeenCalledExactlyOnceWith("b");
        expect(view.current.app.state?.tasks.b.archived).toBe(true);
        expect(view.current.completion.busy).toBe(false);
        noSheet(); view.assertNoPending();
    });

    it("abandons queued completions on unmount without extra commands or hold releases", async () => {
        const view = await setup();
        const gate = deferred();
        const pause = view.data.pauseTimer.bind(view.data);
        vi.spyOn(view.data, "pauseTimer").mockImplementation(async () => {
            const result = await pause();
            await gate.promise;
            return result;
        });
        const hold = view.current.memo!.holdMemoPresentation;
        const release = vi.fn();
        vi.spyOn(view.current.memo!, "holdMemoPresentation").mockImplementation(() => {
            const original = hold();
            return () => { release(); original(); };
        });
        const finalize = vi.spyOn(view.data, "finalizeTask");
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = view.current.completion.completeTask("pa");
            second = view.current.completion.completeTask("pb");
        });
        view.unmount();
        expect(release).toHaveBeenCalledTimes(1);
        await act(async () => { gate.resolve(); await Promise.all([first, second]); });
        expect(release).toHaveBeenCalledTimes(1);
        expect(finalize).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        noSheet(); view.assertNoPending();
    });

    it("finalizes a non-occupant without touching the timer (branch 1)", async () => {
        const view = await setup();
        const original = structuredClone(view.data.store.state.timer);
        const finalize = vi.spyOn(view.data, "finalizeTask");
        await act(async () => { await view.current.completion.completeTask("pb"); });
        expect(finalize).toHaveBeenCalledExactlyOnceWith("b");
        expect(view.current.app.state?.timer).toEqual(original);
        noSheet(); view.assertNoPending();
    });

    it("finalizes a depleted occupant and progresses to a break (branch 2)", async () => {
        const view = await setup({ timer: { paused: true, accumulated_secs: 1500, paused_remaining_secs: 0 } });
        const finalize = vi.spyOn(view.data, "finalizeTask");
        await act(async () => { await view.current.completion.completeTask("pa"); });
        expect(finalize).toHaveBeenCalledExactlyOnceWith("a");
        expect(view.current.app.state?.timer?.kind).toBe("ShortBreak");
        expect(view.data.store.state.logs.filter(log => log.work_window_id === W)).toHaveLength(1);
        expect(view.data.store.state.current_cycle_pomodoros).toBe(1);
        noSheet(); view.assertNoPending();
    });

    it("pauses once, commits durably, and keeps the window (branch 3)", async () => {
        const view = await setup();
        const pause = vi.spyOn(view.data, "pauseTimer");
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        await act(async () => { await view.current.completion.completeTask("pa"); });
        expect(pause).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledExactlyOnceWith("a");
        expect(view.current.app.state?.timer).toMatchObject({ task_id: "a", paused: true, window_started_at: W });
        expect(view.current.app.state?.tasks.a).toMatchObject({ completed_at: NOW, archived: true });
        expect(screen.getByRole("dialog", { name: "Switch task" })).toBeVisible();
        view.assertNoPending();
    });

    it("skips a second pause for an already paused occupant", async () => {
        const view = await setup({ timer: { paused: true, accumulated_secs: 300, paused_remaining_secs: 1200 } });
        const pause = vi.spyOn(view.data, "pauseTimer");
        await act(async () => { await view.current.completion.completeTask("pa"); });
        expect(pause).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog", { name: "Switch task" })).toBeVisible();
        view.assertNoPending();
    });

    it("hands the remainder to a candidate with one window log and pausedAt transitions", async () => {
        const view = await setup();
        await act(async () => { await view.current.completion.completeTask("pa"); });
        const remaining = view.current.app.state!.timer!.paused_remaining_secs;
        vi.setSystemTime(new Date("2026-11-09T14:08:00.000Z"));
        fireEvent.click(within(screen.getByRole("dialog", { name: "Switch task" })).getByRole("button", { name: /Task B/ }));
        await waitFor(() => expect(view.current.app.state?.timer?.task_id).toBe("b"));
        expect(view.current.app.state?.timer).toMatchObject({ window_started_at: W, paused: false });
        expect(Date.parse(view.current.app.state!.timer!.ends_at) - Date.now()).toBe(remaining! * 1000);
        expect(view.data.store.state.logs.filter(log => log.work_window_id === W)).toHaveLength(1);
        expect(view.events).toEqual([
            { type: "leave", reason: "pause", taskId: "a", windowId: W, at: NOW },
            { type: "leave", reason: "switch", taskId: "a", windowId: W, at: "2026-11-09T14:08:00.000Z", pausedAt: NOW },
            { type: "enter", reason: "switch", taskId: "b", windowId: W, at: "2026-11-09T14:08:00.000Z", fromTaskId: "a" },
        ]);
        noSheet(); view.assertNoPending();
    });

    it.each([
        ["blocked", { status: "Blocked" }, "blocked"],
        ["waiting", { waiting: { type: "agent", since: W } }, "waiting on someone"],
        ["backend-closed", {}, "already finished on the timer"],
        ["project-not-workable", { projectId: "off" }, "in projects not scheduled for today"],
    ] as const)("explains an unworkable %s candidate (branch 4)", async (reason, extra, explanation) => {
        const off: Project = { id: "off", name: "Off", color: "#fff", isArchived: false, sortOrder: 0,
            createdAt: W, updatedAt: W, workableDays: [2], workableStart: "09:00", workableEnd: "17:00" };
        const view = await setup({ tasks: [pmTask("a"), pmTask("b", extra)], projects: { off } });
        if (reason === "backend-closed") {
            await act(async () => { await view.data.archiveTask("b"); await view.current.app.refresh(); });
        }
        await act(async () => { await view.current.completion.completeTask("pa"); });
        expect(screen.getByRole("dialog", { name: "Switch task" })).toBeVisible();
        expect(screen.getByText(`Nothing to switch to right now: 1 task is ${explanation}.`)).toBeVisible();
        expect(screen.queryByText("Nothing else to switch to")).not.toBeInTheDocument();
        view.assertNoPending();
    });

    it("finalizes the only occupant without a sheet (branch 5)", async () => {
        const view = await setup({ tasks: [pmTask("a")] });
        const finalize = vi.spyOn(view.data, "finalizeTask");
        await act(async () => { await view.current.completion.completeTask("pa"); });
        expect(finalize).toHaveBeenCalledExactlyOnceWith("a");
        expect(view.current.app.state?.timer).toBeNull();
        expect(view.data.store.state.logs.filter(log => log.work_window_id === W)).toHaveLength(1);
        noSheet(); view.assertNoPending();
    });

    it("completes during a break without changing that timer", async () => {
        const view = await setup({ timer: { kind: "ShortBreak", started_at: NOW, ends_at: "2026-11-09T14:10:00.000Z" } });
        const timer = structuredClone(view.data.store.state.timer);
        const finalize = vi.spyOn(view.data, "finalizeTask");
        await act(async () => { await view.current.completion.completeTask("pa"); });
        expect(finalize).toHaveBeenCalledExactlyOnceWith("a");
        expect(view.current.app.state?.tasks.a.archived).toBe(true);
        expect(view.current.app.state?.timer).toEqual(timer);
        noSheet(); view.assertNoPending();
    });

    it.each([true, false])("handles an occupant without a PM twin, candidates=%s", async candidates => {
        const view = await setup({ tasks: candidates ? [pmTask("b")] : [] });
        const finalize = vi.spyOn(view.data, "finalizeTask");
        await act(async () => { await view.current.completion.completeAppTask("a"); });
        if (candidates) expect(screen.getByRole("dialog", { name: "Switch task" })).toBeVisible();
        else { expect(finalize).toHaveBeenCalledExactlyOnceWith("a"); noSheet(); }
        view.assertNoPending();
    });

    it("returns quietly for missing PM linkage or backend tasks", async () => {
        const view = await setup({ tasks: [pmTask("a", { appTaskId: undefined }), pmTask("b", { appTaskId: "missing" })] });
        const finalize = vi.spyOn(view.data, "finalizeTask");
        await act(async () => {
            await view.current.completion.completeTask("pa");
            await view.current.completion.completeTask("pb");
            await view.current.completion.completeTask("missing");
            await view.current.completion.completeAppTask("missing");
        });
        expect(finalize).not.toHaveBeenCalled(); noSheet(); view.assertNoPending();
    });

    it.each(["non-occupant", "depleted occupant", "only occupant", "break"] as const)("rejects finalize failure for %s and surfaces the error", async branch => {
        const view = await setup({
            tasks: branch === "only occupant" ? [pmTask("a")] : undefined,
            timer: branch === "depleted occupant" ? { paused: true, accumulated_secs: 1500, paused_remaining_secs: 0 }
                : branch === "break" ? { kind: "ShortBreak", started_at: NOW, ends_at: "2026-11-09T14:10:00.000Z" } : undefined,
        });
        const before = structuredClone(view.current.app.state);
        vi.spyOn(view.data, "finalizeTask").mockRejectedValueOnce(new Error("Finalize unavailable"));
        await act(async () => {
            await expect(view.current.completion.completeTask(branch === "non-occupant" ? "pb" : "pa")).rejects.toThrow("Finalize unavailable");
        });
        expect(view.current.app.error).toBe("Finalize unavailable");
        expect(view.current.app.state).toEqual(before);
        expect(view.current.completion.busy).toBe(false);
        noSheet(); view.assertNoPending();
    });

    it("rejects a commit failure, keeps the pause, surfaces error and releases the memo hold", async () => {
        const view = await setup();
        vi.spyOn(view.data, "completeTaskKeepingWindow").mockRejectedValue(new Error("Commit unavailable"));
        await act(async () => { await expect(view.current.completion.completeTask("pa")).rejects.toThrow("Commit unavailable"); });
        expect(view.current.app.state?.timer).toMatchObject({ task_id: "a", paused: true, window_started_at: W });
        expect(view.current.app.error).toBe("Commit unavailable");
        expect(view.current.completion.busy).toBe(false);
        noSheet(); view.assertNoPending();
        // The queued pause memo can present only once the controller releases.
        expect(await screen.findByRole("dialog", { name: "What were you doing in Task A?" })).toBeVisible();
    });

    it("rejects pause failure without committing or leaking a memo hold", async () => {
        const view = await setup();
        vi.spyOn(view.data, "pauseTimer").mockRejectedValue(new Error("Pause unavailable"));
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        await act(async () => { await expect(view.current.completion.completeTask("pa")).rejects.toThrow("Pause unavailable"); });
        expect(commit).not.toHaveBeenCalled();
        expect(view.current.app.state?.timer?.paused).toBe(false);
        expect(view.current.app.error).toBe("Pause unavailable");
        noSheet(); view.assertNoPending();
        act(() => view.current.memo!.openMemo("b"));
        await screen.findByRole("dialog", { name: "What were you doing in Task B?" });
    });

    it("holds before pause resolves, survives revision refresh, deduplicates and releases on Escape", async () => {
        const view = await setup();
        const pause = view.data.pauseTimer.bind(view.data);
        let releasePause!: () => void;
        const gate = new Promise<void>(resolve => { releasePause = resolve; });
        vi.spyOn(view.data, "pauseTimer").mockImplementation(async () => { const result = await pause(); await gate; return result; });
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        let first!: Promise<void>;
        act(() => { first = view.current.completion.completeTask("pa"); });
        await waitFor(() => expect(view.current.app.state?.timer?.paused).toBe(true));
        expect(view.current.completion.busy).toBe(true);
        act(() => view.current.memo!.openMemo("b"));
        // Drain the memo provider's scheduled presentation pass while pause is pending.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        await act(async () => {
            await view.current.app.refresh();
            await view.current.completion.completeTask("pa");
            releasePause(); await first;
        });
        expect(commit).toHaveBeenCalledTimes(1);
        expect(view.current.completion.busy).toBe(false);
        expect(screen.getByRole("dialog", { name: "Switch task" })).toBeVisible();
        fireEvent.keyDown(document, { key: "Escape" });
        noSheet();
        await screen.findByRole("dialog", { name: "What were you doing in Task B?" });
        expect(view.current.app.state?.timer).toMatchObject({ task_id: "a", paused: true, window_started_at: W });
        await act(async () => { await view.current.app.refresh(); });
        expect(view.current.app.state?.tasks.a).toMatchObject({ completed_at: NOW, archived: true });
        const reloaded = new InMemoryDataAccess(view.data.store.state);
        expect((await reloaded.fetchState()).state.tasks.a).toMatchObject({ completed_at: NOW, archived: true });
        view.assertNoPending();
    });

    it("releases its hold exactly once when unmounted during a pause", async () => {
        const view = await setup();
        const hold = view.current.memo!.holdMemoPresentation;
        const release = vi.fn();
        vi.spyOn(view.current.memo!, "holdMemoPresentation").mockImplementation(() => {
            const original = hold();
            return () => { release(); original(); };
        });
        let finish!: () => void;
        const gate = new Promise<void>(resolve => { finish = resolve; });
        const pause = view.data.pauseTimer.bind(view.data);
        vi.spyOn(view.data, "pauseTimer").mockImplementation(async () => { const result = await pause(); await gate; return result; });
        const commit = vi.spyOn(view.data, "completeTaskKeepingWindow");
        let pending!: Promise<void>;
        act(() => { pending = view.current.completion.completeTask("pa"); });
        view.unmount();
        expect(release).toHaveBeenCalledTimes(1);
        await act(async () => { finish(); await pending; });
        expect(release).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
        view.assertNoPending();
    });

    it("provides an optional null hook and a required throwing hook outside the provider", () => {
        function Optional() { expect(useOptionalTaskCompletion()).toBeNull(); return null; }
        render(<Optional />);
        function Required() { useTaskCompletion(); return null; }
        expect(() => render(<Required />)).toThrow("useTaskCompletion must be inside provider");
    });
});
