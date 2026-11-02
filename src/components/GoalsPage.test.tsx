import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { GoalsPage } from "./GoalsPage";
import { GoalProvider } from "../state/GoalContext";
import { HabitProvider } from "../state/HabitContext";
import { AppStateProvider } from "../state/AppStateContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { GoalMetric, Habit, Project } from "../state/types";
import type { LocalDateKey } from "../lib/todos/types";
import type { DeckPlan } from "../lib/goals/deck/types";
import { serializeGoalSet } from "../lib/goals/goalSetFile";
import {
    buildArchivedTrackerFixture,
    buildCheckInHistoryFixture,
    buildCleanCheckInHistoryFixture,
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
} from "../lib/goals/testFixtures";

const drag = vi.hoisted(() => ({ end: null as null | ((event: DragEndEvent) => void) }));
const deckExport = vi.hoisted(() => ({ render: vi.fn(), deliver: vi.fn(), stamp: vi.fn() }));
vi.mock("../lib/goals/deck/render", () => ({ renderDeck: deckExport.render }));
vi.mock("../lib/goals/deck/delivery", () => ({ initiateBlobDownload: deckExport.deliver }));
vi.mock("../state/GoalContext", async importOriginal => {
    const original = await importOriginal<typeof import("../state/GoalContext")>();
    return { ...original, useGoals: () => {
        const goals = original.useGoals();
        return { ...goals, stampBuiltPeriod: async (trackerId: string, periodStart: LocalDateKey) => {
            await deckExport.stamp(trackerId, periodStart);
            await goals.stampBuiltPeriod(trackerId, periodStart);
        } };
    } };
});
vi.mock("@dnd-kit/core", async importOriginal => {
    const original = await importOriginal<typeof import("@dnd-kit/core")>();
    return { ...original, DndContext: (props: React.ComponentProps<typeof original.DndContext>) => {
        drag.end = props.onDragEnd ?? null;
        return <original.DndContext {...props} />;
    } };
});

function tree(data: InMemoryDataAccess, today?: LocalDateKey) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="goals-page-owner"><HabitProvider><AppStateProvider><ProjectManagerProvider><GoalProvider><GoalsPage today={today} /></GoalProvider></ProjectManagerProvider></AppStateProvider></HabitProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}
async function mount(data = new InMemoryDataAccess(makeAppState()), today?: LocalDateKey) {
    const view = render(tree(data, today));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add tracker" })).toBeEnabled());
    return { data, user: userEvent.setup(), ...view };
}
async function oneTracker() {
    const data = new InMemoryDataAccess(makeAppState());
    const tracker = buildGoalTrackerFixture();
    await data.saveGoals([tracker], [], []);
    return { data, tracker };
}
function project(overrides: Partial<Project> = {}): Project {
    return {
        id: "project-1",
        name: "Deep Work",
        color: "#6366F1",
        workableStart: "09:00",
        workableEnd: "17:00",
        workableDays: [1, 2, 3, 4, 5],
        isArchived: false,
        sortOrder: 0,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        ...overrides,
    };
}
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
const habitMetric = (overrides: Partial<GoalMetric> = {}): GoalMetric => ({
    label: "Read",
    current: 0,
    target: 6,
    unit: "days",
    source: "habit",
    habitId: "habit-read",
    overridePinned: false,
    ...overrides,
});
beforeEach(() => {
    localStorage.clear();
    deckExport.render.mockReset().mockResolvedValue({ blob: new Blob(["deck"]), fileName: "Work.pptx" });
    deckExport.deliver.mockReset().mockResolvedValue(undefined);
    deckExport.stamp.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe("GoalsPage", () => {
    it("shows a clear page heading and description", async () => {
        await mount();
        expect(screen.getByRole("heading", { level: 1, name: "Goals" })).toBeInTheDocument();
        expect(screen.getByText(/Check in each period to record progress/)).toBeInTheDocument();
    });

    it("has a clean empty state and creates multiple trackers using both validated cadence variants", async () => {
        const { user, data } = await mount();
        expect(screen.getByRole("heading", { name: "Start your first tracker" })).toBeInTheDocument();
        expect(screen.getByText(/A tracker holds the goals you are working toward/)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Add tracker" })).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "Add tracker" }));
        await user.type(screen.getByLabelText("Tracker name"), "Work");
        await user.type(screen.getByLabelText("Purpose"), "Ship useful things");
        await user.clear(screen.getByLabelText("Every N weeks"));
        await user.type(screen.getByLabelText("Every N weeks"), "3");
        await user.selectOptions(screen.getByLabelText("Weekday"), "3");
        fireEvent.change(screen.getByLabelText("Color"), { target: { value: "#123456" } });
        await user.click(screen.getByRole("button", { name: "Create tracker" }));
        expect(await screen.findByRole("heading", { name: "Work" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Add your first goal")).toBeInTheDocument();
        expect(screen.getByText(/Review what you did/)).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: /project/i })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Add tracker" }));
        await user.type(screen.getByLabelText("Tracker name"), "Life");
        await user.selectOptions(screen.getByLabelText("Cadence"), "monthly-weekday");
        await user.selectOptions(screen.getByLabelText("Weekday"), "5");
        await user.click(screen.getByRole("button", { name: "Create tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers).toHaveLength(2));
        const saved = await data.loadGoals();
        expect(saved.trackers.find(row => row.name === "Work")).toMatchObject({ purpose: "Ship useful things", cadence: { kind: "every-n-weeks", weekday: 3, intervalWeeks: 3 }, color: "#123456" });
        expect(saved.trackers.find(row => row.name === "Life")?.cadence).toEqual({ kind: "monthly-weekday", weekday: 5 });
        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), saved.trackers.find(row => row.name === "Work")!.id);
        expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
    });

    it("shows a distinct empty state when every tracker is archived", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveGoals([buildArchivedTrackerFixture()], [], []);
        await mount(data);
        expect(screen.getByRole("heading", { name: "No active trackers" })).toBeInTheDocument();
        expect(screen.getByText(/Every tracker you have is archived/)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Add tracker" })).toHaveLength(1);
        expect(screen.queryByRole("heading", { name: "Start your first tracker" })).not.toBeInTheDocument();
    });

    it("rejects invalid tracker forms and supports tracker edit, confirmed archive, and restore", async () => {
        const { data, tracker } = await oneTracker();
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: "Edit tracker" }));
        await user.clear(screen.getByLabelText("Tracker name"));
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Give this tracker a name");
        await user.type(screen.getByLabelText("Tracker name"), "Renamed");
        await user.clear(screen.getByLabelText("Every N weeks"));
        await user.type(screen.getByLabelText("Every N weeks"), "0");
        // Exercise app validation independently of browser number-input validation.
        fireEvent.submit(screen.getByRole("form", { name: "Edit tracker" }));
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect((await data.loadGoals()).trackers[0].name).toBe(tracker.name);
        await user.clear(screen.getByLabelText("Every N weeks"));
        await user.type(screen.getByLabelText("Every N weeks"), "2");
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        expect(await screen.findByRole("heading", { name: "Renamed" })).toBeInTheDocument();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        await user.click(screen.getByRole("button", { name: "Archive tracker" }));
        expect(screen.getByRole("heading", { name: "Renamed" })).toBeInTheDocument();
        confirm.mockReturnValue(true);
        await user.click(screen.getByRole("button", { name: "Archive tracker" }));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("history will be kept"));
        await user.click(screen.getByRole("checkbox", { name: "Show archived trackers" }));
        expect(await screen.findByRole("heading", { name: "Renamed" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Reactivate tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].isArchived).toBe(false));
        expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    });

    it("shows the exact saved first start with honest future and past copy, leaving all frozen mount slots", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04", sortOrder: 0 });
        const past = buildGoalTrackerFixture({ id: "past", name: "Past", sortOrder: 1 });
        const goal = buildGoalFixture({ trackerId: future.id });
        await data.saveGoals([future, past], [goal], []);
        const { user, container } = await mount(data);
        expect(screen.getByText("Every 2 weeks on Sunday")).toBeInTheDocument();
        expect(screen.getByText(/No open period. First period starts on/)).toHaveTextContent("2099-01-04");
        expect(screen.queryByRole("button", { name: /check.in|build deck/i })).not.toBeInTheDocument();
        for (const slot of ["tracker-due", "check-in-entry", "deck-entry", "goal-set-actions", "goal-slip", "check-in-wizard", "deck-preview", "due-nudge"]) {
            expect(container.querySelector(`[data-goals-slot="${slot}"]`)).not.toBeNull();
        }
        expect(container.querySelector('[data-goals-slot="tracker-due"]')).toHaveAttribute("data-tracker-id", future.id);
        expect(container.querySelector('[data-goals-slot="goal-slip"]')).toHaveAttribute("data-goal-id", goal.id);
        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), past.id);
        expect(screen.getByText(/First period started on/)).toHaveTextContent(past.cadenceAnchorAt);
        expect(screen.queryByText(/No open period/)).not.toBeInTheDocument();
    });

    it("quick-adds immediately on Enter and follows name, status, note keyboard order", async () => {
        const { data } = await oneTracker();
        const { user } = await mount(data);
        const name = screen.getByRole("textbox", { name: "Goal name" });
        await user.type(name, "Launch{Enter}");
        expect(screen.getByRole("heading", { name: "Launch" })).toBeInTheDocument();
        expect(name).toHaveFocus();
        expect(name).toHaveValue("");
        await user.type(name, "Learn");
        await user.tab();
        expect(screen.getByRole("combobox", { name: "Status" })).toHaveFocus();
        await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "achieved");
        await user.tab();
        expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
        await user.keyboard("Completed course{Enter}");
        await user.selectOptions(screen.getByRole("combobox", { name: "Goal status" }), "achieved");
        expect(screen.getByRole("heading", { name: "Learn" })).toBeInTheDocument();
        await waitFor(async () => expect((await data.loadGoals()).goals).toHaveLength(2));
        expect((await data.loadGoals()).goals.find(row => row.title === "Launch")).toMatchObject({ lifecycle: "active", notes: "", projectId: null });
        expect((await data.loadGoals()).goals.find(row => row.title === "Learn")).toMatchObject({ lifecycle: "achieved", notes: "Completed course" });
    });

    it("edits a goal and its one manual metric, validates values, and can remove the metric", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.clear(screen.getByRole("textbox", { name: "Name" }));
        await user.type(screen.getByRole("textbox", { name: "Name" }), "Train");
        await user.type(screen.getByLabelText("Goal note"), "Weekly practice");
        await user.click(screen.getByLabelText("Track one metric"));
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Metric needs a label");
        await user.type(screen.getByLabelText("Metric label"), "Sessions");
        await user.clear(screen.getByLabelText("Current"));
        await user.type(screen.getByLabelText("Current"), "3.5");
        await user.clear(screen.getByLabelText("Target"));
        await user.type(screen.getByLabelText("Target"), "8");
        await user.type(screen.getByLabelText("Unit"), "sessions");
        expect(within(screen.getByLabelText("Source")).getAllByRole("option").map(option => option.textContent)).toEqual(["Manual", "Habit"]);
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.getByText(/Sessions: 3.5 \/ 8 sessions/)).toBeInTheDocument();
        expect(screen.getByText("Manual")).toBeInTheDocument();
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric?.current).toBe(3.5));
        await user.click(screen.getByRole("button", { name: "Show details" }));
        expect(screen.getByText("Weekly practice")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(screen.getByLabelText("Track one metric"));
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toBeNull());
    });

    it.each(["manual", "liftingtracker"] as const)("preserves existing %s override metadata and keeps the legacy auto source disabled", async source => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: { label: "Lifts", current: 4, target: 8, unit: "sessions", source, overridePinned: true } });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        expect(screen.getByText(`${source === "manual" ? "Manual" : "Auto"} · Override`)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(within(screen.getByLabelText("Source")).getAllByRole("option").map(option => option.textContent))
            .toEqual(source === "liftingtracker" ? ["Manual", "Habit", "Auto"] : ["Manual", "Habit"]);
        if (source === "liftingtracker") expect(within(screen.getByLabelText("Source")).getByRole("option", { name: "Auto" })).toBeDisabled();
        await user.type(screen.getByLabelText("Goal note"), "Keep the metric");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Keep the metric"));
        expect((await data.loadGoals()).goals[0].metric).toEqual(goal.metric);
    });

    it("offers habit as a metric source and defaults the label and unit from the selected habit", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read 20 minutes" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(screen.getByLabelText("Track one metric"));
        expect(screen.queryByLabelText("Habit")).not.toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Source"), "habit");
        const picker = screen.getByLabelText("Habit");
        expect(within(picker).getByRole("option", { name: "Read 20 minutes" })).toBeInTheDocument();
        await user.selectOptions(picker, "habit-read");
        expect(screen.getByLabelText("Metric label")).toHaveValue("Read 20 minutes");
        expect(screen.getByLabelText("Unit")).toHaveValue("days");
        expect(screen.queryByLabelText("Current")).not.toBeInTheDocument();
    });

    it("saves a habit metric with a derived current of zero and no override", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read 20 minutes" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(screen.getByLabelText("Track one metric"));
        await user.selectOptions(screen.getByLabelText("Source"), "habit");
        await user.selectOptions(screen.getByLabelText("Habit"), "habit-read");
        await user.clear(screen.getByLabelText("Target"));
        await user.type(screen.getByLabelText("Target"), "6");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Read 20 minutes", current: 0, target: 6, unit: "days", source: "habit", habitId: "habit-read", overridePinned: false,
        }));
        const row = screen.getByLabelText(goal.title);
        expect(await within(row).findByText("Read 20 minutes: 0 / 6 days · 12 days left")).toBeInTheDocument();
        expect(within(row).getByText("Habit")).toBeInTheDocument();
    });

    it("switching manual to habit and back clears the habit link, override, and stored current", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({
            trackerId: tracker.id,
            metric: { label: "Sessions", current: 3, target: 8, unit: "sessions", source: "manual", overridePinned: true },
        });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read 20 minutes" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getByLabelText("Current")).toHaveValue(3);
        await user.selectOptions(screen.getByLabelText("Source"), "habit");
        await user.selectOptions(screen.getByLabelText("Habit"), "habit-read");
        // An edited label is never overwritten by a later habit selection.
        expect(screen.getByLabelText("Metric label")).toHaveValue("Sessions");
        await user.selectOptions(screen.getByLabelText("Source"), "manual");
        expect(screen.getByLabelText("Current")).toHaveValue(0);
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => {
            const metric = (await data.loadGoals()).goals[0].metric;
            expect(metric).toStrictEqual({ label: "Sessions", current: 0, target: 8, unit: "days", source: "manual", overridePinned: false });
            expect(metric !== null && "habitId" in metric).toBe(false);
        });
    });

    it("blocks a habit target above the cadence maximum with the specific reason", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([
            habit("habit-daily", { name: "Daily walk" }),
            habit("habit-weekly", { name: "Weekly review", frequency: "weekly", position: 1 }),
        ], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(screen.getByLabelText("Track one metric"));
        await user.selectOptions(screen.getByLabelText("Source"), "habit");
        await user.selectOptions(screen.getByLabelText("Habit"), "habit-daily");
        await user.clear(screen.getByLabelText("Target"));
        await user.type(screen.getByLabelText("Target"), "20");
        const picker = screen.getByLabelText("Habit");
        // Impossible habits stay visible and explain why rather than disappearing.
        expect(within(picker).getByRole("option", { name: /Daily walk \(max 14 days for this cadence\)/ })).toBeDisabled();
        expect(within(picker).getByRole("option", { name: /Weekly review \(max 2 weeks for this cadence\)/ })).toBeDisabled();
        expect(screen.getByText("This cadence can hold at most 14 days.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.getByRole("alert")).toHaveTextContent("This cadence can hold at most 14 days.");
        expect((await data.loadGoals()).goals[0].metric).toBeNull();
    });

    it("hints at an unreachable saved target without rewriting stored data", async () => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ label: "Daily walk", target: 20 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("This cadence can hold at most 14 days.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getAllByText("This cadence can hold at most 14 days.")).toHaveLength(2);
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.getByRole("alert")).toHaveTextContent("This cadence can hold at most 14 days.");
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it("shows a quiet missing-habit note instead of a zero reading on a broken link", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: "habit-gone" }) });
        await data.saveGoals([tracker], [goal], []);
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(await within(row).findByText("Linked habit is missing")).toBeInTheDocument();
        expect(within(row).queryByText(/0 \/ 6/)).not.toBeInTheDocument();
        expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("never shows a zero reading while the habits provider is still hydrating", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ target: 12 }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        vi.spyOn(data, "loadHabits").mockReturnValue(new Promise<never>(() => {}));
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Loading habit progress…")).toBeInTheDocument();
        expect(within(row).queryByText(/0 \/ 12/)).not.toBeInTheDocument();
    });

    it("renders a project link and a habit reading as two separate links", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, projectId: "project-1", metric: habitMetric({ target: 3 }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {},
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Deep Work")).toBeInTheDocument();
        expect(within(row).queryByText("Linked project is missing")).not.toBeInTheDocument();
        expect(await within(row).findByText("Read: 0 / 3 days · 12 days left")).toBeInTheDocument();
        expect(within(row).queryByText("Linked habit is missing")).not.toBeInTheDocument();
    });

    it("keeps a linked archived habit as the selected picker value", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ label: "Read" }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([
            habit("habit-read", { name: "Read", isArchived: true }),
            habit("habit-walk", { name: "Walk", position: 1 }),
        ], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const picker = screen.getByLabelText("Habit");
        expect(picker).toHaveValue("habit-read");
        expect(within(picker).getByRole("option", { name: "Read (archived)" })).toBeInTheDocument();
        expect(within(picker).getByRole("option", { name: "Walk" })).toBeInTheDocument();
        expect(within(picker).getAllByRole("option")).toHaveLength(3);
    });

    it("moves goals through achieved and dropped and reactivates them without losing history", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id });
        await data.saveGoals([tracker], [goal], [checkIn]);
        const { user } = await mount(data);
        const achieve = screen.getByRole("button", { name: "Achieve" });
        expect(achieve).toHaveClass("border-emerald-700");
        expect(achieve).toHaveClass("text-emerald-200");
        const drop = screen.getByRole("button", { name: "Drop" });
        expect(drop).toHaveClass("border-rose-800");
        expect(drop).toHaveClass("text-rose-200");
        await user.click(achieve);
        expect(screen.queryByRole("heading", { name: goal.title })).not.toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Goal status"), "achieved");
        const reactivate = screen.getByRole("button", { name: "Reactivate" });
        expect(reactivate).toHaveClass("border-neutral-700");
        await user.click(reactivate);
        await user.selectOptions(screen.getByLabelText("Goal status"), "active");
        await user.click(screen.getByRole("button", { name: "Drop" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "dropped");
        expect(screen.getByRole("heading", { name: goal.title })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Reactivate" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "active");
        await waitFor(async () => expect((await data.loadGoals()).goals[0].lifecycle).toBe("active"));
        expect((await data.loadGoals()).checkIns).toEqual([checkIn]);
    });

    it("renders colored lifecycle pills for active, achieved, and dropped goals", async () => {
        const { data, tracker } = await oneTracker();
        const active = buildGoalFixture({ id: "goal-active", trackerId: tracker.id, title: "Active goal", sortOrder: 0 });
        const achieved = buildGoalFixture({ id: "goal-achieved", trackerId: tracker.id, title: "Achieved goal", sortOrder: 1, lifecycle: "achieved", achievedAt: "2026-10-12T12:00:00.000Z" });
        const dropped = buildGoalFixture({ id: "goal-dropped", trackerId: tracker.id, title: "Dropped goal", sortOrder: 2, lifecycle: "dropped", droppedAt: "2026-10-20T12:00:00.000Z" });
        await data.saveGoals([tracker], [active, achieved, dropped], []);
        const { user } = await mount(data);
        await user.selectOptions(screen.getByLabelText("Goal status"), "all");
        const pill = (title: string) => within(screen.getByLabelText(title)).getByText(/^(Active|Achieved|Dropped)$/);
        expect(pill("Active goal")).toHaveTextContent("Active");
        expect(pill("Active goal")).toHaveClass("text-sky-200");
        expect(pill("Achieved goal")).toHaveTextContent("Achieved");
        expect(pill("Achieved goal")).toHaveClass("text-emerald-200");
        expect(pill("Dropped goal")).toHaveTextContent("Dropped");
        expect(pill("Dropped goal")).toHaveClass("text-neutral-400");
    });

    it("reorders from the dnd-kit drop event while retaining hidden lifecycle rows and the complete set", async () => {
        const { data, tracker } = await oneTracker();
        const first = buildGoalFixture({ id: "a", trackerId: tracker.id, title: "First", sortOrder: 0 });
        const hidden = buildGoalFixture({ id: "b", trackerId: tracker.id, title: "Hidden", sortOrder: 1, lifecycle: "dropped" });
        const last = buildGoalFixture({ id: "c", trackerId: tracker.id, title: "Last", sortOrder: 2 });
        await data.saveGoals([tracker], [first, hidden, last], []);
        await mount(data);
        expect(screen.getByRole("button", { name: "Reorder First" })).toBeInTheDocument();
        await act(async () => { drag.end!({ active: { id: first.id }, over: { id: last.id } } as DragEndEvent); });
        const list = screen.getByLabelText("Goals list");
        expect(within(list).getAllByRole("heading").map(row => row.textContent)).toEqual(["Last", "First"]);
        await waitFor(async () => expect((await data.loadGoals()).goals.find(row => row.id === last.id)?.sortOrder).toBe(0));
        const saved = (await data.loadGoals()).goals.sort((a, b) => a.sortOrder - b.sortOrder);
        expect(saved.map(row => row.id)).toEqual([last.id, hidden.id, first.id]);
    });

    it("shows the due badge with the completed period label, and clears it when that period is built", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const due = buildGoalTrackerFixture({ id: "due", name: "Due", sortOrder: 0 });
        const built = buildGoalTrackerFixture({ id: "built", name: "Built", sortOrder: 1, lastBuiltPeriodStart: "2026-10-04" });
        await data.saveGoals([due, built], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const slot = () => container.querySelector('[data-goals-slot="tracker-due"]') as HTMLElement;
        expect(slot()).toHaveAttribute("data-tracker-id", due.id);
        expect(slot()).toHaveTextContent("Deck due · October 2026");
        // An equal build key permits a rebuild but no longer shows the badge.
        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), built.id);
        expect(slot()).toHaveAttribute("data-tracker-id", built.id);
        expect(slot()).toBeEmptyDOMElement();
    });

    it("shows no due badge before the first boundary or for an archived tracker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const active = buildGoalTrackerFixture({ id: "active", name: "Active", sortOrder: 0 });
        const archived = buildArchivedTrackerFixture({ id: "archived", name: "Archived", sortOrder: 1 });
        await data.saveGoals([active, archived], [], []);
        const { user, container, unmount } = await mount(data, "2026-10-20");
        const slot = () => container.querySelector('[data-goals-slot="tracker-due"]') as HTMLElement;
        await user.click(screen.getByRole("checkbox", { name: "Show archived trackers" }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), archived.id);
        expect(slot()).toHaveAttribute("data-tracker-id", archived.id);
        expect(slot()).toBeEmptyDOMElement();

        unmount();
        const futureData = new InMemoryDataAccess(makeAppState());
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04" });
        await futureData.saveGoals([future], [], []);
        const futureView = await mount(futureData, "2026-10-20");
        const futureSlot = futureView.container.querySelector('[data-goals-slot="tracker-due"]') as HTMLElement;
        expect(futureSlot).toHaveAttribute("data-tracker-id", future.id);
        expect(futureSlot).toBeEmptyDOMElement();
    });

    it("shows the slip counter only after two consecutive slipping transitions", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const slipping = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Slipping", sortOrder: 0 });
        const clean = buildGoalFixture({ id: "goal-clean", trackerId: tracker.id, title: "Clean", sortOrder: 1 });
        await data.saveGoals(
            [tracker],
            [slipping, clean],
            [...buildCheckInHistoryFixture("goal-ship"), ...buildCleanCheckInHistoryFixture("goal-clean")],
        );
        await mount(data, "2026-11-02");
        expect(within(screen.getByLabelText("Slipping")).getByText("Slipped 2×")).toBeInTheDocument();
        expect(within(screen.getByLabelText("Clean")).queryByText(/Slipped/)).not.toBeInTheDocument();
    });

    it("shows no slip counter for a single slip or a clean history", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], [
            buildGoalCheckInFixture({ id: "one-1", goalId: goal.id, periodStart: "2026-10-18", planned: [{ text: "Ship the migration", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "one-2", goalId: goal.id, periodStart: "2026-11-01", did: "Reviewed the spec" }),
        ]);
        const { container } = await mount(data, "2026-11-02");
        expect(container.querySelector('[data-goals-slot="goal-slip"]')).toBeEmptyDOMElement();
    });

    it("keeps the legacy no-open-period copy and disables the check-in control before the first boundary", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04" });
        await data.saveGoals([future], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement;
        expect(entry).toHaveAttribute("data-tracker-id", future.id);
        expect(entry).toHaveTextContent("No open period. First period starts on 2099-01-04.");
        expect(screen.getAllByText(/No open period. First period starts on/)).toHaveLength(1);
        const countdown = entry.querySelector("[data-goal-countdown-tone]") as HTMLElement;
        expect(countdown).toHaveAttribute("data-goal-countdown-tone", "green");
        expect(countdown).toHaveTextContent(/\d+ days/);
        const control = within(entry).getByRole("button", { name: "Period not open" });
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute("aria-disabled", "true");
        expect(control).toHaveClass("border-neutral-700");
        await user.click(control);
        expect(container.querySelector('[data-goals-slot="check-in-wizard"]')).toBeEmptyDOMElement();
    });

    it("colors the countdown by days remaining before the first period", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const soon = buildGoalTrackerFixture({ cadenceAnchorAt: "2026-10-25" });
        await data.saveGoals([soon], [], []);
        const { container } = await mount(data, "2026-10-20");
        const countdown = container.querySelector("[data-goal-countdown-tone]") as HTMLElement;
        expect(countdown).toHaveAttribute("data-goal-countdown-tone", "yellow");
        expect(countdown).toHaveTextContent("5 days");
    });

    it("opens the wizard pinned to the current grid period and removes it on close", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 9, 20, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement;
        expect(entry).toHaveAttribute("data-tracker-id", tracker.id);
        expect(entry).toHaveTextContent(`First period started on ${tracker.cadenceAnchorAt}.`);
        const openEntry = within(entry).getByRole("button", { name: "Check in · October 2026" });
        expect(openEntry).toHaveClass("bg-indigo-600");
        expect(openEntry).toHaveClass("ring-indigo-400/40");
        expect(openEntry).toHaveTextContent("Period open");
        await user.click(openEntry);

        const slot = container.querySelector('[data-goals-slot="check-in-wizard"]') as HTMLElement;
        expect(within(slot).getByRole("heading", { name: "Check in · October 2026" })).toBeInTheDocument();
        expect(within(slot).getByLabelText("Check-in period")).toHaveValue("2026-10-18");
        expect(within(slot).getByLabelText(`Did for ${goal.title}`)).toBeInTheDocument();

        await user.click(within(slot).getByRole("button", { name: "Close check-in wizard" }));
        expect(slot).toBeEmptyDOMElement();
    });

    it("builds the most recent completed deck into the preview slot and clears it on close", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        expect(entry).toHaveAttribute("data-tracker-id", tracker.id);
        const build = within(entry).getByRole("button", { name: "Build deck" });
        expect(build).toBeEnabled();
        await user.click(build);
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
        // The completed period is the one that started 2026-10-04, not the 2026-10-18 period in progress.
        expect(within(preview).getAllByText(/Oct 4/).length).toBeGreaterThan(0);
        expect(within(preview).getAllByLabelText("Slide title")[0]).toHaveValue(tracker.name);
        await user.click(within(preview).getByRole("button", { name: "Close preview" }));
        expect(preview).toBeEmptyDOMElement();
    });

    it("shows the built cue for the completed period and still allows a same-period rebuild", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ lastBuiltPeriodStart: "2026-10-04" });
        await data.saveGoals([tracker], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        expect(within(entry).getByText("Built")).toBeInTheDocument();
        const rebuild = within(entry).getByRole("button", { name: "Rebuild deck" });
        expect(rebuild).toBeEnabled();
        await user.click(rebuild);
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
    });

    it("disables the deck entry without a completed period and for an archived tracker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const inProgress = buildGoalTrackerFixture({ id: "in-progress", name: "In progress", cadenceAnchorAt: "2026-10-18", sortOrder: 0 });
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04", sortOrder: 1 });
        const archived = buildArchivedTrackerFixture({ id: "archived", name: "Archived", sortOrder: 2 });
        await data.saveGoals([inProgress, future, archived], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = () => container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        const preview = () => container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;

        expect(entry()).toHaveAttribute("data-tracker-id", inProgress.id);
        expect(entry()).toHaveTextContent("No completed period yet. Build the deck after the October 2026 period completes.");
        const disabled = within(entry()).getByRole("button", { name: "Deck not ready" });
        expect(disabled).toBeDisabled();
        expect(disabled).toHaveAttribute("aria-disabled", "true");
        await user.click(disabled);
        expect(preview()).toBeEmptyDOMElement();
        expect(screen.queryByRole("button", { name: /build deck|rebuild deck/i })).not.toBeInTheDocument();

        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), future.id);
        expect(entry()).toHaveAttribute("data-tracker-id", future.id);
        expect(entry()).toHaveTextContent("it starts on 2099-01-04");
        expect(within(entry()).getByRole("button", { name: "Deck not ready" })).toBeDisabled();
        expect(preview()).toBeEmptyDOMElement();

        await user.click(screen.getByRole("checkbox", { name: "Show archived trackers" }));
        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), archived.id);
        expect(entry()).toHaveAttribute("data-tracker-id", archived.id);
        expect(entry()).toHaveTextContent("This tracker is archived. Reactivate it to build a deck.");
        expect(within(entry()).getByRole("button", { name: "Deck not ready" })).toBeDisabled();
        expect(preview()).toBeEmptyDOMElement();
    });

    it("keeps the preview open and writes no export artifacts to localStorage", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        await data.saveGoals([tracker], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        await user.click(within(entry).getByRole("button", { name: "Build deck" }));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        const heading = within(preview).getByRole("heading", { name: `${tracker.name} deck preview` });
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
        expect(within(preview).getByRole("heading", { name: heading.textContent! })).toBeInTheDocument();
        expect(within(preview).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("awaits render, delivery, then stamp with the edited plan's completed period key", async () => {
        const { data, tracker } = await oneTracker();
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        const title = within(preview).getAllByLabelText("Slide title")[0];
        fireEvent.change(title, { target: { value: "Edited export title" } });
        const notes = within(preview).getAllByLabelText("Speaker notes")[0];
        fireEvent.change(notes, { target: { value: "Edited export notes" } });
        let finishRender!: (value: { blob: Blob; fileName: string }) => void;
        let finishDelivery!: () => void;
        deckExport.render.mockReturnValue(new Promise(resolve => { finishRender = resolve; }));
        deckExport.deliver.mockReturnValue(new Promise<void>(resolve => { finishDelivery = resolve; }));
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(deckExport.render).toHaveBeenCalledTimes(1));
        const edited = deckExport.render.mock.calls[0][0] as DeckPlan;
        expect(edited.slides[0].title).toBe("Edited export title");
        expect(edited.slides[0].notes).toBe("Edited export notes");
        expect(edited.period.periodStart).toBe("2026-10-04");
        expect(deckExport.deliver).not.toHaveBeenCalled();
        expect(deckExport.stamp).not.toHaveBeenCalled();
        const blob = new Blob(["edited deck"]);
        await act(async () => { finishRender({ blob, fileName: "edited.pptx" }); });
        expect(deckExport.deliver).toHaveBeenCalledExactlyOnceWith(blob, "edited.pptx");
        expect(deckExport.stamp).not.toHaveBeenCalled();
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        await act(async () => { finishDelivery(); });
        await waitFor(() => expect(deckExport.stamp).toHaveBeenCalledExactlyOnceWith(edited.trackerId, edited.period.periodStart));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBe("2026-10-04"));
        expect(deckExport.render.mock.invocationCallOrder[0]).toBeLessThan(deckExport.deliver.mock.invocationCallOrder[0]);
        expect(deckExport.deliver.mock.invocationCallOrder[0]).toBeLessThan(deckExport.stamp.mock.invocationCallOrder[0]);
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
        expect(title).toHaveValue("Edited export title");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each(["render", "deliver"])("surfaces a %s rejection in the page and preview without stamping", async stage => {
        const { data } = await oneTracker();
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        deckExport[stage as "render" | "deliver"].mockRejectedValueOnce(new Error(`${stage} failed`));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
        for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent(`${stage} failed`);
        expect(deckExport.stamp).not.toHaveBeenCalled();
        if (stage === "render") expect(deckExport.deliver).not.toHaveBeenCalled();
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        expect(within(preview).getByRole("button", { name: "Export deck" })).toBeEnabled();
    });

    it("rejects and shows both alerts when the awaited stamp write fails after initiation", async () => {
        const { data } = await oneTracker();
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        const save = vi.spyOn(data, "saveGoals").mockRejectedValueOnce(new Error("Stamp storage failed"));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
        for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent("Stamp storage failed");
        expect(deckExport.deliver).toHaveBeenCalledTimes(1);
        expect(deckExport.stamp).toHaveBeenCalledExactlyOnceWith("tracker-work", "2026-10-04");
        expect(save).toHaveBeenCalledTimes(1);
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        expect(screen.queryByText("Built")).not.toBeInTheDocument();
        expect(within(preview).getByRole("button", { name: "Export deck" })).toBeEnabled();
        save.mockRestore();
    });

    it("round-trips a goal project link through the editor and clears it to null", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ id: "goal-linked", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {},
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        const { user } = await mount(data, "2026-10-20");

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const select = await screen.findByLabelText("Project");
        await screen.findByRole("option", { name: "Deep Work" });
        await user.selectOptions(select, "project-1");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].projectId).toBe("project-1"));
        expect(within(screen.getByLabelText(goal.title)).getByText("Deep Work")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const reopened = await screen.findByLabelText("Project");
        await waitFor(() => expect(reopened).toHaveValue("project-1"));
        await user.selectOptions(reopened, "");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].projectId).toBeNull());
        expect(screen.queryByText("Deep Work")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows a quiet missing-project note instead of an error on a broken goal link", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ id: "goal-broken", trackerId: tracker.id, title: "Broken link", projectId: "project-gone" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {},
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        await mount(data, "2026-10-20");

        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Linked project is missing")).toBeInTheDocument();
        expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("mounts goal-set export and import actions in the selected tracker's slot", async () => {
        const { data, tracker } = await oneTracker();
        const { container } = await mount(data);
        const slot = container.querySelector('[data-goals-slot="goal-set-actions"]') as HTMLElement;
        expect(slot).toHaveAttribute("data-tracker-id", tracker.id);
        expect(within(slot).getByRole("button", { name: "Export goals" })).toBeDisabled();
        expect(within(slot).getByText("Add a goal before exporting this tracker.")).toBeInTheDocument();
        expect(within(slot).getByLabelText("Import goals")).toHaveAttribute("type", "file");
        expect(container.querySelectorAll('[data-goals-slot="goal-set-actions"]')).toHaveLength(1);
    });

    it("moves the goal-set actions to the newly selected tracker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = buildGoalTrackerFixture({ id: "tracker-alpha", name: "Alpha", sortOrder: 0 });
        const second = buildGoalTrackerFixture({ id: "tracker-beta", name: "Beta", sortOrder: 1 });
        await data.saveGoals([first, second], [], []);
        const { user, container } = await mount(data);
        const slot = () => container.querySelector('[data-goals-slot="goal-set-actions"]') as HTMLElement;
        expect(slot()).toHaveAttribute("data-tracker-id", first.id);
        await user.selectOptions(screen.getByRole("combobox", { name: "Tracker" }), second.id);
        expect(slot()).toHaveAttribute("data-tracker-id", second.id);
        expect(within(slot()).getByRole("button", { name: "Export goals" })).toBeDisabled();
        expect(within(slot()).getByText("Add a goal before exporting this tracker.")).toBeInTheDocument();
        expect(within(slot()).getByLabelText("Import goals")).toBeInTheDocument();
        expect(container.querySelectorAll('[data-goals-slot="goal-set-actions"]')).toHaveLength(1);
    });

    it("selects an imported tracker and clears the deck preview, pinned check-in, and goal edit", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ cadenceAnchorAt: "2026-10-04" });
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const { user, container } = await mount(data, "2026-10-20");
        const slot = () => container.querySelector('[data-goals-slot="goal-set-actions"]') as HTMLElement;
        const wizard = () => container.querySelector('[data-goals-slot="check-in-wizard"]') as HTMLElement;
        const preview = () => container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;

        // Put the page in the state import must clear.
        await user.click(within(container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement)
            .getByRole("button", { name: "Check in · October 2026" }));
        expect(wizard()).not.toBeEmptyDOMElement();
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        expect(preview()).not.toBeEmptyDOMElement();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getByRole("form", { name: "Edit goal" })).toBeInTheDocument();

        // Drive the real Lane B component through a validated file and confirm.
        await user.upload(
            within(slot()).getByLabelText("Import goals"),
            new File([serializeGoalSet(tracker, [goal])], "goals-work-2026-10-20.json", { type: "application/json" }),
        );
        const review = await within(slot()).findByRole("region", { name: "Import review" });
        expect(within(review).getByText("Ship the release")).toBeInTheDocument();
        await user.click(within(review).getByRole("button", { name: "Create tracker" }));

        await waitFor(() => expect(slot().getAttribute("data-tracker-id")).not.toBe(tracker.id));
        const created = (await data.loadGoals()).trackers.find(row => row.id !== tracker.id)!;
        expect(created).toBeDefined();
        expect(slot()).toHaveAttribute("data-tracker-id", created.id);
        expect(screen.getByRole("combobox", { name: "Tracker" })).toHaveValue(created.id);
        expect(wizard()).toBeEmptyDOMElement();
        expect(preview()).toBeEmptyDOMElement();
        expect(screen.queryByRole("form", { name: "Edit goal" })).not.toBeInTheDocument();

        // Import stays additive: the source tracker and goal are untouched.
        await waitFor(async () => expect((await data.loadGoals()).goals).toHaveLength(2));
        const saved = await data.loadGoals();
        expect(saved.trackers).toHaveLength(2);
        expect(saved.goals.find(row => row.id === goal.id)).toMatchObject({
            id: goal.id,
            trackerId: tracker.id,
            title: goal.title,
            lifecycle: goal.lifecycle,
        });
    });

    it("leaves the goal-set actions slot absent in the empty state", async () => {
        const { container } = await mount();
        expect(screen.getByRole("heading", { name: "Start your first tracker" })).toBeInTheDocument();
        expect(container.querySelector('[data-goals-slot="goal-set-actions"]')).toBeNull();
        expect(screen.queryByRole("button", { name: "Export goals" })).not.toBeInTheDocument();
    });
});
