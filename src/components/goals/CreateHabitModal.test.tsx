import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateHabitModal, type NewHabitDraft } from "./CreateHabitModal";

function renderModal(overrides: Partial<React.ComponentProps<typeof CreateHabitModal>> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const initial: NewHabitDraft = { name: "Read 20 min", color: "#6366F1", frequency: "daily" };
    render(<CreateHabitModal initial={initial} replacing={null} onConfirm={onConfirm} onCancel={onCancel} {...overrides} />);
    return { dialog: screen.getByRole("dialog", { name: "Create habit" }), onConfirm, onCancel, initial };
}

describe("CreateHabitModal", () => {
    it("starts from the supplied name, color, and frequency", () => {
        const { dialog } = renderModal();
        expect(within(dialog).getByLabelText("Habit name")).toHaveValue("Read 20 min");
        expect(within(dialog).getByRole("radio", { name: "Choose #6366F1" })).toHaveAttribute("aria-checked", "true");
        expect(within(dialog).getByLabelText("Frequency")).toHaveValue("daily");
        expect(within(dialog).queryByText(/habit link/)).not.toBeInTheDocument();
    });

    it("names the habit link that will be replaced", () => {
        const { dialog } = renderModal({ replacing: "Read 20 minutes" });
        expect(within(dialog).getByText(/will replace this goal’s “Read 20 minutes” habit link/)).toBeInTheDocument();
    });

    it("rejects an empty name with the habits-page message", async () => {
        const user = userEvent.setup();
        const { dialog, onConfirm } = renderModal();
        await user.clear(within(dialog).getByLabelText("Habit name"));
        await user.click(within(dialog).getByRole("button", { name: "Create habit" }));

        expect(within(dialog).getByRole("alert")).toHaveTextContent("Give this habit a name first.");
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("confirms the trimmed name with the selected color and frequency", async () => {
        const user = userEvent.setup();
        const { dialog, onConfirm } = renderModal();
        await user.clear(within(dialog).getByLabelText("Habit name"));
        await user.type(within(dialog).getByLabelText("Habit name"), "  Walk outside  ");
        await user.click(within(dialog).getByRole("radio", { name: "Choose #10B981" }));
        await user.selectOptions(within(dialog).getByLabelText("Frequency"), "weekly");
        await user.click(within(dialog).getByRole("button", { name: "Create habit" }));

        expect(onConfirm).toHaveBeenCalledWith({ name: "Walk outside", color: "#10B981", frequency: "weekly" });
    });

    it("confirms with Enter from the name field", async () => {
        const user = userEvent.setup();
        const { dialog, onConfirm } = renderModal();
        await user.click(within(dialog).getByLabelText("Habit name"));
        await user.keyboard("{Enter}");
        expect(onConfirm).toHaveBeenCalledWith({ name: "Read 20 min", color: "#6366F1", frequency: "daily" });
    });

    it("cancels from the button, Escape, or the backdrop", async () => {
        const user = userEvent.setup();
        const { dialog, onCancel } = renderModal();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        await user.keyboard("{Escape}");
        expect(onCancel).toHaveBeenCalledTimes(2);
        await user.click(dialog.querySelector("[aria-hidden=true]")!);
        expect(onCancel).toHaveBeenCalledTimes(3);
    });
});
