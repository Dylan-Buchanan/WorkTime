import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HabitConnectWizard } from "./HabitConnectWizard";
import { GoalProvider, useGoals } from "../../state/GoalContext";
import { HabitProvider } from "../../state/HabitContext";
import { AppStateProvider } from "../../state/AppStateContext";
import { ProjectManagerProvider } from "../../state/ProjectManagerContext";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import { buildGoalFixture, buildGoalTrackerFixture } from "../../lib/goals/testFixtures";
import type { Goal, GoalCadence, GoalMetric, GoalTracker, Habit } from "../../state/types";

const goalWrite = vi.hoisted(() => ({ failNext: false }));
const habitDelete = vi.hoisted(() => ({ failNext: false }));

vi.mock("../../state/GoalContext", async importOriginal => {
    const original = await importOriginal<typeof import("../../state/GoalContext")>();
    return { ...original, useGoals: () => {
        const goals = original.useGoals();
        return {
            ...goals,
            updateGoal: (id: string, patch: Parameters<typeof goals.updateGoal>[1]) => {
                if (goalWrite.failNext) {
                    goalWrite.failNext = false;
                    throw new RangeError("Goal write failed");
                }
                goals.updateGoal(id, patch);
            },
        };
    } };
});

vi.mock("../../state/HabitContext", async importOriginal => {
    const original = await importOriginal<typeof import("../../state/HabitContext")>();
    return { ...original, useHabits: () => {
        const habits = original.useHabits();
        return {
            ...habits,
            deleteHabit: (id: string) => {
                if (habitDelete.failNext) {
                    habitDelete.failNext = false;
                    throw new RangeError("Habit delete failed");
                }
                habits.deleteHabit(id);
            },
        };
    } };
});

function WizardHarness({ goalId, cadence, linkedHabitId, onClose }: {
    goalId: string;
    cadence: GoalCadence;
    linkedHabitId: string | null;
    onClose: () => void;
}) {
    const goals = useGoals();
    const goal = goals.state.goals[goalId];
    if (!goals.hydrated || !goal) return <p>hydrating goals</p>;
    return <HabitConnectWizard goal={goal} cadence={cadence} linkedHabitId={linkedHabitId} onClose={onClose} />;
}

function tree(data: InMemoryDataAccess, tracker: GoalTracker, goal: Goal, linkedHabitId: string | null, onClose: () => void) {
    return <TauriCloseProvider>
        <DataProvider dataAccess={data}>
            <SyncProvider ownerId="connect-wizard-owner">
                <HabitProvider>
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <GoalProvider>
                                <WizardHarness goalId={goal.id} cadence={tracker.cadence} linkedHabitId={linkedHabitId} onClose={onClose} />
                            </GoalProvider>
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </HabitProvider>
            </SyncProvider>
        </DataProvider>
    </TauriCloseProvider>;
}

async function mountWizard(data: InMemoryDataAccess, tracker: GoalTracker, goal: Goal, linkedHabitId: string | null, onClose: () => void) {
    const view = render(tree(data, tracker, goal, linkedHabitId, onClose));
    await screen.findByRole("dialog", { name: "Connect a habit" });
    return { user: userEvent.setup(), ...view };
}

async function saveData(data: InMemoryDataAccess, tracker: GoalTracker, goal: Goal, habits: Habit[] = []) {
    await data.saveHabits(habits, []);
    await data.saveGoals([tracker], [goal], []);
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

async function waitForNextEnabled() {
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
}

beforeEach(() => {
    localStorage.clear();
    goalWrite.failNext = false;
    habitDelete.failNext = false;
});

describe("HabitConnectWizard", () => {
    it.each([
        { archived: true, target: 14 },
        { archived: true, target: 15 },
        { archived: false, target: 14 },
        { archived: false, target: 15 },
    ])("explains only the linked habit’s archived and stale states ($archived, $target)", async ({ archived, target }) => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read", isArchived: archived });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ target }) });
        await saveData(data, tracker, goal, [linked, habit("habit-old", { name: "Old", isArchived: true })]);
        const { user } = await mountWizard(data, tracker, goal, linked.id, vi.fn());
        await screen.findByRole("radiogroup", { name: "Habits" });
        const archivedNote = document.querySelector('[data-goals-slot="connect-archived"]');
        const staleNote = document.querySelector('[data-goals-slot="connect-stale"]');
        if (archived) expect(archivedNote).toHaveTextContent("“Read” is archived. It still counts toward this goal; choose another habit to switch.");
        else expect(archivedNote).toBeNull();
        if (target > 14) expect(staleNote).toHaveTextContent("This tracker’s periods changed. Save again to recalculate the target.");
        else expect(staleNote).toBeNull();
        expect(screen.queryByRole("radio", { name: "Old (archived)" })).not.toBeInTheDocument();
        await waitForNextEnabled();
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });
        expect(document.querySelector('[data-goals-slot="connect-archived"]')).toBeNull();
        expect(document.querySelector('[data-goals-slot="connect-stale"]')).toBeNull();
    });

    it.each(["habit-read", "habit-gone"])("shows neither repair explanation before hydration for %s", async linkedId => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: linkedId, target: 20 }) });
        await saveData(data, tracker, goal, [habit("habit-read", { name: "Read", isArchived: true })]);
        vi.spyOn(data, "loadHabits").mockReturnValue(new Promise<never>(() => {}));
        await mountWizard(data, tracker, goal, linkedId, vi.fn());
        expect(screen.getByRole("status")).toHaveTextContent("Loading habits…");
        expect(document.querySelector('[data-goals-slot="connect-archived"]')).toBeNull();
        expect(document.querySelector('[data-goals-slot="connect-stale"]')).toBeNull();
        expect(document.querySelector('[data-goals-slot="connect-missing"]')).toBeNull();
    });

    it.each(["achieved", "dropped"] as const)("omits archived and stale explanations on a %s goal", async lifecycle => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, lifecycle, metric: habitMetric({ target: 20 }) });
        await saveData(data, tracker, goal, [habit("habit-read", { name: "Read", isArchived: true })]);
        await mountWizard(data, tracker, goal, "habit-read", vi.fn());
        await screen.findByText("Reactivate this goal to connect a different habit.");
        expect(document.querySelector('[data-goals-slot="connect-archived"]')).toBeNull();
        expect(document.querySelector('[data-goals-slot="connect-stale"]')).toBeNull();
    });

    it("does not classify a dangling link as archived or stale", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: "habit-gone", target: 400 }) });
        await saveData(data, tracker, goal, [habit("habit-old", { isArchived: true })]);
        await mountWizard(data, tracker, goal, "habit-gone", vi.fn());
        await screen.findByRole("radiogroup", { name: "Habits" });
        expect(document.querySelector('[data-goals-slot="connect-missing"]')).toBeInTheDocument();
        expect(document.querySelector('[data-goals-slot="connect-archived"]')).toBeNull();
        expect(document.querySelector('[data-goals-slot="connect-stale"]')).toBeNull();
    });

    it.each(["manual", "liftingtracker"] as const)("does not classify a large %s target as stale", async source => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: { label: "Pages", current: 0, target: 400, unit: "pages", source, overridePinned: false } });
        await saveData(data, tracker, goal, [habit("habit-read"), habit("habit-old", { isArchived: true })]);
        await mountWizard(data, tracker, goal, null, vi.fn());
        await screen.findByRole("radiogroup", { name: "Habits" });
        expect(document.querySelector('[data-goals-slot="connect-archived"]')).toBeNull();
        expect(document.querySelector('[data-goals-slot="connect-stale"]')).toBeNull();
    });

    it("opens directly on the inline create form when there are no habits and no link", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, null, onClose);

        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        expect(screen.getByLabelText("Habit name")).toHaveValue(goal.title);
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        await waitFor(async () => {
            expect((await data.loadGoals()).goals[0].metric).toBeNull();
            expect((await data.loadHabits()).habits).toHaveLength(0);
        });
    });

    it("shows only the loading status while habits hydrate, even with a dangling link", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: "habit-gone", label: "Read 20 minutes" }) });
        await data.saveGoals([tracker], [goal], []);
        vi.spyOn(data, "loadHabits").mockReturnValue(new Promise<never>(() => {}));
        await mountWizard(data, tracker, goal, "habit-gone", vi.fn());

        expect(screen.getByRole("status")).toHaveTextContent("Loading habits…");
        expect(screen.queryAllByRole("radio")).toHaveLength(0);
        expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
        expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Create a new habit" })).not.toBeInTheDocument();
    });

    it("promotes and preselects an archived linked habit while hiding other archived habits", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read", isArchived: true, position: 0 });
        const other = habit("habit-old", { name: "Old", isArchived: true, position: 1 });
        const active = habit("habit-walk", { name: "Walk", position: 2 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: linked.id, label: "Read" }) });
        await saveData(data, tracker, goal, [linked, other, active]);
        await mountWizard(data, tracker, goal, linked.id, vi.fn());

        const group = await screen.findByRole("radiogroup", { name: "Habits" });
        const radios = within(group).getAllByRole("radio");
        expect(radios[0]).toHaveAccessibleName("Read (archived)");
        await waitFor(() => expect(radios[0]).toHaveAttribute("aria-checked", "true"));
        expect(within(group).queryByRole("radio", { name: "Old (archived)" })).not.toBeInTheDocument();
        expect(within(group).getByRole("radio", { name: "Walk" })).toBeInTheDocument();
        expect(within(radios[0]).getByText("Tracks 1 goal")).toBeInTheDocument();
    });

    it("names a dangling link and repairs it without touching stored data on cancel", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const original = habitMetric({ habitId: "habit-gone", label: "Read 20 minutes" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: original });
        await saveData(data, tracker, goal, [habit("habit-walk", { name: "Walk" })]);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, "habit-gone", onClose);

        const group = await screen.findByRole("radiogroup", { name: "Habits" });
        const note = document.querySelector('[data-goals-slot="connect-missing"]');
        expect(note).toHaveTextContent("The habit this goal tracked (“Read 20 minutes”) no longer exists. Choose a habit to repair the link.");
        const walk = within(group).getByRole("radio", { name: "Walk" });
        await user.click(walk);
        expect(walk).toHaveAttribute("aria-checked", "true");
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect((await data.loadGoals()).goals[0].metric).toStrictEqual(original);
    });

    it("disables a monthly habit and trims the create frequencies under a monthly cadence", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ cadence: { kind: "monthly-weekday", weekday: 2 } });
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal, [
            habit("habit-read", { name: "Read", frequency: "monthly" }),
            habit("habit-walk", { name: "Walk", frequency: "daily", position: 1 }),
        ]);
        const { user } = await mountWizard(data, tracker, goal, null, vi.fn());

        const group = await screen.findByRole("radiogroup", { name: "Habits" });
        const read = within(group).getByRole("radio", { name: "Read" });
        expect(read).toBeDisabled();
        expect(within(read).getByText("Monthly habits don't fit every period of this tracker")).toBeInTheDocument();
        expect(within(group).getByRole("radio", { name: "Walk" })).not.toBeDisabled();

        await user.click(screen.getByRole("button", { name: "Create a new habit" }));
        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        const options = within(screen.getByLabelText("Frequency")).getAllByRole("option").map(option => option.textContent);
        expect(options).toEqual(["Daily", "Weekly"]);
    });

    it("offers only daily and weekly for a one-week cadence", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ cadence: { kind: "every-n-weeks", weekday: 0, intervalWeeks: 1 } });
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal);
        await mountWizard(data, tracker, goal, null, vi.fn());

        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        const options = within(screen.getByLabelText("Frequency")).getAllByRole("option").map(option => option.textContent);
        expect(options).toEqual(["Daily", "Weekly"]);
    });

    it("seeds a daily target at the guaranteed minimum and enforces both stepper bounds", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: linked.id, label: "Read", target: 7 }) });
        await saveData(data, tracker, goal, [linked]);
        const { user } = await mountWizard(data, tracker, goal, linked.id, vi.fn());

        await screen.findByRole("radiogroup", { name: "Habits" });
        await waitForNextEnabled();
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });

        const input = screen.getByLabelText("Target");
        expect(input).toHaveValue(14);
        expect(screen.getByRole("button", { name: "Increase target" })).toBeDisabled();
        expect(document.querySelector('[data-goals-slot="connect-sentence"]')).toHaveTextContent("Track Read against 14 days per period");
        expect(screen.getByText("Every period holds exactly 14 days.")).toBeInTheDocument();

        await user.clear(input);
        await user.type(input, "1");
        expect(screen.getByRole("button", { name: "Decrease target" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Increase target" })).not.toBeDisabled();
        expect(document.querySelector('[data-goals-slot="connect-sentence"]')).toHaveTextContent("Track Read against 1 day per period");
    });

    it("derives a 21-day minimum and 42-day maximum for a Wednesday monthly cadence", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ cadence: { kind: "monthly-weekday", weekday: 3 } });
        const linked = habit("habit-read", { name: "Read" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: linked.id, label: "Read" }) });
        await saveData(data, tracker, goal, [linked]);
        const { user } = await mountWizard(data, tracker, goal, linked.id, vi.fn());

        await screen.findByRole("radiogroup", { name: "Habits" });
        await waitForNextEnabled();
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });

        expect(screen.getByLabelText("Target")).toHaveValue(21);
        expect(screen.getByText("Every period holds at least 21 days; the longest holds 42.")).toBeInTheDocument();
        expect(document.querySelector('[data-goals-slot="connect-sentence"]')).toHaveTextContent("Track Read against 21 days per period");
    });

    it("cancels from Escape and the backdrop without writing", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read" });
        const original = habitMetric({ habitId: linked.id, label: "Read" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: original });
        await saveData(data, tracker, goal, [linked]);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, linked.id, onClose);

        await screen.findByRole("radiogroup", { name: "Habits" });
        await user.keyboard("{Escape}");
        expect(onClose).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole("dialog", { name: "Connect a habit" }).querySelector("[aria-hidden='true']")!);
        expect(onClose).toHaveBeenCalledTimes(2);
        expect((await data.loadGoals()).goals[0].metric).toStrictEqual(original);
        expect((await data.loadHabits()).habits).toHaveLength(1);
    });

    it("confirms the create form with Enter without saving anything", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal);
        const { user } = await mountWizard(data, tracker, goal, null, vi.fn());

        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        await user.click(screen.getByLabelText("Habit name"));
        await user.keyboard("{Enter}");
        expect(await screen.findByRole("heading", { name: "Set the target" })).toBeInTheDocument();
        await waitFor(async () => {
            expect((await data.loadHabits()).habits).toHaveLength(0);
            expect((await data.loadGoals()).goals[0].metric).toBeNull();
        });
    });

    it("saves the exact derived metric for an existing habit and recomputes every field", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read" });
        const goal = buildGoalFixture({
            trackerId: tracker.id,
            metric: habitMetric({ habitId: linked.id, label: "Read 20 minutes", current: 3, target: 99, unit: "sessions" }),
        });
        await saveData(data, tracker, goal, [linked]);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, linked.id, onClose);

        await screen.findByRole("radiogroup", { name: "Habits" });
        await waitForNextEnabled();
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });
        await user.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect((await data.loadGoals()).goals[0].metric).toStrictEqual({
            label: "Read", current: 0, target: 14, unit: "days", source: "habit", habitId: "habit-read", overridePinned: false,
        });
    });

    it("notes a replaced manual metric and keeps Save enabled", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({
            trackerId: tracker.id,
            metric: { label: "Sessions", current: 2, target: 4, unit: "sessions", source: "manual", overridePinned: false },
        });
        await saveData(data, tracker, goal, [habit("habit-read", { name: "Read" })]);
        const { user } = await mountWizard(data, tracker, goal, null, vi.fn());

        const group = await screen.findByRole("radiogroup", { name: "Habits" });
        expect(screen.getByText("Saving replaces this goal’s manual metric “Sessions”.")).toBeInTheDocument();
        await user.click(within(group).getByRole("radio", { name: "Read" }));
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });
        expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("notes a replaced different habit link and keeps Save enabled", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read" });
        const other = habit("habit-walk", { name: "Walk", position: 1 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: linked.id, label: "Read" }) });
        await saveData(data, tracker, goal, [linked, other]);
        const { user } = await mountWizard(data, tracker, goal, linked.id, vi.fn());

        const group = await screen.findByRole("radiogroup", { name: "Habits" });
        await waitFor(() => expect(within(group).getByRole("radio", { name: "Read" })).toHaveAttribute("aria-checked", "true"));
        await user.click(within(group).getByRole("radio", { name: "Walk" }));
        expect(screen.getByText("Saving replaces the link to “Read”.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });
        expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("creates exactly one habit on Save and links it", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, null, onClose);

        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        await user.clear(screen.getByLabelText("Habit name"));
        await user.type(screen.getByLabelText("Habit name"), "Walk outside");
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });
        expect(document.querySelector('[data-goals-slot="connect-sentence"]')).toHaveTextContent("Track Walk outside against 14 days per period");
        await user.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const habits = (await data.loadHabits()).habits;
        expect(habits).toHaveLength(1);
        expect(habits[0]).toMatchObject({ name: "Walk outside", frequency: "daily" });
        expect((await data.loadGoals()).goals[0].metric).toStrictEqual({
            label: "Walk outside", current: 0, target: 14, unit: "days", source: "habit", habitId: habits[0].id, overridePinned: false,
        });
    });

    it("deletes a habit created in the same save when the goal write fails, then retries cleanly", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, null, onClose);

        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        await user.clear(screen.getByLabelText("Habit name"));
        await user.type(screen.getByLabelText("Habit name"), "Walk outside");
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });

        goalWrite.failNext = true;
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("This goal couldn’t be saved, so the new habit wasn’t kept. Try again.");
        await waitFor(async () => expect((await data.loadHabits()).habits).toHaveLength(0));
        expect((await data.loadGoals()).goals[0].metric).toBeNull();

        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        const habits = (await data.loadHabits()).habits;
        expect(habits).toHaveLength(1);
        expect(habits[0].name).toBe("Walk outside");
        expect((await data.loadGoals()).goals[0].metric).toMatchObject({ source: "habit", habitId: habits[0].id });
    });

    it("keeps the created habit selected when rollback fails and retries without duplicating", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await saveData(data, tracker, goal);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, null, onClose);

        expect(await screen.findByRole("heading", { name: "New habit" })).toBeInTheDocument();
        await user.clear(screen.getByLabelText("Habit name"));
        await user.type(screen.getByLabelText("Habit name"), "Walk outside");
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });

        goalWrite.failNext = true;
        habitDelete.failNext = true;
        await user.click(screen.getByRole("button", { name: "Save" }));
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Habit “Walk outside” was created, but this goal could not be saved with it. Link it from /habits.");
        await waitFor(async () => expect((await data.loadHabits()).habits).toHaveLength(1));
        const created = (await data.loadHabits()).habits[0];

        await user.click(screen.getByRole("button", { name: "Back" }));
        const group = await screen.findByRole("radiogroup", { name: "Habits" });
        expect(within(group).getByRole("radio", { name: "Walk outside" })).toHaveAttribute("aria-checked", "true");
        await waitForNextEnabled();
        await user.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByRole("heading", { name: "Set the target" });
        await user.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect((await data.loadHabits()).habits).toHaveLength(1);
        expect((await data.loadGoals()).goals[0].metric).toMatchObject({ label: "Walk outside", habitId: created.id });
    });

    it("downgrades a habit link to a manual metric on Disconnect and closes", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read" });
        const goal = buildGoalFixture({
            trackerId: tracker.id,
            metric: habitMetric({ habitId: linked.id, label: "Read", current: 2, target: 5, unit: "days" }),
        });
        await saveData(data, tracker, goal, [linked]);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker, goal, linked.id, onClose);

        await screen.findByRole("radiogroup", { name: "Habits" });
        await user.click(screen.getByRole("button", { name: "Disconnect habit" }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        const saved = (await data.loadGoals()).goals[0].metric;
        expect(saved).toStrictEqual({
            label: "Read", current: 2, target: 5, unit: "days", source: "manual", overridePinned: false,
        });
        expect(saved !== null && "habitId" in saved).toBe(false);
    });

    it("offers Disconnect but no picker on a non-active goal", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const linked = habit("habit-read", { name: "Read" });
        const goal = buildGoalFixture({
            trackerId: tracker.id,
            lifecycle: "achieved",
            achievedAt: "2026-10-12T12:00:00.000Z",
            metric: habitMetric({ habitId: linked.id, label: "Read" }),
        });
        await saveData(data, tracker, goal, [linked]);
        await mountWizard(data, tracker, goal, linked.id, vi.fn());

        expect(await screen.findByText("Reactivate this goal to connect a different habit.")).toBeInTheDocument();
        expect(screen.queryByRole("radiogroup", { name: "Habits" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Create a new habit" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Disconnect habit" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
});
