import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TASK_SORT_LS_KEY, TaskPanel } from "./TaskPanel";
import { AppStateProvider } from "../state/AppStateContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { DataProvider } from "../state/DataContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";

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
