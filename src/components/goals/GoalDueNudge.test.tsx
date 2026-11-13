import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GoalsPage } from "../GoalsPage";
import { GoalProvider } from "../../state/GoalContext";
import { HabitProvider } from "../../state/HabitContext";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import type { LocalDateKey } from "../../lib/todos/types";
import { buildArchivedTrackerFixture, buildGoalTrackerFixture } from "../../lib/goals/testFixtures";

const { notifySpy } = vi.hoisted(() => ({
    notifySpy: vi.fn(async (_opts: { title: string; body?: string }) => true),
}));
vi.mock("../../state/AppStateContext", async importOriginal => {
    const original = await importOriginal<typeof import("../../state/AppStateContext")>();
    return { ...original, notifyNow: notifySpy };
});

function tree(data: InMemoryDataAccess, today: LocalDateKey) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="goal-nudge-owner"><HabitProvider><GoalProvider><GoalsPage today={today} /></GoalProvider></HabitProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}
async function mount(data: InMemoryDataAccess, today: LocalDateKey) {
    const view = render(tree(data, today));
    await screen.findByRole("region", { name: "Goal-set export and import" });
    return view;
}
const seeded = async (trackers: ReturnType<typeof buildGoalTrackerFixture>[]) => {
    const data = new InMemoryDataAccess(makeAppState());
    await data.saveGoals(trackers, [], []);
    return data;
};

beforeEach(() => {
    localStorage.clear();
    notifySpy.mockClear();
});

describe("GoalDueNudge", () => {
    it("baselines an already-due tracker on mount without notifying", async () => {
        const data = await seeded([buildGoalTrackerFixture()]);
        await mount(data, "2026-10-20");
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it("notifies once when today crosses the first completed boundary while mounted", async () => {
        const tracker = buildGoalTrackerFixture();
        const data = await seeded([tracker]);
        const view = await mount(data, "2026-10-10");
        expect(notifySpy).not.toHaveBeenCalled();
        view.rerender(tree(data, "2026-10-20"));
        await waitFor(() => expect(notifySpy).toHaveBeenCalledTimes(1));
        expect(notifySpy).toHaveBeenCalledWith({
            title: expect.stringContaining(tracker.name),
            body: expect.stringContaining("October 2026"),
        });
    });

    it("does not notify twice for the same tracker and period on later renders", async () => {
        const data = await seeded([buildGoalTrackerFixture()]);
        const view = await mount(data, "2026-10-10");
        view.rerender(tree(data, "2026-10-20"));
        await waitFor(() => expect(notifySpy).toHaveBeenCalledTimes(1));
        view.rerender(tree(data, "2026-10-20"));
        view.rerender(tree(data, "2026-10-25"));
        await waitFor(() => expect(notifySpy).toHaveBeenCalledTimes(1));
    });

    it("never notifies for archived or before-first-period trackers", async () => {
        const archived = buildArchivedTrackerFixture();
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04" });
        const data = await seeded([archived, future]);
        const view = await mount(data, "2026-10-10");
        view.rerender(tree(data, "2026-10-20"));
        view.rerender(tree(data, "2026-12-01"));
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it("notifies once per newly due tracker without batching them together", async () => {
        const first = buildGoalTrackerFixture({ id: "t1", name: "Alpha", sortOrder: 0 });
        const second = buildGoalTrackerFixture({ id: "t2", name: "Beta", sortOrder: 1 });
        const data = await seeded([first, second]);
        const view = await mount(data, "2026-10-10");
        view.rerender(tree(data, "2026-10-20"));
        await waitFor(() => expect(notifySpy).toHaveBeenCalledTimes(2));
        const titles = notifySpy.mock.calls.map(([opts]) => opts.title);
        expect(titles).toEqual(expect.arrayContaining([expect.stringContaining("Alpha"), expect.stringContaining("Beta")]));
    });
});
