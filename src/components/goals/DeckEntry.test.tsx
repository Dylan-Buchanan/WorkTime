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
    it.each([
        { variant: "settled", label: "Deck not ready", message: "No completed period yet." },
        { variant: "early", label: "Build deck early", message: "Log a check-in for every active goal to build this period's deck early." },
    ] as const)("renders the disabled $variant control with the message and never builds", async ({ variant, label, message }) => {
        const onBuild = vi.fn();
        const user = userEvent.setup();
        render(<DeckEntry
            trackerId="tracker-work"
            trackerName="Work"
            variant={variant}
            availability={{ kind: "not-ready", message }}
            onBuild={onBuild}
        />);
        const control = screen.getByRole("button", { name: label });
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByText(message)).toBeInTheDocument();
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

    it.each([
        { built: false, label: "Build deck early" },
        { built: true, label: "Rebuild deck" },
    ])("shows $label with quiet styling and builds the supplied period", async ({ built, label }) => {
        const onBuild = vi.fn();
        const user = userEvent.setup();
        const { container } = render(<DeckEntry
            trackerId="tracker-work"
            trackerName="Work"
            variant="early"
            availability={{ kind: "ready", period: PERIOD, built }}
            onBuild={onBuild}
        />);
        expect(container.firstElementChild).toHaveAttribute("data-deck-entry-variant", "early");
        const control = screen.getByRole("button", { name: label });
        expect(control).toBeEnabled();
        expect(control).toHaveClass("border-neutral-700", "text-indigo-200");
        if (built) expect(screen.getByText("Built")).toHaveClass("text-emerald-200");
        else expect(screen.queryByText("Built")).not.toBeInTheDocument();
        await user.click(control);
        expect(onBuild).toHaveBeenCalledExactlyOnceWith(PERIOD);
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
