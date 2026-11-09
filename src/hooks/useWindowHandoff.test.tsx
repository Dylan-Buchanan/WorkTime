import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowHandoff } from "./useWindowHandoff";
import { makeActiveTimer, makeAppState } from "../test/mockTauri";

const contexts = vi.hoisted(() => ({ app: {} as any, pm: {} as any }));
vi.mock("../state/AppStateContext", () => ({ useAppState: () => contexts.app }));
vi.mock("../state/ProjectManagerContext", () => ({ usePM: () => contexts.pm }));
beforeEach(() => {
    contexts.app = { state: makeAppState({ timer: makeActiveTimer({ paused: true }) }), resumeTimer: vi.fn().mockResolvedValue(undefined), startTaskWork: vi.fn().mockResolvedValue("joined"), setActiveTask: vi.fn().mockResolvedValue(undefined) };
    contexts.pm = { state: { tasks: { candidate: { id: "candidate", appTaskId: "b", title: "Candidate" } } }, linkFailures: {}, retryLink: vi.fn() };
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
