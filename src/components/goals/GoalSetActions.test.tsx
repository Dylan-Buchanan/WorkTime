import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { GoalSetActions } from "./GoalSetActions";
import { GoalProvider, type NewGoalInput, type NewGoalTrackerInput } from "../../state/GoalContext";
import { ProjectManagerProvider } from "../../state/ProjectManagerContext";
import { AppStateProvider } from "../../state/AppStateContext";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import { serializeGoalSet } from "../../lib/goals/goalSetFile";
import {
    buildAchievedGoalFixture,
    buildEveryNWeeksTrackerFixture,
    buildGoalFixture,
    buildMetricGoalFixture,
} from "../../lib/goals/testFixtures";
import type { Goal, GoalTracker, Project } from "../../state/types";

const calls = vi.hoisted(() => ({
    deliver: vi.fn(),
    createTracker: [] as NewGoalTrackerInput[],
    createGoal: [] as NewGoalInput[],
    createdGoals: [] as Goal[],
    setLifecycle: [] as [string, Goal["lifecycle"]][],
    selected: [] as string[],
    updateTracker: vi.fn(),
    archiveTracker: vi.fn(),
    persist: vi.fn(),
    persistFailure: null as Error | null,
}));

vi.mock("../../lib/goals/deck/delivery", async importOriginal => {
    const original = await importOriginal<typeof import("../../lib/goals/deck/delivery")>();
    return { ...original, initiateBlobDownload: calls.deliver };
});

vi.mock("../../state/GoalContext", async importOriginal => {
    const original = await importOriginal<typeof import("../../state/GoalContext")>();
    return {
        ...original,
        useGoals: () => {
            const goals = original.useGoals();
            return {
                ...goals,
                createTracker: (input: NewGoalTrackerInput) => {
                    calls.createTracker.push(input);
                    return goals.createTracker(input);
                },
                createGoal: (input: NewGoalInput) => {
                    calls.createGoal.push(input);
                    const goal = goals.createGoal(input);
                    calls.createdGoals.push(goal);
                    return goal;
                },
                setGoalLifecycle: (id: string, lifecycle: Goal["lifecycle"]) => {
                    calls.setLifecycle.push([id, lifecycle]);
                    goals.setGoalLifecycle(id, lifecycle);
                },
                selectTracker: (id: string | null) => {
                    calls.selected.push(id ?? "null");
                    goals.selectTracker(id);
                },
                updateTracker: (id: string, patch: Parameters<typeof goals.updateTracker>[1]) => {
                    calls.updateTracker(id, patch);
                    goals.updateTracker(id, patch);
                },
                archiveTracker: (id: string, archived?: boolean) => {
                    calls.archiveTracker(id, archived);
                    goals.archiveTracker(id, archived);
                },
                persist: () => {
                    calls.persist();
                    return calls.persistFailure !== null ? Promise.reject(calls.persistFailure) : goals.persist();
                },
            };
        },
    };
});

function tree(data: InMemoryDataAccess, trackerId: string, onImported: (newTrackerId: string) => void) {
    return <TauriCloseProvider>
        <DataProvider dataAccess={data}>
            <SyncProvider ownerId="goal-set-owner">
                <AppStateProvider>
                    <ProjectManagerProvider>
                        <GoalProvider>
                            <GoalSetActions trackerId={trackerId} onImported={onImported} />
                        </GoalProvider>
                    </ProjectManagerProvider>
                </AppStateProvider>
            </SyncProvider>
        </DataProvider>
    </TauriCloseProvider>;
}

async function seeded(tracker: GoalTracker, goals: Goal[]) {
    const data = new InMemoryDataAccess(makeAppState());
    await data.saveGoals([tracker], goals, []);
    return data;
}

function project(id: string, sortOrder: number): Project {
    return {
        id,
        name: `Project ${id}`,
        color: "#6366F1",
        workableStart: "09:00",
        workableEnd: "17:00",
        workableDays: [1, 2, 3, 4, 5],
        isArchived: false,
        sortOrder,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
    };
}

async function seedProjects(data: InMemoryDataAccess, projects: readonly Project[]) {
    await data.savePMState({
        projects: Object.fromEntries(projects.map(row => [row.id, row])),
        tasks: {},
        meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
    });
}

async function mount(data: InMemoryDataAccess, trackerId: string, onImported = vi.fn()) {
    const view = render(tree(data, trackerId, onImported));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export tracker" })).toBeEnabled());
    expect(screen.getByRole("region", { name: "Tracker export and import" })).toBeInTheDocument();
    return { user: userEvent.setup(), onImported, ...view };
}

async function uploadJson(user: UserEvent, text: string, name = "goals-work-2026-11-02.json") {
    const input = screen.getByLabelText("Import tracker");
    await user.upload(input, new File([text], name, { type: "application/json" }));
}

function fileJson(tracker: GoalTracker, goals: Goal[], projects: readonly Project[] = []): string {
    return serializeGoalSet(tracker, goals, Object.fromEntries(projects.map(row => [row.id, row])));
}

function mutateFile(tracker: GoalTracker, goals: Goal[], change: (file: Record<string, unknown>) => void): string {
    const file = JSON.parse(fileJson(tracker, goals)) as Record<string, unknown>;
    change(file);
    return JSON.stringify(file);
}

beforeEach(() => {
    localStorage.clear();
    calls.deliver.mockReset().mockResolvedValue(undefined);
    calls.updateTracker.mockReset();
    calls.archiveTracker.mockReset();
    calls.persist.mockReset();
    calls.persistFailure = null;
    calls.createTracker.length = 0;
    calls.createGoal.length = 0;
    calls.createdGoals.length = 0;
    calls.setLifecycle.length = 0;
    calls.selected.length = 0;
});

describe("GoalSetActions", () => {
    it("exports the tracker as a JSON download with a dated filename and persists nothing", async () => {
        const tracker = { ...buildEveryNWeeksTrackerFixture(), projectId: "tracker-project" };
        const goal: Goal = {
            ...buildMetricGoalFixture(tracker.id),
            projectLink: { mode: "project", projectId: "goal-project" },
        };
        const data = await seeded(tracker, [goal]);
        await seedProjects(data, [
            { ...project("tracker-project", 0), name: "Studio" },
            { ...project("goal-project", 1), name: "Release" },
        ]);
        const { user } = await mount(data, tracker.id);

        await user.click(screen.getByRole("button", { name: "Export tracker" }));

        await waitFor(() => expect(calls.deliver).toHaveBeenCalledTimes(1));
        const [blob, fileName] = calls.deliver.mock.calls[0] as [Blob, string];
        expect(fileName).toMatch(/^goals-work-\d{4}-\d{2}-\d{2}\.json$/);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe("application/json");
        const payload = JSON.parse(await blob.text());
        expect(payload).toMatchObject({
            format: "worktime.goal-set",
            version: 2,
            tracker: { name: "Work", project: "Studio" },
            goals: [{ title: "Train four times", projectMode: "project", project: "Release" }],
        });
        expect(calls.persist).not.toHaveBeenCalled();
        expect(calls.updateTracker).not.toHaveBeenCalled();
        expect(calls.archiveTracker).not.toHaveBeenCalled();
    });

    it("disables export for a tracker with no goals and never delivers a file", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const data = await seeded(tracker, []);
        render(tree(data, tracker.id, vi.fn()));

        const hint = await screen.findByText("Add a goal before exporting this tracker.");
        const exportButton = screen.getByRole("button", { name: "Export tracker" });
        expect(exportButton).toBeDisabled();
        expect(exportButton).toHaveAttribute("aria-describedby", hint.id);
        expect(screen.getByLabelText("Import tracker")).toBeEnabled();

        await userEvent.setup().click(exportButton);

        expect(calls.deliver).not.toHaveBeenCalled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("reviews a selected file without creating anything yet", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [
            buildGoalFixture({ id: "goal-a", trackerId: tracker.id, title: "Ship the release", sortOrder: 0 }),
            buildGoalFixture({ id: "goal-b", trackerId: tracker.id, title: "Run the retro", sortOrder: 1 }),
        ];
        const data = await seeded(tracker, goals);
        const { user } = await mount(data, tracker.id);

        await uploadJson(user, fileJson(tracker, goals));

        const review = await screen.findByRole("region", { name: "Import review" });
        expect(within(review).getByText("Work")).toBeInTheDocument();
        expect(within(review).getByText(/2 goals/)).toBeInTheDocument();
        expect(within(review).getByText("Every 2 weeks on Sunday")).toBeInTheDocument();
        expect(within(review).getByText("Ship the release")).toBeInTheDocument();
        expect(within(review).getByText("Run the retro")).toBeInTheDocument();
        expect(within(review).getByRole("button", { name: "Create tracker" })).toBeEnabled();
        expect(calls.createTracker).toHaveLength(0);
        expect(calls.createGoal).toHaveLength(0);
        expect(calls.selected).toHaveLength(0);
    });

    it("creates fresh rows and keeps tracker and goal project names that match across accounts", async () => {
        const tracker = { ...buildEveryNWeeksTrackerFixture(), projectId: "source-tracker-project" };
        const goals = [
            buildGoalFixture({ id: "goal-a", trackerId: tracker.id, title: "Ship the release", notes: "Two notes", projectLink: { mode: "project", projectId: "source-goal-project" }, sortOrder: 0 }),
            { ...buildMetricGoalFixture(tracker.id), projectLink: { mode: "none" }, sortOrder: 1 } satisfies Goal,
            buildGoalFixture({ id: "goal-inherited", trackerId: tracker.id, title: "Inherit the project", sortOrder: 2 }),
        ];
        const data = await seeded(tracker, goals);
        await seedProjects(data, [
            { ...project("local-tracker-project", 0), name: "STUDIO", isArchived: true },
            { ...project("local-goal-project", 1), name: "Release", isArchived: true },
        ]);
        const { user, onImported } = await mount(data, tracker.id);
        await uploadJson(user, fileJson(tracker, goals, [
            { ...project("source-tracker-project", 0), name: "Studio" },
            { ...project("source-goal-project", 1), name: "Release" },
        ]));

        const review = await screen.findByRole("region", { name: "Import review" });
        expect(within(review).queryByText(/no unique local match/)).not.toBeInTheDocument();
        await user.click(within(review).getByRole("button", { name: "Create tracker" }));

        await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
        const newTrackerId = onImported.mock.calls[0][0] as string;
        expect(newTrackerId).not.toBe(tracker.id);

        expect(calls.createTracker).toHaveLength(1);
        expect(calls.createTracker[0]).toEqual({
            name: tracker.name,
            purpose: tracker.purpose,
            cadence: tracker.cadence,
            color: tracker.color,
            projectId: "local-tracker-project",
        });
        expect(calls.createGoal).toHaveLength(3);
        expect(calls.createGoal.map(input => input.title)).toEqual(["Ship the release", "Train four times", "Inherit the project"]);
        expect(calls.createGoal.every(input => input.trackerId === newTrackerId)).toBe(true);
        expect(calls.createGoal.map(input => input.sortOrder)).toEqual([0, 1, 2]);
        expect(calls.createGoal[1].metric).toEqual({ label: "Sessions", target: 8, current: 0, unit: "", source: "manual", overridePinned: false });
        const saved = await data.loadGoals();
        expect(saved.trackers.find(row => row.id === newTrackerId)?.projectId).toBe("local-tracker-project");
        expect(saved.trackers.find(row => row.id === tracker.id)).toEqual(tracker);
        const importedGoals = saved.goals.filter(row => row.trackerId === newTrackerId).sort((a, b) => a.sortOrder - b.sortOrder);
        expect(importedGoals.map(row => row.projectLink)).toEqual([
            { mode: "project", projectId: "local-goal-project" }, { mode: "none" }, { mode: "inherit" },
        ]);
        const sourceIds = new Set(goals.map(row => row.id));
        expect(importedGoals.every(row => !sourceIds.has(row.id))).toBe(true);
        expect(saved.goals.filter(row => row.trackerId === tracker.id)).toHaveLength(goals.length);
        for (const goal of goals) expect(saved.goals.find(row => row.id === goal.id)).toEqual(goal);
        expect(calls.selected).toHaveLength(0);
        expect(screen.queryByRole("region", { name: "Import review" })).not.toBeInTheDocument();
        expect(calls.updateTracker).not.toHaveBeenCalled();
        expect(calls.archiveTracker).not.toHaveBeenCalled();
        expect(calls.setLifecycle).toHaveLength(0);
    });

    it("keeps the review and its project note visible when the save rejects", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [buildGoalFixture({
            id: "goal-a",
            trackerId: tracker.id,
            projectLink: { mode: "project", projectId: "source-project" },
            sortOrder: 0,
        })];
        const data = await seeded(tracker, goals);
        const { user, onImported } = await mount(data, tracker.id);
        await uploadJson(user, fileJson(tracker, goals, [project("source-project", 0)]));

        const review = await screen.findByRole("region", { name: "Import review" });
        calls.persistFailure = new Error("storage is unavailable");
        await user.click(within(review).getByRole("button", { name: "Create tracker" }));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Could not save the imported tracker");
        expect(alert).toHaveTextContent("storage is unavailable");
        expect(within(screen.getByRole("region", { name: "Import review" })).getByText(
            "1 goal will inherit the tracker’s project because its override has no unique local match.",
        )).toBeInTheDocument();
        expect(onImported).not.toHaveBeenCalled();
        expect(calls.selected).toHaveLength(0);
        expect(calls.persist).toHaveBeenCalledTimes(1);
        expect(calls.createTracker).toHaveLength(1);
        expect(calls.createGoal).toHaveLength(1);
    });

    it("warns about a missing tracker project and unresolved overrides without blocking import", async () => {
        const tracker = { ...buildEveryNWeeksTrackerFixture(), projectId: "source-tracker-project" };
        const goals = [
            buildGoalFixture({ id: "goal-known", trackerId: tracker.id, title: "Known project", projectLink: { mode: "project", projectId: "project-1" }, sortOrder: 0 }),
            buildGoalFixture({ id: "goal-missing-a", trackerId: tracker.id, title: "Missing A", projectLink: { mode: "project", projectId: "project-missing-a" }, sortOrder: 1 }),
            buildGoalFixture({ id: "goal-missing-b", trackerId: tracker.id, title: "Missing B", projectLink: { mode: "project", projectId: "project-missing-b" }, sortOrder: 2 }),
        ];
        const data = await seeded(tracker, goals);
        await seedProjects(data, [
            { ...project("local-release", 0), name: "Release" },
            { ...project("local-studio", 1), name: "Studio" },
            { ...project("archived-studio", 2), name: "STUDIO", isArchived: true },
        ]);
        const { user, onImported } = await mount(data, tracker.id);
        await uploadJson(user, fileJson(tracker, goals, [
            { ...project("source-tracker-project", 0), name: "Missing tracker project" },
            { ...project("project-1", 1), name: "Release" },
            { ...project("project-missing-a", 2), name: "Studio" },
            { ...project("project-missing-b", 3), name: "Missing override" },
        ]));

        const review = await screen.findByRole("region", { name: "Import review" });
        expect(within(review).getByText(
            "The tracker’s project link will be cleared because it has no unique local match.",
        )).toBeInTheDocument();
        expect(within(review).getByText(
            "2 goals will inherit the tracker’s project because their overrides have no unique local match.",
        )).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        const confirm = within(review).getByRole("button", { name: "Create tracker" });
        expect(confirm).toBeEnabled();

        await user.click(confirm);
        await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

        expect(calls.createTracker[0].projectId).toBeNull();
        const expectedLinks = [{ mode: "project", projectId: "local-release" }, { mode: "inherit" }, { mode: "inherit" }];
        expect(calls.createGoal.map(input => input.projectLink)).toEqual(expectedLinks);
        expect(calls.createdGoals.map(goal => goal.projectLink)).toEqual(expectedLinks);
    });

    it("preserves achieved and dropped lifecycle when importing", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [
            { ...buildAchievedGoalFixture(tracker.id), sortOrder: 0 },
            { ...buildGoalFixture({ id: "goal-dropped", trackerId: tracker.id, title: "Revive the newsletter", lifecycle: "dropped" }), sortOrder: 1 },
            buildGoalFixture({ id: "goal-active", trackerId: tracker.id, title: "Stay active", sortOrder: 2 }),
        ];
        const data = await seeded(tracker, goals);
        const { user, onImported } = await mount(data, tracker.id);
        await uploadJson(user, fileJson(tracker, goals));

        const review = await screen.findByRole("region", { name: "Import review" });
        await user.click(within(review).getByRole("button", { name: "Create tracker" }));

        await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
        expect(calls.createGoal).toHaveLength(3);
        expect(calls.setLifecycle).toEqual([
            [calls.createdGoals[0].id, "achieved"],
            [calls.createdGoals[1].id, "dropped"],
        ]);
        expect(calls.updateTracker).not.toHaveBeenCalled();
        expect(calls.archiveTracker).not.toHaveBeenCalled();
    });

    it("cancels an import without creating anything", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [buildGoalFixture({ id: "goal-a", trackerId: tracker.id, sortOrder: 0 })];
        const data = await seeded(tracker, goals);
        const { user, onImported } = await mount(data, tracker.id);
        await uploadJson(user, fileJson(tracker, goals));

        const review = await screen.findByRole("region", { name: "Import review" });
        await user.click(within(review).getByRole("button", { name: "Cancel" }));

        expect(screen.queryByRole("region", { name: "Import review" })).not.toBeInTheDocument();
        expect(onImported).not.toHaveBeenCalled();
        expect(calls.createTracker).toHaveLength(0);
        expect(calls.createGoal).toHaveLength(0);
    });

    it.each([
        ["invalid JSON", () => "{ not json", "not valid JSON. Choose a tracker file"],
        ["an unsupported version", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => { file.version = 1; }), "tracker file uses a version this app does not support"],
        ["a foreign format", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => { file.format = "other.tool"; }), "not a WorkTime tracker file"],
        ["an invalid field", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => {
            (file.tracker as Record<string, unknown>).name = " ";
        }), "tracker file has an invalid field"],
        ["an invalid root field", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => {
            file.extra = true;
        }), 'has an invalid field: the tracker file has an unknown field "extra"'],
        ["an empty goal list", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => { file.goals = []; }), "tracker file has no goals"],
    ])("reports %s with tracker wording and creates nothing", async (_label, buildText, copy) => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [buildGoalFixture({ id: "goal-a", trackerId: tracker.id, sortOrder: 0 })];
        const data = await seeded(tracker, goals);
        const { user, onImported } = await mount(data, tracker.id);

        await user.upload(
            screen.getByLabelText("Import tracker"),
            new File([buildText(tracker, goals)], "broken.json", { type: "application/json" }),
        );

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(new RegExp(copy));
        expect(alert).not.toHaveTextContent(/goal[- ]set/i);
        expect(screen.queryByRole("region", { name: "Import review" })).not.toBeInTheDocument();
        expect(calls.createTracker).toHaveLength(0);
        expect(calls.createGoal).toHaveLength(0);
        expect(onImported).not.toHaveBeenCalled();
    });

    it("reports an unreadable file and creates nothing", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [buildGoalFixture({ id: "goal-a", trackerId: tracker.id, sortOrder: 0 })];
        const data = await seeded(tracker, goals);
        const { user } = await mount(data, tracker.id);
        const file = new File([""], "unreadable.json", { type: "application/json" });
        file.text = () => Promise.reject(new Error("unreadable"));

        await user.upload(screen.getByLabelText("Import tracker"), file);

        expect(await screen.findByRole("alert")).toHaveTextContent("Could not read that file");
        expect(calls.createTracker).toHaveLength(0);
        expect(calls.createGoal).toHaveLength(0);
    });

    it("lets the user retry with a valid file after an error", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [buildGoalFixture({ id: "goal-a", trackerId: tracker.id, title: "Ship the release", sortOrder: 0 })];
        const data = await seeded(tracker, goals);
        const { user } = await mount(data, tracker.id);

        await uploadJson(user, "{}");
        expect(await screen.findByRole("alert")).toHaveTextContent("not a WorkTime tracker file");

        await uploadJson(user, fileJson(tracker, goals));
        const review = await screen.findByRole("region", { name: "Import review" });
        expect(within(review).getByText("Ship the release")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
