import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResumeCard, type ResumeCardProps } from "./ResumeCard";

const enteredAt = "2026-11-09T14:00:00.000Z";
const memo = { whereIAm: "Parser drafted", nextAction: "Cover errors", blocker: "Need schema", savedAt: "2026-11-09T13:52:00.000Z" };
function props(overrides: Partial<ResumeCardProps> = {}): ResumeCardProps {
    return { taskId: "a", taskName: "Task A", memo, weight: "full", enteredAt, onDismiss: vi.fn(), onAdd: vi.fn(), ...overrides };
}

describe("ResumeCard presentation of T12 props", () => {
    it.each([
        { whereIAm: "", nextAction: "Cover errors", present: "Next action", absent: "Where I am" },
        { whereIAm: "Parser drafted", nextAction: "", present: "Where I am", absent: "Next action" },
    ])("omits empty $absent in summary and expanded view", ({ whereIAm, nextAction, present, absent }) => {
        render(<ResumeCard {...props({ memo: { whereIAm, nextAction, savedAt: memo.savedAt } })} />);
        const card = screen.getByRole("region");
        expect(card).toHaveTextContent(present);
        expect(card).not.toHaveTextContent(absent);
        fireEvent.click(screen.getByRole("button", { name: "Expand note" }));
        expect(within(card).getByText(present)).toBeVisible();
        expect(within(card).queryByText(absent)).toBeNull();
        expect(card).toHaveTextContent(whereIAm || nextAction);
    });

    it.each([
        { row: "resume, 30-minute memo", weight: "full", ageMs: 30 * 60_000, age: "30 min ago" },
        { row: "switch, exactly two-hour memo", weight: "full", ageMs: 2 * 60 * 60_000, age: "2 h ago" },
        { row: "start, two hours plus one millisecond", weight: "dimmed-line", ageMs: 2 * 60 * 60_000 + 1, age: "2 h ago" },
        { row: "break-end, one-minute memo", weight: "dimmed-line", ageMs: 60_000, age: "1 min ago" },
    ] as const)("renders $row with the supplied $weight weight", ({ weight, ageMs, age }) => {
        render(<ResumeCard {...props({ weight, memo: { ...memo, savedAt: new Date(Date.parse(enteredAt) - ageMs).toISOString() } })} />);
        const card = screen.getByRole("region", { name: "Resume Task A" });
        expect(card).toHaveAttribute("data-weight", weight);
        expect(card).toHaveTextContent("Task A");
        expect(card).toHaveTextContent(age);
        expect(card).toHaveTextContent("Parser drafted");
        expect(card).toHaveTextContent("Cover errors");
        expect(card).toHaveTextContent("Need schema");
        if (weight === "dimmed-line") {
            expect(card).toHaveClass("text-neutral-500");
            expect(card.querySelectorAll("p")).toHaveLength(1);
            expect(card.querySelector("p")).toHaveClass("truncate");
            expect(card.querySelector("dl")).toBeNull();
        }
    });

    it.each(["start", "resume", "switch"])("renders full empty-state props for an eligible %s enter", () => {
        const onAdd = vi.fn();
        const onDismiss = vi.fn();
        render(<ResumeCard {...props({ memo: null, onAdd, onDismiss })} />);
        expect(screen.getByText("No note from your last exit")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Expand note" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Add note" }));
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(onAdd).toHaveBeenCalledOnce();
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it.each([
        { memo: null, weight: "dimmed-line" as const },
        { memo: { ...memo, dismissedAt: enteredAt }, weight: "full" as const },
        { memo: { ...memo, dismissedAt: enteredAt }, weight: "dimmed-line" as const },
    ])("does not fabricate an empty state for hidden note props: %j", overrides => {
        const view = render(<ResumeCard {...props(overrides)} />);
        expect(view.container).toBeEmptyDOMElement();
    });

    it.each([
        ["2026-11-09T13:52:00.000Z", "8 min ago"],
        ["2026-11-09T12:00:00.000Z", "2 h ago"],
        ["2026-11-09T13:59:59.000Z", "just now"],
        ["2026-11-09T14:01:00.000Z", "just now"],
    ])("labels savedAt %s relative to enteredAt as %s", (savedAt, age) => {
        render(<ResumeCard {...props({ memo: { ...memo, savedAt } })} />);
        expect(screen.getByText(age)).toBeVisible();
    });

    it.each(["full", "dimmed-line"] as const)("expands 140 characters and all fields by keyboard from %s", async weight => {
        const user = userEvent.setup();
        const whereIAm = "x".repeat(140);
        const taskName = "Long task ".repeat(20);
        render(<ResumeCard {...props({ taskName, weight, memo: { ...memo, whereIAm } })} />);
        const card = screen.getByRole("region");
        expect(card).toHaveClass("w-full", "min-w-0", "max-w-full", "overflow-hidden");
        expect(card.querySelector("p")).toHaveClass("truncate");
        expect(card.closest("[aria-live]")).toBeNull();
        expect(card.querySelector("[aria-live]")).toBeNull();
        expect(screen.queryByRole("status")).toBeNull();
        const expand = within(card).getByRole("button", { name: "Expand note", expanded: false });
        await user.tab();
        expect(expand).toHaveFocus();
        await user.keyboard("{Enter}");
        expect(expand).toHaveAttribute("aria-expanded", "true");
        const content = document.getElementById(expand.getAttribute("aria-controls")!)!;
        expect(content).toHaveClass("[overflow-wrap:anywhere]");
        expect(within(content).getByText(whereIAm)).toBeVisible();
        expect(within(content).getByText(memo.nextAction)).toBeVisible();
        expect(within(content).getByText(memo.blocker)).toBeVisible();
        expect(card).toHaveTextContent(taskName.trim());
        await user.keyboard(" ");
        expect(expand).toHaveAttribute("aria-expanded", "false");
        expect(card.querySelector("dl")).toBeNull();
    });

    it("omits the blocker when absent and dismisses an existing memo", () => {
        const onDismiss = vi.fn();
        render(<ResumeCard {...props({ onDismiss, memo: { whereIAm: "Draft", nextAction: "Review", savedAt: memo.savedAt } })} />);
        expect(screen.queryByText(/Blocker/)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Expand note" }));
        expect(screen.queryByText(/Blocker/)).toBeNull();
        expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(onDismiss).toHaveBeenCalledOnce();
    });
});
