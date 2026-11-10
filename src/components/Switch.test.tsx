import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Switch } from "./Switch";

it("has a stable accessible name and optional description, and toggles via keyboard and pointer", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = { label: "Sound effects", description: "Play app sounds", onChange };
    const { rerender } = render(<Switch {...props} checked={false} />);
    const control = screen.getByRole("switch", { name: "Sound effects", checked: false });
    expect(control).toHaveAccessibleDescription("Play app sounds");

    await user.tab();
    expect(control).toHaveFocus();
    await user.keyboard("[Space]");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);

    rerender(<Switch label={props.label} onChange={onChange} checked />);
    expect(screen.getByRole("switch", { name: "Sound effects", checked: true })).toBe(control);
    expect(control).not.toHaveAccessibleDescription();
    await user.click(control);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
});

it("prevents changes when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Sound effects" checked onChange={onChange} disabled />);
    const control = screen.getByRole("switch", { name: "Sound effects", checked: true });

    expect(control).toBeDisabled();
    await user.click(control);
    expect(onChange).not.toHaveBeenCalled();
});
