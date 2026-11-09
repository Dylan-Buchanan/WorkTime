import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ResumeMemoSheet, type ResumeMemoSheetProps } from "./ResumeMemoSheet";

const memo = { whereIAm: "At the parser", nextAction: "Add coverage", blocker: "API question", savedAt: "2026-11-09T14:04:00Z" };
function props(overrides: Partial<ResumeMemoSheetProps> = {}): ResumeMemoSheetProps {
    return { mode: "leave", outgoing: { taskId: "A", taskName: "Task A", memo, alreadyCaptured: false }, onSave: vi.fn(async () => {}), onDismiss: vi.fn(), ...overrides };
}

describe("ResumeMemoSheet", () => {
    it("labels a modal and three prefilled single-line fields without a live region", () => {
        const view = render(<ResumeMemoSheet {...props()} />);
        const dialog = screen.getByRole("dialog", { name: "What were you doing in Task A?" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(dialog).toHaveAttribute("aria-labelledby", screen.getByRole("heading").id);
        for (const [label, value] of [["Where I am", memo.whereIAm], ["Next action", memo.nextAction], ["Open question or blocker (optional)", memo.blocker]]) {
            expect(screen.getByLabelText(label)).toHaveValue(value);
            expect(screen.getByLabelText(label)).toHaveAttribute("type", "text");
        }
        expect(view.container.querySelector("[aria-live], [role=alert], [role=status]")).toBeNull();
        expect(dialog.firstElementChild).toHaveAccessibleName("Close resume memo backdrop");
        // Width is bounded by the viewport padding and w-full, including at 360px.
        expect(dialog).toHaveClass("fixed", "inset-0", "p-4");
        expect(dialog.lastElementChild).toHaveClass("w-full", "min-w-0", "max-w-xl");
    });

    it("submits Enter once, ignores composing Enter, and preserves drafts across prop updates", async () => {
        let resolve!: () => void;
        const input = props({ onSave: vi.fn(() => new Promise<void>((done) => { resolve = done; })) });
        const view = render(<ResumeMemoSheet {...input} />);
        const field = screen.getByLabelText("Where I am");
        fireEvent.change(field, { target: { value: "Draft" } });
        fireEvent.keyDown(field, { key: "Enter", isComposing: true });
        expect(input.onSave).not.toHaveBeenCalled();
        fireEvent.keyDown(field, { key: "Enter" });
        fireEvent.keyDown(field, { key: "Enter" });
        expect(input.onSave).toHaveBeenCalledExactlyOnceWith("A", { whereIAm: "Draft", nextAction: memo.nextAction, blocker: memo.blocker });
        expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
        view.rerender(<ResumeMemoSheet {...input} outgoing={{ ...input.outgoing, memo: { ...memo, whereIAm: "Changed elsewhere" } }} error="Retry me" />);
        expect(field).toHaveValue("Draft");
        await act(async () => resolve());
        expect(screen.getByRole("dialog")).toBeVisible();
        expect(screen.getByRole("button", { name: "Save note" })).toBeEnabled();
    });

    it.each(["Escape", "Skip", "backdrop"])("abandons via %s without saving", (method) => {
        const input = props();
        render(<ResumeMemoSheet {...input} />);
        if (method === "Escape") fireEvent.keyDown(screen.getByLabelText("Next action"), { key: "Escape" });
        else fireEvent.click(screen.getByRole("button", { name: method === "Skip" ? "Skip" : "Close resume memo backdrop" }));
        expect(input.onDismiss).toHaveBeenCalledOnce();
        expect(input.onSave).not.toHaveBeenCalled();
    });

    it("traps both Tab directions including inputs and restores the invoker", () => {
        const invoker = document.createElement("button");
        document.body.append(invoker);
        invoker.focus();
        const view = render(<ResumeMemoSheet {...props()} />);
        expect(screen.getByRole("dialog")).toHaveFocus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(screen.getByLabelText("Where I am")).toHaveFocus();
        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
        expect(screen.getByRole("button", { name: "Skip" })).toHaveFocus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(screen.getByLabelText("Where I am")).toHaveFocus();
        view.unmount();
        expect(invoker).toHaveFocus();
        invoker.remove();
    });

    it.each(["Where I am", "Next action", "Open question or blocker (optional)"])("caps %s at 140 code points without splitting emoji", async (label) => {
        const input = props();
        render(<ResumeMemoSheet {...input} />);
        const value = "x".repeat(139) + "😀" + "y".repeat(20);
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
        expect(screen.getByLabelText(label)).toHaveValue("x".repeat(139) + "😀");
        await act(async () => fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" }));
        const saved = vi.mocked(input.onSave).mock.calls[0][1];
        expect(saved[label === "Where I am" ? "whereIAm" : label === "Next action" ? "nextAction" : "blocker"]).toBe("x".repeat(139) + "😀");
    });

    it("shows saved outgoing and dismissed incoming notes, continues without writing, and explicitly edits prefilled fields", async () => {
        const input = props({ mode: "switch", outgoing: { taskId: "A", taskName: "Task A", memo, alreadyCaptured: true }, incoming: { taskId: "B", taskName: "Task B", memo: { ...memo, whereIAm: "Incoming", dismissedAt: memo.savedAt } } });
        render(<ResumeMemoSheet {...input} />);
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.getByText("Incoming")).toBeVisible();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", isComposing: true });
        expect(input.onDismiss).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
        expect(input.onDismiss).toHaveBeenCalledOnce();
        expect(input.onSave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
        expect(screen.getByLabelText("Where I am")).toHaveValue(memo.whereIAm);
        expect(input.onSave).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText("Where I am"), { target: { value: "Edited" } });
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save note" })));
        expect(input.onSave).toHaveBeenCalledExactlyOnceWith("A", expect.objectContaining({ whereIAm: "Edited" }));
    });

    it("shows the incoming task and starting fresh line when no memo exists", () => {
        render(<ResumeMemoSheet {...props({ mode: "switch", incoming: { taskId: "B", taskName: "Task B", memo: null } })} />);
        expect(screen.getByRole("heading", { name: "Task B" })).toBeVisible();
        expect(screen.getByText("Starting fresh — no note yet.")).toBeVisible();
    });
});
