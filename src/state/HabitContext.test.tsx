import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { HabitProvider, useHabits } from "./HabitContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { Habit, HabitCompletion } from "./types";
import type { SyncOptions, SyncResult } from "../lib/data/DataAccess";
import { makeAppState } from "../test/mockTauri";

const OWNER = "owner-1";
const BUCKET = "2026-08-04";

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: id,
        description: "",
        color: "#fff",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function completion(id: string, habitId: string, bucket = BUCKET): HabitCompletion {
    return {
        id,
        habitId,
        bucket,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

function HabitProbe() {
    const {
        state,
        createHabit,
        updateHabit,
        archiveHabit,
        deleteHabit,
        checkCompletion,
        uncheckCompletion,
        reorderHabits,
        setPeriod,
        setSelectedHabit,
        setHabitExpanded,
    } = useHabits();
    const firstId = Object.keys(state.habits)[0] ?? "";
    return <div>
        <div data-testid="habit-count">{Object.keys(state.habits).length}</div>
        <div data-testid="completion-count">{Object.keys(state.completions).length}</div>
        <div data-testid="first-name">{firstId ? state.habits[firstId].name : ""}</div>
        <div data-testid="period">{state.ui.period}</div>
        <div data-testid="selected">{state.ui.selected ?? ""}</div>
        <div data-testid="expanded">{firstId && state.ui.expanded[firstId] ? "yes" : "no"}</div>
        <button onClick={() => createHabit({ name: "New habit", color: "#000", frequency: "daily" })}>create</button>
        <button onClick={() => firstId && updateHabit(firstId, { name: "Updated" })}>update</button>
        <button onClick={() => firstId && archiveHabit(firstId)}>archive</button>
        <button onClick={() => firstId && deleteHabit(firstId)}>delete</button>
        <button onClick={() => firstId && checkCompletion(firstId, BUCKET)}>check</button>
        <button onClick={() => firstId && uncheckCompletion(firstId, BUCKET)}>uncheck</button>
        <button onClick={() => reorderHabits(Object.keys(state.habits).reverse())}>reorder</button>
        <button onClick={() => firstId && setSelectedHabit(firstId)}>select</button>
        <button onClick={() => setPeriod("year")}>year</button>
        <button onClick={() => firstId && setHabitExpanded(firstId, true)}>expand</button>
    </div>;
}

function wrap(data: InMemoryDataAccess, children: React.ReactNode) {
    return <TauriCloseProvider>
        <DataProvider dataAccess={data}>
            <SyncProvider ownerId={OWNER}>
                <HabitProvider>{children}</HabitProvider>
            </SyncProvider>
        </DataProvider>
    </TauriCloseProvider>;
}

class UninitializedDataAccess extends InMemoryDataAccess {
    private bootstrapped = false;

    override isInitialized(): boolean {
        return this.bootstrapped;
    }

    override async sync(options: SyncOptions): Promise<SyncResult> {
        this.bootstrapped = true;
        return super.sync(options);
    }
}

beforeEach(() => localStorage.clear());

describe("HabitContext", () => {
    it("hydrates staged habits and restores only device-local UI", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([habit("h1", { name: "Morning" })], [completion("c1", "h1")]);
        localStorage.setItem("habit_state_v1", JSON.stringify({ ui: { period: "year", selected: "h1", expanded: { h1: true } } }));

        render(wrap(data, <HabitProbe />));
        await waitFor(() => expect(screen.getByTestId("first-name")).toHaveTextContent("Morning"));
        expect(screen.getByTestId("habit-count")).toHaveTextContent("1");
        expect(screen.getByTestId("completion-count")).toHaveTextContent("1");
        expect(screen.getByTestId("period")).toHaveTextContent("year");
        expect(screen.getByTestId("selected")).toHaveTextContent("h1");
        expect(screen.getByTestId("expanded")).toHaveTextContent("yes");
        expect(JSON.parse(localStorage.getItem("habit_state_v1")!).ui.period).toBe("year");
    });

    it("stages domain actions immediately and never triggers sync", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const saveSpy = vi.spyOn(data, "saveHabits");
        const loadSpy = vi.spyOn(data, "loadHabits");
        render(wrap(data, <HabitProbe />));
        await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(2));
        const syncBefore = data.syncCalls.length;
        saveSpy.mockClear();

        await act(async () => screen.getByText("create").click());
        await waitFor(() => expect(screen.getByTestId("habit-count")).toHaveTextContent("1"));
        expect(saveSpy).toHaveBeenCalled();
        expect(data.syncCalls.length).toBe(syncBefore);
        expect(data.syncCalls.filter((call) => call.reason === "bridge")).toHaveLength(0);

        await act(async () => screen.getByText("check").click());
        await waitFor(() => expect(screen.getByTestId("completion-count")).toHaveTextContent("1"));
        await act(async () => screen.getByText("uncheck").click());
        await waitFor(() => expect(screen.getByTestId("completion-count")).toHaveTextContent("0"));
    });

    it("supports habit mutation, reorder, cascade delete, and local UI actions", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([habit("h1"), habit("h2", { position: 1 })], [completion("c1", "h1")]);
        render(wrap(data, <HabitProbe />));
        await waitFor(() => expect(screen.getByTestId("habit-count")).toHaveTextContent("2"));

        await act(async () => screen.getByText("update").click());
        await waitFor(() => expect(screen.getByTestId("first-name")).toHaveTextContent("Updated"));
        await act(async () => screen.getByText("archive").click());
        await act(async () => screen.getByText("select").click());
        await act(async () => screen.getByText("year").click());
        await act(async () => screen.getByText("expand").click());
        expect(screen.getByTestId("period")).toHaveTextContent("year");
        expect(screen.getByTestId("selected")).toHaveTextContent("h1");
        expect(screen.getByTestId("expanded")).toHaveTextContent("yes");

        await act(async () => screen.getByText("reorder").click());
        await act(async () => screen.getByText("delete").click());
        await waitFor(() => expect(screen.getByTestId("habit-count")).toHaveTextContent("1"));
        expect(screen.getByTestId("completion-count")).toHaveTextContent("0");
        expect((await data.loadHabits()).habits[0].id).toBe("h2");
    });

    it("does not seed defaults before bootstrap initialization", async () => {
        const data = new UninitializedDataAccess(makeAppState());
        const saveSpy = vi.spyOn(data, "saveHabits");
        render(wrap(data, <HabitProbe />));
        await waitFor(() => expect(screen.getByTestId("habit-count")).toHaveTextContent("0"));
        expect(saveSpy).not.toHaveBeenCalled();
        expect((await data.loadHabits()).habits).toEqual([]);
    });

    it("reloads staged revisions without restaging the reloaded slice", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveHabits([habit("h1")], []);
        const saveSpy = vi.spyOn(data, "saveHabits");
        render(wrap(data, <HabitProbe />));
        await waitFor(() => expect(screen.getByTestId("habit-count")).toHaveTextContent("1"));
        saveSpy.mockClear();

        await data.saveHabits([habit("h1"), habit("h2", { position: 1 })], []);
        await waitFor(() => expect(screen.getByTestId("habit-count")).toHaveTextContent("2"));
        saveSpy.mockClear();
        await act(async () => screen.getByText("year").click());
        expect(JSON.parse(localStorage.getItem("habit_state_v1")!).ui.period).toBe("year");
        expect(saveSpy).not.toHaveBeenCalled();
    });
});
