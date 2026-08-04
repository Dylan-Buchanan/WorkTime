import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitsPage } from "./HabitsPage";
import { HabitProvider } from "../state/HabitContext";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { Habit } from "../state/types";
import { makeAppState } from "../test/mockTauri";

const OWNER = "habit-page-owner";

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: id,
        description: "",
        color: "#6366F1",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function wrap(data: InMemoryDataAccess) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <HabitProvider><HabitsPage /></HabitProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

beforeEach(() => localStorage.clear());

describe("HabitsPage", () => {
    it("renders period windows and toggles a current completion cell", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([habit("morning", { name: "Morning walk", description: "Start the day outside" })], []);
        const user = userEvent.setup();

        render(wrap(data));
        await screen.findByText("Morning walk");

        expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
        const todayCell = screen.getByRole("button", { name: /today, not completed/ });
        await user.click(todayCell);
        await waitFor(() => expect(screen.getByRole("button", { name: /today, completed/ })).toHaveAttribute("aria-pressed", "true"));

        // Day and Week are genuinely distinct windows: Day renders today's
        // single daily cell while Week renders the seven-day window, so the
        // selector is not a duplicate control.
        await user.click(screen.getByRole("button", { name: "Day" }));
        expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByLabelText("Morning walk day completion cells")).toBeInTheDocument();
        expect(screen.getByText(/1 cell/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Week" }));
        expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByLabelText("Morning walk week completion cells")).toBeInTheDocument();
        expect(screen.getByText(/7 cells/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Month" }));
        expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByLabelText("Morning walk month completion cells")).toBeInTheDocument();
    });

    it("creates, edits, archives, restores, and hard-confirms deletion", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([habit("morning", { name: "Morning walk" })], []);
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

        render(wrap(data));
        await screen.findByText("Morning walk");

        await user.click(screen.getByRole("button", { name: "Add habit" }));
        await user.type(screen.getByLabelText("Name"), "Read");
        await user.click(screen.getByRole("button", { name: "Create habit" }));
        await screen.findByText("Read");

        const readCard = screen.getByText("Read").closest("article");
        expect(readCard).not.toBeNull();
        await user.click(within(readCard!).getByRole("button", { name: "Edit" }));
        const nameInput = screen.getByLabelText("Name");
        await user.clear(nameInput);
        await user.type(nameInput, "Read books");
        await user.click(screen.getByRole("button", { name: "Save changes" }));
        await screen.findByText("Read books");

        const morningCard = screen.getByText("Morning walk").closest("article");
        await user.click(within(morningCard!).getByRole("button", { name: "Archive" }));
        expect(screen.queryByText("Morning walk")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Show archived" }));
        await screen.findByText("Morning walk");
        const archivedCard = screen.getByText("Morning walk").closest("article");
        await user.click(within(archivedCard!).getByRole("button", { name: "Restore" }));
        await user.click(within(screen.getByText("Morning walk").closest("article")!).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByText("Morning walk")).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("completion history"));
        confirm.mockRestore();
    });

    it("expands daily and weekly year history into engine-derived seven-column grids", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([
            habit("daily", { name: "Daily", frequency: "daily" }),
            habit("weekly", { name: "Weekly", frequency: "weekly", position: 1 }),
            habit("monthly", { name: "Monthly", frequency: "monthly", position: 2 }),
        ], []);
        const user = userEvent.setup();

        render(wrap(data));
        await screen.findByText("Daily");
        await user.click(screen.getByRole("button", { name: "Year" }));

        expect(screen.getByRole("button", { name: "Expand Daily 365 details" })).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByRole("button", { name: "Expand Weekly 365 details" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Expand Monthly 365 details" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Expand Daily 365 details" }));
        const dailyGrid = screen.getByLabelText("Daily daily 365 completion grid");
        expect(dailyGrid).toBeVisible();
        expect(within(dailyGrid).getAllByRole("button")).toHaveLength(365);
        expect(screen.getByRole("button", { name: "Collapse Daily 365 details" })).toHaveAttribute("aria-expanded", "true");
        await user.click(within(dailyGrid).getByRole("button", { name: /today, not completed/ }));
        await waitFor(() => expect(within(dailyGrid).getByRole("button", { name: /today, completed/ })).toHaveAttribute("aria-pressed", "true"));

        await user.click(screen.getByRole("button", { name: "Expand Weekly 365 details" }));
        const weeklyGrid = screen.getByLabelText("Weekly weekly 365 completion grid");
        expect(within(weeklyGrid).getAllByRole("button")).toHaveLength(53);
        expect(JSON.parse(localStorage.getItem("habit_state_v1")!).ui).toMatchObject({
            selected: "weekly",
            expanded: { daily: true, weekly: true },
        });
    });
});
