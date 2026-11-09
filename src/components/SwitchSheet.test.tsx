import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SwitchSheet, type SwitchSheetProps } from "./SwitchSheet";
import type { RankedCandidate } from "../lib/whatsNext";
import { normalizeProjectSchedule } from "../lib/projectSchedule";

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
});
