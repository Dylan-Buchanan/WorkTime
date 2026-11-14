import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalEvidencePanel } from "./GoalEvidencePanel";
import { AppStateProvider } from "../../state/AppStateContext";
import { ProjectManagerProvider } from "../../state/ProjectManagerContext";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import { buildGoalCheckInFixture, buildGoalFixture, buildGoalTrackerFixture } from "../../lib/goals/testFixtures";
import type { Goal, GoalCheckIn, GoalTracker, PMTask, PomodoroLogEntry, Project, Task } from "../../state/types";
import type { PeriodBounds } from "../../lib/goals/periods";

const PERIOD: PeriodBounds = { periodStart: "2026-10-04", periodEnd: "2026-10-18" };
const INSIDE = new Date(2026, 9, 10, 12).toISOString();

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
        completed_at: INSIDE,
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
        finished_at: INSIDE,
        was_break: false,
        break_skipped: false,
        ...overrides,
    };
}

function Harness({ goal, tracker, nextTracker, initial, period }: {
    goal: Goal;
    tracker: GoalTracker;
    nextTracker?: GoalTracker;
    initial: GoalCheckIn;
    period: PeriodBounds;
}) {
    const [checkIn, setCheckIn] = useState(initial);
    const [activeTracker, setActiveTracker] = useState(tracker);
    const [tick, setTick] = useState(0);
    return <div>
        <GoalEvidencePanel
            goal={goal}
            tracker={activeTracker}
            checkIn={checkIn}
            period={period}
            onChange={patch => setCheckIn(previous => ({ ...previous, ...patch }))}
        />
        <span data-testid="current">{checkIn.current}</span>
        <span data-testid="did">{checkIn.did}</span>
        <span data-testid="ids">{checkIn.evidenceTaskIds.join(",")}</span>
        <span data-testid="tick">{tick}</span>
        <button type="button" onClick={() => setCheckIn(previous => ({ ...previous, current: "Handwritten" }))}>manual edit</button>
        <button type="button" onClick={() => setCheckIn(previous => ({ ...previous, current: "" }))}>clear current</button>
        <button type="button" onClick={() => setTick(value => value + 1)}>rerender</button>
        {nextTracker && <button type="button" onClick={() => setActiveTracker(nextTracker)}>switch tracker</button>}
    </div>;
}

async function mount(options: {
    goal?: Goal;
    tracker?: GoalTracker;
    nextTracker?: GoalTracker;
    checkIn?: GoalCheckIn;
    period?: PeriodBounds;
    projects?: Project[];
    pmTasks?: PMTask[];
    backendTasks?: Task[];
    logs?: PomodoroLogEntry[];
} = {}) {
    const backendTasks = options.backendTasks ?? [backendTask()];
    const data = new InMemoryDataAccess(makeAppState({
        tasks: Object.fromEntries(backendTasks.map(task => [task.id, task])),
        logs: options.logs ?? [],
    }));
    const projects = options.projects ?? [project()];
    const pmTasks = options.pmTasks ?? [pmTask()];
    if (projects.length > 0 || pmTasks.length > 0) {
        await data.savePMState({
            projects: Object.fromEntries(projects.map(row => [row.id, row])),
            tasks: Object.fromEntries(pmTasks.map(row => [row.id, row])),
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
    }
    const goal = options.goal ?? buildGoalFixture({ projectLink: { mode: "project", projectId: "project-1" } });
    const tracker = options.tracker ?? buildGoalTrackerFixture({ projectId: null });
    const checkIn = options.checkIn ?? buildGoalCheckInFixture({ goalId: goal.id, periodStart: PERIOD.periodStart });
    const view = render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId="evidence-panel-owner">
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <Harness
                                goal={goal}
                                tracker={tracker}
                                nextTracker={options.nextTracker}
                                initial={checkIn}
                                period={options.period ?? PERIOD}
                            />
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>,
    );
    return { data, user: userEvent.setup(), ...view };
}

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    // Inside PERIOD, so the default panel case is the currently open period.
    vi.setSystemTime(new Date(2026, 9, 10, 12));
});
afterEach(() => {
    vi.useRealTimers();
});

describe("GoalEvidencePanel", () => {
    it("adds and removes PM task ids without touching stale ids or did", async () => {
        const goal = buildGoalFixture({ id: "goal-ship", projectLink: { mode: "project", projectId: "project-1" } });
        const checkIn = buildGoalCheckInFixture({
            goalId: goal.id,
            periodStart: PERIOD.periodStart,
            did: "Typed by hand",
            evidenceTaskIds: ["stale-id"],
        });
        const { user } = await mount({ goal, checkIn });

        const checkbox = await screen.findByRole("checkbox", { name: /Ship the release/ });
        expect(checkbox).not.toBeChecked();

        await user.click(checkbox);
        expect(checkbox).toBeChecked();
        expect(screen.getByTestId("ids")).toHaveTextContent("stale-id,pm-1");
        expect(screen.getByTestId("did")).toHaveTextContent("Typed by hand");

        await user.click(checkbox);
        expect(checkbox).not.toBeChecked();
        expect(screen.getByTestId("ids")).toHaveTextContent("stale-id");
    });

    it("shows the folded hours summary only when there is evidence data", async () => {
        const { user } = await mount({
            logs: [
                log({ id: "log-1", duration_minutes: 420 }),
                log({ id: "log-2", duration_minutes: 420 }),
                log({ id: "log-break", duration_minutes: 30, was_break: true }),
            ],
        });

        expect(await screen.findByText("1 task done · 14h")).toBeInTheDocument();

        await user.click(screen.getByRole("checkbox", { name: /Ship the release/ }));
        expect(screen.getByText("1 task done · 14h")).toBeInTheDocument();
    });

    it("shows a quiet note for a linked project that no longer exists", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-missing" } });
        await mount({ goal });

        expect(await screen.findByText("Linked project no longer exists - evidence is unavailable.")).toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("prefills current on first open and freezes after a manual edit until refresh", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-1" } });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id, periodStart: PERIOD.periodStart, current: "" });
        const { user } = await mount({
            goal,
            checkIn,
            pmTasks: [
                pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", appTaskId: undefined, sortOrder: 0 }),
                pmTask({ id: "pm-b", title: "Beta", status: "In Progress", appTaskId: undefined, sortOrder: 1 }),
            ],
            backendTasks: [],
        });

        await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("Alpha, Beta"));
        expect(screen.getByText("In Progress: Alpha, Beta")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "manual edit" }));
        expect(screen.getByTestId("current")).toHaveTextContent("Handwritten");
        await user.click(screen.getByRole("button", { name: "clear current" }));
        await user.click(screen.getByRole("button", { name: "rerender" }));
        expect(screen.getByTestId("current")).toHaveTextContent("");

        await user.click(screen.getByRole("button", { name: "Refresh suggestions" }));
        await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("Alpha, Beta"));
    });

    it("never overwrites a current value present when the panel mounts", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-1" } });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id, periodStart: PERIOD.periodStart, current: "Already typed" });
        await mount({
            goal,
            checkIn,
            pmTasks: [pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", appTaskId: undefined })],
            backendTasks: [],
        });

        expect(await screen.findByText("In Progress: Alpha")).toBeInTheDocument();
        expect(screen.getByTestId("current")).toHaveTextContent("Already typed");
    });

    it.each([
        ["a past period", { periodStart: "2026-08-02", periodEnd: "2026-08-16" } as PeriodBounds],
        ["a future period", { periodStart: "2026-10-18", periodEnd: "2026-11-01" } as PeriodBounds],
    ])("never prefills %s from today's In Progress tasks", async (_label, period) => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-1" } });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id, periodStart: period.periodStart, current: "" });
        await mount({
            goal,
            checkIn,
            period,
            pmTasks: [pmTask({ id: "pm-a", title: "Alpha", status: "In Progress", appTaskId: undefined })],
            backendTasks: [],
        });

        expect(await screen.findByText("In Progress: Alpha")).toBeInTheDocument();
        expect(screen.getByTestId("current").textContent).toBe("");
    });

    it("renders evidence for a goal that inherits the tracker project", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });
        const tracker = buildGoalTrackerFixture({ projectId: "project-1" });
        await mount({ goal, tracker });

        expect(await screen.findByRole("heading", { name: "Evidence" })).toBeInTheDocument();
        expect(await screen.findByRole("checkbox", { name: /Ship the release/ })).toBeInTheDocument();
    });

    it("renders nothing when the goal inherits from a project-less tracker", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });
        await mount({ goal, tracker: buildGoalTrackerFixture({ projectId: null }) });

        expect(screen.queryByRole("region", { name: /Evidence/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Evidence" })).not.toBeInTheDocument();
    });

    it("renders nothing for an explicit no-project goal even when the tracker has a project", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "none" } });
        await mount({ goal, tracker: buildGoalTrackerFixture({ projectId: "project-1" }) });

        expect(screen.queryByRole("region", { name: /Evidence/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Evidence" })).not.toBeInTheDocument();
    });

    it("keeps an overriding goal on its own project regardless of the tracker", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "project", projectId: "project-1" } });
        await mount({ goal, tracker: buildGoalTrackerFixture({ projectId: "project-2" }) });

        expect(await screen.findByRole("checkbox", { name: /Ship the release/ })).toBeInTheDocument();
    });

    it("re-baselines the prefill when the resolved project changes mid-period", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id, periodStart: PERIOD.periodStart, current: "" });
        const { user } = await mount({
            goal,
            tracker: buildGoalTrackerFixture({ projectId: "project-1" }),
            nextTracker: buildGoalTrackerFixture({ projectId: "project-2" }),
            checkIn,
            projects: [project(), project({ id: "project-2", name: "Other" })],
            pmTasks: [
                pmTask({ id: "pm-a", title: "Alpha", projectId: "project-1", status: "In Progress", appTaskId: undefined }),
                pmTask({ id: "pm-b", title: "Beta", projectId: "project-2", status: "In Progress", appTaskId: undefined }),
            ],
            backendTasks: [],
        });

        await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("Alpha"));
        expect(screen.getByText("In Progress: Alpha")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "switch tracker" }));

        await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("Beta"));
        expect(screen.getByText("In Progress: Beta")).toBeInTheDocument();
    });

    it("keeps a manual Current edit when the resolved project changes", async () => {
        const goal = buildGoalFixture({ projectLink: { mode: "inherit" } });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id, periodStart: PERIOD.periodStart, current: "" });
        const { user } = await mount({
            goal,
            tracker: buildGoalTrackerFixture({ projectId: "project-1" }),
            nextTracker: buildGoalTrackerFixture({ projectId: "project-2" }),
            checkIn,
            projects: [project(), project({ id: "project-2", name: "Other" })],
            pmTasks: [
                pmTask({ id: "pm-a", title: "Alpha", projectId: "project-1", status: "In Progress", appTaskId: undefined }),
                pmTask({ id: "pm-b", title: "Beta", projectId: "project-2", status: "In Progress", appTaskId: undefined }),
            ],
            backendTasks: [],
        });

        await waitFor(() => expect(screen.getByTestId("current")).toHaveTextContent("Alpha"));
        await user.click(screen.getByRole("button", { name: "manual edit" }));
        await user.click(screen.getByRole("button", { name: "switch tracker" }));

        expect(screen.getByTestId("current")).toHaveTextContent("Handwritten");
        expect(screen.getByText("In Progress: Beta")).toBeInTheDocument();
    });

    it("renders nothing for an unlinked goal", async () => {
        await mount({ goal: buildGoalFixture({ projectLink: { mode: "inherit" } }) });

        expect(screen.queryByRole("region", { name: /Evidence/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Evidence" })).not.toBeInTheDocument();
    });
});
