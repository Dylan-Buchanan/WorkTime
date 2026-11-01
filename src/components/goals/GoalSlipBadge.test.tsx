import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalSlipBadge } from "./GoalSlipBadge";

describe("GoalSlipBadge", () => {
    it.each([0, 1])("renders nothing at %i consecutive slips", consecutiveSlips => {
        const { container } = render(<GoalSlipBadge consecutiveSlips={consecutiveSlips} />);
        expect(container).toBeEmptyDOMElement();
    });

    it.each([2, 3])("renders factual slip copy at %i consecutive slips", consecutiveSlips => {
        render(<GoalSlipBadge consecutiveSlips={consecutiveSlips} />);
        expect(screen.getByText(`Slipped ${consecutiveSlips}×`)).toBeInTheDocument();
    });
});
