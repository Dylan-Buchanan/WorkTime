import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInEntry } from "./CheckInEntry";

describe("CheckInEntry", () => {
    it("disables the control before the first period and never opens the wizard", async () => {
        const onOpen = vi.fn();
        const user = userEvent.setup();
        render(<CheckInEntry
            trackerId="tracker-work"
            availability={{ kind: "not-started", message: "No open period. First period starts on 2099-01-04.", firstPeriodLabel: "January 2099" }}
            onOpen={onOpen}
        />);
        const control = screen.getByRole("button", { name: "Period not open" });
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute("aria-disabled", "true");
        expect(control).toHaveAttribute("title", "No open period. First period starts on 2099-01-04.");
        await user.click(control);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it("opens the pinned grid period", async () => {
        const onOpen = vi.fn();
        const user = userEvent.setup();
        render(<CheckInEntry
            trackerId="tracker-work"
            availability={{ kind: "open", periodStart: "2026-10-18", periodLabel: "October 2026" }}
            onOpen={onOpen}
        />);
        await user.click(screen.getByRole("button", { name: "Check in · October 2026" }));
        expect(onOpen).toHaveBeenCalledWith("2026-10-18");
    });
});
