import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { GoalsPage } from "./GoalsPage";
import { GoalProvider } from "../state/GoalContext";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { LocalDateKey } from "../lib/todos/types";
import {
    buildArchivedTrackerFixture,
    buildCheckInHistoryFixture,
    buildCleanCheckInHistoryFixture,
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
} from "../lib/goals/testFixtures";

const drag = vi.hoisted(() => ({ end: null as null | ((event: DragEndEvent) => void) }));
vi.mock("@dnd-kit/core", async importOriginal => {
    const original = await importOriginal<typeof import("@dnd-kit/core")>();
    return { ...original, DndContext: (props: React.ComponentProps<typeof original.DndContext>) => {
        drag.end = props.onDragEnd ?? null;
        return <original.DndContext {...props} />;
    } };
});

function tree(data: InMemoryDataAccess, today?: LocalDateKey) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="goals-page-owner"><GoalProvider><GoalsPage today={today} /></GoalProvider></SyncProvider></DataProvider></TauriCloseProvider>;
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
beforeEach(() => localStorage.clear());

describe("GoalsPage", () => {
    it("has a clean empty state and creates multiple trackers using both validated cadence variants", async () => {
        const { user, data } = await mount();
        expect(screen.getByText(/No trackers yet/)).toBeInTheDocument();
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
        expect(within(screen.getByLabelText("Source")).getAllByRole("option")).toHaveLength(1);
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

    it.each(["manual", "liftingtracker"] as const)("preserves existing %s override metadata and only offers manual as a new source", async source => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: { label: "Lifts", current: 4, target: 8, unit: "sessions", source, overridePinned: true } });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        expect(screen.getByText(`${source === "manual" ? "Manual" : "Auto"} · Override`)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        if (source === "liftingtracker") expect(within(screen.getByLabelText("Source")).getByRole("option", { name: "Auto" })).toBeDisabled();
        await user.type(screen.getByLabelText("Goal note"), "Keep the metric");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Keep the metric"));
        expect((await data.loadGoals()).goals[0].metric).toEqual(goal.metric);
    });

    it("moves goals through achieved and dropped and reactivates them without losing history", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id });
        await data.saveGoals([tracker], [goal], [checkIn]);
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: "Achieve" }));
        expect(screen.queryByRole("heading", { name: goal.title })).not.toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Goal status"), "achieved");
        await user.click(screen.getByRole("button", { name: "Reactivate" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "active");
        await user.click(screen.getByRole("button", { name: "Drop" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "dropped");
        expect(screen.getByRole("heading", { name: goal.title })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Reactivate" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "active");
        await waitFor(async () => expect((await data.loadGoals()).goals[0].lifecycle).toBe("active"));
        expect((await data.loadGoals()).checkIns).toEqual([checkIn]);
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
});
