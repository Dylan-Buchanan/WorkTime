import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EnergyControls, type EnergyControlsProps } from "./EnergyControls";

function setup(overrides: Partial<EnergyControlsProps> = {}) {
    const onChange = vi.fn();
    const view = render(
        <EnergyControls
            idPrefix="test"
            energy={null}
            clarity={null}
            caffeine={false}
            onChange={onChange}
            {...overrides}
        />,
    );
    return { onChange, ...view };
}

describe("EnergyControls", () => {
    it("renders both dot clusters and the pill at once with accessible group names", () => {
        setup();

        const energyGroup = screen.getByRole("group", { name: "Energy" });
        const clarityGroup = screen.getByRole("group", { name: "Clarity" });
        expect(within(energyGroup).getAllByRole("button")).toHaveLength(5);
        expect(within(clarityGroup).getAllByRole("button")).toHaveLength(5);
        expect(screen.getByRole("button", { name: "Caffeine" })).toBeInTheDocument();
        expect(screen.getAllByRole("button")).toHaveLength(11);
    });

    it("shows scale anchors at the extremes only and leaves intermediate dots unlabelled", () => {
        setup();

        expect(screen.getAllByText(/^(Drained|Sharp|Foggy|Crystal)$/).map((element) => element.textContent))
            .toEqual(["Drained", "Sharp", "Foggy", "Crystal"]);
        expect(screen.queryByText("2")).toBeNull();
        expect(screen.queryByText("3")).toBeNull();
        expect(screen.queryByText("4")).toBeNull();
        expect(screen.queryByText("neutral")).toBeNull();
        expect(screen.queryByText("moderate")).toBeNull();
        expect(screen.queryByText("clear")).toBeNull();
    });

    it("emits the tapped rating for the dot's own field", async () => {
        const user = userEvent.setup();
        const { onChange } = setup();

        await user.click(screen.getByRole("button", { name: "Energy 3 of 5" }));
        expect(onChange).toHaveBeenLastCalledWith({ energy: 3 });
        await user.click(screen.getByRole("button", { name: "Clarity 5 of 5" }));
        expect(onChange).toHaveBeenLastCalledWith({ clarity: 5 });
        expect(onChange).toHaveBeenCalledTimes(2);
        // Exactly one field per call.
        expect(Object.keys(onChange.mock.calls[0][0])).toEqual(["energy"]);
        expect(Object.keys(onChange.mock.calls[1][0])).toEqual(["clarity"]);
    });

    it("emits null when the displayed dot is tapped again", async () => {
        const user = userEvent.setup();
        const { onChange } = setup({ energy: 3, clarity: 2 });

        expect(screen.getByRole("button", { name: "Energy 3 of 5" })).toHaveAttribute("aria-pressed", "true");
        await user.click(screen.getByRole("button", { name: "Energy 3 of 5" }));
        expect(onChange).toHaveBeenLastCalledWith({ energy: null });

        await user.click(screen.getByRole("button", { name: "Clarity 2 of 5" }));
        expect(onChange).toHaveBeenLastCalledWith({ clarity: null });
    });

    it("toggles the caffeine pill, exposing its pressed state and Yes/No text", async () => {
        const user = userEvent.setup();
        const { onChange } = setup({ caffeine: false });

        const pill = screen.getByRole("button", { name: "Caffeine" });
        expect(pill).toHaveAttribute("aria-pressed", "false");
        expect(pill).toHaveTextContent("No");

        await user.click(pill);
        expect(onChange).toHaveBeenLastCalledWith({ caffeine: true });
    });

    it("shows Yes and a pressed pill for a caffeinated value", async () => {
        const user = userEvent.setup();
        const { onChange } = setup({ caffeine: true });

        const pill = screen.getByRole("button", { name: "Caffeine" });
        expect(pill).toHaveAttribute("aria-pressed", "true");
        expect(pill).toHaveTextContent("Yes");

        await user.click(pill);
        expect(onChange).toHaveBeenLastCalledWith({ caffeine: false });
    });

    it("keeps all eleven controls keyboard reachable in order", async () => {
        const user = userEvent.setup();
        setup();

        const expected = [
            "Energy 1 of 5", "Energy 2 of 5", "Energy 3 of 5", "Energy 4 of 5", "Energy 5 of 5",
            "Clarity 1 of 5", "Clarity 2 of 5", "Clarity 3 of 5", "Clarity 4 of 5", "Clarity 5 of 5",
            "Caffeine",
        ];
        const reached: string[] = [];
        for (let index = 0; index < expected.length; index += 1) {
            await user.tab();
            reached.push(document.activeElement?.getAttribute("aria-label") ?? "");
        }
        expect(reached).toEqual(expected);
    });

    it("labels each scale with a visible title", () => {
        setup();

        const energyTitle = screen.getByText("Physical energy");
        const clarityTitle = screen.getByText("Mental clarity");
        const energyGroup = screen.getByRole("group", { name: "Energy" });
        const clarityGroup = screen.getByRole("group", { name: "Clarity" });
        expect(energyTitle.compareDocumentPosition(energyGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(clarityTitle.compareDocumentPosition(clarityGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("colours each rating of both scales with a distinct bad-to-good tone", () => {
        setup();

        for (const label of ["Energy", "Clarity"]) {
            const tones = [1, 2, 3, 4, 5].map((rating) =>
                screen.getByRole("button", { name: `${label} ${rating} of 5` }).firstElementChild?.className ?? "",
            );
            expect(new Set(tones).size).toBe(5);
            expect(tones[0]).toContain("rose-");
            expect(tones[4]).toContain("emerald-");
        }
        expect(screen.getByText("Drained").className).toContain("rose-");
        expect(screen.getByText("Sharp").className).toContain("emerald-");
        expect(screen.getByText("Foggy").className).toContain("rose-");
        expect(screen.getByText("Crystal").className).toContain("emerald-");
    });

    it("keeps the tone of the rated end when a dot is selected", () => {
        setup({ energy: 1, clarity: 5 });

        const energyOne = screen.getByRole("button", { name: "Energy 1 of 5" });
        const clarityFive = screen.getByRole("button", { name: "Clarity 5 of 5" });
        expect(energyOne.className).toContain("border-rose-");
        expect(energyOne.firstElementChild?.className).toContain("bg-rose-200");
        expect(clarityFive.className).toContain("border-emerald-");
        expect(clarityFive.firstElementChild?.className).toContain("bg-emerald-200");
        expect(energyOne.className).not.toBe(screen.getByRole("button", { name: "Energy 5 of 5" }).className);
    });

    it("gives each target at least a 20x20 px hit area", () => {
        setup();

        for (const button of screen.getAllByRole("button")) {
            expect(button.className).toContain("h-6");
            expect(button.className.includes("w-6") || button.className.includes("min-w-[2.75rem]")).toBe(true);
        }
    });
});
