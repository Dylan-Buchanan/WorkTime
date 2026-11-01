import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
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
import { buildGoalCheckInFixture, buildGoalFixture } from "../../lib/goals/testFixtures";
import type { Goal, GoalCheckIn, PMTask, PomodoroLogEntry, Project, Task } from "../../state/types";
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

function Harness({ goal, initial, period }: { goal: Goal; initial: GoalCheckIn; period: PeriodBounds }) {
    const [checkIn, setCheckIn] = useState(initial);
    const [tick, setTick] = useState(0);
    return <div>
        <GoalEvidencePanel
            goal={goal}
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
    </div>;
}

async function mount(options: {
    goal?: Goal;
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
    const goal = options.goal ?? buildGoalFixture({ projectId: "project-1" });
    const checkIn = options.checkIn ?? buildGoalCheckInFixture({ goalId: goal.id, periodStart: PERIOD.periodStart });
    const view = render(
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId="evidence-panel-owner">
                    <AppStateProvider>
                        <ProjectManagerProvider>
                            <Harness goal={goal} initial={checkIn} period={options.period ?? PERIOD} />
                        </ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>,
    );
    return { data, user: userEvent.setup(), ...view };
}

beforeEach(() => localStorage.clear());

describe("GoalEvidencePanel", () => {
    it("adds and removes PM task ids without touching stale ids or did", async () => {
        const goal = buildGoalFixture({ id: "goal-ship", projectId: "project-1" });
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
        const goal = buildGoalFixture({ projectId: "project-missing" });
        await mount({ goal });

        expect(await screen.findByText("Linked project no longer exists - evidence is unavailable.")).toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("prefills current on first open and freezes after a manual edit until refresh", async () => {
        const goal = buildGoalFixture({ projectId: "project-1" });
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
        const goal = buildGoalFixture({ projectId: "project-1" });
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

    it("renders nothing for an unlinked goal", async () => {
        await mount({ goal: buildGoalFixture({ projectId: null }) });

        expect(screen.queryByRole("region", { name: /Evidence/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Evidence" })).not.toBeInTheDocument();
    });
});
