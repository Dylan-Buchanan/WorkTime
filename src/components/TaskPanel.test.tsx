import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TASK_SORT_LS_KEY, TaskPanel } from "./TaskPanel";
import { AppStateProvider, useAppState } from "../state/AppStateContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { PMTask } from "../state/types";

vi.mock("../hooks/useSounds", () => ({
    useSounds: () => ({ play: () => {} }),
}));

const OWNER = "task-panel-owner";

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                        <ProjectManagerProvider>{children}</ProjectManagerProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

function sortSelect(): HTMLSelectElement {
    return screen.getByRole("combobox") as HTMLSelectElement;
}

beforeEach(() => localStorage.clear());

describe("TaskPanel waiting", () => {
    it.each(["agent", "person"] as const)("shows an accessible %s dot and a row tooltip line", async (type) => {
        const appTask = {
            id: "app-task", name: "Waiting task", target_pomodoros: 2, completed_pomodoros: 0,
            created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false,
        };
        const task: PMTask = {
            id: "pm-task", title: "Waiting task", appTaskId: appTask.id, projectId: null,
            status: "In Progress", priority: "Medium", timeSpentMinutes: 0, tags: [], links: [], checklist: [],
            sortOrder: 0, isArchived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
            relatedTo: [], waiting: { type, since: "2026-08-12T09:00:00Z" },
        };
        const data = new InMemoryDataAccess(makeAppState({ tasks: { [appTask.id]: appTask }, active_task: appTask.id }));
        await data.savePMState({ projects: {}, tasks: { [task.id]: task }, meta: { initializedAt: "2026-01-01T00:00:00Z" } });
        render(wrap(data, <TaskPanel />));
        const dot = await screen.findByRole("img", { name: `Waiting on ${type}` });
        expect(dot).toHaveAttribute("title", `Waiting on ${type}`);
        expect(dot.closest("li")).toHaveAttribute("title", `Project: No project\nPriority: Medium\nEstimate: 2 pomodoros\nWaiting on ${type}`);
        expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });
});

describe("TaskPanel sort persistence", () => {
    it("persists the selected sort option and restores it on a fresh mount", () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = render(wrap(data, <TaskPanel />));

        fireEvent.change(sortSelect(), { target: { value: "priority" } });
        expect(localStorage.getItem(TASK_SORT_LS_KEY)).toBe("priority");
        expect(sortSelect().value).toBe("priority");

        first.unmount();
        render(wrap(data, <TaskPanel />));
        expect(sortSelect().value).toBe("priority");
    });

    it("restores a saved sort option on first render", () => {
        localStorage.setItem(TASK_SORT_LS_KEY, "dueDate");
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <TaskPanel />));
        expect(sortSelect().value).toBe("dueDate");
    });

    it("falls back to the default sort when the stored value is invalid", () => {
        localStorage.setItem(TASK_SORT_LS_KEY, "bogus");
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <TaskPanel />));
        expect(sortSelect().value).toBe("default");
    });

    it("falls back to the default sort when nothing is stored", () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data, <TaskPanel />));
        expect(sortSelect().value).toBe("default");
    });
});


it("handles a rejected row activation while preserving the AppState error banner", async () => {
    const task = { id: "a", name: "Clickable", target_pomodoros: 1, completed_pomodoros: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null, break_skips: 0, archived: false };
    const data = new InMemoryDataAccess(makeAppState({ tasks: { a: task } }));
    vi.spyOn(data, "setActiveTask").mockRejectedValue(new Error("Activation unavailable"));
    function Banner() { return <span role="alert">{useAppState().error}</span>; }
    render(wrap(data, <><TaskPanel /><Banner /></>));
    const row = await screen.findByText("Clickable (0/1)");
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Activation unavailable"));
});
