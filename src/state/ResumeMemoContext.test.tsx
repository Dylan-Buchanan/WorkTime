import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ResumeMemoProvider, useOptionalResumeMemo, useResumeMemo, type ResumeMemoContextValue } from "./ResumeMemoContext";
import { makeAppState } from "../test/mockTauri";
import * as store from "../lib/resume";
import type { TimerTransitionEvent } from "./timerTransitions";
import type { PMTask } from "./types";

vi.mock("./AppStateContext", () => ({ useAppState: () => app }));
vi.mock("./ProjectManagerContext", () => ({ usePM: () => pm }));
const listeners = new Set<(event: TimerTransitionEvent) => void>();
const unsubscribe = vi.fn();
const subscribe = vi.fn((listener: (event: TimerTransitionEvent) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); unsubscribe(); };
});
const app = { state: makeAppState(), subscribeTimerTransitions: subscribe };
const pm = { state: { tasks: {} as Record<string, PMTask> } };
const P = "2026-11-09T14:03:00.000Z";
const W = "2026-11-09T14:00:00.000Z";
const memo = { whereIAm: "Parser", nextAction: "Cover errors", savedAt: "2026-11-09T14:04:00.000Z" };
let context!: ResumeMemoContextValue;
function Probe() {
    context = useResumeMemo();
    return <><button onClick={() => context.openMemo("A")}>Add note</button><span data-testid="version">{context.notesVersion}</span></>;
}
const tree = () => <ResumeMemoProvider><Probe /></ResumeMemoProvider>;
function emit(event: TimerTransitionEvent) { act(() => { for (const listener of [...listeners]) listener(event); }); }
function leave(reason: "pause" | "stop" | "switch", pausedAt?: string, taskId = "A") {
    emit({ type: "leave", taskId, reason, at: P, windowId: W, ...(pausedAt ? { pausedAt } : {}) });
}
function switchTo(taskId = "B", pausedAt?: string) {
    act(() => {
        leave("switch", pausedAt);
        emit({ type: "enter", taskId, reason: "switch", at: P, windowId: W, fromTaskId: "A" });
    });
}
async function settle() { await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 10)); }); }
async function save(value = "  Draft  ") {
    fireEvent.change(screen.getByLabelText("Where I am"), { target: { value } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save note" })));
}
beforeEach(() => {
    vi.restoreAllMocks(); listeners.clear(); subscribe.mockClear(); unsubscribe.mockClear();
    app.state = makeAppState({ tasks: Object.fromEntries(["A", "B", "C"].map(id => [id, {
        id, name: `Task ${id}`, target_pomodoros: 2, completed_pomodoros: 0, created_at: W, completed_at: null, archived: false, break_skips: 0,
    }])) });
    pm.state = { tasks: {} };
});

describe("ResumeMemoProvider", () => {
    it("subscribes in an effect, cleans up on unmount, and invents no cold-load enter", async () => {
        const view = render(tree());
        await settle();
        expect(context.lastEnter).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(subscribe).toHaveBeenCalledOnce();
        view.unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(listeners.size).toBe(0);
    });

    it("opens the same editable sheet from a card action without fabricating an event", async () => {
        store.saveResumeNote("A", memo);
        render(tree());
        fireEvent.click(screen.getByRole("button", { name: "Add note" }));
        await screen.findByRole("dialog");
        expect(screen.getByLabelText("Where I am")).toHaveValue("Parser");
        expect(context.lastEnter).toBeNull();
        expect(context.notesVersion).toBe(0);
    });

    it("keeps enter recording independent of holds and clears it for any leave", async () => {
        render(tree());
        const release = context.holdMemoPresentation();
        for (const reason of ["start", "resume", "switch", "break-end"] as const) {
            emit({ type: "enter", taskId: "B", reason, at: P, windowId: W });
            await waitFor(() => expect(context.lastEnter?.reason).toBe(reason));
        }
        leave("pause");
        await waitFor(() => expect(context.lastEnter).toBeNull());
        expect(screen.queryByRole("dialog")).toBeNull();
        act(() => { release(); release(); });
        await screen.findByRole("dialog");
    });

    it("trims fields, omits an empty blocker, stamps submission time, and increments only after saving", async () => {
        const write = vi.spyOn(store, "saveResumeNote");
        render(tree()); leave("pause");
        await screen.findByRole("dialog");
        fireEvent.change(screen.getByLabelText("Next action"), { target: { value: "  Next  " } });
        fireEvent.change(screen.getByLabelText("Open question or blocker (optional)"), { target: { value: "  " } });
        const before = Date.now();
        await save();
        expect(write).toHaveBeenCalledExactlyOnceWith("A", { whereIAm: "Draft", nextAction: "Next", savedAt: expect.any(String) });
        expect(Date.parse(write.mock.calls[0][1].savedAt)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(write.mock.calls[0][1].savedAt)).toBeLessThanOrEqual(Date.now());
        expect(context.notesVersion).toBe(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it.each(["whereIAm", "nextAction", "blocker"] as const)("accepts %s as the only nonempty field", async (field) => {
        render(tree()); leave("pause"); await screen.findByRole("dialog");
        fireEvent.change(screen.getByLabelText({ whereIAm: "Where I am", nextAction: "Next action", blocker: "Open question or blocker (optional)" }[field]), { target: { value: "  Only  " } });
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save note" })));
        expect(store.getResumeNote("A")).toMatchObject({ [field]: "Only" });
        expect(context.notesVersion).toBe(1);
    });

    it.each(["escape", "whitespace"])("abandons %s without writing or changing the version", async method => {
        const write = vi.spyOn(store, "saveResumeNote");
        render(tree()); leave("stop"); await screen.findByRole("dialog");
        if (method === "escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        else await save("  ");
        expect(write).not.toHaveBeenCalled();
        expect(context.notesVersion).toBe(0);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("stores 160-character drafts at 140 code points with the boundary emoji intact", async () => {
        render(tree()); leave("pause"); await screen.findByRole("dialog");
        await save("x".repeat(139) + "😀" + "y".repeat(20));
        expect(store.getResumeNote("A")?.whereIAm).toBe("x".repeat(139) + "😀");
        expect(Array.from(store.getResumeNote("A")!.whereIAm)).toHaveLength(140);
    });

    it.each(["unavailable", "write-failed"] as const)("retains the draft on %s and permits a successful retry", async reason => {
        const write = vi.spyOn(store, "saveResumeNote").mockReturnValueOnce({ ok: false, reason, note: memo });
        render(tree()); leave("pause"); await screen.findByRole("dialog");
        await save();
        expect(screen.getByText("Could not save your note. Please try again.")).toBeVisible();
        expect(screen.getByLabelText("Where I am")).toHaveValue("  Draft  ");
        expect(context.notesVersion).toBe(0);
        await act(async () => fireEvent.keyDown(screen.getByLabelText("Where I am"), { key: "Enter" }));
        expect(write).toHaveBeenCalledTimes(2);
        expect(store.getResumeNote("A")?.whereIAm).toBe("Draft");
        expect(context.notesVersion).toBe(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("increments the version only for successful stored-note dismissal", () => {
        store.saveResumeNote("A", memo);
        const dismiss = vi.spyOn(store, "dismissResumeNote");
        render(tree());
        act(() => context.dismissNote("missing"));
        expect(context.notesVersion).toBe(0);
        act(() => context.dismissNote("A"));
        expect(context.notesVersion).toBe(1);
        expect(dismiss).toHaveBeenLastCalledWith("A", expect.any(String));
        expect(store.getResumeNote("A")?.dismissedAt).toBeTruthy();
    });

    it.each([
        { name: "saved after pause", savedAt: memo.savedAt, pausedAt: P, captured: true },
        { name: "timestamp equality", savedAt: P, pausedAt: P, captured: true },
        { name: "yesterday's memo", savedAt: "2026-11-08T14:04:00Z", pausedAt: P, captured: false },
        { name: "cold paused reload", savedAt: memo.savedAt, pausedAt: undefined, captured: false },
        { name: "dismissed after pause", savedAt: memo.savedAt, pausedAt: P, captured: true, dismissedAt: memo.savedAt },
        { name: "resumed episode", savedAt: memo.savedAt, pausedAt: undefined, captured: false, resumed: true },
    ])("applies suppression to $name for switch and stop", async row => {
        store.saveResumeNote("A", { ...memo, savedAt: row.savedAt });
        if (row.dismissedAt) store.dismissResumeNote("A", row.dismissedAt);
        const write = vi.spyOn(store, "saveResumeNote");
        render(tree());
        if (row.resumed) emit({ type: "enter", taskId: "A", reason: "resume", at: P, windowId: W });
        switchTo("B", row.pausedAt);
        await screen.findByRole("dialog");
        if (row.captured) {
            expect(screen.queryByRole("textbox")).toBeNull();
            expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
            fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
        } else {
            expect(screen.getByLabelText("Where I am")).toHaveValue("Parser");
            fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        }
        expect(write).not.toHaveBeenCalled();
        leave("stop", row.pausedAt);
        await settle();
        expect(Boolean(screen.queryByRole("dialog"))).toBe(!row.captured);
    });

    it("always edits a pause or explicit opener even when a recent memo exists", async () => {
        store.saveResumeNote("A", memo);
        render(tree()); leave("pause"); await screen.findByRole("dialog");
        expect(screen.getByLabelText("Where I am")).toHaveValue("Parser");
    });

    it("keeps active drafts and later leaves, switch pairs and openers in FIFO order", async () => {
        render(tree()); leave("pause"); await screen.findByRole("dialog");
        fireEvent.change(screen.getByLabelText("Where I am"), { target: { value: "Do not overwrite" } });
        switchTo("B");
        leave("stop", undefined, "B");
        act(() => context.openMemo("C"));
        emit({ type: "enter", taskId: "C", reason: "start", at: W, windowId: W });
        await settle();
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        expect(screen.getByLabelText("Where I am")).toHaveValue("Do not overwrite");
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        await screen.findByRole("heading", { name: "Task B" });
        expect(screen.getByRole("dialog")).toHaveAccessibleName("What were you doing in Task A?");
        expect(screen.queryByRole("heading", { name: "Task C" })).toBeNull();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        await screen.findByRole("dialog", { name: "What were you doing in Task B?" });
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        await screen.findByRole("dialog", { name: "What were you doing in Task C?" });
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        await settle();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("snapshots notes on dequeue and never opens for unpaired or mismatched switch enters", async () => {
        render(tree());
        const release = context.holdMemoPresentation();
        switchTo();
        store.saveResumeNote("B", { ...memo, whereIAm: "Incoming while held" });
        store.dismissResumeNote("B", memo.savedAt);
        emit({ type: "enter", taskId: "C", reason: "start", at: W, windowId: W });
        act(() => release());
        await screen.findByText("Incoming while held");
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        emit({ type: "enter", taskId: "B", reason: "switch", at: P, windowId: W, fromTaskId: "A" });
        leave("switch");
        emit({ type: "enter", taskId: "C", reason: "switch", at: W, windowId: W, fromTaskId: "A" });
        await settle();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(context.lastEnter?.taskId).toBe("C");
    });

    it.each(["missing", "completed", "archived", "pm-archived"])("revalidates %s tasks before submit and before dequeue", async terminal => {
        const write = vi.spyOn(store, "saveResumeNote");
        const view = render(tree()); leave("pause"); await screen.findByRole("dialog");
        act(() => context.openMemo("A"));
        if (terminal === "missing") { const { A: _removed, ...tasks } = app.state.tasks; app.state = { ...app.state, tasks }; }
        if (terminal === "completed") app.state = { ...app.state, tasks: { ...app.state.tasks, A: { ...app.state.tasks.A, completed_at: P } } };
        if (terminal === "archived") app.state = { ...app.state, tasks: { ...app.state.tasks, A: { ...app.state.tasks.A, archived: true } } };
        if (terminal === "pm-archived") pm.state = { tasks: { linked: { id: "linked", appTaskId: "A", isArchived: true, sortOrder: 0, createdAt: W } as PMTask } };
        view.rerender(tree());
        await save(); await settle();
        expect(write).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("permits missing PM metadata and a break underneath the outgoing draft using retained openers", async () => {
        const view = render(tree());
        const retainedOpen = context.openMemo;
        leave("pause"); await screen.findByRole("dialog");
        app.state = { ...app.state, active_task: "B", timer: { task_id: "B", kind: "ShortBreak", started_at: W, ends_at: P } };
        view.rerender(tree()); await save();
        expect(store.getResumeNote("A")?.whereIAm).toBe("Draft");
        app.state = { ...app.state, tasks: { ...app.state.tasks, A: { ...app.state.tasks.A, archived: true } } };
        view.rerender(tree());
        act(() => retainedOpen("A")); await settle();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("allows existing drafts to remain visible while nested idempotent holds block new presentation", async () => {
        render(tree()); leave("pause"); await screen.findByRole("dialog");
        await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
        const first = context.holdMemoPresentation(); const second = context.holdMemoPresentation();
        act(() => context.openMemo("B"));
        expect(screen.getByRole("dialog")).toBeVisible();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        act(() => { first(); first(); }); await settle();
        expect(screen.queryByRole("dialog")).toBeNull();
        act(() => second()); await screen.findByRole("dialog", { name: "What were you doing in Task B?" });
    });

    it("returns undefined from the optional hook and throws from the strict hook outside its provider", () => {
        function Optional() { return <span>{String(useOptionalResumeMemo())}</span>; }
        render(<Optional />);
        expect(screen.getByText("undefined")).toBeVisible();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => render(<Probe />)).toThrow("useResumeMemo must be used within ResumeMemoProvider");
        error.mockRestore();
    });
});
