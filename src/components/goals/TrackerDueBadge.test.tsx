import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackerDueBadge } from "./TrackerDueBadge";

describe("TrackerDueBadge", () => {
    it("renders nothing when not due", () => {
        const { container } = render(<TrackerDueBadge due={false} periodLabel="October 2026" />);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders the neutral badge with the completed period label when due", () => {
        render(<TrackerDueBadge due periodLabel="October 2026" />);
        const badge = screen.getByText(/Deck due/);
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent("Deck due · October 2026");
        // The narrow rail must wrap the whole pill to the next line, never
        // split the label inside the fully-rounded capsule.
        expect(badge).toHaveClass("whitespace-nowrap");
    });

    it("omits the period label when none is provided", () => {
        render(<TrackerDueBadge due periodLabel={null} />);
        expect(screen.getByText(/Deck due/)).toBeInTheDocument();
        expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });
});
