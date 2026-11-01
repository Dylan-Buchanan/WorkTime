import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { GoalSetActions } from "./GoalSetActions";
import { GoalProvider, type NewGoalInput, type NewGoalTrackerInput } from "../../state/GoalContext";
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
import type { Goal, GoalTracker } from "../../state/types";

const calls = vi.hoisted(() => ({
    deliver: vi.fn(),
    createTracker: [] as NewGoalTrackerInput[],
    createGoal: [] as NewGoalInput[],
    createdGoals: [] as Goal[],
    setLifecycle: [] as [string, Goal["lifecycle"]][],
    selected: [] as string[],
    updateTracker: vi.fn(),
    archiveTracker: vi.fn(),
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
            };
        },
    };
});

function tree(data: InMemoryDataAccess, trackerId: string, onImported: (newTrackerId: string) => void) {
    return <TauriCloseProvider>
        <DataProvider dataAccess={data}>
            <SyncProvider ownerId="goal-set-owner">
                <GoalProvider>
                    <GoalSetActions trackerId={trackerId} onImported={onImported} />
                </GoalProvider>
            </SyncProvider>
        </DataProvider>
    </TauriCloseProvider>;
}

async function seeded(tracker: GoalTracker, goals: Goal[]) {
    const data = new InMemoryDataAccess(makeAppState());
    await data.saveGoals([tracker], goals, []);
    return data;
}

async function mount(data: InMemoryDataAccess, trackerId: string, onImported = vi.fn()) {
    const view = render(tree(data, trackerId, onImported));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export goals" })).toBeEnabled());
    return { user: userEvent.setup(), onImported, ...view };
}

async function uploadJson(user: UserEvent, text: string, name = "goals-work-2026-11-02.json") {
    const input = screen.getByLabelText("Import goals");
    await user.upload(input, new File([text], name, { type: "application/json" }));
}

function fileJson(tracker: GoalTracker, goals: Goal[]): string {
    return serializeGoalSet(tracker, goals);
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
    calls.createTracker.length = 0;
    calls.createGoal.length = 0;
    calls.createdGoals.length = 0;
    calls.setLifecycle.length = 0;
    calls.selected.length = 0;
});

describe("GoalSetActions", () => {
    it("exports the tracker as a JSON download with a dated filename and persists nothing", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goal = buildMetricGoalFixture(tracker.id);
        const data = await seeded(tracker, [goal]);
        const { user } = await mount(data, tracker.id);

        await user.click(screen.getByRole("button", { name: "Export goals" }));

        await waitFor(() => expect(calls.deliver).toHaveBeenCalledTimes(1));
        const [blob, fileName] = calls.deliver.mock.calls[0] as [Blob, string];
        expect(fileName).toMatch(/^goals-work-\d{4}-\d{2}-\d{2}\.json$/);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe("application/json");
        const payload = JSON.parse(await blob.text());
        expect(payload).toMatchObject({ format: "worktime.goal-set", version: 1, tracker: { name: "Work" } });
        expect(payload.goals.map((row: { title: string }) => row.title)).toEqual(["Train four times"]);
        expect(calls.updateTracker).not.toHaveBeenCalled();
        expect(calls.archiveTracker).not.toHaveBeenCalled();
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

    it("creates a new tracker and one goal per definition on confirm", async () => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [
            buildGoalFixture({ id: "goal-a", trackerId: tracker.id, title: "Ship the release", notes: "Two notes", projectId: "project-1", sortOrder: 0 }),
            buildMetricGoalFixture(tracker.id),
        ];
        const data = await seeded(tracker, goals);
        const { user, onImported } = await mount(data, tracker.id);
        await uploadJson(user, fileJson(tracker, goals));

        const review = await screen.findByRole("region", { name: "Import review" });
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
        });
        expect(calls.createGoal).toHaveLength(2);
        expect(calls.createGoal.map(input => input.title)).toEqual(["Ship the release", "Train four times"]);
        expect(calls.createGoal.every(input => input.trackerId === newTrackerId)).toBe(true);
        expect(calls.createGoal.map(input => input.sortOrder)).toEqual([0, 1]);
        expect(calls.createGoal[1].metric).toEqual({ label: "Sessions", target: 8, current: 0, unit: "", source: "manual", overridePinned: false });
        expect(calls.selected).toEqual([newTrackerId]);
        expect(screen.queryByRole("region", { name: "Import review" })).not.toBeInTheDocument();
        expect(calls.updateTracker).not.toHaveBeenCalled();
        expect(calls.archiveTracker).not.toHaveBeenCalled();
        expect(calls.setLifecycle).toHaveLength(0);
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
        ["invalid JSON", () => "{ not json", "not valid JSON"],
        ["an unsupported version", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => { file.version = 2; }), "version this app does not support"],
        ["a foreign format", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => { file.format = "other.tool"; }), "not a WorkTime goal-set file"],
        ["an invalid field", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => {
            (file.tracker as Record<string, unknown>).name = " ";
        }), "has an invalid field"],
        ["an empty goal list", (tracker: GoalTracker, goals: Goal[]) => mutateFile(tracker, goals, file => { file.goals = []; }), "has no goals"],
    ])("reports %s and creates nothing", async (_label, buildText, copy) => {
        const tracker = buildEveryNWeeksTrackerFixture();
        const goals = [buildGoalFixture({ id: "goal-a", trackerId: tracker.id, sortOrder: 0 })];
        const data = await seeded(tracker, goals);
        const { user, onImported } = await mount(data, tracker.id);

        await user.upload(
            screen.getByLabelText("Import goals"),
            new File([buildText(tracker, goals)], "broken.json", { type: "application/json" }),
        );

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(new RegExp(copy));
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

        await user.upload(screen.getByLabelText("Import goals"), file);

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
        expect(await screen.findByRole("alert")).toHaveTextContent("not a WorkTime goal-set file");

        await uploadJson(user, fileJson(tracker, goals));
        const review = await screen.findByRole("region", { name: "Import review" });
        expect(within(review).getByText("Ship the release")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
