import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelect } from "./AnalyticsPage";

const general = { value: "g", label: "General" };
const design = { value: "p2", label: "Design" };

describe("MultiSelect summary", () => {
    it("shows the label when nothing is selected", () => {
        render(
            <MultiSelect
                label="Projects"
                options={[general]}
                value={[]}
                onChange={() => {}}
            />
        );
        expect(screen.getByRole("button", { name: "Projects" })).toHaveTextContent(
            "Projects"
        );
    });

    it("shows 'All selected' when the single visible option is selected", () => {
        render(
            <MultiSelect
                label="Projects"
                options={[general]}
                value={["g"]}
                onChange={() => {}}
            />
        );
        expect(screen.getByRole("button")).toHaveTextContent("All selected");
    });

    it("shows 'All selected' when every visible option is selected", () => {
        render(
            <MultiSelect
                label="Projects"
                options={[general, design]}
                value={["g", "p2"]}
                onChange={() => {}}
            />
        );
        expect(screen.getByRole("button")).toHaveTextContent("All selected");
    });

    it("shows a single selected option's label", () => {
        render(
            <MultiSelect
                label="Projects"
                options={[general, design]}
                value={["p2"]}
                onChange={() => {}}
            />
        );
        expect(screen.getByRole("button")).toHaveTextContent("Design");
    });

    it("counts multiple selected visible options", () => {
        render(
            <MultiSelect
                label="Projects"
                options={[general, design, { value: "p3", label: "Research" }]}
                value={["g", "p2"]}
                onChange={() => {}}
            />
        );
        expect(screen.getByRole("button")).toHaveTextContent("2 selected");
    });

    it("does not count hidden ids absent from the option list", () => {
        render(
            <MultiSelect
                label="Projects"
                options={[general]}
                value={["g", "archived-id"]}
                onChange={() => {}}
            />
        );
        expect(screen.getByRole("button")).toHaveTextContent("All selected");
    });
});

describe("MultiSelect toggling", () => {
    it("prunes hidden ids when toggling a visible option on", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <MultiSelect
                label="Projects"
                options={[general]}
                value={["archived-id"]}
                onChange={onChange}
            />
        );
        await user.click(screen.getByRole("button", { name: "Projects" }));
        await user.click(await screen.findByLabelText("General"));
        expect(onChange).toHaveBeenCalledWith(["g"]);
    });

    it("removes a visible option on toggle-off", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <MultiSelect
                label="Projects"
                options={[general, design]}
                value={["g", "p2"]}
                onChange={onChange}
            />
        );
        await user.click(screen.getByRole("button", { name: "Projects" }));
        await user.click(await screen.findByLabelText("General"));
        expect(onChange).toHaveBeenCalledWith(["p2"]);
    });
});
