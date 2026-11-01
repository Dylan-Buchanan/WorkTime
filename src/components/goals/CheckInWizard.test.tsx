import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInWizard, type CheckInWizardProps } from "./CheckInWizard";
import { GoalProvider, useGoals } from "../../state/GoalContext";
import { AppStateProvider } from "../../state/AppStateContext";
import { ProjectManagerProvider } from "../../state/ProjectManagerContext";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import { goalGrid, periodAt, type GoalPeriod } from "../../lib/goals/periods";
import {
    buildCheckInHistoryFixture,
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
} from "../../lib/goals/testFixtures";
import type { GoalTracker, PMTask, PomodoroLogEntry, Project, Task } from "../../state/types";
import type { LocalDateKey } from "../../lib/todos/types";

function WizardHarness(props: CheckInWizardProps) {
    const { hydrated } = useGoals();
    return hydrated ? <CheckInWizard {...props} /> : <p>hydrating</p>;
}

function periodFor(tracker: GoalTracker, today: LocalDateKey): GoalPeriod {
    const period = periodAt(goalGrid(tracker), today);
    if (!period) throw new RangeError("Tracker has no open period");
    return period;
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

function pmTask(overrides: Partial<PMTask> = {}): PMTask {
    return {
        id: "pm-1",
        title: "Ship the release",
        projectId: "project-1",
        status: "Done",
        priority: "Medium",
        timeSpentMinutes: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        appTaskId: "app-1",
        relatedTo: [],
        ...overrides,
    };
}

function backendTask(overrides: Partial<Task> = {}): Task {
    return {
        id: "app-1",
        name: "Ship the release",
        target_pomodoros: 1,
        completed_pomodoros: 1,
        created_at: "2026-10-01T00:00:00.000Z",
        completed_at: new Date(2026, 9, 20, 12).toISOString(),
        break_skips: 0,
        archived: false,
        ...overrides,
    };
}

function log(overrides: Partial<PomodoroLogEntry> = {}): PomodoroLogEntry {
    return {
        id: "log-1",
        task_id: "app-1",
        duration_minutes: 25,
        finished_at: new Date(2026, 9, 20, 12).toISOString(),
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

async function mountWizard(data: InMemoryDataAccess, trackerId: string, period: GoalPeriod, onClose: () => void) {
    const view = render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId="wizard-owner">
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <GoalProvider>
                                <WizardHarness trackerId={trackerId} period={period} onClose={onClose} />
                            </GoalProvider>
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>,
    );
    await screen.findByLabelText("Check-in period");
    return { user: userEvent.setup(), ...view };
}

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
});
afterEach(() => {
    vi.useRealTimers();
});

describe("CheckInWizard", () => {
    it("walks a goal card through status, did, current, planned items, focus, and saves one natural-key row", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release", sortOrder: 0 });
        const achieved = buildGoalFixture({ id: "goal-done", trackerId: tracker.id, title: "Finished earlier", lifecycle: "achieved", sortOrder: 1 });
        await data.saveGoals([tracker], [goal, achieved], []);
        const period = periodFor(tracker, "2026-10-20");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByRole("heading", { name: goal.title })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: achieved.title })).not.toBeInTheDocument();
        expect(screen.getByLabelText(`Focus for ${goal.title}`)).toBeChecked();

        await user.selectOptions(screen.getByLabelText(`Status for ${goal.title}`), "at-risk");
        await user.type(screen.getByLabelText(`Did for ${goal.title}`), "Reviewed the spec");
        await user.type(screen.getByLabelText(`Current for ${goal.title}`), "Writing the migration");

        await user.click(screen.getByRole("button", { name: `Add planned item for ${goal.title}` }));
        await user.type(screen.getByLabelText(`Planned item 1 for ${goal.title}`), "Ship the migration");
        fireEvent.change(screen.getByLabelText(`Planned due date 1 for ${goal.title}`), { target: { value: "2026-10-30" } });
        await user.click(screen.getByRole("button", { name: `Add planned item for ${goal.title}` }));
        await user.type(screen.getByLabelText(`Planned item 2 for ${goal.title}`), "Write the retro");
        await user.click(screen.getByRole("button", { name: `Remove planned item 2 for ${goal.title}` }));
        await user.click(screen.getByRole("button", { name: `Add planned item for ${goal.title}` }));
        await user.type(screen.getByLabelText(`Planned item 2 for ${goal.title}`), "Write the retro");
        expect(screen.getByLabelText(`Planned due date 2 for ${goal.title}`)).toHaveValue("");

        await user.type(screen.getByLabelText(`Miss reason for ${goal.title}`), "Waited on review");
        await user.click(screen.getByLabelText(`Focus for ${goal.title}`));
        expect(screen.getByLabelText(`Focus for ${goal.title}`)).not.toBeChecked();
        await user.click(screen.getByLabelText(`Focus for ${goal.title}`));

        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        const saved = (await data.loadGoals()).checkIns;
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
            goalId: goal.id,
            periodStart: period.periodStart,
            statusPill: "at-risk",
            did: "Reviewed the spec",
            current: "Writing the migration",
            missReason: "Waited on review",
            isFocus: true,
            evidenceTaskIds: [],
            planned: [
                { text: "Ship the migration", dueDate: "2026-10-30" },
                { text: "Write the retro", dueDate: null },
            ],
        });
        expect(saved[0].id).toBeTruthy();
    });

    it("derives a live Did not do list from the latest previous check-in", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        const previous = buildGoalCheckInFixture({
            id: "previous-row",
            goalId: goal.id,
            periodStart: "2026-10-04",
            planned: [
                { text: "Ship the migration", dueDate: "2026-10-10" },
                { text: "Write the retro", dueDate: null },
            ],
        });
        await data.saveGoals([tracker], [goal], [previous]);
        const period = periodFor(tracker, "2026-10-20");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        const card = await screen.findByRole("article", { name: goal.title });
        const comparison = within(card).getByRole("heading", { name: "Did not do" }).closest("section") as HTMLElement;
        expect(within(comparison).getByText("Ship the migration")).toBeInTheDocument();
        expect(within(comparison).getByText("Write the retro")).toBeInTheDocument();
        expect(within(comparison).getByText("2026-10-10")).toBeInTheDocument();
        expect(within(comparison).getByText("Why not")).toBeInTheDocument();
        expect(within(comparison).getByLabelText(`Miss reason for ${goal.title}`).tagName).toBe("TEXTAREA");
        expect(within(comparison).getByText("Optional notes explaining the items above.")).toBeInTheDocument();

        const did = screen.getByLabelText(`Did for ${goal.title}`);
        await user.type(did, "Ship the migration");
        expect(within(comparison).queryByText("Ship the migration")).not.toBeInTheDocument();
        expect(within(comparison).getByText("Write the retro")).toBeInTheDocument();
        expect(within(comparison).queryByText("2026-10-10")).not.toBeInTheDocument();

        await user.type(did, "{Enter}Write the retro");
        expect(within(comparison).queryByText("Write the retro")).not.toBeInTheDocument();
        expect(within(comparison).getByText("Everything from the previous check-in is marked done.")).toBeInTheDocument();

        const whyNote = within(comparison).getByLabelText(`Miss reason for ${goal.title}`);
        await user.type(whyNote, "Waited on review");
        expect(whyNote).toHaveValue("Waited on review");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = (await data.loadGoals()).checkIns.find(row => row.periodStart === period.periodStart)!;
        expect(saved.missReason).toBe("Waited on review");
        expect(saved.did).toBe("Ship the migration\nWrite the retro");
        expect(Object.keys(saved).sort()).toEqual([
            "createdAt", "current", "did", "evidenceTaskIds", "goalId", "id",
            "isFocus", "missReason", "periodStart", "planned", "statusPill", "updatedAt",
        ]);
    });

    it("shows a quiet comparison message when there is no previous check-in", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const period = periodFor(tracker, "2026-10-20");
        await mountWizard(data, tracker.id, period, vi.fn());

        const card = await screen.findByRole("article", { name: goal.title });
        const comparison = within(card).getByRole("heading", { name: "Did not do" }).closest("section") as HTMLElement;
        expect(within(comparison).getByText("No previous plans to compare.")).toBeInTheDocument();
        expect(within(comparison).getByLabelText(`Miss reason for ${goal.title}`)).toBeInTheDocument();
    });

    it("reflects the selected status pill in a colored chip", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const period = periodFor(tracker, "2026-10-20");
        const { user } = await mountWizard(data, tracker.id, period, vi.fn());

        const chip = () => screen.getByRole("article", { name: goal.title }).querySelector("[data-status-pill]") as HTMLElement;
        expect(chip()).toHaveAttribute("data-status-pill", "on-track");
        expect(chip()).toHaveTextContent("On track");
        expect(chip()).toHaveClass("text-emerald-200");

        await user.selectOptions(screen.getByLabelText(`Status for ${goal.title}`), "at-risk");
        expect(chip()).toHaveAttribute("data-status-pill", "at-risk");
        expect(chip()).toHaveTextContent("At risk");
        expect(chip()).toHaveClass("text-amber-200");

        await user.selectOptions(screen.getByLabelText(`Status for ${goal.title}`), "blocked");
        expect(chip()).toHaveAttribute("data-status-pill", "blocked");
        expect(chip()).toHaveTextContent("Blocked");
        expect(chip()).toHaveClass("text-rose-200");
    });

    it("reloads stored values and upserts a single row per goal and period on reopen", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        const period = periodFor(tracker, "2026-10-20");
        const existing = buildGoalCheckInFixture({
            id: "existing-row",
            goalId: goal.id,
            periodStart: period.periodStart,
            did: "Old did",
            statusPill: "blocked",
            planned: [{ text: "Old plan", dueDate: null }],
            isFocus: false,
            evidenceTaskIds: ["task-1"],
            createdAt: "2026-10-06T12:00:00.000Z",
            updatedAt: "2026-10-06T12:00:00.000Z",
        });
        await data.saveGoals([tracker], [goal], [existing]);
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByLabelText(`Did for ${goal.title}`)).toHaveValue("Old did");
        expect(screen.getByLabelText(`Focus for ${goal.title}`)).not.toBeChecked();
        expect(screen.getByLabelText(`Planned item 1 for ${goal.title}`)).toHaveValue("Old plan");

        await user.clear(screen.getByLabelText(`Did for ${goal.title}`));
        await user.type(screen.getByLabelText(`Did for ${goal.title}`), "New did");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = (await data.loadGoals()).checkIns;
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
            id: "existing-row",
            goalId: goal.id,
            periodStart: period.periodStart,
            did: "New did",
            isFocus: false,
            evidenceTaskIds: ["task-1"],
            createdAt: "2026-10-06T12:00:00.000Z",
        });
    });

    it("shows an explanatory empty state when the tracker has no active goals", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const achieved = buildGoalFixture({ id: "goal-done", trackerId: tracker.id, title: "Finished earlier", lifecycle: "achieved" });
        await data.saveGoals([tracker], [achieved], []);
        const period = periodFor(tracker, "2026-10-20");
        await mountWizard(data, tracker.id, period, vi.fn());

        expect(await screen.findByText(/No active goals to check in/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Save check-ins" })).not.toBeInTheDocument();
    });

    it("renders the slip badge from stored history through the pinned period", async () => {
        vi.setSystemTime(new Date(2026, 10, 2, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], buildCheckInHistoryFixture(goal.id));
        const period = periodFor(tracker, "2026-11-02");
        await mountWizard(data, tracker.id, period, vi.fn());

        expect(await screen.findByRole("heading", { name: goal.title })).toBeInTheDocument();
        expect(screen.getByText("Slipped 2×")).toBeInTheDocument();
    });

    it("edits a chosen stored period and keeps every other row, including off-grid history", async () => {
        vi.setSystemTime(new Date(2026, 10, 2, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const first = buildGoalFixture({ id: "goal-a", trackerId: tracker.id, title: "Ship the release", sortOrder: 0 });
        const second = buildGoalFixture({ id: "goal-b", trackerId: tracker.id, title: "Grow the team", sortOrder: 1 });
        const old = buildGoalCheckInFixture({ id: "a-old", goalId: first.id, periodStart: "2026-10-04", did: "Old A" });
        const previousA = buildGoalCheckInFixture({ id: "a-prev", goalId: first.id, periodStart: "2026-10-18", did: "Previous A" });
        const previousB = buildGoalCheckInFixture({ id: "b-prev", goalId: second.id, periodStart: "2026-10-18", did: "Previous B" });
        const offGrid = buildGoalCheckInFixture({ id: "a-off", goalId: first.id, periodStart: "2026-01-15", did: "Historical" });
        await data.saveGoals([tracker], [first, second], [old, previousA, previousB, offGrid]);
        const period = periodFor(tracker, "2026-11-02");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByRole("heading", { name: first.title })).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Check-in period"), "2026-10-18");
        await waitFor(() => expect(screen.getByLabelText(`Did for ${first.title}`)).toHaveValue("Previous A"));
        expect(screen.getByLabelText(`Did for ${second.title}`)).toHaveValue("Previous B");

        await user.clear(screen.getByLabelText(`Did for ${first.title}`));
        await user.type(screen.getByLabelText(`Did for ${first.title}`), "Edited A");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = (await data.loadGoals()).checkIns;
        const byKey = new Map(saved.map(row => [`${row.goalId}:${row.periodStart}`, row]));
        expect(saved).toHaveLength(4);
        expect(byKey.get(`${first.id}:2026-10-18`)).toMatchObject({ id: "a-prev", did: "Edited A" });
        expect(byKey.get(`${first.id}:2026-10-04`)).toMatchObject({ id: "a-old", did: "Old A" });
        expect(byKey.get(`${first.id}:2026-01-15`)).toMatchObject({ id: "a-off", did: "Historical" });
        expect(byKey.get(`${second.id}:2026-10-18`)).toMatchObject({ id: "b-prev", did: "Previous B" });
        expect(byKey.has(`${first.id}:2026-11-01`)).toBe(false);
    });

    it("warns when a revision advances the build key, and Continue editing keeps the pinned target", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const period = periodFor(tracker, "2026-10-20");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByRole("heading", { name: goal.title })).toBeInTheDocument();
        const staged = await data.loadGoals();
        await data.saveGoals(
            [{ ...staged.trackers[0], lastBuiltPeriodStart: "2026-10-18", updatedAt: new Date().toISOString() }],
            staged.goals,
            staged.checkIns,
        );

        const warning = await screen.findByRole("alert");
        expect(warning).toHaveTextContent(/already built elsewhere/);
        expect(warning).toHaveTextContent("Continue editing");
        expect(warning).toHaveTextContent("Reload current period");
        await user.click(screen.getByRole("button", { name: "Continue editing" }));
        expect(screen.queryByText(/already built elsewhere/)).not.toBeInTheDocument();

        await user.type(screen.getByLabelText(`Did for ${goal.title}`), "Kept editing the pinned period");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = await data.loadGoals();
        expect(saved.checkIns).toHaveLength(1);
        expect(saved.checkIns[0]).toMatchObject({
            periodStart: "2026-10-18",
            did: "Kept editing the pinned period",
        });
        expect(saved.trackers[0].lastBuiltPeriodStart).toBe("2026-10-18");
    });

    it("Reload current period explicitly moves to the newly current grid period", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const period = periodFor(tracker, "2026-10-20");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByRole("heading", { name: goal.title })).toBeInTheDocument();
        expect(screen.getByLabelText("Check-in period")).toHaveValue("2026-10-18");
        const staged = await data.loadGoals();
        await data.saveGoals(
            [{ ...staged.trackers[0], lastBuiltPeriodStart: "2026-10-18", updatedAt: new Date().toISOString() }],
            staged.goals,
            staged.checkIns,
        );
        await screen.findByRole("alert");

        vi.setSystemTime(new Date(2026, 10, 2, 12));
        await user.click(screen.getByRole("button", { name: "Reload current period" }));
        await waitFor(() => expect(screen.getByLabelText("Check-in period")).toHaveValue("2026-11-01"));
        expect(screen.queryByText(/already built elsewhere/)).not.toBeInTheDocument();

        await user.type(screen.getByLabelText(`Did for ${goal.title}`), "New current period");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = await data.loadGoals();
        expect(saved.checkIns).toHaveLength(1);
        expect(saved.checkIns[0]).toMatchObject({ periodStart: "2026-11-01", did: "New current period" });
    });

    it("excludes a goal from a past period that ended before the goal was created", async () => {
        vi.setSystemTime(new Date(2026, 9, 31, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const earlier = buildGoalFixture({
            id: "goal-earlier",
            trackerId: tracker.id,
            title: "Started earlier",
            sortOrder: 0,
        });
        const later = buildGoalFixture({
            id: "goal-later",
            trackerId: tracker.id,
            title: "Started later",
            sortOrder: 1,
            createdAt: "2026-10-25T12:00:00.000Z",
        });
        await data.saveGoals([tracker], [earlier, later], []);
        const period = periodFor(tracker, "2026-10-31");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByRole("heading", { name: later.title })).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Check-in period"), "2026-10-04");
        await waitFor(() =>
            expect(screen.queryByRole("heading", { name: later.title })).not.toBeInTheDocument());
        expect(screen.getByRole("heading", { name: earlier.title })).toBeInTheDocument();

        await user.type(screen.getByLabelText(`Did for ${earlier.title}`), "Older progress");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = (await data.loadGoals()).checkIns;
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
            goalId: earlier.id,
            periodStart: "2026-10-04",
            did: "Older progress",
        });
        expect(saved.some(row => row.goalId === later.id)).toBe(false);
    });

    it("includes an active goal created within the selected period", async () => {
        vi.setSystemTime(new Date(2026, 9, 31, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const created = buildGoalFixture({
            id: "goal-new",
            trackerId: tracker.id,
            title: "Created this period",
            createdAt: "2026-10-25T12:00:00.000Z",
        });
        await data.saveGoals([tracker], [created], []);
        const period = periodFor(tracker, "2026-10-31");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        expect(await screen.findByRole("heading", { name: created.title })).toBeInTheDocument();
        expect(screen.getByLabelText("Check-in period")).toHaveValue("2026-10-18");
        await user.type(screen.getByLabelText(`Did for ${created.title}`), "First check-in");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = (await data.loadGoals()).checkIns;
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({
            goalId: created.id,
            periodStart: "2026-10-18",
            did: "First check-in",
        });
    });

    it("retains a stored row for an excluded goal and period verbatim on save", async () => {
        vi.setSystemTime(new Date(2026, 9, 31, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const earlier = buildGoalFixture({
            id: "goal-earlier",
            trackerId: tracker.id,
            title: "Started earlier",
            sortOrder: 0,
        });
        const later = buildGoalFixture({
            id: "goal-later",
            trackerId: tracker.id,
            title: "Started later",
            sortOrder: 1,
            createdAt: "2026-10-25T12:00:00.000Z",
        });
        const legacy = buildGoalCheckInFixture({
            id: "legacy-row",
            goalId: later.id,
            periodStart: "2026-10-04",
            did: "Legacy before creation",
            planned: [{ text: "Old plan", dueDate: "2026-10-10" }],
            statusPill: "blocked",
            missReason: "Older reason",
            isFocus: true,
            createdAt: "2026-10-05T12:00:00.000Z",
            updatedAt: "2026-10-05T12:00:00.000Z",
        });
        await data.saveGoals([tracker], [earlier, later], [legacy]);
        const period = periodFor(tracker, "2026-10-31");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        await screen.findByRole("heading", { name: earlier.title });
        await user.selectOptions(screen.getByLabelText("Check-in period"), "2026-10-04");
        await waitFor(() =>
            expect(screen.queryByRole("heading", { name: later.title })).not.toBeInTheDocument());

        await user.type(screen.getByLabelText(`Did for ${earlier.title}`), "Edited older goal");
        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        const saved = (await data.loadGoals()).checkIns;
        expect(saved).toHaveLength(2);
        expect(saved.find(row => row.id === "legacy-row")).toEqual(legacy);
    });

    it("shows project evidence for a linked goal and persists an accepted task id", async () => {
        const data = new InMemoryDataAccess(makeAppState({
            tasks: { "app-1": backendTask() },
            logs: [log()],
        }));
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release", projectId: "project-1" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: { "pm-1": pmTask() },
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        const period = periodFor(tracker, "2026-10-20");
        const onClose = vi.fn();
        const { user } = await mountWizard(data, tracker.id, period, onClose);

        const card = await screen.findByRole("article", { name: goal.title });
        const checkbox = await within(card).findByRole("checkbox", { name: /^Evidence Ship the release for/ });
        expect(within(card).getByRole("heading", { name: "Evidence" })).toBeInTheDocument();
        expect(checkbox).not.toBeChecked();
        await user.click(checkbox);
        expect(checkbox).toBeChecked();

        await user.click(screen.getByRole("button", { name: "Save check-ins" }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        const saved = (await data.loadGoals()).checkIns[0];
        expect(saved).toMatchObject({
            goalId: goal.id,
            periodStart: period.periodStart,
            evidenceTaskIds: ["pm-1"],
            did: "",
        });
    });

    it("shows no evidence panel for an unlinked goal even when project data exists", async () => {
        const data = new InMemoryDataAccess(makeAppState({ tasks: { "app-1": backendTask() } }));
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-life", trackerId: tracker.id, title: "Life goal", projectId: null });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: { "pm-1": pmTask() },
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        const period = periodFor(tracker, "2026-10-20");
        await mountWizard(data, tracker.id, period, vi.fn());

        const card = await screen.findByRole("article", { name: goal.title });
        expect(within(card).queryByRole("region", { name: /Evidence/ })).not.toBeInTheDocument();
        expect(within(card).queryByRole("checkbox", { name: /^Evidence/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/only tasks finalized through the timer/)).not.toBeInTheDocument();
    });

    it("prefills current from In Progress tasks, freezes after an edit, and re-syncs only on refresh", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release", projectId: "project-1" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {
                "pm-a": pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", appTaskId: undefined, sortOrder: 0 }),
                "pm-b": pmTask({ id: "pm-b", title: "Beta", status: "In Progress", appTaskId: undefined, sortOrder: 1 }),
            },
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        const period = periodFor(tracker, "2026-10-20");
        const { user } = await mountWizard(data, tracker.id, period, vi.fn());

        const card = await screen.findByRole("article", { name: goal.title });
        const current = screen.getByLabelText(`Current for ${goal.title}`);
        await waitFor(() => expect(current).toHaveValue("Alpha, Beta"));

        await user.clear(current);
        await user.type(current, "Handwritten");
        expect(current).toHaveValue("Handwritten");
        await user.clear(current);
        await waitFor(() => expect(current).toHaveValue(""));

        await user.click(within(card).getByRole("button", { name: "Refresh suggestions" }));
        await waitFor(() => expect(current).toHaveValue("Alpha, Beta"));
    });

    it("opens a past period with an empty current and never prefills it", async () => {
        vi.setSystemTime(new Date(2026, 10, 2, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release", projectId: "project-1" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {
                "pm-a": pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", appTaskId: undefined, sortOrder: 0 }),
                "pm-b": pmTask({ id: "pm-b", title: "Beta", status: "In Progress", appTaskId: undefined, sortOrder: 1 }),
            },
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        const period = periodFor(tracker, "2026-11-02");
        const { user } = await mountWizard(data, tracker.id, period, vi.fn());

        expect(await screen.findByRole("heading", { name: goal.title })).toBeInTheDocument();
        expect(screen.getByLabelText("Check-in period")).toHaveValue("2026-11-01");
        await user.selectOptions(screen.getByLabelText("Check-in period"), "2026-10-18");

        const card = screen.getByRole("article", { name: goal.title });
        expect(await within(card).findByText("In Progress: Alpha, Beta")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText(`Current for ${goal.title}`)).toHaveValue(""));
        expect(screen.getByLabelText(`Current for ${goal.title}`)).toHaveValue("");
    });

    it("re-prefills the current period after editing current in another period", async () => {
        vi.setSystemTime(new Date(2026, 10, 2, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release", projectId: "project-1" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {
                "pm-a": pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", appTaskId: undefined, sortOrder: 0 }),
                "pm-b": pmTask({ id: "pm-b", title: "Beta", status: "In Progress", appTaskId: undefined, sortOrder: 1 }),
            },
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        const period = periodFor(tracker, "2026-11-02");
        const { user } = await mountWizard(data, tracker.id, period, vi.fn());

        const current = () => screen.getByLabelText(`Current for ${goal.title}`);
        await waitFor(() => expect(current()).toHaveValue("Alpha, Beta"));
        await user.clear(current());
        await user.type(current(), "Handwritten");
        expect(current()).toHaveValue("Handwritten");

        await user.selectOptions(screen.getByLabelText("Check-in period"), "2026-10-18");
        await waitFor(() => expect(current()).toHaveValue(""));

        await user.selectOptions(screen.getByLabelText("Check-in period"), "2026-11-01");
        await waitFor(() => expect(current()).toHaveValue("Alpha, Beta"));
    });
});
