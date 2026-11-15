import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WellbeingSection } from "./WellbeingSection";
import type { EnergyAnalyticsFilters } from "../../lib/energy/analytics";
import type { EnergyEntry } from "../../state/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const at = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute = 0
) => new Date(year, month, day, hour, minute, 0).toISOString();

function entry(
    windowStartedAt: string,
    overrides: Partial<EnergyEntry> = {}
): EnergyEntry {
    return {
        work_window_id: windowStartedAt,
        energy: null,
        clarity: null,
        caffeine: false,
        energy_carried: false,
        clarity_carried: false,
        created_at: windowStartedAt,
        updated_at: windowStartedAt,
        ...overrides,
    };
}

function filters(
    overrides: Partial<EnergyAnalyticsFilters> = {}
): EnergyAnalyticsFilters {
    return {
        from: new Date(2026, 10, 1, 0, 0, 0),
        to: new Date(2026, 10, 30, 23, 59, 59),
        workHoursOnly: false,
        ...overrides,
    };
}

function normalize(color: string): string {
    const probe = document.createElement("div");
    probe.style.background = color;
    return probe.style.background;
}

function gridCells(container: HTMLElement): HTMLElement[] {
    return Array.from(
        container.querySelectorAll<HTMLElement>(".grid [aria-label]")
    );
}

// 2026-11-02 is a Monday.
const MONDAY = 2;

describe("WellbeingSection empty states", () => {
    it("renders with zero entries: axes, empty-state text and 0 of 0", () => {
        const { container } = render(
            <WellbeingSection
                entries={[]}
                filters={filters()}
                identityFiltersActive={false}
            />
        );

        expect(
            screen.getByRole("heading", { name: "Wellbeing" })
        ).toBeInTheDocument();
        WEEKDAYS.forEach((day) =>
            expect(screen.getByText(day)).toBeInTheDocument()
        );
        for (let hour = 0; hour < 24; hour++) {
            expect(screen.getByText(String(hour))).toBeInTheDocument();
        }

        const cells = gridCells(container);
        expect(cells).toHaveLength(24 * 7);
        cells.forEach((cell) =>
            expect(cell.style.background).toBe(
                normalize("transparent")
            )
        );

        expect(
            screen.getByText("No energy check-ins in this range yet.")
        ).toBeInTheDocument();
        expect(
            screen.getByText(/0 of 0 sessions explicitly rated/)
        ).toBeInTheDocument();
        expect(screen.getByText("No check-ins to show.")).toBeInTheDocument();
    });

    it("renders an empty grid and 0 of N when every value is null", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9, 5)),
            entry(at(2026, 10, MONDAY, 10, 5)),
        ];
        const { container } = render(
            <WellbeingSection
                entries={entries}
                filters={filters()}
                identityFiltersActive={false}
            />
        );

        expect(
            screen.getByText(/0 of 2 sessions explicitly rated/)
        ).toBeInTheDocument();
        gridCells(container).forEach((cell) =>
            expect(cell.style.background).toBe(normalize("transparent"))
        );
        // Null values render as an em dash in the recent list.
        expect(screen.getAllByText("Energy —")).toHaveLength(2);
        expect(screen.getAllByText("Clarity —")).toHaveLength(2);
        expect(
            screen.queryByText("No energy check-ins in this range yet.")
        ).toBeNull();
    });
});

describe("WellbeingSection metric toggle", () => {
    const entries = [
        entry(at(2026, 10, MONDAY, 9, 5), { energy: 4, clarity: 2 }),
    ];

    it("defaults to energy and switches to clarity", async () => {
        const user = userEvent.setup();
        render(
            <WellbeingSection
                entries={entries}
                filters={filters()}
                identityFiltersActive={false}
            />
        );

        const energyButton = screen.getByRole("button", { name: "Energy" });
        const clarityButton = screen.getByRole("button", { name: "Clarity" });
        expect(energyButton).toHaveAttribute("aria-pressed", "true");
        expect(clarityButton).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByTitle("Mon 9:00 - 4.0 avg energy")).toBeInTheDocument();
        expect(screen.queryByTitle("Mon 9:00 - 2.0 avg clarity")).toBeNull();

        await user.click(clarityButton);

        expect(energyButton).toHaveAttribute("aria-pressed", "false");
        expect(clarityButton).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByTitle("Mon 9:00 - 2.0 avg clarity")).toBeInTheDocument();
        expect(screen.queryByTitle("Mon 9:00 - 4.0 avg energy")).toBeNull();
    });
});

describe("WellbeingSection identity filter note", () => {
    const entries = [entry(at(2026, 10, MONDAY, 9, 5), { energy: 4 })];

    it("is absent when no identity filter is active", () => {
        render(
            <WellbeingSection
                entries={entries}
                filters={filters()}
                identityFiltersActive={false}
            />
        );
        expect(screen.queryByText(/session-scoped/)).toBeNull();
    });

    it("appears when an identity filter is active", () => {
        render(
            <WellbeingSection
                entries={entries}
                filters={filters()}
                identityFiltersActive
            />
        );
        const note = screen.getByText(/session-scoped/);
        expect(note).toHaveTextContent(/project, tag, status or deep-work/);
    });
});

describe("WellbeingSection recent entries", () => {
    it("orders newest first and marks carried values", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9, 0), {
                energy: 3,
                energy_carried: true,
                clarity: 4,
            }),
            entry(at(2026, 10, MONDAY, 11, 0), {
                energy: 5,
                caffeine: true,
            }),
        ];
        render(
            <WellbeingSection
                entries={entries}
                filters={filters()}
                identityFiltersActive={false}
            />
        );

        const items = screen.getAllByRole("listitem");
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent("11:00");
        expect(items[0]).toHaveTextContent("Caffeine Yes");
        expect(items[0]).not.toHaveTextContent("carried");
        expect(items[1]).toHaveTextContent("09:00");
        expect(items[1]).toHaveTextContent("Caffeine No");
        expect(within(items[1]).getByText("carried")).toBeInTheDocument();
        // Only the carried field is marked; the explicit clarity is not.
        expect(items[1].textContent?.match(/carried/g)).toHaveLength(1);
    });

    it("follows only the date range and the work-hours filter", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9, 5), { energy: 4 }),
            entry(at(2026, 10, MONDAY, 7, 30), { energy: 5 }),
            entry(at(2026, 8, MONDAY, 9, 0), { energy: 2 }),
        ];

        const { unmount } = render(
            <WellbeingSection
                entries={entries}
                filters={filters({ workHoursOnly: true })}
                identityFiltersActive={false}
            />
        );
        expect(
            screen.getByText(/1 of 1 sessions explicitly rated/)
        ).toBeInTheDocument();
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        unmount();

        render(
            <WellbeingSection
                entries={entries}
                filters={filters({ workHoursOnly: false })}
                identityFiltersActive={false}
            />
        );
        // The September entry stays outside the range; 07:30 is now included.
        expect(
            screen.getByText(/2 of 2 sessions explicitly rated/)
        ).toBeInTheDocument();
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
});
