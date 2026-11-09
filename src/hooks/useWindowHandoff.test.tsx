import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowHandoff } from "./useWindowHandoff";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";

const contexts = vi.hoisted(() => ({ app: {} as any, pm: {} as any }));
vi.mock("../state/AppStateContext", () => ({ useAppState: () => contexts.app }));
vi.mock("../state/ProjectManagerContext", () => ({ usePM: () => contexts.pm }));
beforeEach(() => {
    contexts.app = { state: makeAppState({ timer: makeActiveTimer({ paused: true }) }), resumeTimer: vi.fn().mockResolvedValue(undefined), startTaskWork: vi.fn().mockResolvedValue("joined"), setActiveTask: vi.fn().mockResolvedValue(undefined) };
    contexts.pm = { state: { projects: {}, tasks: { candidate: { id: "candidate", appTaskId: "b", title: "Candidate" } } }, linkFailures: {}, retryLink: vi.fn() };
});
describe("useWindowHandoff", () => {
    it("awaits resume before joining and finishing the selection", async () => {
        let release!: () => void;
        contexts.app.resumeTimer.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
        const close = vi.fn();
        const { result } = renderHook(() => useWindowHandoff(close));
        act(() => result.current.select("candidate"));
        expect(contexts.app.resumeTimer).toHaveBeenCalledOnce();
        expect(contexts.app.startTaskWork).not.toHaveBeenCalled();
        await act(async () => { release(); });
        expect(contexts.app.startTaskWork).toHaveBeenCalledWith("b");
        expect(close).toHaveBeenCalledOnce();
    });
    it("cancels a pending link so a later context update cannot hand over", async () => {
        contexts.pm.state.tasks.candidate.appTaskId = undefined;
        const close = vi.fn();
        const { result, rerender } = renderHook(() => useWindowHandoff(close));
        act(() => result.current.select("candidate"));
        expect(result.current.busyTaskId).toBe("candidate");
        act(() => result.current.cancel());
        contexts.pm.state.tasks.candidate.appTaskId = "b";
        rerender();
        await waitFor(() => expect(result.current.busyTaskId).toBeNull());
        expect(contexts.app.startTaskWork).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
    it("does not hand over after dismissal during an awaited resume", async () => {
        let release!: () => void;
        contexts.app.resumeTimer.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
        const close = vi.fn();
        const { result } = renderHook(() => useWindowHandoff(close));
        act(() => result.current.select("candidate"));
        act(() => result.current.cancel());
        await act(async () => { release(); });
        expect(contexts.app.startTaskWork).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
});


it.each(["Done", "Blocked", "archived", "waiting", "project", "backend-completed", "backend-archived"])("revalidates %s eligibility after an awaited resume", async (kind) => {
    let release!: () => void;
    contexts.app.resumeTimer.mockReturnValue(new Promise<void>(r => { release = r; }));
    const { result, rerender } = renderHook(() => useWindowHandoff(vi.fn()));
    act(() => result.current.select("candidate"));
    const task = contexts.pm.state.tasks.candidate;
    if (kind === "Done" || kind === "Blocked") task.status = kind;
    if (kind === "archived") task.isArchived = true;
    if (kind === "waiting") task.waiting = { type: "agent", since: new Date().toISOString() };
    if (kind === "project") { task.projectId = "p"; contexts.pm.state.projects.p = { workableDays: [(new Date().getDay() + 1) % 7] }; }
    if (kind.startsWith("backend")) contexts.app.state.tasks.b = { completed_at: kind === "backend-completed" ? new Date().toISOString() : null, archived: kind === "backend-archived" };
    rerender();
    await act(async () => { release(); });
    expect(contexts.app.startTaskWork).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/no longer eligible/i);
    expect(result.current.busyTaskId).toBeNull();
});

it("cancels an ineligible pending link and does not hand off when linkage arrives", async () => {
    contexts.pm.state.tasks.candidate.appTaskId = undefined;
    const { result, rerender } = renderHook(() => useWindowHandoff(vi.fn()));
    act(() => result.current.select("candidate"));
    contexts.pm.state.tasks.candidate.status = "Done";
    rerender();
    await waitFor(() => expect(result.current.busyTaskId).toBeNull());
    expect(result.current.error).toMatch(/no longer eligible/i);
    contexts.pm.state.tasks.candidate.appTaskId = "b";
    rerender();
    expect(contexts.app.startTaskWork).not.toHaveBeenCalled();
});
