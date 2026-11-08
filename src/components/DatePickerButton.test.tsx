import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatePickerButton } from "./DatePickerButton";
import { localDateAtNoon, localDateFromKey } from "../lib/todos";

const display = (key: string) => localDateFromKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fullLabel = (date: Date) => date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthLabel = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

describe("DatePickerButton", () => {
    it("shows a neutral placeholder until a date is chosen", () => {
        render(<DatePickerButton id="due" label="Due date" value="" onChange={() => {}} />);

        const trigger = screen.getByLabelText("Due date");
        expect(trigger).toHaveTextContent("Pick a date");
        expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("shows the formatted stored date and opens on that date's month", async () => {
        const user = userEvent.setup();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={() => {}} />);

        const trigger = screen.getByLabelText("Due date");
        expect(trigger).toHaveTextContent(display("2026-03-04"));

        await user.click(trigger);

        const dialog = screen.getByRole("dialog", { name: "Due date calendar" });
        expect(within(dialog).getByRole("grid")).toBeInTheDocument();
        expect(within(dialog).getByText(monthLabel(localDateAtNoon(2026, 2, 1)))).toBeInTheDocument();
        const selected = within(dialog).getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 4)) });
        expect(selected).toHaveAttribute("aria-pressed", "true");
        expect(selected.closest('[role="gridcell"]')).toHaveAttribute("aria-selected", "true");
    });

    it("emits the local date key of the chosen day and closes immediately", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={onChange} />);

        await user.click(screen.getByLabelText("Due date"));
        await user.click(screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 10)) }));

        expect(onChange).toHaveBeenCalledWith("2026-03-10");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Due date")).toHaveFocus();
    });

    it("opens with Enter and restores focus to the trigger on Escape", async () => {
        const user = userEvent.setup();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={() => {}} />);

        const trigger = screen.getByLabelText("Due date");
        trigger.focus();
        await user.keyboard("{Enter}");
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        const selected = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 4)) });
        await waitFor(() => expect(selected).toHaveFocus());

        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it("opens with Space and selects a focused day with Space", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={onChange} />);

        const trigger = screen.getByLabelText("Due date");
        trigger.focus();
        await user.keyboard(" ");
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        const selected = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 4)) });
        await waitFor(() => expect(selected).toHaveFocus());

        await user.keyboard(" ");
        expect(onChange).toHaveBeenCalledWith("2026-03-04");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("moves between days and months with the keyboard and selects with Enter", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={onChange} />);

        await user.click(screen.getByLabelText("Due date"));
        const selected = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 4)) });
        await waitFor(() => expect(selected).toHaveFocus());

        await user.keyboard("{ArrowRight}");
        const nextDay = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 5)) });
        await waitFor(() => expect(nextDay).toHaveFocus());

        await user.keyboard("{ArrowDown}");
        const nextWeek = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 12)) });
        await waitFor(() => expect(nextWeek).toHaveFocus());

        await user.keyboard("{PageDown}");
        const nextMonth = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 3, 12)) });
        await waitFor(() => expect(nextMonth).toHaveFocus());

        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenCalledWith("2026-04-12");
    });

    it("changes months with labelled chevrons without submitting the surrounding form", async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={() => {}} />
            </form>,
        );

        await user.click(screen.getByLabelText("Due date"));
        await user.click(screen.getByRole("button", { name: "Next month" }));
        expect(screen.getByText(monthLabel(localDateAtNoon(2026, 3, 1)))).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Previous month" }));
        expect(screen.getByText(monthLabel(localDateAtNoon(2026, 2, 1)))).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 2, 10)) }));
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("keeps keyboard navigation inside the month chosen with the chevrons", async () => {
        const user = userEvent.setup();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={() => {}} />);

        await user.click(screen.getByLabelText("Due date"));
        await user.click(screen.getByRole("button", { name: "Next month" }));

        const tabStop = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 3, 4)) });
        expect(tabStop).toHaveAttribute("tabindex", "0");

        tabStop.focus();
        await user.keyboard("{ArrowRight}");
        expect(screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 3, 5)) })).toHaveFocus();
    });

    it("closes when clicking outside", async () => {
        const user = userEvent.setup();
        render(<DatePickerButton id="due" label="Due date" value="2026-03-04" onChange={() => {}} />);

        await user.click(screen.getByLabelText("Due date"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        await user.click(document.body);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders a leap-year February and selects February 29", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DatePickerButton id="due" label="Due date" value="2024-02-29" onChange={onChange} />);

        await user.click(screen.getByLabelText("Due date"));
        expect(screen.getByText(monthLabel(localDateAtNoon(2024, 1, 1)))).toBeInTheDocument();

        const leapDay = screen.getByRole("button", { name: fullLabel(localDateAtNoon(2024, 1, 29)) });
        expect(leapDay).toHaveAttribute("aria-pressed", "true");
        await user.click(leapDay);
        expect(onChange).toHaveBeenCalledWith("2024-02-29");
    });

    it("starts a month that begins on Sunday in the first column", async () => {
        const user = userEvent.setup();
        render(<DatePickerButton id="due" label="Due date" value="2026-02-15" onChange={() => {}} />);

        await user.click(screen.getByLabelText("Due date"));
        const grid = screen.getByRole("grid");
        const rows = within(grid).getAllByRole("row");
        expect(within(rows[1]).getAllByRole("gridcell")[0]).toHaveTextContent("1");
    });

    it("crosses into the next year from December 31", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DatePickerButton id="due" label="Due date" value="2026-12-31" onChange={onChange} />);

        await user.click(screen.getByLabelText("Due date"));
        expect(screen.getByRole("button", { name: fullLabel(localDateAtNoon(2026, 11, 31)) })).toHaveAttribute("aria-pressed", "true");

        await user.click(screen.getByRole("button", { name: "Next month" }));
        expect(screen.getByText(monthLabel(localDateAtNoon(2027, 0, 1)))).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: fullLabel(localDateAtNoon(2027, 0, 1)) }));
        expect(onChange).toHaveBeenCalledWith("2027-01-01");
    });
});
