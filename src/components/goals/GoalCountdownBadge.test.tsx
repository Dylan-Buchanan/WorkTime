import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { countdownTone, GoalCountdownBadge } from "./GoalCountdownBadge";

describe("countdownTone", () => {
    it.each([
        [30, "green"],
        [11, "green"],
        [10, "yellow"],
        [4, "yellow"],
        [3, "red"],
        [1, "red"],
    ] as const)("maps %i days to %s", (days, tone) => {
        expect(countdownTone(days)).toBe(tone);
    });
});

describe("GoalCountdownBadge", () => {
    it("renders the day count with its tone and title", () => {
        render(<GoalCountdownBadge daysUntilOpen={5} />);
        const badge = screen.getByText("5 days");
        expect(badge).toHaveAttribute("data-goal-countdown-tone", "yellow");
        expect(badge).toHaveAttribute("title", "First period opens in 5 days.");
    });

    it("uses the singular unit for a single day", () => {
        render(<GoalCountdownBadge daysUntilOpen={1} />);
        expect(screen.getByText("1 day")).toHaveAttribute("data-goal-countdown-tone", "red");
    });

    it.each([0, -3, 2.5])("renders nothing at %s days", days => {
        const { container } = render(<GoalCountdownBadge daysUntilOpen={days} />);
        expect(container).toBeEmptyDOMElement();
    });
});
