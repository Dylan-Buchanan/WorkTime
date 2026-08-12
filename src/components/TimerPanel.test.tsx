import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TimerPanel } from "./TimerPanel";
import { AppStateProvider } from "../state/AppStateContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { toLocalDateKey } from "../lib/timer";
import { makeAppState } from "../test/mockTauri";
import type { PMTask } from "../state/types";

vi.mock("../hooks/useSounds", () => ({
    useSounds: () => ({ play: () => {} }),
}));

const OWNER = "timer-panel-owner";

function makePMTask(overrides: Partial<PMTask>): PMTask {
    return {
        id: "pm-task",
        title: "Task",
        projectId: null,
        status: "Backlog",
        priority: "Medium",
        timeSpentMinutes: 0,
        workedPomos: 0,
        tags: [],
        links: [],
        checklist: [],
        sortOrder: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        relatedTo: [],
        ...overrides,
    };
}

function futureDateKey(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return toLocalDateKey(date);
}

function wrap(data: InMemoryDataAccess) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider><TimerPanel /></ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

async function renderWithTasks(tasks: Record<string, PMTask>) {
    const data = new InMemoryDataAccess(makeAppState());
    await data.savePMState({
        projects: {},
        tasks,
        meta: { initializedAt: "2026-01-01T00:00:00.000Z" },
    });
    render(wrap(data));
    return data;
}

describe("TimerPanel projected finish", () => {
    it("discloses future-due work instead of claiming the day is complete", async () => {
        await renderWithTasks({
            future: makePMTask({ id: "future", estimatePomos: 2, dueDate: futureDateKey() }),
        });

        await waitFor(() => expect(screen.getByText("No work due today. 2p future-due work remains outside this projection.")).toBeInTheDocument());
        expect(screen.queryByText("You're all caught up for today. Great work!")).not.toBeInTheDocument();
        expect(screen.queryByText("Includes no due date and due today/overdue. Excludes future-due, Done, archived, no-estimate, and zero remaining.")).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Info" })[0]);
        expect(screen.getByText("Includes no due date and due today/overdue. Excludes future-due, Done, archived, no-estimate, and zero remaining.")).toBeInTheDocument();
    });

    it("labels the included and excluded task rules when work is projected", async () => {
        const today = toLocalDateKey(new Date());
        await renderWithTasks({
            today: makePMTask({ id: "today", estimatePomos: 1, dueDate: today }),
            future: makePMTask({ id: "future", estimatePomos: 2, dueDate: futureDateKey() }),
        });

        await waitFor(() => expect(screen.getByText("Daily projected finish")).toBeInTheDocument());
        expect(screen.getByText("Due now · 1p")).toBeInTheDocument();
        expect(screen.queryByText("Includes no due date and due today/overdue. Excludes future-due, Done, archived, no-estimate, and zero remaining.")).not.toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Info" })[0]);
        expect(screen.getByText("Includes no due date and due today/overdue. Excludes future-due, Done, archived, no-estimate, and zero remaining.")).toBeInTheDocument();
    });

    it("includes later-this-week tasks in a distinct weekly projection", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 7, 12, 10, 0));
        try {
            await renderWithTasks({
                friday: makePMTask({ id: "friday", estimatePomos: 2, dueDate: "2026-08-14" }),
                nextWeek: makePMTask({ id: "next-week", estimatePomos: 3, dueDate: "2026-08-17" }),
            });

            await waitFor(() => expect(screen.getByText("No work due today. 5p future-due work remains outside this projection.")).toBeInTheDocument());
            fireEvent.click(screen.getByRole("button", { name: /This week/ }));
            expect(screen.getByText("Weekly projected finish")).toBeInTheDocument();
            expect(screen.getByText("Later this week · 2p")).toBeInTheDocument();
            expect(screen.queryByText("Later this week · 5p")).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});
