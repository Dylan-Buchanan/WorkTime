import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitsPage } from "./HabitsPage";
import { HabitProvider } from "../state/HabitContext";
import { GoalProvider } from "../state/GoalContext";
import { AppStateProvider } from "../state/AppStateContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { Habit, HabitCompletion } from "../state/types";
import { makeAppState } from "../test/mockTauri";
import { buildGoalFixture, buildGoalTrackerFixture } from "../lib/goals/testFixtures";

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
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <GoalProvider><HabitProvider><HabitsPage /></HabitProvider></GoalProvider>
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

function completion(id: string, habitId: string, bucket: string): HabitCompletion {
    return {
        id,
        habitId,
        bucket,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
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

    it("names a linked goal in the delete confirmation and only deletes once confirmed", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        await data.saveGoals([tracker], [
            buildGoalFixture({
                trackerId: tracker.id,
                title: "Ship the release",
                metric: { label: "Walks", current: 0, target: 5, unit: "days", source: "habit", habitId: "morning", overridePinned: false },
            }),
        ], []);
        await data.saveHabits([habit("morning", { name: "Morning walk" })], [completion("completion-1", "morning", "2026-10-31")]);
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

        render(wrap(data));
        await screen.findByText("Morning walk");
        const card = () => within(screen.getByText("Morning walk").closest("article")!);

        await user.click(card().getByRole("button", { name: "Delete" }));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("The goal Ship the release uses this habit as its metric."));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("It will be switched to manual tracking."));
        expect(screen.getByText("Morning walk")).toBeInTheDocument();
        expect((await data.loadHabits()).completions).toHaveLength(1);

        confirm.mockReturnValue(true);
        await user.click(card().getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByText("Morning walk")).not.toBeInTheDocument());
        await waitFor(async () => expect(await data.loadHabits()).toEqual({ habits: [], completions: [] }));
        await waitFor(async () => {
            const metric = (await data.loadGoals()).goals[0].metric;
            expect(metric).toEqual({ label: "Walks", current: 0, target: 5, unit: "days", source: "manual", overridePinned: false });
            expect(metric !== null && "habitId" in metric).toBe(false);
        });
        confirm.mockRestore();
    });

    it("downgrades every dependent goal, including achieved and dropped ones, and names them all", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const metric = { label: "Walks", current: 0, target: 5, unit: "days", source: "habit" as const, habitId: "morning", overridePinned: false };
        await data.saveGoals([tracker], [
            buildGoalFixture({ id: "goal-active", trackerId: tracker.id, title: "Alpha walk", metric, sortOrder: 0 }),
            buildGoalFixture({
                id: "goal-achieved", trackerId: tracker.id, title: "Zulu walk", metric, sortOrder: 1,
                lifecycle: "achieved", achievedAt: "2026-10-12T12:00:00.000Z",
            }),
            buildGoalFixture({
                id: "goal-dropped", trackerId: tracker.id, title: "Middle walk", metric, sortOrder: 2,
                lifecycle: "dropped", droppedAt: "2026-10-20T12:00:00.000Z",
            }),
        ], []);
        await data.saveHabits([habit("morning", { name: "Morning walk" })], []);
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

        render(wrap(data));
        await screen.findByText("Morning walk");
        await user.click(within(screen.getByText("Morning walk").closest("article")!).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByText("Morning walk")).not.toBeInTheDocument());

        const message = String(confirm.mock.calls[0][0]);
        expect(message).toContain("The goals Alpha walk, Middle walk and Zulu walk use this habit as their metric.");
        expect(message).toContain("They will be switched to manual tracking.");

        await waitFor(async () => {
            const goals = (await data.loadGoals()).goals;
            expect(goals).toHaveLength(3);
            for (const goal of goals) {
                expect(goal.metric).toEqual({ label: "Walks", current: 0, target: 5, unit: "days", source: "manual", overridePinned: false });
                expect(goal.metric !== null && "habitId" in goal.metric).toBe(false);
            }
        });
        confirm.mockRestore();
    });

    it("leaves goals untouched when archiving a habit and when deleting a different habit", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const morningMetric = { label: "Walks", current: 0, target: 5, unit: "days", source: "habit" as const, habitId: "morning", overridePinned: false };
        const eveningMetric = { label: "Walks", current: 0, target: 5, unit: "days", source: "habit" as const, habitId: "evening", overridePinned: false };
        const otherMetric = { label: "Walks", current: 0, target: 5, unit: "days", source: "habit" as const, habitId: "reading", overridePinned: false };
        await data.saveGoals([tracker], [
            buildGoalFixture({ id: "goal-morning", trackerId: tracker.id, title: "Morning goal", metric: morningMetric, sortOrder: 0 }),
            buildGoalFixture({ id: "goal-evening", trackerId: tracker.id, title: "Evening goal", metric: eveningMetric, sortOrder: 1 }),
            buildGoalFixture({ id: "goal-other", trackerId: tracker.id, title: "Other goal", metric: otherMetric, sortOrder: 2 }),
        ], []);
        await data.saveHabits([
            habit("morning", { name: "Morning walk" }),
            habit("evening", { name: "Evening walk", position: 1 }),
            habit("reading", { name: "Read", position: 2 }),
        ], []);
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

        render(wrap(data));
        await screen.findByText("Morning walk");
        await user.click(within(screen.getByText("Morning walk").closest("article")!).getByRole("button", { name: "Archive" }));
        await waitFor(() => expect(screen.queryByText("Morning walk")).not.toBeInTheDocument());

        // Archiving keeps the link: only deletion downgrades.
        await waitFor(async () => {
            const goals = (await data.loadGoals()).goals;
            expect(goals.find(goal => goal.id === "goal-morning")?.metric).toEqual(morningMetric);
        });

        await user.click(within(screen.getByText("Evening walk").closest("article")!).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByText("Evening walk")).not.toBeInTheDocument());

        const message = String(confirm.mock.calls[0][0]);
        expect(message).toContain("The goal Evening goal uses this habit as its metric.");
        expect(message).not.toContain("Morning goal");
        expect(message).not.toContain("Other goal");

        await waitFor(async () => {
            const goals = (await data.loadGoals()).goals;
            const evening = goals.find(goal => goal.id === "goal-evening")?.metric ?? null;
            expect(evening).toEqual({ label: "Walks", current: 0, target: 5, unit: "days", source: "manual", overridePinned: false });
            expect(evening !== null && "habitId" in evening).toBe(false);
            expect(goals.find(goal => goal.id === "goal-morning")?.metric).toEqual(morningMetric);
            expect(goals.find(goal => goal.id === "goal-other")?.metric).toEqual(otherMetric);
        });
        confirm.mockRestore();
    });

    it("keeps the existing delete confirmation wording when no goal links the habit", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([habit("morning", { name: "Morning walk" })], []);
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

        render(wrap(data));
        await screen.findByText("Morning walk");
        await user.click(within(screen.getByText("Morning walk").closest("article")!).getByRole("button", { name: "Delete" }));
        expect(confirm).toHaveBeenCalledWith("Delete “Morning walk”? This also deletes its completion history.");
        expect(screen.getByText("Morning walk")).toBeInTheDocument();
        confirm.mockRestore();
    });
});
