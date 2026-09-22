import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PetTimePicker } from "./PetTimePicker";

describe("PetTimePicker", () => {
    it("renders the 12-hour controls from a 24-hour value", () => {
        render(<PetTimePicker value="18:30" onChange={() => {}} />);

        expect(screen.getByRole("combobox", { name: "Time hour" })).toHaveTextContent("6");
        expect(screen.getByRole("combobox", { name: "Time minute" })).toHaveTextContent("30");
        expect(screen.getByRole("button", { name: "PM" })).toHaveAttribute("aria-pressed", "true");
    });

    it("emits the exact selected minute", () => {
        const onChange = vi.fn();
        render(<PetTimePicker value="08:00" onChange={onChange} />);

        fireEvent.click(screen.getByRole("combobox", { name: "Time minute" }));
        fireEvent.click(screen.getByRole("option", { name: "45" }));

        expect(onChange).toHaveBeenCalledWith("08:45");
    });

    it("keeps minutes and converts between AM and PM", () => {
        const onChange = vi.fn();
        render(<PetTimePicker value="08:15" onChange={onChange} />);

        fireEvent.click(screen.getByRole("button", { name: "PM" }));

        expect(onChange).toHaveBeenCalledWith("20:15");
    });

    it("styles the option list scrollbar with the app scrollbar", () => {
        render(<PetTimePicker value="08:00" onChange={() => {}} />);

        fireEvent.click(screen.getByRole("combobox", { name: "Time minute" }));

        expect(screen.getByRole("listbox", { name: "Time minute options" })).toHaveClass("app-scrollbar");
    });
});
