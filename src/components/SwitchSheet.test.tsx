import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { ResumeMemoProvider, useResumeMemo } from "../state/ResumeMemoContext";
import { AppStateProvider, useAppState } from "../state/AppStateContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import { SWITCH_SHEET_FOCUS_FALLBACK_ID, SwitchSheet, type SwitchSheetProps } from "./SwitchSheet";
import type { RankedCandidate } from "../lib/whatsNext";
import { normalizeProjectSchedule } from "../lib/projectSchedule";
import { OVERLAY_TIER_CLASS, TOP_SHEET_TIER_CLASS } from "../lib/overlayLayers";

/** Counts every call to the release function handed to the sheet, so a double release is visible. */
const memoReleases = vi.hoisted(() => ({ count: 0 }));
vi.mock("../state/ResumeMemoContext", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../state/ResumeMemoContext")>();
    const wrapped = new WeakMap<() => () => void, () => () => void>();
    return {
        ...actual,
        useOptionalResumeMemo: () => {
            const value = actual.useOptionalResumeMemo();
            if (!value) return undefined;
            let hold = wrapped.get(value.holdMemoPresentation);
            if (!hold) {
                const original = value.holdMemoPresentation;
                hold = () => {
                    const release = original();
                    return () => { memoReleases.count += 1; release(); };
                };
                wrapped.set(original, hold);
            }
            return { ...value, holdMemoPresentation: hold };
        },
    };
});

function candidate(id: string, tier: RankedCandidate["tier"], remainingPomodoros = 1.5): RankedCandidate {
    return {
        task: { id, title: `Task ${id}`, projectId: "project", status: "Next", priority: "High", tags: [], links: [], checklist: [], relatedTo: [], sortOrder: 0, isArchived: false, timeSpentMinutes: 0, createdAt: "2026-11-08", updatedAt: "2026-11-08" },
        projectId: "project", dueDate: "2026-11-09", dueKey: "2026-11-09", remainingPomodoros, tier,
    };
}
function props(overrides: Partial<SwitchSheetProps> = {}): SwitchSheetProps {
    return { mode: "switch", result: { top: [candidate("a", "top-pick")], continuation: [] }, projects: { project: { id: "project", name: "WorkTime", color: "#123456", ...normalizeProjectSchedule(null), isArchived: false, sortOrder: 0, createdAt: "2026-11-08", updatedAt: "2026-11-08" } }, linkStateOf: () => "ready", onSelect: vi.fn(), onClose: vi.fn(), ...overrides };
}

describe("SwitchSheet", () => {
    it("holds queued memo presentation through StrictMode focus cleanup and restores the invoker before the memo focuses", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { A: {
            id: "A", name: "Task A", target_pomodoros: 2, completed_pomodoros: 0, completed_at: null,
            archived: false, break_skips: 0, created_at: "2026-11-09T14:00:00Z",
        } } }));
        function Flow() {
            const memo = useResumeMemo();
            const app = useAppState();
            const [open, setOpen] = useState(false);
            return <>
                <button disabled={!app.state} onClick={() => setOpen(true)}>Open switch</button>
                {open && <SwitchSheet {...props({ onSelect: () => memo.openMemo("A"), onClose: () => setOpen(false) })} />}
            </>;
        }
        render(<StrictMode><TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="sheet-hold-owner">
            <AppStateProvider><ProjectManagerProvider><ResumeMemoProvider><Flow /></ResumeMemoProvider></ProjectManagerProvider></AppStateProvider>
        </SyncProvider></DataProvider></TauriCloseProvider></StrictMode>);
        const invoker = await screen.findByRole("button", { name: "Open switch" });
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)); });
        expect(invoker).toBeEnabled();
        invoker.focus(); fireEvent.click(invoker);
        fireEvent.click(screen.getByRole("button", { name: /Task a/ }));
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)); });
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        expect(screen.getByRole("dialog", { name: "Switch task" })).toHaveFocus();
        expect(screen.queryByLabelText("Where I am")).toBeNull();
        const focusOrder: EventTarget[] = [];
        const onFocus = (event: FocusEvent) => { if (event.target) focusOrder.push(event.target); };
        document.addEventListener("focusin", onFocus);
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        const memoDialog = await screen.findByRole("dialog", { name: "What were you doing in Task A?" });
        await waitFor(() => expect(memoDialog).toHaveFocus());
        document.removeEventListener("focusin", onFocus);
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        expect(memoDialog).toHaveFocus();
        expect(focusOrder.indexOf(invoker)).toBeGreaterThanOrEqual(0);
        expect(focusOrder.indexOf(memoDialog)).toBeGreaterThan(focusOrder.indexOf(invoker));
        fireEvent.keyDown(memoDialog, { key: "Escape" });
        expect(invoker).toHaveFocus();
    });
    it("labels a modal, renders card details and only present tier headers", () => {
        const input = props({ result: { top: [candidate("a", "top-pick"), candidate("c", "next-up")], continuation: [] } });
        render(<SwitchSheet {...input} />);
        const dialog = screen.getByRole("dialog", { name: "Switch task" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(dialog).toHaveAttribute("aria-labelledby", screen.getByRole("heading", { name: "Switch task" }).id);
        expect(screen.getByRole("heading", { name: "Top pick" })).toBeVisible();
        expect(screen.getByRole("heading", { name: "Next up" })).toBeVisible();
        expect(screen.queryByRole("heading", { name: "Quick win" })).toBeNull();
        const card = screen.getByRole("button", { name: /Task a/ });
        for (const value of ["Task a", "WorkTime", "1.5p left", "Due 2026-11-09", "High", "Next"]) expect(within(card).getByText(value)).toBeVisible();
        expect(card.querySelector('[aria-hidden="true"]')).toHaveStyle({ backgroundColor: "#123456" });
        fireEvent.click(card);
        expect(input.onSelect).toHaveBeenCalledWith("a");
    });
    it("collapses Other options initially, expands it and shows the un-estimated tail", () => {
        render(<SwitchSheet {...props({ result: { top: [candidate("a", "quick-win")], continuation: [candidate("tail", null, 0)] } })} />);
        expect(screen.getByRole("heading", { name: "Quick win" })).toBeVisible();
        const toggle = screen.getByRole("button", { name: "Other options" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("Task tail")).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("No estimate")).toBeVisible();
        fireEvent.click(toggle);
        expect(screen.queryByText("Task tail")).toBeNull();
    });
    it("shows an explicit empty state", () => {
        render(<SwitchSheet {...props({ result: { top: [], continuation: [] } })} />);
        expect(screen.getByText("Nothing else to switch to")).toBeVisible();
    });
    it("shows the waiting header and Agent/Person pressed state", () => {
        const input = props({ mode: "waiting", waitingType: "person", onSetWaitingType: vi.fn() });
        render(<SwitchSheet {...input} />);
        expect(screen.getByRole("dialog", { name: "Waiting — switch task" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "true");
        const agent = screen.getByRole("button", { name: "Agent" });
        expect(agent).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(agent);
        expect(input.onSetWaitingType).toHaveBeenCalledWith("agent");
    });
    it("shows preparing, failure details and Retry", () => {
        const input = props({ linkStateOf: () => "preparing", onRetryLink: vi.fn() });
        const view = render(<SwitchSheet {...input} />);
        expect(screen.getByText("preparing…")).toBeVisible();
        view.rerender(<SwitchSheet {...input} linkStateOf={() => "failed"} linkErrorOf={() => "Storage unavailable"} />);
        expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable");
        expect(screen.getByRole("button", { name: /Task a/ })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(input.onRetryLink).toHaveBeenCalledWith("a");
    });
    it.each(["Escape", "Close", "backdrop"])("closes via %s", (method) => {
        const input = props();
        render(<SwitchSheet {...input} />);
        if (method === "Escape") fireEvent.keyDown(document, { key: "Escape" });
        else fireEvent.click(screen.getByRole("button", { name: method === "Close" ? "Close" : "Close switch sheet backdrop" }));
        expect(input.onClose).toHaveBeenCalledOnce();
    });
    it("moves focus into the dialog, traps Tab, and restores the invoker", () => {
        const invoker = document.createElement("button");
        document.body.append(invoker);
        invoker.focus();
        const view = render(<SwitchSheet {...props()} />);
        expect(screen.getByRole("dialog")).toHaveFocus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
        expect(screen.getByRole("button", { name: /Task a/ })).toHaveFocus();
        view.unmount();
        expect(invoker).toHaveFocus();
        invoker.remove();
    });
    it("owns Escape so an underlying overlay's document listener never sees it", () => {
        const overlayEscape = vi.fn();
        const onDocumentKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") overlayEscape(); };
        document.addEventListener("keydown", onDocumentKeyDown);
        try {
            const input = props();
            render(<SwitchSheet {...input} />);
            const dialog = screen.getByRole("dialog", { name: "Switch task" });
            expect(dialog).toHaveFocus();
            const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
            act(() => { dialog.dispatchEvent(escape); });
            expect(overlayEscape).not.toHaveBeenCalled();
            expect(input.onClose).toHaveBeenCalledOnce();
            expect(escape.defaultPrevented).toBe(true);
        } finally {
            document.removeEventListener("keydown", onDocumentKeyDown);
        }
    });
    it("lets the underlying document listener handle Escape once the sheet has unmounted", () => {
        const overlayEscape = vi.fn();
        const onDocumentKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") overlayEscape(); };
        document.addEventListener("keydown", onDocumentKeyDown);
        try {
            const view = render(<SwitchSheet {...props()} />);
            view.unmount();
            act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
            expect(overlayEscape).toHaveBeenCalledOnce();
        } finally {
            document.removeEventListener("keydown", onDocumentKeyDown);
        }
    });
    it("keeps a React onKeyDown escape handler outside the sheet from firing while the sheet is open", () => {
        const overlayEscape = vi.fn();
        const onKeyDown = (event: { key: string }) => { if (event.key === "Escape") overlayEscape(); };
        const view = render(<div onKeyDown={onKeyDown}><SwitchSheet {...props()} /></div>);
        const dialog = screen.getByRole("dialog", { name: "Switch task" });
        expect(dialog).toHaveFocus();
        act(() => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
        expect(overlayEscape).not.toHaveBeenCalled();
        view.rerender(<div onKeyDown={onKeyDown}><button type="button">Underlying overlay</button></div>);
        const overlay = screen.getByRole("button", { name: "Underlying overlay" });
        overlay.focus();
        act(() => { overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
        expect(overlayEscape).toHaveBeenCalledOnce();
    });
    it("focuses the app-main fallback when the invoker was removed before the sheet closed", () => {
        const invoker = document.createElement("button");
        document.body.append(invoker);
        invoker.focus();
        const fallback = document.createElement("main");
        fallback.id = SWITCH_SHEET_FOCUS_FALLBACK_ID;
        fallback.tabIndex = -1;
        document.body.append(fallback);
        const view = render(<SwitchSheet {...props()} />);
        invoker.remove();
        act(() => { view.unmount(); });
        expect(fallback).toHaveFocus();
        fallback.remove();
    });
    it("closes without throwing when the invoker and the fallback are both gone", () => {
        expect(document.getElementById(SWITCH_SHEET_FOCUS_FALLBACK_ID)).toBeNull();
        const invoker = document.createElement("button");
        document.body.append(invoker);
        invoker.focus();
        const view = render(<SwitchSheet {...props()} />);
        invoker.remove();
        expect(() => view.unmount()).not.toThrow();
        expect(document.getElementById(SWITCH_SHEET_FOCUS_FALLBACK_ID)).toBeNull();
    });
    it.each(["backdrop", "Close", "Escape"])("releases the held memo exactly once when closed by %s", async (method) => {
        memoReleases.count = 0;
        const data = new InMemoryDataAccess(makeAppState());
        function Flow() {
            const app = useAppState();
            const [open, setOpen] = useState(false);
            return <>
                <button disabled={!app.state} onClick={() => setOpen(true)}>Open sheet</button>
                {open && <SwitchSheet {...props({ onClose: () => setOpen(false) })} />}
            </>;
        }
        render(<TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="sheet-hold-owner">
            <AppStateProvider><ProjectManagerProvider><ResumeMemoProvider><Flow /></ResumeMemoProvider></ProjectManagerProvider></AppStateProvider>
        </SyncProvider></DataProvider></TauriCloseProvider>);
        const opener = await screen.findByRole("button", { name: "Open sheet" });
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)); });
        fireEvent.click(opener);
        expect(screen.getByRole("dialog", { name: "Switch task" })).toBeInTheDocument();
        expect(memoReleases.count).toBe(0);
        if (method === "Escape") fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
        else fireEvent.click(screen.getByRole("button", { name: method === "Close" ? "Close" : "Close switch sheet backdrop" }));
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)); });
        expect(screen.queryByRole("dialog", { name: "Switch task" })).toBeNull();
        expect(memoReleases.count).toBe(1);
    });
    it("uses the explicit top-sheet tier above the overlay tier", () => {
        render(<SwitchSheet {...props()} />);
        const dialog = screen.getByRole("dialog", { name: "Switch task" });
        expect(dialog).toHaveClass(TOP_SHEET_TIER_CLASS);
        expect(dialog).not.toHaveClass(OVERLAY_TIER_CLASS);
        expect(TOP_SHEET_TIER_CLASS).not.toBe(OVERLAY_TIER_CLASS);
    });
    it("renders an emptyMessage in the empty-state slot instead of the default placeholder", () => {
        render(<SwitchSheet {...props({ result: { top: [], continuation: [] }, emptyMessage: "Nothing to switch to right now: 2 tasks are blocked." })} />);
        expect(screen.getByText("Nothing to switch to right now: 2 tasks are blocked.")).toBeVisible();
        expect(screen.queryByText("Nothing else to switch to")).toBeNull();
    });
    it("ignores emptyMessage when there are candidates", () => {
        render(<SwitchSheet {...props({ emptyMessage: "Nothing to switch to right now: 2 tasks are blocked." })} />);
        expect(screen.queryByText("Nothing to switch to right now: 2 tasks are blocked.")).toBeNull();
        expect(screen.getByRole("button", { name: /Task a/ })).toBeVisible();
    });
    it("shows the default placeholder when emptyMessage is absent and keeps notice rendering", () => {
        render(<SwitchSheet {...props({ result: { top: [], continuation: [] }, notice: "Paused mid-window" })} />);
        expect(screen.getByText("Nothing else to switch to")).toBeVisible();
        expect(screen.getByRole("status")).toHaveTextContent("Paused mid-window");
    });
    it("renders, traps focus and closes with minimal props and no surrounding timer state", () => {
        function Minimal() {
            const [open, setOpen] = useState(true);
            return open
                ? <SwitchSheet {...props({ result: { top: [], continuation: [] }, onClose: () => setOpen(false) })} />
                : <p>closed</p>;
        }
        const view = render(<Minimal />);
        expect(screen.getByRole("dialog", { name: "Switch task" })).toHaveFocus();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByText("closed")).toBeVisible();
        expect(() => view.unmount()).not.toThrow();
    });
});
