import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AppStateProvider, useAppState } from "./AppStateContext";
import { makeAppState, makeActiveTimer } from "../test/mockTauri";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function Probe() {
    const { state, remainingMs, tick, createTask, startWork, pauseTimer, resumeTimer } = useAppState();
    return (
        <div>
            <div data-testid="status">{state ? "loaded" : "loading"}</div>
            <div data-testid="task-count">{state ? Object.keys(state.tasks).length : 0}</div>
            <div data-testid="remaining">{remainingMs()}</div>
            <div data-testid="tick">{tick}</div>
            <button onClick={() => createTask("New Task", 3)}>create</button>
            <button onClick={() => startWork()}>start</button>
            <button onClick={() => pauseTimer()}>pause</button>
            <button onClick={() => resumeTimer()}>resume</button>
        </div>
    );
}

beforeEach(() => {
    invokeMock.mockReset();
});

describe("AppStateContext", () => {
    it("loads backend state on mount", async () => {
        const state = makeAppState({
            tasks: {
                t1: {
                    id: "t1",
                    name: "Backend task",
                    target_pomodoros: 2,
                    completed_pomodoros: 0,
                    created_at: "2026-01-01T00:00:00Z",
                    completed_at: null,
                    break_skips: 0,
                    archived: false,
                },
            },
        });
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === "get_state") return state;
            throw new Error("unexpected command " + cmd);
        });

        render(
            <AppStateProvider>
                <Probe />
            </AppStateProvider>
        );

        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        expect(screen.getByTestId("task-count")).toHaveTextContent("1");
        expect(invokeMock).toHaveBeenCalledWith("get_state");
    });

    it("computes remainingMs from ends_at", async () => {
        const timer = makeActiveTimer({ ends_at: new Date(Date.now() + 10 * 60_000).toISOString(), kind: "Work" });
        const state = makeAppState({ timer });
        invokeMock.mockImplementation(async (cmd: string) => (cmd === "get_state" ? state : state));

        render(
            <AppStateProvider>
                <Probe />
            </AppStateProvider>
        );

        await waitFor(() => expect(screen.getByTestId("remaining")).not.toHaveTextContent("0"));
        expect(Number(screen.getByTestId("remaining").textContent)).toBeGreaterThan(0);
    });

    it("auto-progresses an expired work timer into a break", async () => {
        const initial = makeAppState({
            active_task: "t1",
            tasks: {
                t1: {
                    id: "t1",
                    name: "Task",
                    target_pomodoros: 1,
                    completed_pomodoros: 0,
                    created_at: "2026-01-01T00:00:00Z",
                    completed_at: null,
                    break_skips: 0,
                    archived: false,
                },
            },
            timer: makeActiveTimer({
                ends_at: new Date(Date.now() - 1000).toISOString(),
                planned_secs: 25 * 60,
            }),
        });

        let s: any = initial;
        invokeMock.mockImplementation(async (cmd: string) => {
            switch (cmd) {
                case "get_state":
                    return s;
                case "complete_timer":
                    s = {
                        ...s,
                        timer: null,
                        current_cycle_pomodoros: s.current_cycle_pomodoros + 1,
                        logs: [{ task_id: "t1", duration_minutes: 25, finished_at: new Date().toISOString(), was_break: false, break_skipped: false }],
                    };
                    return s;
                case "start_break_timer":
                    s = { ...s, timer: makeActiveTimer({ kind: "ShortBreak", planned_secs: 5 * 60, ends_at: new Date(Date.now() + 5 * 60_000).toISOString() }) };
                    return s.timer;
                default:
                    throw new Error("unexpected command " + cmd);
            }
        });

        render(
            <AppStateProvider>
                <Probe />
            </AppStateProvider>
        );

        // The end-detection effect fires on mount once the expired timer loads.
        await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("complete_timer"));
        await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("start_break_timer"));
    });

    it("createTask invokes create_task with payload and refreshes", async () => {
        const state = makeAppState();
        const createdTask = {
            id: "new-id",
            name: "New Task",
            target_pomodoros: 3,
            completed_pomodoros: 0,
            created_at: "2026-01-01T00:00:00Z",
            completed_at: null,
            break_skips: 0,
            archived: false,
        };
        invokeMock.mockImplementation(async (cmd: string, args?: any) => {
            if (cmd === "get_state") return state;
            if (cmd === "create_task") {
                expect(args).toEqual({ payload: { name: "New Task", target_pomodoros: 3 } });
                return createdTask;
            }
            throw new Error("unexpected command " + cmd);
        });

        render(
            <AppStateProvider>
                <Probe />
            </AppStateProvider>
        );

        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("loaded"));
        await act(async () => {
            screen.getByText("create").click();
        });
        await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_task", { payload: { name: "New Task", target_pomodoros: 3 } }));
    });
});
