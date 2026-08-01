import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AppStateProvider, useAppState } from "./AppStateContext";
import { DataProvider } from "./DataContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState, makeActiveTimer } from "../test/mockTauri";

function Probe() {
    const { state, remainingMs, tick, createTask, startWork, pauseTimer, resumeTimer } = useAppState();
    return <div>
        <div data-testid="status">{state ? "loaded" : "loading"}</div>
        <div data-testid="task-count">{state ? Object.keys(state.tasks).length : 0}</div>
        <div data-testid="remaining">{remainingMs()}</div>
        <div data-testid="tick">{tick}</div>
        <button onClick={() => createTask("New Task", 3)}>create</button>
        <button onClick={() => startWork()}>start</button>
        <button onClick={() => pauseTimer()}>pause</button>
        <button onClick={() => resumeTimer()}>resume</button>
    </div>;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return <DataProvider dataAccess={data}><AppStateProvider>{children}</AppStateProvider></DataProvider>;
}

beforeEach(() => localStorage.clear());

describe("AppStateContext", () => {
    it("loads backend state on mount", async () => {
        const state = makeAppState({ tasks: { t1: { id: "t1", name: "Backend task", target_pomodoros: 2, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } } });
        const data = new InMemoryDataAccess(state);
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });

    it("computes remainingMs from ends_at", async () => {
        const data = new InMemoryDataAccess(makeAppState({ timer: makeActiveTimer({ ends_at: new Date(Date.now() + 600_000).toISOString() }) }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(Number(screen.getByTestId("remaining").textContent)).toBeGreaterThan(0));
    });

    it("auto-progresses an expired work timer into a break", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            active_task: "t1",
            tasks: { t1: { id: "t1", name: "Task", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false } },
            timer: makeActiveTimer({ task_id: "t1", ends_at: new Date(Date.now() - 1000).toISOString(), planned_secs: 1500 }),
        }));
        render(wrap(data, <Probe />));
        await waitFor(() => expect(data.store.state.timer?.kind).toBe("ShortBreak"));
        expect(data.store.state.logs).toHaveLength(1);
    });

    it("creates a task and refreshes", async () => {
        const data = new InMemoryDataAccess(makeAppState(), { createTaskId: () => "new-id" });
        render(wrap(data, <Probe />));
        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        await act(async () => screen.getByText("create").click());
        await waitFor(() => expect(data.store.state.tasks["new-id"]?.name).toBe("New Task"));
    });
});
