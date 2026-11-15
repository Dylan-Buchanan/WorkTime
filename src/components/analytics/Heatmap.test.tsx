import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Heatmap } from "./Heatmap";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Original inline formula from AnalyticsPage, kept here as the parity oracle. */
function legacyBackground(value: number, max: number): string {
    const pct = value / max;
    return pct === 0
        ? "transparent"
        : `hsl(${Math.round(180 - pct * 120)},70%,${30 + pct * 30}%)`;
}

/** jsdom normalises colour values; normalise the expected string the same way. */
function normalize(color: string): string {
    const probe = document.createElement("div");
    probe.style.background = color;
    return probe.style.background;
}

const focusTitle = (day: string, hour: number, value: number | undefined) =>
    `${day} ${hour}:00 - ${Math.round(value ?? 0)} mins`;
const focusLabel = (day: string, hour: number, value: number | undefined) =>
    `${day} hour ${hour} ${Math.round(value ?? 0)} minutes`;

describe("Heatmap focus ramp parity", () => {
    const matrix: Record<string, number> = {
        "1-9": 25,
        "1-14": 50,
        "3-10": 12.5,
        "5-18": 75,
        "6-23": 100,
    };
    const max = 100;

    it("renders every cell with the previous background, title and aria-label", () => {
        render(
            <Heatmap
                matrix={matrix}
                max={max}
                cellTitle={focusTitle}
                cellLabel={focusLabel}
            />
        );

        WEEKDAYS.forEach((day, dayIdx) => {
            for (let hour = 0; hour < 24; hour++) {
                const value = matrix[`${dayIdx}-${hour}`];
                const cell = screen.getByLabelText(
                    focusLabel(day, hour, value)
                );
                expect(cell).toHaveAttribute(
                    "title",
                    focusTitle(day, hour, value)
                );
                expect(cell.style.background).toBe(
                    normalize(legacyBackground(value || 0, max))
                );
            }
        });
    });

    it("keeps the 48px + 24-column grid and the axis labels unchanged", () => {
        const { container } = render(
            <Heatmap
                matrix={matrix}
                max={max}
                cellTitle={focusTitle}
                cellLabel={focusLabel}
            />
        );
        const grid = container.querySelector(".grid") as HTMLElement;
        expect(grid).not.toBeNull();
        expect(grid.getAttribute("style")).toContain(
            "48px repeat(24, 1fr)"
        );
        WEEKDAYS.forEach((day) => expect(screen.getByText(day)).toBeInTheDocument());
        for (let hour = 0; hour < 24; hour++) {
            expect(screen.getByText(String(hour))).toBeInTheDocument();
        }
        expect(container.querySelectorAll("[aria-label]")).toHaveLength(24 * 7);
    });

    it("does not produce NaN or divide by zero when max is 0", () => {
        render(
            <Heatmap
                matrix={{ "1-9": 5 }}
                max={0}
                cellTitle={focusTitle}
                cellLabel={focusLabel}
            />
        );
        const cell = screen.getByLabelText(focusLabel("Mon", 9, 5));
        expect(cell.style.background).toBe("transparent");
        expect(cell.getAttribute("style")).not.toContain("NaN");
        expect(cell).toHaveAttribute("title", "Mon 9:00 - 5 mins");
    });
});

describe("Heatmap rating ramp", () => {
    const ratingTitle = (day: string, hour: number, value: number | undefined) =>
        `${day} ${hour}:00 ${value === undefined ? "no data" : value.toFixed(1)}`;
    const ratingLabel = (day: string, hour: number, value: number | undefined) =>
        `${day} hour ${hour} ${
            value === undefined ? "no data" : value.toFixed(1)
        }`;

    it("leaves absent cells transparent and shows value 1", () => {
        render(
            <Heatmap
                matrix={{ "2-10": 1, "2-11": 5, "2-12": 3 }}
                max={5}
                ramp="rating"
                cellTitle={ratingTitle}
                cellLabel={ratingLabel}
            />
        );
        const absent = screen.getByLabelText(ratingLabel("Tue", 9, undefined));
        expect(absent.style.background).toBe("transparent");

        // pct = (1 - 1) / 4 = 0, but a present value is still visible.
        const lowest = screen.getByLabelText(ratingLabel("Tue", 10, 1));
        expect(lowest.style.background).toBe(
            normalize("hsl(180,70%,30%)")
        );
        expect(lowest.style.background).not.toBe("transparent");

        const highest = screen.getByLabelText(ratingLabel("Tue", 11, 5));
        expect(highest.style.background).toBe(normalize("hsl(60,70%,60%)"));
    });

    it("clamps values outside the 1..5 range", () => {
        render(
            <Heatmap
                matrix={{ "2-10": 9 }}
                max={5}
                ramp="rating"
                cellTitle={ratingTitle}
                cellLabel={ratingLabel}
            />
        );
        const cell = screen.getByLabelText(ratingLabel("Tue", 10, 9));
        expect(cell.style.background).toBe(normalize("hsl(60,70%,60%)"));
    });
});
