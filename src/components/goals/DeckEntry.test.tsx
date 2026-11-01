import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeckEntry } from "./DeckEntry";
import type { GoalPeriod } from "../../lib/goals/periods";

const PERIOD: GoalPeriod = {
    periodStart: "2026-10-04",
    periodEnd: "2026-10-18",
    monthKey: "2026-10",
};

describe("DeckEntry", () => {
    it("renders a disabled control with the message and never builds", async () => {
        const onBuild = vi.fn();
        const user = userEvent.setup();
        render(<DeckEntry
            trackerId="tracker-work"
            trackerName="Work"
            availability={{ kind: "not-ready", message: "No completed period yet. Build the deck after the October 2026 period completes." }}
            onBuild={onBuild}
        />);
        const control = screen.getByRole("button", { name: "Deck not ready" });
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByText("No completed period yet. Build the deck after the October 2026 period completes.")).toBeInTheDocument();
        await user.click(control);
        expect(onBuild).not.toHaveBeenCalled();
    });

    it("calls onBuild with the completed period when ready", async () => {
        const onBuild = vi.fn();
        const user = userEvent.setup();
        render(<DeckEntry
            trackerId="tracker-work"
            trackerName="Work"
            availability={{ kind: "ready", period: PERIOD, built: false }}
            onBuild={onBuild}
        />);
        const control = screen.getByRole("button", { name: "Build deck" });
        expect(control).toBeEnabled();
        expect(screen.getByText(/October 2026/)).toBeInTheDocument();
        expect(screen.queryByText("Built")).not.toBeInTheDocument();
        await user.click(control);
        expect(onBuild).toHaveBeenCalledWith(PERIOD);
    });

    it("shows the built cue and stays actionable for a same-period rebuild", async () => {
        const onBuild = vi.fn();
        const user = userEvent.setup();
        render(<DeckEntry
            trackerId="tracker-work"
            trackerName="Work"
            availability={{ kind: "ready", period: PERIOD, built: true }}
            onBuild={onBuild}
        />);
        const control = screen.getByRole("button", { name: "Rebuild deck" });
        expect(control).toBeEnabled();
        expect(screen.getByText("Built")).toBeInTheDocument();
        await user.click(control);
        expect(onBuild).toHaveBeenCalledWith(PERIOD);
    });
});
