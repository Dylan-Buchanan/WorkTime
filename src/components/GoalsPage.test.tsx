import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DragEndEvent } from "@dnd-kit/core";
import { GoalsPage } from "./GoalsPage";
import { GoalProvider, GOAL_UI_STORAGE_KEY } from "../state/GoalContext";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { HabitProvider } from "../state/HabitContext";
import { AppStateProvider } from "../state/AppStateContext";
import { ProjectManagerProvider } from "../state/ProjectManagerContext";
import { DataProvider } from "../state/DataContext";
import { SyncProvider } from "../state/SyncContext";
import { TauriCloseProvider } from "../state/TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { GoalMetric, Habit, Project } from "../state/types";
import type { LocalDateKey } from "../lib/todos/types";
import type { DeckPlan } from "../lib/goals/deck/types";
import { serializeGoalSet } from "../lib/goals/goalSetFile";
import {
    buildArchivedTrackerFixture,
    buildCheckInHistoryFixture,
    buildCleanCheckInHistoryFixture,
    buildGoalCheckInFixture,
    buildGoalFixture,
    buildGoalTrackerFixture,
} from "../lib/goals/testFixtures";

const drag = vi.hoisted(() => ({ goals: null as null | ((event: DragEndEvent) => void), trackers: null as null | ((event: DragEndEvent) => void) }));
const deckExport = vi.hoisted(() => ({ render: vi.fn(), deliver: vi.fn(), stamp: vi.fn() }));
const goalWrite = vi.hoisted(() => ({ failNext: false }));
// PM always normalizes to a default "General" project; this seam exposes the
// genuinely empty project list a fresh install could present.
const pmProjects = vi.hoisted(() => ({ override: null as null | Record<string, Project> }));
vi.mock("../hooks/useMediaQuery");
vi.mock("../lib/goals/deck/render", () => ({ renderDeck: deckExport.render }));
vi.mock("../lib/goals/deck/delivery", () => ({ initiateBlobDownload: deckExport.deliver }));
vi.mock("../state/GoalContext", async importOriginal => {
    const original = await importOriginal<typeof import("../state/GoalContext")>();
    return { ...original, useGoals: () => {
        const goals = original.useGoals();
        return {
            ...goals,
            updateGoal: (id: string, patch: Parameters<typeof goals.updateGoal>[1]) => {
                if (goalWrite.failNext) {
                    goalWrite.failNext = false;
                    throw new RangeError("Goal write failed");
                }
                goals.updateGoal(id, patch);
            },
            stampBuiltPeriod: async (trackerId: string, periodStart: LocalDateKey) => {
                await deckExport.stamp(trackerId, periodStart);
                await goals.stampBuiltPeriod(trackerId, periodStart);
            },
        };
    } };
});
vi.mock("../state/ProjectManagerContext", async importOriginal => {
    const original = await importOriginal<typeof import("../state/ProjectManagerContext")>();
    return { ...original, usePM: () => {
        const pm = original.usePM();
        return pmProjects.override === null ? pm : { ...pm, state: { ...pm.state, projects: pmProjects.override } };
    } };
});
vi.mock("@dnd-kit/core", async importOriginal => {
    const original = await importOriginal<typeof import("@dnd-kit/core")>();
    return { ...original, DndContext: (props: React.ComponentProps<typeof original.DndContext>) => {
        if (props.id === "tracker-rail") drag.trackers = props.onDragEnd ?? null;
        else drag.goals = props.onDragEnd ?? null;
        return <original.DndContext {...props} />;
    } };
});

function tree(data: InMemoryDataAccess, today?: LocalDateKey) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="goals-page-owner"><HabitProvider><AppStateProvider><ProjectManagerProvider><GoalProvider><GoalsPage today={today} /></GoalProvider></ProjectManagerProvider></AppStateProvider></HabitProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}
async function mount(data = new InMemoryDataAccess(makeAppState()), today?: LocalDateKey) {
    const view = render(tree(data, today));
    await waitFor(() => expect(screen.getByRole("button", { name: /^(Add tracker|New tracker|Trackers)$/ })).toBeEnabled());
    return { data, user: userEvent.setup(), ...view };
}
function trackerRow(name: string) {
    return within(screen.getByRole("navigation", { name: "Trackers" })).getByRole("button", { name });
}
/** Rail row labels in rendered order, including the archived group. */
function railOrder() {
    return within(screen.getByRole("navigation", { name: "Trackers" }))
        .getAllByRole("listitem")
        .map(row => row.querySelector("[id^='tracker-rail-name-']")?.textContent ?? "");
}
async function oneTracker() {
    const data = new InMemoryDataAccess(makeAppState());
    const tracker = buildGoalTrackerFixture();
    await data.saveGoals([tracker], [], []);
    return { data, tracker };
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
function pmState(projects: Project[]) {
    return {
        projects: Object.fromEntries(projects.map(row => [row.id, row])),
        tasks: {},
        meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
    };
}
function habit(id: string, overrides: Partial<Habit> = {}): Habit {
    return {
        id,
        name: id,
        description: "",
        color: "#6366F1",
        frequency: "daily",
        position: 0,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}
const habitMetric = (overrides: Partial<GoalMetric> = {}): GoalMetric => ({
    label: "Read",
    current: 0,
    target: 6,
    unit: "days",
    source: "habit",
    habitId: "habit-read",
    overridePinned: false,
    ...overrides,
});
beforeEach(() => {
    localStorage.clear();
    drag.goals = null;
    drag.trackers = null;
    goalWrite.failNext = false;
    pmProjects.override = null;
    vi.mocked(useMediaQuery).mockReturnValue(true);
    deckExport.render.mockReset().mockResolvedValue({ blob: new Blob(["deck"]), fileName: "Work.pptx" });
    deckExport.deliver.mockReset().mockResolvedValue(undefined);
    deckExport.stamp.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe("GoalsPage", () => {
    it("centers the page heading and hides the description behind an info icon", async () => {
        const { user } = await mount();
        expect(screen.getByRole("heading", { level: 1, name: "Goal Trackers" })).toBeInTheDocument();
        const info = screen.getByRole("button", { name: "About goal trackers" });
        expect(info).toHaveAccessibleDescription(
            "Goal trackers group the goals you are working toward. A tracker can hold one or more goals and lets you know when it’s time to check in on them.",
        );
        const tooltip = screen.getByText(/A tracker can hold one or more goals/);
        expect(tooltip).not.toBeVisible();

        await user.hover(info);
        expect(tooltip).toBeVisible();
        await user.unhover(info);
        expect(tooltip).not.toBeVisible();

        act(() => info.focus());
        expect(tooltip).toBeVisible();
        act(() => info.blur());
        expect(tooltip).not.toBeVisible();
    });

    it("has a clean empty state and creates multiple trackers using both validated cadence variants", async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 25, 12) });
        const { user, data } = await mount();
        expect(screen.getByRole("heading", { name: "Start your first tracker" })).toBeInTheDocument();
        expect(screen.getByText(/A tracker holds the goals you are working toward/)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Add tracker" })).toHaveLength(1);
        expect(screen.queryByRole("navigation", { name: "Trackers" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Trackers" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Add tracker" }));
        await user.type(screen.getByLabelText("Tracker name"), "Work");
        await user.type(screen.getByLabelText("Purpose"), "Ship useful things");
        await user.clear(screen.getByLabelText("Every N weeks"));
        await user.type(screen.getByLabelText("Every N weeks"), "3");
        await user.selectOptions(screen.getByLabelText("Weekday"), "3");
        fireEvent.change(screen.getByLabelText("Color"), { target: { value: "#123456" } });
        await user.click(screen.getByRole("button", { name: "Create tracker" }));
        expect(await screen.findByRole("heading", { name: "Work" })).toBeInTheDocument();
        expect(screen.getByText(/First period started on/)).toHaveTextContent("2026-11-25");
        expect(screen.getByPlaceholderText("Add your first goal")).toBeInTheDocument();
        expect(screen.getByText(/Review what you did/)).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: /project/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Tracker" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add tracker" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "New tracker" }));
        await user.type(screen.getByLabelText("Tracker name"), "Life");
        await user.selectOptions(screen.getByLabelText("Cadence"), "monthly-weekday");
        await user.selectOptions(screen.getByLabelText("Weekday"), "5");
        await user.click(screen.getByRole("button", { name: "Create tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers).toHaveLength(2));
        const saved = await data.loadGoals();
        expect(saved.trackers.find(row => row.name === "Work")).toMatchObject({
            purpose: "Ship useful things",
            cadence: { kind: "every-n-weeks", weekday: 3, intervalWeeks: 3 },
            cadenceAnchorAt: "2026-11-25",
            color: "#123456",
        });
        expect(saved.trackers.find(row => row.name === "Life")?.cadence).toEqual({ kind: "monthly-weekday", weekday: 5 });
        await user.click(trackerRow("Work"));
        expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
    });

    it("previews three first-period choices, resets the choice on cadence edits, and saves a later start", async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 29, 12) });
        const { user, data, rerender } = await mount();
        await user.click(screen.getByRole("button", { name: "Add tracker" }));
        const picker = screen.getByLabelText("First period");
        expect(within(picker).getAllByRole("option").map(option => option.textContent)).toEqual([
            "Sun, Nov 29 (today)", "Sun, Dec 6", "Sun, Dec 13",
        ]);
        expect(picker).toHaveValue("2026-11-29");
        await user.selectOptions(picker, "2026-12-06");
        await user.selectOptions(screen.getByLabelText("Cadence"), "monthly-weekday");
        expect(picker).toHaveValue("2026-11-29");
        expect(within(picker).getByRole("option", { name: "Sun, Nov 29 · December (today)" })).toBeInTheDocument();
        expect(screen.getByText("Nov 29, 2026 – Jan 2, 2027 · later periods follow on the first Sunday of each month")).toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText("Cadence"), "every-n-weeks");
        await user.selectOptions(picker, "2026-12-06");
        fireEvent.change(screen.getByLabelText("Every N weeks"), { target: { value: "2" } });
        expect(picker).toHaveValue("2026-11-29");
        await user.selectOptions(picker, "2026-12-06");
        await user.selectOptions(screen.getByLabelText("Weekday"), "1");
        expect(picker).toHaveValue("2026-11-30");
        await user.selectOptions(screen.getByLabelText("Weekday"), "0");
        await user.selectOptions(picker, "2026-12-06");
        expect(screen.getByText("Dec 6 – Dec 19, 2026 · later periods follow every 2 weeks")).toBeInTheDocument();

        await user.type(screen.getByLabelText("Tracker name"), "Winter");
        await user.click(screen.getByRole("button", { name: "Create tracker" }));
        expect(screen.getByText(/No open period\. First period starts on/)).toHaveTextContent("2026-12-06");
        expect(screen.getByRole("button", { name: "Period not open" })).toBeDisabled();
        await waitFor(async () => expect((await data.loadGoals()).trackers).toEqual([
            expect.objectContaining({ name: "Winter", cadenceAnchorAt: "2026-12-06", lastBuiltPeriodStart: null }),
        ]));
        rerender(tree(data, "2026-12-06"));
        expect(screen.getByText(/First period started on/)).toHaveTextContent("2026-12-06");
    });

    it("shows a distinct empty state when every tracker is archived", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.saveGoals([buildArchivedTrackerFixture()], [], []);
        await mount(data);
        expect(screen.getByRole("heading", { name: "No active trackers" })).toBeInTheDocument();
        expect(screen.getByText(/Every tracker you have is archived/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add tracker" })).not.toBeInTheDocument();
        expect(screen.getByRole("navigation", { name: "Trackers" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New tracker" })).toBeEnabled();
        expect(screen.queryByRole("heading", { name: "Start your first tracker" })).not.toBeInTheDocument();
    });

    it("shows tracker status in the rail and highlights the visible fallback without overwriting selection", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const work = buildGoalTrackerFixture({ color: "#123456" });
        const life = buildGoalTrackerFixture({ id: "life", name: "Life", sortOrder: 1, lastBuiltPeriodStart: "2026-10-04" });
        const archived = buildArchivedTrackerFixture({ sortOrder: 2 });
        await data.saveGoals([work, life, archived], [
            buildGoalFixture({ id: "active", trackerId: work.id }),
            buildGoalFixture({ id: "achieved", trackerId: work.id, lifecycle: "achieved" }),
            buildGoalFixture({ id: "dropped", trackerId: work.id, lifecycle: "dropped" }),
        ], []);
        localStorage.setItem(GOAL_UI_STORAGE_KEY, JSON.stringify({ selectedTrackerId: archived.id, expandedGoalIds: {} }));
        const { user } = await mount(data, "2026-10-20");
        const navigation = screen.getByRole("navigation", { name: "Trackers" });
        expect(within(navigation).getAllByRole("listitem")).toHaveLength(2);
        expect(trackerRow(work.name)).toHaveAttribute("aria-current", "true");
        expect(trackerRow(work.name)).toHaveAccessibleDescription("1 active · 1 achieved Deck due · October 2026");
        expect(within(trackerRow(work.name)).getByTitle(work.name)).toHaveClass("truncate");
        expect(trackerRow(work.name).querySelector("[style]")).toHaveStyle({ backgroundColor: "rgb(18, 52, 86)" });
        expect(trackerRow(life.name)).toHaveAccessibleDescription("0 active · 0 achieved");
        expect(screen.queryByRole("button", { name: "Trackers" })).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!).selectedTrackerId).toBe(archived.id);

        const toggle = within(navigation).getByRole("checkbox", { name: "Show archived (1)" });
        await user.click(toggle);
        expect(within(navigation).getAllByRole("listitem")).toHaveLength(3);
        expect(trackerRow(archived.name)).toHaveAttribute("aria-current", "true");
        expect(trackerRow(archived.name)).toHaveAccessibleDescription("0 active · 0 achieved Archived");
        expect(trackerRow(archived.name).closest("li")).toHaveClass("opacity-75");
        await user.click(toggle);
        expect(within(navigation).queryByRole("button", { name: archived.name })).not.toBeInTheDocument();
        expect(trackerRow(work.name)).toHaveAttribute("aria-current", "true");
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!).selectedTrackerId).toBe(archived.id);
    });

    it("switches from the rail in one click and resets the content scroll and inline editors", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const work = buildGoalTrackerFixture();
        const life = buildGoalTrackerFixture({ id: "life", name: "Life", sortOrder: 1 });
        await data.saveGoals([work, life], [buildGoalFixture({ trackerId: work.id })], []);
        const { user } = await mount(data, "2026-10-20");
        const main = screen.getByRole("main");
        await user.click(screen.getByRole("button", { name: "Check in · October 2026" }));
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const next = trackerRow(life.name);
        const scrollIntoView = vi.fn();
        Object.defineProperty(next.closest("li"), "scrollIntoView", { value: scrollIntoView });
        main.scrollTop = 100;
        await user.click(next);
        expect(screen.getByRole("heading", { level: 2, name: life.name })).toBeInTheDocument();
        expect(next).toHaveAttribute("aria-current", "true");
        expect(main.scrollTop).toBe(0);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
        await user.click(trackerRow(work.name));
        expect(main.querySelector('[data-goals-slot="check-in-wizard"]')).toBeEmptyDOMElement();
        expect(screen.queryByRole("form", { name: "Edit goal" })).not.toBeInTheDocument();
    });

    it("selects the next active tracker after archiving the selected row even when archives are shown", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = buildGoalTrackerFixture();
        const selected = buildGoalTrackerFixture({ id: "selected", name: "Selected", sortOrder: 1 });
        const next = buildGoalTrackerFixture({ id: "next", name: "Next", sortOrder: 2 });
        await data.saveGoals([first, selected, next, buildArchivedTrackerFixture()], [], []);
        const { user } = await mount(data);
        await user.click(trackerRow(selected.name));
        await user.click(screen.getByRole("checkbox", { name: "Show archived (1)" }));
        vi.spyOn(window, "confirm").mockReturnValue(true);
        await user.click(screen.getByRole("button", { name: "Actions for Selected" }));
        await user.click(screen.getByRole("button", { name: "Archive tracker" }));
        expect(trackerRow(selected.name)).not.toHaveAttribute("aria-current");
        expect(trackerRow(selected.name)).toHaveAccessibleDescription("0 active · 0 achieved Archived");
        expect(trackerRow(next.name)).toHaveAttribute("aria-current", "true");
        expect(screen.getByRole("heading", { level: 2, name: next.name })).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!).selectedTrackerId).toBe(next.id);
    });

    it("opens the narrow drawer and closes it by overlay, Escape, Close, or tracker selection", async () => {
        vi.mocked(useMediaQuery).mockReturnValue(false);
        const data = new InMemoryDataAccess(makeAppState());
        const work = buildGoalTrackerFixture();
        const life = buildGoalTrackerFixture({ id: "life", name: "Life", sortOrder: 1 });
        await data.saveGoals([work, life], [], []);
        const { user } = await mount(data);
        const trigger = screen.getByRole("button", { name: "Trackers" });
        const open = async () => {
            await user.click(trigger);
            expect(trigger).toHaveAttribute("aria-expanded", "true");
            const dialog = screen.getByRole("dialog", { name: "Trackers" });
            expect(dialog).toHaveAttribute("aria-modal", "true");
            expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
            expect(within(dialog).getByRole("navigation", { name: "Trackers" })).toBeInTheDocument();
            return dialog;
        };
        const expectClosed = () => {
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(screen.queryByRole("navigation", { name: "Trackers" })).not.toBeInTheDocument();
            expect(trigger).toHaveAttribute("aria-expanded", "false");
            expect(trigger).toHaveFocus();
        };
        await user.click((await open()).querySelector("[aria-hidden=true]")!);
        expectClosed();
        await open();
        await user.tab({ shift: true });
        expect(screen.getByRole("checkbox", { name: "Show archived (0)" })).toHaveFocus();
        await user.keyboard("{Escape}");
        expectClosed();
        await user.click(within(await open()).getByRole("button", { name: "Close" }));
        expectClosed();
        await user.click(within(await open()).getByRole("button", { name: life.name }));
        expectClosed();
        expect(screen.getByRole("heading", { level: 2, name: life.name })).toBeInTheDocument();
        await open();
        expect(trackerRow(life.name)).toHaveAttribute("aria-current", "true");
    });

    it("rejects invalid tracker forms and supports tracker edit, confirmed archive, and restore", async () => {
        const { data, tracker } = await oneTracker();
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: `Actions for ${tracker.name}` }));
        await user.click(screen.getByRole("button", { name: "Edit tracker" }));
        expect(screen.queryByLabelText("First period")).not.toBeInTheDocument();
        await user.clear(screen.getByLabelText("Tracker name"));
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Give this tracker a name");
        await user.type(screen.getByLabelText("Tracker name"), "Renamed");
        await user.clear(screen.getByLabelText("Every N weeks"));
        await user.type(screen.getByLabelText("Every N weeks"), "0");
        // Exercise app validation independently of browser number-input validation.
        fireEvent.submit(screen.getByRole("form", { name: "Edit tracker" }));
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect((await data.loadGoals()).trackers[0].name).toBe(tracker.name);
        await user.clear(screen.getByLabelText("Every N weeks"));
        await user.type(screen.getByLabelText("Every N weeks"), "2");
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        expect(await screen.findByRole("heading", { name: "Renamed" })).toBeInTheDocument();
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        await user.click(screen.getByRole("button", { name: "Actions for Renamed" }));
        await user.click(screen.getByRole("button", { name: "Archive tracker" }));
        expect(screen.getByRole("heading", { name: "Renamed" })).toBeInTheDocument();
        confirm.mockReturnValue(true);
        await user.click(screen.getByRole("button", { name: "Actions for Renamed" }));
        await user.click(screen.getByRole("button", { name: "Archive tracker" }));
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("history will be kept"));
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!).selectedTrackerId).toBeNull();
        await user.click(screen.getByRole("checkbox", { name: "Show archived (1)" }));
        expect(await screen.findByRole("heading", { name: "Renamed" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Actions for Renamed" }));
        await user.click(screen.getByRole("button", { name: "Reactivate tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].isArchived).toBe(false));
        expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    });

    it("writes a tracker project on create and edit and clears it back to No project", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const deep = project();
        const admin = project({ id: "project-2", name: "Admin", sortOrder: 1 });
        await data.savePMState(pmState([admin, deep]));
        const { user, container } = await mount(data, "2026-10-20");

        await user.click(screen.getByRole("button", { name: "Add tracker" }));
        await user.type(screen.getByLabelText("Tracker name"), "Work");
        await screen.findByRole("option", { name: "Deep Work" });
        const created = screen.getByLabelText("Project");
        expect(within(created).getAllByRole("option").map(option => option.textContent)).toEqual(["No project", "Deep Work", "Admin"]);
        expect(screen.getByText(/Goals inherit this tracker’s project unless they override it/)).toBeInTheDocument();
        await user.selectOptions(created, deep.id);
        await user.click(screen.getByRole("button", { name: "Create tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].projectId).toBe(deep.id));
        await waitFor(() => expect(container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Deep Work"));

        await user.click(screen.getByRole("button", { name: "Actions for Work" }));
        await user.click(screen.getByRole("button", { name: "Edit tracker" }));
        expect(screen.getByLabelText("Project")).toHaveValue(deep.id);
        await user.selectOptions(screen.getByLabelText("Project"), "");
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].projectId).toBeNull());
        expect(container.querySelector('[data-goals-slot="tracker-project"]')).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Actions for Work" }));
        await user.click(screen.getByRole("button", { name: "Edit tracker" }));
        expect(screen.getByLabelText("Project")).toHaveValue("");
        await user.selectOptions(screen.getByLabelText("Project"), admin.id);
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].projectId).toBe(admin.id));
        await waitFor(() => expect(container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Admin"));
    });

    it("follows a project rename in the header chip and keeps a dangling tracker link missing", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ projectId: "project-1" });
        await data.saveGoals([tracker], [], []);
        await data.savePMState(pmState([project()]));
        const first = await mount(data, "2026-10-20");
        await waitFor(() => expect(first.container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Deep Work"));
        first.unmount();

        await data.savePMState(pmState([project({ name: "Deep Work Renamed" })]));
        const second = await mount(data, "2026-10-20");
        await waitFor(() => expect(second.container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Deep Work Renamed"));
        second.unmount();

        await data.saveGoals([{ ...tracker, projectId: "project-gone" }], [], []);
        const third = await mount(data, "2026-10-20");
        await waitFor(() => expect(third.container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Linked project is missing"));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();

        // Saving the untouched form keeps the dangling id instead of clearing it.
        await third.user.click(screen.getByRole("button", { name: `Actions for ${tracker.name}` }));
        await third.user.click(screen.getByRole("button", { name: "Edit tracker" }));
        await third.user.click(screen.getByRole("button", { name: "Save tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].projectId).toBe("project-gone"));
        expect(third.container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Linked project is missing");
    });

    it("offers only No project when no projects exist and still saves the tracker", async () => {
        pmProjects.override = {};
        const { data, tracker } = await oneTracker();
        const { user } = await mount(data);

        await user.click(screen.getByRole("button", { name: `Actions for ${tracker.name}` }));
        await user.click(screen.getByRole("button", { name: "Edit tracker" }));
        const select = screen.getByLabelText("Project");
        expect(within(select).getAllByRole("option").map(option => option.textContent)).toEqual(["No project"]);
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].projectId).toBeNull());
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("changing the tracker project leaves goal links and the built stamp untouched, flagging the goal only as it deviates", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ projectId: "project-1", lastBuiltPeriodStart: "2026-10-04" });
        const goal = buildGoalFixture({ id: "goal-linked", trackerId: tracker.id, title: "Ship the release", projectLink: { mode: "project", projectId: "project-1" } });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState(pmState([project(), project({ id: "project-2", name: "Admin", sortOrder: 1 })]));
        const { user, container } = await mount(data, "2026-10-20");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).queryByText("Deep Work")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: `Actions for ${tracker.name}` }));
        await user.click(screen.getByRole("button", { name: "Edit tracker" }));
        await screen.findByRole("option", { name: "Admin" });
        await user.selectOptions(screen.getByLabelText("Project"), "project-2");
        await user.click(screen.getByRole("button", { name: "Save tracker" }));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].projectId).toBe("project-2"));

        const saved = await data.loadGoals();
        expect(saved.goals[0]).toEqual(goal);
        expect(saved.trackers[0].lastBuiltPeriodStart).toBe("2026-10-04");
        const deviatingRow = screen.getByLabelText(goal.title);
        expect(within(deviatingRow).getByText("Deep Work")).toBeInTheDocument();
        expect(within(deviatingRow).queryByText("Admin")).not.toBeInTheDocument();
        await waitFor(() => expect(container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Admin"));
    });

    it("keeps showing an archived linked project in the tracker chip", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ projectId: "project-1" });
        await data.saveGoals([tracker], [], []);
        await data.savePMState(pmState([project({ isArchived: true })]));
        const { container } = await mount(data, "2026-10-20");

        await waitFor(() => expect(container.querySelector('[data-goals-slot="tracker-project"]')).toHaveTextContent("Deep Work"));
        expect(screen.queryByText("Linked project is missing")).not.toBeInTheDocument();
    });

    it("shows the exact saved first start with honest future and past copy, leaving all frozen mount slots", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04", sortOrder: 0 });
        const past = buildGoalTrackerFixture({ id: "past", name: "Past", sortOrder: 1 });
        const goal = buildGoalFixture({ trackerId: future.id });
        await data.saveGoals([future, past], [goal], []);
        const { user, container } = await mount(data);
        expect(screen.getByText("Every 2 weeks on Sunday")).toBeInTheDocument();
        expect(screen.getByText(/No open period. First period starts on/)).toHaveTextContent("2099-01-04");
        expect(screen.queryByRole("button", { name: /check.in|build deck/i })).not.toBeInTheDocument();
        for (const slot of ["tracker-due", "check-in-entry", "deck-entry", "goal-set-actions", "goal-slip", "check-in-wizard", "deck-preview", "due-nudge"]) {
            expect(container.querySelectorAll(`[data-goals-slot="${slot}"]`)).toHaveLength(1);
        }
        expect(container.querySelector('[data-goals-slot="tracker-due"]')).toHaveAttribute("data-tracker-id", future.id);
        expect(container.querySelector('[data-goals-slot="goal-slip"]')).toHaveAttribute("data-goal-id", goal.id);
        await user.click(trackerRow(past.name));
        expect(screen.getByText(/First period started on/)).toHaveTextContent(past.cadenceAnchorAt);
        expect(screen.queryByText(/No open period/)).not.toBeInTheDocument();
    });

    it("quick-adds immediately on Enter and follows name, status, note keyboard order", async () => {
        const { data } = await oneTracker();
        const { user } = await mount(data);
        const name = screen.getByRole("textbox", { name: "Goal name" });
        await user.type(name, "Launch{Enter}");
        expect(screen.getByRole("heading", { name: "Launch" })).toBeInTheDocument();
        expect(name).toHaveFocus();
        expect(name).toHaveValue("");
        await user.type(name, "Learn");
        await user.tab();
        expect(screen.getByRole("combobox", { name: "Status" })).toHaveFocus();
        await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "achieved");
        await user.tab();
        expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
        await user.keyboard("Completed course{Enter}");
        await user.selectOptions(screen.getByRole("combobox", { name: "Goal status" }), "achieved");
        expect(screen.getByRole("heading", { name: "Learn" })).toBeInTheDocument();
        await waitFor(async () => expect((await data.loadGoals()).goals).toHaveLength(2));
        expect((await data.loadGoals()).goals.find(row => row.title === "Launch")).toMatchObject({ lifecycle: "active", notes: "", projectLink: { mode: "inherit" } });
        expect((await data.loadGoals()).goals.find(row => row.title === "Learn")).toMatchObject({ lifecycle: "achieved", notes: "Completed course" });
    });

    it("edits a goal and its manual metric, validates values, and stops tracking on save", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.clear(screen.getByRole("textbox", { name: "Name" }));
        await user.type(screen.getByRole("textbox", { name: "Name" }), "Train");
        await user.type(screen.getByLabelText("Goal note"), "Weekly practice");
        await user.click(screen.getByRole("button", { name: "Track manually" }));
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Metric needs a label and finite current and target values.");
        await user.type(screen.getByLabelText("Metric label"), "Sessions");
        await user.clear(screen.getByLabelText("Current"));
        await user.type(screen.getByLabelText("Current"), "3.5");
        await user.clear(screen.getByLabelText("Target"));
        await user.type(screen.getByLabelText("Target"), "8");
        await user.type(screen.getByLabelText("Unit"), "sessions");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.getByText(/Sessions: 3.5 \/ 8 sessions/)).toBeInTheDocument();
        expect(screen.getByText("Manual")).toBeInTheDocument();
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric?.current).toBe(3.5));
        expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Sessions", current: 3.5, target: 8, unit: "sessions", source: "manual", overridePinned: false,
        });
        await user.click(screen.getByRole("button", { name: "Show details" }));
        expect(screen.getByText("Weekly practice")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(screen.getByRole("button", { name: "Stop tracking" }));
        expect(screen.getByText("Tracking stops when you save.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toBeNull());
    });

    it("opens the connect wizard from the editor without closing the editor", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        await user.click(within(editor).getByRole("button", { name: "Connect a habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        expect(within(dialog).getByRole("radio", { name: "Read" })).toBeInTheDocument();
        expect(screen.getByRole("form", { name: "Edit goal" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
        expect(screen.getByRole("form", { name: "Edit goal" })).toBeInTheDocument();
    });

    it("writes nothing when the editor is cancelled after Stop tracking", async () => {
        const { data, tracker } = await oneTracker();
        const metric: GoalMetric = { label: "Sessions", current: 3, target: 8, unit: "sessions", source: "manual", overridePinned: true };
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(screen.getByRole("button", { name: "Stop tracking" }));
        expect(screen.getByText("Tracking stops when you save.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("form", { name: "Edit goal" })).not.toBeInTheDocument();
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it.each(["manual", "liftingtracker"] as const)("preserves a %s override on a note-only edit", async source => {
        const { data, tracker } = await oneTracker();
        const metric: GoalMetric = { label: "Lifts", current: 4, target: 8, unit: "sessions", source, overridePinned: true };
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        expect(screen.getByText(`${source === "manual" ? "Manual" : "Auto"} · Override`)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        if (source === "liftingtracker") {
            expect(within(editor).queryByRole("button", { name: "Change habit" })).not.toBeInTheDocument();
            expect(within(editor).queryByRole("button", { name: "Connect a habit" })).not.toBeInTheDocument();
            expect(within(editor).queryByRole("button", { name: "Track manually" })).not.toBeInTheDocument();
            expect(within(editor).getByRole("button", { name: "Stop tracking" })).toBeInTheDocument();
        }
        await user.type(screen.getByLabelText("Goal note"), "Keep the metric");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Keep the metric"));
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it("drops a manual override only when its target changes", async () => {
        const { data, tracker } = await oneTracker();
        const metric: GoalMetric = { label: "Lifts", current: 4, target: 8, unit: "sessions", source: "manual", overridePinned: true };
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        const { user } = await mount(data);
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.clear(screen.getByLabelText("Target"));
        await user.type(screen.getByLabelText("Target"), "10");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Lifts", current: 4, target: 10, unit: "sessions", source: "manual", overridePinned: false,
        }));
    });

    it("connects a habit end to end from the row affordance", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user, container } = await mount(data, "2026-11-02");
        const slot = container.querySelector('[data-goals-slot="goal-metric-connect"]') as HTMLElement;
        await user.click(within(slot).getByRole("button", { name: "Connect a habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await user.click(within(dialog).getByRole("radio", { name: "Read" }));
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        expect(await within(dialog).findByRole("heading", { name: "Set the target" })).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Target")).toHaveValue(14);
        await user.click(within(dialog).getByRole("button", { name: "Save" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Read", current: 0, target: 14, unit: "days", source: "habit", habitId: "habit-read", overridePinned: false,
        }));
        const row = screen.getByLabelText(goal.title);
        expect(await within(row).findByText("Read: 0 / 14 days · 12 days left")).toBeInTheDocument();
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
    });

    it("offers Connect a habit in an active goal's empty metric slot", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user, container } = await mount(data, "2026-11-02");
        const slot = container.querySelector('[data-goals-slot="goal-metric-connect"]') as HTMLElement;
        expect(slot).toHaveTextContent("No metric · Connect a habit");
        await user.click(within(slot).getByRole("button", { name: "Connect a habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        expect(within(dialog).getByRole("radio", { name: "Read" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
        expect((await data.loadGoals()).goals[0].metric).toBeNull();
    });

    it.each(["achieved", "dropped"] as const)("shows no connect affordance on a %s goal without a metric", async lifecycle => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, lifecycle });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.selectOptions(screen.getByLabelText("Goal status"), lifecycle);
        const row = screen.getByLabelText(goal.title);
        expect(within(row).queryByText("No metric")).not.toBeInTheDocument();
        expect(within(row).queryByRole("button", { name: "Connect a habit" })).not.toBeInTheDocument();
    });

    it("opens the wizard from a habit-linked row with its habit checked", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ label: "Read" }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        await user.click(await within(row).findByRole("button", { name: "Read: 0 / 6 days · 12 days left" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        const radio = within(dialog).getByRole("radio", { name: "Read" });
        await waitFor(() => expect(radio).toHaveAttribute("aria-checked", "true"));
    });

    it.each(["achieved", "dropped"] as const)("reaches Disconnect from a %s habit-linked row", async lifecycle => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ label: "Read" });
        const goal = buildGoalFixture({ trackerId: tracker.id, lifecycle, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.selectOptions(screen.getByLabelText("Goal status"), lifecycle);
        const row = screen.getByLabelText(goal.title);
        await user.click(await within(row).findByRole("button", { name: "Read: 0 / 6 days · 12 days left" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await user.click(within(dialog).getByRole("button", { name: "Disconnect habit" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument());
        const saved = (await data.loadGoals()).goals[0].metric;
        expect(saved).toEqual({ label: "Read", current: 0, target: 6, unit: "days", source: "manual", overridePinned: false });
        expect(saved !== null && "habitId" in saved).toBe(false);
    });

    it.each<[string, GoalMetric]>([
        ["manual", { label: "Sessions", current: 3, target: 8, unit: "sessions", source: "manual", overridePinned: false }],
        ["liftingtracker", { label: "Lifts", current: 4, target: 8, unit: "sessions", source: "liftingtracker", overridePinned: false }],
    ])("renders a %s row reading without a connect button", async (source, metric) => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        const { container } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        const line = row.querySelector('[data-goals-slot="goal-metric"]') as HTMLElement;
        expect(line).toHaveTextContent(`${metric.label}: ${metric.current} / ${metric.target} ${metric.unit} ${source === "manual" ? "Manual" : "Auto"}`);
        expect(within(line).queryByRole("button")).not.toBeInTheDocument();
        expect(container.querySelector('[data-goals-slot="goal-metric-connect"]')).toBeNull();
    });

    it("summarises a habit link in the editor and routes Change habit to the wizard", async () => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ label: "Read", target: 2 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], ["2026-11-01", "2026-11-02"].map(bucket => ({
            id: `habit-read:${bucket}`, habitId: "habit-read", bucket,
            createdAt: `${bucket}T12:00:00.000Z`, updatedAt: `${bucket}T12:00:00.000Z`,
        })));
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        const summary = editor.querySelector('[data-goals-slot="goal-metric-summary"]') as HTMLElement;
        expect(summary).toHaveTextContent("Tracked by habit: Read · 2 of 2 days so far · 12 days left · target hit");
        expect(within(editor).queryByRole("button", { name: /Disconnect/ })).not.toBeInTheDocument();
        await user.click(within(editor).getByRole("button", { name: "Change habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        expect(within(dialog).getByRole("radio", { name: "Read" })).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await user.type(screen.getByLabelText("Goal note"), "Keep the habit");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Keep the habit"));
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it("keeps a wizard write made while the editor is open and still saves the note", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        await user.type(screen.getByLabelText("Goal note"), "Keep this note");
        await user.click(within(editor).getByRole("button", { name: "Connect a habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await user.click(within(dialog).getByRole("radio", { name: "Read" }));
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        await user.click(await within(dialog).findByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument());
        expect(within(editor).getByText(/Tracked by habit: Read ·/)).toBeInTheDocument();
        await user.click(within(editor).getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Keep this note"));
        expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Read", current: 0, target: 14, unit: "days", source: "habit", habitId: "habit-read", overridePinned: false,
        });
    });

    it("preserves an identical habit link after Stop tracking and reconnecting in the editor", async () => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ target: 14 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        await user.click(within(editor).getByRole("button", { name: "Stop tracking" }));
        await user.click(within(editor).getByRole("button", { name: "Connect a habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        await user.click(within(dialog).getByRole("button", { name: "Save" }));
        await waitFor(() => expect(dialog).not.toBeInTheDocument());
        await user.type(screen.getByLabelText("Goal note"), "Reconnected");
        await user.click(within(editor).getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Reconnected"));
        expect((await data.loadGoals()).goals[0].metric).toStrictEqual(metric);
    });

    it("restores the stored manual metric after Stop tracking and cancelling Connect a habit", async () => {
        const { data, tracker } = await oneTracker();
        const metric: GoalMetric = { label: "Pages", current: 3, target: 25, unit: "pages", source: "manual", overridePinned: true };
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        await user.clear(within(editor).getByLabelText("Metric label"));
        await user.type(within(editor).getByLabelText("Metric label"), "Unsaved label");
        await user.click(within(editor).getByRole("button", { name: "Stop tracking" }));
        await user.click(within(editor).getByRole("button", { name: "Connect a habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await user.type(screen.getByLabelText("Goal note"), "Keep manual");
        await user.click(within(editor).getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Keep manual"));
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it.each<[string, GoalMetric | null]>([
        ["no metric", null],
        ["manual", { label: "Lifts", current: 4, target: 8, unit: "sessions", source: "manual", overridePinned: false }],
        ["habit", habitMetric()],
        ["liftingtracker", { label: "Lifts", current: 4, target: 8, unit: "sessions", source: "liftingtracker", overridePinned: false }],
    ])("has no metric enum controls in the editor with a %s goal", async (_kind, metric) => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        expect(within(editor).queryByLabelText("Track one metric")).not.toBeInTheDocument();
        expect(within(editor).queryByLabelText("Source")).not.toBeInTheDocument();
        expect(within(editor).queryByLabelText("Habit")).not.toBeInTheDocument();
    });

    it("keeps the stale-target hint and leaves the habit metric unchanged on an editor save", async () => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ label: "Daily walk", target: 20 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        const rowHint = within(row).getByText("This cadence can hold at most 14 days.");
        expect(rowHint.parentElement).toHaveAttribute("data-goals-slot", "goal-metric-hint");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        const editorHint = within(editor).getByText("This cadence can hold at most 14 days.");
        expect(editorHint.parentElement).toHaveClass("text-amber-300");
        await user.type(screen.getByLabelText("Goal note"), "Note only");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.queryByRole("form", { name: "Edit goal" })).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        await waitFor(async () => expect((await data.loadGoals()).goals[0].notes).toBe("Note only"));
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it("hints at an unreachable saved target without rewriting stored data", async () => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ label: "Daily walk", target: 20 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("This cadence can hold at most 14 days.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getAllByText("This cadence can hold at most 14 days.")).toHaveLength(2);
        const beforeSave = screen.getByRole("form", { name: "Edit goal" }).querySelector('[data-goals-slot="goal-metric-hint"]');
        expect(beforeSave).toHaveClass("text-amber-300");
        expect(beforeSave).not.toHaveAttribute("role");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        expect(screen.queryByRole("form", { name: "Edit goal" })).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        const editorHint = editor.querySelector('[data-goals-slot="goal-metric-hint"]');
        expect(editorHint).toHaveTextContent("This cadence can hold at most 14 days.");
        expect(editorHint).toHaveClass("text-amber-300");
        expect(editorHint).not.toHaveAttribute("role");
        expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it("repairs a dangling link from the row through the connect wizard", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: "habit-gone" }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-walk", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(await within(row).findByText("Linked habit is missing")).toBeInTheDocument();
        const repair = within(row).getByRole("button", { name: "Repair link" });
        expect(repair).toHaveAttribute("data-goals-slot", "goal-metric-repair");
        expect(repair).toHaveAttribute("aria-haspopup", "dialog");
        await user.click(repair);
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        expect(dialog.querySelector('[data-goals-slot="connect-missing"]')).toHaveTextContent(
            "The habit this goal tracked (“Read”) no longer exists. Choose a habit to repair the link.",
        );
        await user.click(within(dialog).getByRole("radio", { name: "Daily walk" }));
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        await user.click(await within(dialog).findByRole("button", { name: "Save" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Daily walk", current: 0, target: 14, unit: "days", source: "habit", habitId: "habit-walk", overridePinned: false,
        }));
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
        expect(within(row).queryByRole("button", { name: "Repair link" })).not.toBeInTheDocument();
        expect(within(row).queryByText("Linked habit is missing")).not.toBeInTheDocument();
    });

    it.each(["Cancel", "Escape", "backdrop"] as const)("leaves a dangling metric untouched when repair closes with %s", async close => {
        const { data, tracker } = await oneTracker();
        const original = habitMetric({ habitId: "habit-gone", label: "Old reading", current: 3, unit: "sessions" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: original });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-walk", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(await screen.findByRole("button", { name: "Repair link" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await user.click(within(dialog).getByRole("radio", { name: "Daily walk" }));
        if (close === "Cancel") await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        else if (close === "Escape") await user.keyboard("{Escape}");
        else await user.click(dialog.querySelector('[aria-hidden="true"]')!);
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
        expect((await data.loadGoals()).goals[0].metric).toStrictEqual(original);
    });

    it("offers no dangling repair while habits are still hydrating", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: "habit-gone" }) });
        await data.saveGoals([tracker], [goal], []);
        vi.spyOn(data, "loadHabits").mockReturnValue(new Promise<never>(() => {}));
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Loading habit progress…")).toBeInTheDocument();
        expect(within(row).queryByText("Linked habit is missing")).not.toBeInTheDocument();
        expect(within(row).queryByRole("button", { name: "Repair link" })).not.toBeInTheDocument();
        expect(row.querySelector('[data-goals-slot="goal-metric-repair"]')).toBeNull();
    });

    it("recalculates a stale target from the row with the same habit", async () => {
        const { data, tracker } = await oneTracker();
        const original = habitMetric({ label: "Old label", target: 20, unit: "sessions" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: original });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        const hint = within(row).getByText("This cadence can hold at most 14 days.");
        expect(hint.tagName).toBe("SPAN");
        expect(hint.parentElement).toHaveClass("text-xs", "text-amber-300");
        expect(hint.parentElement).toHaveAttribute("data-goals-slot", "goal-metric-hint");
        const recalculate = within(row).getByRole("button", { name: "Recalculate target" });
        expect(recalculate).toHaveAttribute("aria-haspopup", "dialog");
        await user.click(recalculate);
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Daily walk" })).toHaveAttribute("aria-checked", "true"));
        expect(dialog.querySelector('[data-goals-slot="connect-stale"]')).toHaveTextContent(
            "This tracker’s periods changed. Save again to recalculate the target.",
        );
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        expect(await within(dialog).findByLabelText("Target")).toHaveValue(14);
        await user.click(within(dialog).getByRole("button", { name: "Save" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Daily walk", current: 0, target: 14, unit: "days", source: "habit", habitId: "habit-read", overridePinned: false,
        }));
        expect(row.querySelector('[data-goals-slot="goal-metric-hint"]')).toBeNull();
        expect(within(row).queryByRole("button", { name: "Recalculate target" })).not.toBeInTheDocument();
    });

    it("opens target recalculation from the editor hint without discarding the note", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ target: 20 }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Daily walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        await user.type(within(editor).getByLabelText("Goal note"), "Keep this note");
        const recalculate = within(editor).getByRole("button", { name: "Recalculate target" });
        expect(recalculate).toHaveAttribute("aria-haspopup", "dialog");
        await user.click(recalculate);
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await waitFor(() => expect(within(dialog).getByRole("button", { name: "Next" })).toBeEnabled());
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        await user.click(await within(dialog).findByRole("button", { name: "Save" }));
        expect(within(editor).getByLabelText("Goal note")).toHaveValue("Keep this note");
        expect(editor.querySelector('[data-goals-slot="goal-metric-hint"]')).toBeNull();
        await user.click(within(editor).getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0]).toMatchObject({ notes: "Keep this note", metric: { target: 14 } }));
    });

    it.each(["manual", "liftingtracker"] as const)("renders a large %s target plainly without habit repair controls", async source => {
        const { data, tracker } = await oneTracker();
        const metric: GoalMetric = { label: "Pages", current: 0, target: 400, unit: "pages", source, overridePinned: false };
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read")], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(row.querySelector('[data-goals-slot="goal-metric"]')).toHaveTextContent("Pages: 0 / 400 pages");
        expect(row.querySelector('[data-goals-slot="goal-metric-hint"]')).toBeNull();
        expect(within(row).queryByRole("button", { name: "Recalculate target" })).not.toBeInTheDocument();
        expect(within(row).queryByRole("button", { name: "Repair link" })).not.toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        expect(editor.querySelector('[data-goals-slot="goal-metric-hint"]')).toBeNull();
        expect(within(editor).queryByRole("button", { name: "Recalculate target" })).not.toBeInTheDocument();
    });

    it("explains an archived row link and recomputes it when saving the same habit", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ label: "Old label", current: 3, target: 6, unit: "sessions" }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([
            habit("habit-read", { name: "Read", isArchived: true }),
            habit("habit-old", { name: "Other archived", isArchived: true, position: 1 }),
        ], []);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        await user.click(within(row).getByRole("button", { name: /Old label:/ }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Read (archived)" })).toHaveAttribute("aria-checked", "true"));
        expect(dialog.querySelector('[data-goals-slot="connect-archived"]')).toHaveTextContent(
            "“Read” is archived. It still counts toward this goal; choose another habit to switch.",
        );
        expect(within(dialog).queryByRole("radio", { name: "Other archived (archived)" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Next" }));
        await user.click(await within(dialog).findByRole("button", { name: "Save" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({
            label: "Read", current: 0, target: 14, unit: "days", source: "habit", habitId: "habit-read", overridePinned: false,
        }));
    });

    it("preserves unsaved manual fields across an equal-metric goals refresh", async () => {
        const { data, tracker } = await oneTracker();
        const metric: GoalMetric = { label: "Pages", current: 0, target: 400, unit: "pages", source: "manual", overridePinned: false };
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        const other = buildGoalFixture({ id: "goal-other", trackerId: tracker.id, title: "Another goal", sortOrder: 1 });
        await data.saveGoals([tracker], [goal, other], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(within(screen.getByLabelText(goal.title)).getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        await user.clear(within(editor).getByLabelText("Metric label"));
        await user.type(within(editor).getByLabelText("Metric label"), "Typed label");
        await user.click(within(screen.getByLabelText(other.title)).getByRole("button", { name: "Achieve" }));
        await waitFor(async () => expect((await data.loadGoals()).goals.find(row => row.id === other.id)?.lifecycle).toBe("achieved"));
        expect(within(editor).getByLabelText("Metric label")).toHaveValue("Typed label");
        await user.click(within(editor).getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals.find(row => row.id === goal.id)?.metric).toEqual({ ...metric, label: "Typed label" }));
    });

    it.each(["achieved", "dropped"] as const)("opens dangling repair with Disconnect only on a %s goal", async lifecycle => {
        const { data, tracker } = await oneTracker();
        const original = habitMetric({ habitId: "habit-gone" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: original, lifecycle });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-walk", { name: "Walk" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.selectOptions(screen.getByLabelText("Goal status"), lifecycle);
        await user.click(within(screen.getByLabelText(goal.title)).getByRole("button", { name: "Repair link" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        expect(within(dialog).getByRole("button", { name: "Disconnect habit" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
        expect(within(dialog).queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "Create a new habit" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Disconnect habit" }));
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
        const { habitId: _habitId, ...manual } = original;
        await waitFor(async () => expect((await data.loadGoals()).goals[0].metric).toEqual({ ...manual, source: "manual" }));
    });

    it("shows a quiet missing-habit note instead of a zero reading on a broken link", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ habitId: "habit-gone" }) });
        await data.saveGoals([tracker], [goal], []);
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(await within(row).findByText("Linked habit is missing")).toBeInTheDocument();
        expect(within(row).queryByText(/0 \/ 6/)).not.toBeInTheDocument();
        expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("never shows a zero reading while the habits provider is still hydrating", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ target: 12 }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        vi.spyOn(data, "loadHabits").mockReturnValue(new Promise<never>(() => {}));
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Loading habit progress…")).toBeInTheDocument();
        expect(within(row).queryByText(/0 \/ 12/)).not.toBeInTheDocument();
    });

    it("renders a project link and a habit reading as two separate links", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, projectLink: { mode: "project", projectId: "project-1" }, metric: habitMetric({ target: 3 }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {},
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Deep Work")).toBeInTheDocument();
        expect(within(row).queryByText("Linked project is missing")).not.toBeInTheDocument();
        expect(await within(row).findByText("Read: 0 / 3 days · 12 days left")).toBeInTheDocument();
        expect(within(row).queryByText("Linked habit is missing")).not.toBeInTheDocument();
    });

    it("shows a goal project only when it deviates from the tracker's project", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ projectId: "project-1" });
        const inherited = buildGoalFixture({ id: "goal-inherit", trackerId: tracker.id, title: "Inherited", sortOrder: 0, projectLink: { mode: "inherit" } });
        const same = buildGoalFixture({ id: "goal-same", trackerId: tracker.id, title: "Same override", sortOrder: 1, projectLink: { mode: "project", projectId: "project-1" } });
        const other = buildGoalFixture({ id: "goal-other", trackerId: tracker.id, title: "Other override", sortOrder: 2, projectLink: { mode: "project", projectId: "project-2" } });
        const none = buildGoalFixture({ id: "goal-none", trackerId: tracker.id, title: "No project", sortOrder: 3, projectLink: { mode: "none" } });
        await data.saveGoals([tracker], [inherited, same, other, none], []);
        await data.savePMState(pmState([project(), project({ id: "project-2", name: "Admin", sortOrder: 1 })]));
        await mount(data, "2026-10-20");

        for (const title of [inherited.title, same.title, none.title]) {
            const row = screen.getByLabelText(title);
            expect(within(row).queryByText("Deep Work")).not.toBeInTheDocument();
            expect(within(row).queryByText("Admin")).not.toBeInTheDocument();
        }
        const deviating = screen.getByLabelText(other.title);
        expect(within(deviating).getByText("Admin")).toBeInTheDocument();
        expect(within(deviating).queryByText("Deep Work")).not.toBeInTheDocument();
    });

    it("shows an override's project in a project-less tracker but nothing for an inheriting goal", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const inherited = buildGoalFixture({ id: "goal-inherit", trackerId: tracker.id, title: "Inherited", sortOrder: 0, projectLink: { mode: "inherit" } });
        const override = buildGoalFixture({ id: "goal-override", trackerId: tracker.id, title: "Override", sortOrder: 1, projectLink: { mode: "project", projectId: "project-1" } });
        await data.saveGoals([tracker], [inherited, override], []);
        await data.savePMState(pmState([project()]));
        await mount(data, "2026-10-20");

        expect(within(screen.getByLabelText(inherited.title)).queryByText("Deep Work")).not.toBeInTheDocument();
        expect(within(screen.getByLabelText(override.title)).getByText("Deep Work")).toBeInTheDocument();
    });

    it("counts an archived linked habit's completions and names it in the editor summary", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric({ label: "Read" }) });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read", isArchived: true })], [{
            id: "archived-completion", habitId: "habit-read", bucket: "2026-11-01",
            createdAt: "2026-11-01T12:00:00.000Z", updatedAt: "2026-11-01T12:00:00.000Z",
        }]);
        const { user } = await mount(data, "2026-11-02");
        const row = screen.getByLabelText(goal.title);
        expect(await within(row).findByText("Read: 1 / 6 days · 12 days left")).toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        const summary = editor.querySelector('[data-goals-slot="goal-metric-summary"]') as HTMLElement;
        expect(summary).toHaveTextContent("Tracked by habit: Read (archived) · 1 of 6 days so far · 12 days left");
    });

    it("names a dangling habit link in the editor and opens the wizard to repair it", async () => {
        const { data, tracker } = await oneTracker();
        const metric = habitMetric({ label: "Read", habitId: "habit-gone" });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric });
        await data.saveGoals([tracker], [goal], []);
        await data.saveHabits([habit("habit-read", { name: "Read 20 minutes" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const editor = screen.getByRole("form", { name: "Edit goal" });
        const summary = editor.querySelector('[data-goals-slot="goal-metric-summary"]') as HTMLElement;
        expect(summary).toHaveTextContent("Tracked by habit: Linked habit is missing");
        await user.click(within(editor).getByRole("button", { name: "Change habit" }));
        const dialog = screen.getByRole("dialog", { name: "Connect a habit" });
        expect(dialog.querySelector('[data-goals-slot="connect-missing"]')).toHaveTextContent("no longer exists");
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect((await data.loadGoals()).goals[0].metric).toEqual(metric);
    });

    it("closes an open connect wizard when the tracker changes", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const work = buildGoalTrackerFixture();
        const life = buildGoalTrackerFixture({ id: "life", name: "Life", sortOrder: 1 });
        await data.saveGoals([work, life], [
            buildGoalFixture({ id: "goal-work", trackerId: work.id, title: "Work goal" }),
            buildGoalFixture({ id: "goal-life", trackerId: life.id, title: "Life goal", sortOrder: 1 }),
        ], []);
        await data.saveHabits([habit("habit-read", { name: "Read" })], []);
        const { user } = await mount(data, "2026-11-02");
        await user.click(within(screen.getByLabelText("Work goal")).getByRole("button", { name: "Connect a habit" }));
        expect(screen.getByRole("dialog", { name: "Connect a habit" })).toBeInTheDocument();
        await user.click(trackerRow(life.name));
        expect(screen.queryByRole("dialog", { name: "Connect a habit" })).not.toBeInTheDocument();
    });

    it("moves goals through achieved and dropped and reactivates them without losing history", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id });
        await data.saveGoals([tracker], [goal], [checkIn]);
        const { user } = await mount(data);
        const achieve = screen.getByRole("button", { name: "Achieve" });
        expect(achieve).toHaveClass("border-emerald-700");
        expect(achieve).toHaveClass("text-emerald-200");
        const drop = screen.getByRole("button", { name: "Drop" });
        expect(drop).toHaveClass("border-rose-800");
        expect(drop).toHaveClass("text-rose-200");
        await user.click(achieve);
        expect(screen.queryByRole("heading", { name: goal.title })).not.toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText("Goal status"), "achieved");
        const reactivate = screen.getByRole("button", { name: "Reactivate" });
        expect(reactivate).toHaveClass("border-neutral-700");
        await user.click(reactivate);
        await user.selectOptions(screen.getByLabelText("Goal status"), "active");
        await user.click(screen.getByRole("button", { name: "Drop" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "dropped");
        expect(screen.getByRole("heading", { name: goal.title })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Reactivate" }));
        await user.selectOptions(screen.getByLabelText("Goal status"), "active");
        await waitFor(async () => expect((await data.loadGoals()).goals[0].lifecycle).toBe("active"));
        expect((await data.loadGoals()).checkIns).toEqual([checkIn]);
    });

    it("renders colored lifecycle pills for active, achieved, and dropped goals", async () => {
        const { data, tracker } = await oneTracker();
        const active = buildGoalFixture({ id: "goal-active", trackerId: tracker.id, title: "Active goal", sortOrder: 0 });
        const achieved = buildGoalFixture({ id: "goal-achieved", trackerId: tracker.id, title: "Achieved goal", sortOrder: 1, lifecycle: "achieved", achievedAt: "2026-10-12T12:00:00.000Z" });
        const dropped = buildGoalFixture({ id: "goal-dropped", trackerId: tracker.id, title: "Dropped goal", sortOrder: 2, lifecycle: "dropped", droppedAt: "2026-10-20T12:00:00.000Z" });
        await data.saveGoals([tracker], [active, achieved, dropped], []);
        const { user } = await mount(data);
        await user.selectOptions(screen.getByLabelText("Goal status"), "all");
        const pill = (title: string) => within(screen.getByLabelText(title)).getByText(/^(Active|Achieved|Dropped)$/);
        expect(pill("Active goal")).toHaveTextContent("Active");
        expect(pill("Active goal")).toHaveClass("text-sky-200");
        expect(pill("Achieved goal")).toHaveTextContent("Achieved");
        expect(pill("Achieved goal")).toHaveClass("text-emerald-200");
        expect(pill("Dropped goal")).toHaveTextContent("Dropped");
        expect(pill("Dropped goal")).toHaveClass("text-neutral-400");
    });

    it("reorders from the dnd-kit drop event while retaining hidden lifecycle rows and the complete set", async () => {
        const { data, tracker } = await oneTracker();
        const first = buildGoalFixture({ id: "a", trackerId: tracker.id, title: "First", sortOrder: 0 });
        const hidden = buildGoalFixture({ id: "b", trackerId: tracker.id, title: "Hidden", sortOrder: 1, lifecycle: "dropped" });
        const last = buildGoalFixture({ id: "c", trackerId: tracker.id, title: "Last", sortOrder: 2 });
        await data.saveGoals([tracker], [first, hidden, last], []);
        await mount(data);
        expect(screen.getByRole("button", { name: "Reorder First" })).toBeInTheDocument();
        await act(async () => { drag.goals!({ active: { id: first.id }, over: { id: last.id } } as DragEndEvent); });
        const list = screen.getByLabelText("Goals list");
        expect(within(list).getAllByRole("heading").map(row => row.textContent)).toEqual(["Last", "First"]);
        await waitFor(async () => expect((await data.loadGoals()).goals.find(row => row.id === last.id)?.sortOrder).toBe(0));
        const saved = (await data.loadGoals()).goals.sort((a, b) => a.sortOrder - b.sortOrder);
        expect(saved.map(row => row.id)).toEqual([last.id, hidden.id, first.id]);
    });

    it("reorders two active trackers from the keyboard and persists the new order", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const work = buildGoalTrackerFixture({ id: "tracker-work", name: "Work", sortOrder: 0 });
        const life = buildGoalTrackerFixture({ id: "tracker-life", name: "Life", sortOrder: 1 });
        await data.saveGoals([work, life], [], []);
        const { user } = await mount(data);
        expect(railOrder()).toEqual(["Work", "Life"]);
        // jsdom has no layout, so give each row a vertical rect; the keyboard
        // coordinate getter then has a row below the picked-up row to find.
        for (const [index, row] of within(screen.getByRole("navigation", { name: "Trackers" })).getAllByRole("listitem").entries()) {
            const top = index * 60;
            Object.defineProperty(row, "getBoundingClientRect", {
                configurable: true,
                value: () => ({ x: 0, y: top, top, left: 0, right: 200, bottom: top + 48, width: 200, height: 48, toJSON: () => ({}) }),
            });
        }
        const handle = screen.getByRole("button", { name: `Reorder ${work.name}` });
        act(() => handle.focus());
        await user.keyboard("[Space]");
        // dnd-kit attaches its movement listener on the next macrotask.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        await user.keyboard("{ArrowDown}");
        await user.keyboard("[Space]");

        expect(railOrder()).toEqual(["Life", "Work"]);
        await waitFor(async () => expect((await data.loadGoals()).trackers.sort((a, b) => a.sortOrder - b.sortOrder).map(row => row.id))
            .toEqual([life.id, work.id]));
        // Focus follows the moved row, and the content column keeps showing it.
        expect(handle).toHaveFocus();
        expect(screen.getByRole("heading", { level: 2, name: work.name })).toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!).selectedTrackerId).toBe(work.id);
    });

    it("keeps archived trackers in a trailing non-sortable group that accepts no drop", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const work = buildGoalTrackerFixture({ id: "tracker-work", name: "Work", sortOrder: 1 });
        const life = buildGoalTrackerFixture({ id: "tracker-life", name: "Life", sortOrder: 2 });
        const archived = buildArchivedTrackerFixture({ id: "tracker-archived", name: "Old work", sortOrder: 0 });
        await data.saveGoals([work, life, archived], [], []);
        const { user } = await mount(data);
        expect(railOrder()).toEqual(["Work", "Life"]);
        const nav = screen.getByRole("navigation", { name: "Trackers" });
        await user.click(within(nav).getByRole("checkbox", { name: "Show archived (1)" }));
        expect(railOrder()).toEqual(["Work", "Life", "Old work"]);
        expect(within(nav).getAllByRole("button", { name: /^Reorder / }).map(button => button.getAttribute("aria-label")))
            .toEqual([`Reorder ${work.name}`, `Reorder ${life.name}`]);
        expect(within(trackerRow(archived.name).closest("li")!).queryByRole("button", { name: /^Reorder / })).not.toBeInTheDocument();

        await act(async () => { drag.trackers!({ active: { id: life.id }, over: { id: archived.id } } as DragEndEvent); });
        await act(async () => { drag.trackers!({ active: { id: life.id }, over: null } as DragEndEvent); });
        expect(railOrder()).toEqual(["Work", "Life", "Old work"]);
        expect((await data.loadGoals()).trackers.map(row => [row.id, row.sortOrder]).sort())
            .toEqual([[work.id, 1], [life.id, 2], [archived.id, 0]].sort());
    });

    it("shows the due badge with the completed period label, and clears it when that period is built", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const due = buildGoalTrackerFixture({ id: "due", name: "Due", sortOrder: 0 });
        const built = buildGoalTrackerFixture({ id: "built", name: "Built", sortOrder: 1, lastBuiltPeriodStart: "2026-10-04" });
        await data.saveGoals([due, built], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const slot = () => container.querySelector('[data-goals-slot="tracker-due"]') as HTMLElement;
        expect(slot()).toHaveAttribute("data-tracker-id", due.id);
        expect(slot()).toHaveTextContent("Deck due · October 2026");
        // An equal build key permits a rebuild but no longer shows the badge.
        await user.click(trackerRow(built.name));
        expect(slot()).toHaveAttribute("data-tracker-id", built.id);
        expect(slot()).toBeEmptyDOMElement();
    });

    it("shows no due badge before the first boundary or for an archived tracker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const active = buildGoalTrackerFixture({ id: "active", name: "Active", sortOrder: 0 });
        const archived = buildArchivedTrackerFixture({ id: "archived", name: "Archived", sortOrder: 1 });
        await data.saveGoals([active, archived], [], []);
        const { user, container, unmount } = await mount(data, "2026-10-20");
        const slot = () => container.querySelector('[data-goals-slot="tracker-due"]') as HTMLElement;
        await user.click(screen.getByRole("checkbox", { name: "Show archived (1)" }));
        await user.click(trackerRow(archived.name));
        expect(slot()).toHaveAttribute("data-tracker-id", archived.id);
        expect(slot()).toBeEmptyDOMElement();

        unmount();
        const futureData = new InMemoryDataAccess(makeAppState());
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04" });
        await futureData.saveGoals([future], [], []);
        const futureView = await mount(futureData, "2026-10-20");
        const futureSlot = futureView.container.querySelector('[data-goals-slot="tracker-due"]') as HTMLElement;
        expect(futureSlot).toHaveAttribute("data-tracker-id", future.id);
        expect(futureSlot).toBeEmptyDOMElement();
    });

    it("shows the slip counter only after two consecutive slipping transitions", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const slipping = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Slipping", sortOrder: 0 });
        const clean = buildGoalFixture({ id: "goal-clean", trackerId: tracker.id, title: "Clean", sortOrder: 1 });
        await data.saveGoals(
            [tracker],
            [slipping, clean],
            [...buildCheckInHistoryFixture("goal-ship"), ...buildCleanCheckInHistoryFixture("goal-clean")],
        );
        await mount(data, "2026-11-02");
        expect(within(screen.getByLabelText("Slipping")).getByText("Slipped 2×")).toBeInTheDocument();
        expect(within(screen.getByLabelText("Clean")).queryByText(/Slipped/)).not.toBeInTheDocument();
    });

    it("shows no slip counter for a single slip or a clean history", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id });
        await data.saveGoals([tracker], [goal], [
            buildGoalCheckInFixture({ id: "one-1", goalId: goal.id, periodStart: "2026-10-18", planned: [{ text: "Ship the migration", dueDate: null }] }),
            buildGoalCheckInFixture({ id: "one-2", goalId: goal.id, periodStart: "2026-11-01", did: "Reviewed the spec" }),
        ]);
        const { container } = await mount(data, "2026-11-02");
        expect(container.querySelector('[data-goals-slot="goal-slip"]')).toBeEmptyDOMElement();
    });

    it("summarizes active, achieved, and slipped goals while dropping dropped goals from progress", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const active = buildGoalFixture({ id: "g-active", trackerId: tracker.id, title: "Active goal", sortOrder: 0 });
        const achieved = buildGoalFixture({
            id: "g-achieved", trackerId: tracker.id, title: "Achieved goal", sortOrder: 1,
            lifecycle: "achieved", achievedAt: "2026-10-12T12:00:00.000Z",
        });
        const dropped = buildGoalFixture({
            id: "g-dropped", trackerId: tracker.id, title: "Dropped goal", sortOrder: 2,
            lifecycle: "dropped", droppedAt: "2026-10-13T12:00:00.000Z",
        });
        await data.saveGoals([tracker], [active, achieved, dropped], []);
        const { container } = await mount(data, "2026-10-20");
        const health = container.querySelector('[data-goals-slot="tracker-health"]') as HTMLElement;
        expect(health).toHaveTextContent("1 active");
        expect(health).toHaveTextContent("1 achieved");
        expect(health).toHaveTextContent("0 slipped");
        expect(health).toHaveTextContent("1 of 2 achieved");
        expect(within(health).getByRole("progressbar", { name: "Goals achieved" })).toHaveAttribute("aria-valuenow", "50");
    });

    it("counts recorded goals for the open period and calms the entry once every goal is recorded", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const first = buildGoalFixture({ id: "g-first", trackerId: tracker.id, title: "First goal", sortOrder: 0 });
        const second = buildGoalFixture({ id: "g-second", trackerId: tracker.id, title: "Second goal", sortOrder: 1 });
        await data.saveGoals([tracker], [first, second], [
            buildGoalCheckInFixture({ id: "c-first", goalId: first.id, periodStart: "2026-10-18" }),
            buildGoalCheckInFixture({ id: "c-second", goalId: second.id, periodStart: "2026-10-18" }),
        ]);
        const { container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement;
        expect(entry).toHaveTextContent("2 of 2 goals recorded");
        const control = within(entry).getByRole("button", { name: "Check in · October 2026" });
        expect(control).toHaveAttribute("data-check-in-state", "complete");
        expect(control).toHaveClass("border-emerald-700/70");
        expect(control).not.toHaveClass("bg-indigo-600");
        expect(control).toHaveTextContent("Recorded");
    });

    it("shows partial check-in progress for the open period", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const first = buildGoalFixture({ id: "g-first", trackerId: tracker.id, title: "First goal", sortOrder: 0 });
        const second = buildGoalFixture({ id: "g-second", trackerId: tracker.id, title: "Second goal", sortOrder: 1 });
        await data.saveGoals([tracker], [first, second], [
            buildGoalCheckInFixture({ id: "c-first", goalId: first.id, periodStart: "2026-10-18" }),
        ]);
        const { container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement;
        expect(entry).toHaveTextContent("1 of 2 goals recorded");
        const control = within(entry).getByRole("button", { name: "Check in · October 2026" });
        expect(control).toHaveAttribute("data-check-in-state", "open");
        expect(control).toHaveClass("bg-indigo-600");
    });

    it("keeps the legacy no-open-period copy and disables the check-in control before the first boundary", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04" });
        await data.saveGoals([future], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement;
        expect(entry).toHaveAttribute("data-tracker-id", future.id);
        expect(entry).toHaveTextContent("No open period. First period starts on 2099-01-04.");
        expect(screen.getAllByText(/No open period. First period starts on/)).toHaveLength(1);
        const countdown = entry.querySelector("[data-goal-countdown-tone]") as HTMLElement;
        expect(countdown).toHaveAttribute("data-goal-countdown-tone", "green");
        expect(countdown).toHaveTextContent(/\d+ days/);
        const control = within(entry).getByRole("button", { name: "Period not open" });
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute("aria-disabled", "true");
        expect(control).toHaveClass("border-neutral-700");
        await user.click(control);
        expect(container.querySelector('[data-goals-slot="check-in-wizard"]')).toBeEmptyDOMElement();
    });

    it("colors the countdown by days remaining before the first period", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const soon = buildGoalTrackerFixture({ cadenceAnchorAt: "2026-10-25" });
        await data.saveGoals([soon], [], []);
        const { container } = await mount(data, "2026-10-20");
        const countdown = container.querySelector("[data-goal-countdown-tone]") as HTMLElement;
        expect(countdown).toHaveAttribute("data-goal-countdown-tone", "yellow");
        expect(countdown).toHaveTextContent("5 days");
    });

    it("opens the wizard pinned to the current grid period and removes it on close", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 9, 20, 12));
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement;
        expect(entry).toHaveAttribute("data-tracker-id", tracker.id);
        expect(entry).toHaveTextContent(`First period started on ${tracker.cadenceAnchorAt}.`);
        const openEntry = within(entry).getByRole("button", { name: "Check in · October 2026" });
        expect(openEntry).toHaveClass("bg-indigo-600");
        expect(openEntry).toHaveClass("ring-indigo-400/40");
        expect(openEntry).toHaveTextContent("Period open");
        await user.click(openEntry);

        const slot = container.querySelector('[data-goals-slot="check-in-wizard"]') as HTMLElement;
        // The wizard stays inline inside the page's only scroller, so a long
        // check-in scrolls with the page instead of being clipped below it.
        expect(container.querySelector("main")?.contains(slot)).toBe(true);
        expect(within(slot).getByRole("form", { name: "Check-in wizard" })).not.toHaveClass("fixed");
        expect(within(slot).getByRole("heading", { name: "Check in · October 2026" })).toBeInTheDocument();
        expect(within(slot).getByLabelText("Check-in period")).toHaveValue("2026-10-18");
        expect(within(slot).getByLabelText(`Did for ${goal.title}`)).toBeInTheDocument();

        await user.click(within(slot).getByRole("button", { name: "Close check-in wizard" }));
        expect(slot).toBeEmptyDOMElement();
    });

    it("builds the most recent completed deck into the preview slot and clears it on close", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        const goal = buildGoalFixture({ trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        expect(entry).toHaveAttribute("data-tracker-id", tracker.id);
        const build = within(entry).getByRole("button", { name: "Build deck" });
        expect(build).toBeEnabled();
        await user.click(build);
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
        // The completed period is the one that started 2026-10-04, not the 2026-10-18 period in progress.
        expect(within(preview).getAllByText(/Oct 4/).length).toBeGreaterThan(0);
        expect(within(preview).getAllByLabelText("Slide title")[0]).toHaveValue(tracker.name);
        await user.click(within(preview).getByRole("button", { name: "Close preview" }));
        expect(preview).toBeEmptyDOMElement();
    });

    it("passes the PM project registry into the built deck", async () => {
        const work = project({ id: "project-work", name: "Deep Work" });
        const ops = project({ id: "project-ops", name: "Ops", sortOrder: 1 });
        pmProjects.override = { [work.id]: work, [ops.id]: ops };
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ projectId: work.id });
        const goals = [
            buildGoalFixture({ id: "goal-inherit", trackerId: tracker.id, title: "Inherits", sortOrder: 0 }),
            buildGoalFixture({
                id: "goal-ops",
                trackerId: tracker.id,
                title: "Ops goal",
                sortOrder: 1,
                projectLink: { mode: "project", projectId: ops.id },
            }),
        ];
        await data.saveGoals([tracker], goals, []);
        const { user, container } = await mount(data, "2026-10-20");

        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        await user.click(within(entry).getByRole("button", { name: "Build deck" }));

        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        const title = within(preview).getByRole("article", { name: `Slide: ${tracker.name}` });
        expect(within(title).getByText("Deep Work")).toBeInTheDocument();
        expect(within(title).getByText("+1 goal in other projects")).toBeInTheDocument();
        expect(within(within(preview).getByRole("article", { name: "Slide: Ops goal" })).getByText("Ops"))
            .toBeInTheDocument();
        expect(within(within(preview).getByRole("article", { name: "Slide: Inherits" })).queryByText("Ops"))
            .not.toBeInTheDocument();
    });

    it("waits for habit hydration before enabling a linked tracker's deck", async () => {
        const { data, tracker } = await oneTracker();
        const plainTracker = buildGoalTrackerFixture({ id: "plain-tracker", name: "Plain tracker", sortOrder: 1 });
        const goal = buildGoalFixture({ trackerId: tracker.id, metric: habitMetric() });
        await data.saveGoals([tracker, plainTracker], [goal], []);
        await data.saveHabits([habit("habit-read")], []);
        const loadedHabits = await data.loadHabits();
        let finishLoading!: (value: typeof loadedHabits) => void;
        const load = vi.spyOn(data, "loadHabits").mockReturnValue(new Promise(resolve => { finishLoading = resolve; }));
        try {
            const { user, container } = await mount(data, "2026-10-20");
            const entry = () => container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
            expect(load).toHaveBeenCalled();
            expect(within(entry()).getByRole("button", { name: "Deck not ready" })).toBeDisabled();
            expect(entry()).toHaveTextContent("Habits are still loading. Try again when they finish.");
            expect(within(entry()).queryByRole("button", { name: "Build deck" })).not.toBeInTheDocument();
            expect(container.querySelector('[data-goals-slot="deck-preview"]')).toBeEmptyDOMElement();

            await user.click(trackerRow(plainTracker.name));
            expect(within(entry()).getByRole("button", { name: "Build deck" })).toBeEnabled();
            await user.click(trackerRow(tracker.name));
            expect(within(entry()).getByRole("button", { name: "Deck not ready" })).toBeDisabled();

            await act(async () => { finishLoading(loadedHabits); });
            expect(await within(entry()).findByRole("button", { name: "Build deck" })).toBeEnabled();
            expect(within(entry()).queryByText("Habits are still loading. Try again when they finish.")).not.toBeInTheDocument();
        } finally {
            load.mockRestore();
        }
    });

    it("builds the deck preview from habit completions instead of the stored metric current", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 9, 20, 12));
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({
            trackerId: tracker.id, title: "Practice goal",
            metric: habitMetric({ label: "Practice", current: 9999, target: 3, unit: "sessions" }),
        });
        const checkIn = buildGoalCheckInFixture({ goalId: goal.id, periodStart: "2026-10-04", did: "Practiced twice", isFocus: true });
        await data.saveGoals([tracker], [goal], [checkIn]);
        await data.saveHabits([habit("habit-read")], ["2026-10-05", "2026-10-06"].map(bucket => ({
            id: `habit-read:${bucket}`, habitId: "habit-read", bucket,
            createdAt: `${bucket}T12:00:00.000Z`, updatedAt: `${bucket}T12:00:00.000Z`,
        })));
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(await screen.findByRole("button", { name: "Build deck" }));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
        expect(within(preview).getAllByText("Practice: 2 / 3 sessions · short by 1").length).toBeGreaterThan(0);
        expect(preview).not.toHaveTextContent("9999");
        for (const field of within(preview).getAllByRole("textbox")) expect(field).not.toHaveValue(expect.stringContaining("9999"));
        expect((await data.loadGoals()).goals[0].metric?.current).toBe(9999);
    });

    it("shows the built cue for the completed period and still allows a same-period rebuild", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ lastBuiltPeriodStart: "2026-10-04" });
        await data.saveGoals([tracker], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        expect(within(entry).getByText("Built")).toBeInTheDocument();
        const rebuild = within(entry).getByRole("button", { name: "Rebuild deck" });
        expect(rebuild).toBeEnabled();
        await user.click(rebuild);
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
    });

    it("disables the deck entry without a completed period and for an archived tracker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const inProgress = buildGoalTrackerFixture({ id: "in-progress", name: "In progress", cadenceAnchorAt: "2026-10-18", sortOrder: 0 });
        const future = buildGoalTrackerFixture({ id: "future", name: "Future", cadenceAnchorAt: "2099-01-04", sortOrder: 1 });
        const archived = buildArchivedTrackerFixture({ id: "archived", name: "Archived", sortOrder: 2 });
        await data.saveGoals([inProgress, future, archived], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = () => container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        const preview = () => container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;

        expect(entry()).toHaveAttribute("data-tracker-id", inProgress.id);
        expect(entry()).toHaveTextContent("No completed period yet. Build the deck after the October 2026 period completes.");
        const disabled = within(entry()).getByRole("button", { name: "Deck not ready" });
        expect(disabled).toBeDisabled();
        expect(disabled).toHaveAttribute("aria-disabled", "true");
        await user.click(disabled);
        expect(preview()).toBeEmptyDOMElement();
        expect(screen.queryByRole("button", { name: /build deck|rebuild deck/i })).not.toBeInTheDocument();

        await user.click(trackerRow(future.name));
        expect(entry()).toHaveAttribute("data-tracker-id", future.id);
        expect(entry()).toHaveTextContent("it starts on 2099-01-04");
        expect(within(entry()).getByRole("button", { name: "Deck not ready" })).toBeDisabled();
        expect(preview()).toBeEmptyDOMElement();

        await user.click(screen.getByRole("checkbox", { name: "Show archived (1)" }));
        await user.click(trackerRow(archived.name));
        // Archived trackers collapse the period spine entirely.
        expect(entry()).toBeNull();
        expect(container.querySelector('[data-goals-slot="check-in-entry"]')).toBeNull();
        expect(screen.getByText("This tracker is archived. Its goals and history are kept.")).toBeInTheDocument();
        expect(preview()).toBeEmptyDOMElement();
    });

    it("keeps the preview open and writes no export artifacts to localStorage", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture();
        await data.saveGoals([tracker], [], []);
        const { user, container } = await mount(data, "2026-10-20");
        const entry = container.querySelector('[data-goals-slot="deck-entry"]') as HTMLElement;
        await user.click(within(entry).getByRole("button", { name: "Build deck" }));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        const heading = within(preview).getByRole("heading", { name: `${tracker.name} deck preview` });
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
        expect(within(preview).getByRole("heading", { name: heading.textContent! })).toBeInTheDocument();
        expect(within(preview).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("awaits render, delivery, then stamp with the edited plan's completed period key", async () => {
        const { data, tracker } = await oneTracker();
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        const title = within(preview).getAllByLabelText("Slide title")[0];
        fireEvent.change(title, { target: { value: "Edited export title" } });
        const notes = within(preview).getAllByLabelText("Speaker notes")[0];
        fireEvent.change(notes, { target: { value: "Edited export notes" } });
        let finishRender!: (value: { blob: Blob; fileName: string }) => void;
        let finishDelivery!: () => void;
        deckExport.render.mockReturnValue(new Promise(resolve => { finishRender = resolve; }));
        deckExport.deliver.mockReturnValue(new Promise<void>(resolve => { finishDelivery = resolve; }));
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(deckExport.render).toHaveBeenCalledTimes(1));
        const edited = deckExport.render.mock.calls[0][0] as DeckPlan;
        expect(edited.slides[0].title).toBe("Edited export title");
        expect(edited.slides[0].notes).toBe("Edited export notes");
        expect(edited.period.periodStart).toBe("2026-10-04");
        expect(deckExport.deliver).not.toHaveBeenCalled();
        expect(deckExport.stamp).not.toHaveBeenCalled();
        const blob = new Blob(["edited deck"]);
        await act(async () => { finishRender({ blob, fileName: "edited.pptx" }); });
        expect(deckExport.deliver).toHaveBeenCalledExactlyOnceWith(blob, "edited.pptx");
        expect(deckExport.stamp).not.toHaveBeenCalled();
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        await act(async () => { finishDelivery(); });
        await waitFor(() => expect(deckExport.stamp).toHaveBeenCalledExactlyOnceWith(edited.trackerId, edited.period.periodStart));
        await waitFor(async () => expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBe("2026-10-04"));
        expect(deckExport.render.mock.invocationCallOrder[0]).toBeLessThan(deckExport.deliver.mock.invocationCallOrder[0]);
        expect(deckExport.deliver.mock.invocationCallOrder[0]).toBeLessThan(deckExport.stamp.mock.invocationCallOrder[0]);
        expect(within(preview).getByRole("heading", { name: `${tracker.name} deck preview` })).toBeInTheDocument();
        expect(title).toHaveValue("Edited export title");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each(["render", "deliver"])("surfaces a %s rejection in the page and preview without stamping", async stage => {
        const { data } = await oneTracker();
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        deckExport[stage as "render" | "deliver"].mockRejectedValueOnce(new Error(`${stage} failed`));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
        for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent(`${stage} failed`);
        expect(deckExport.stamp).not.toHaveBeenCalled();
        if (stage === "render") expect(deckExport.deliver).not.toHaveBeenCalled();
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        expect(within(preview).getByRole("button", { name: "Export deck" })).toBeEnabled();
    });

    it("rejects and shows both alerts when the awaited stamp write fails after initiation", async () => {
        const { data } = await oneTracker();
        const { user, container } = await mount(data, "2026-10-20");
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        const save = vi.spyOn(data, "saveGoals").mockRejectedValueOnce(new Error("Stamp storage failed"));
        const preview = container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;
        await user.click(within(preview).getByRole("button", { name: "Export deck" }));
        await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
        for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent("Stamp storage failed");
        expect(deckExport.deliver).toHaveBeenCalledTimes(1);
        expect(deckExport.stamp).toHaveBeenCalledExactlyOnceWith("tracker-work", "2026-10-04");
        expect(save).toHaveBeenCalledTimes(1);
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        expect(screen.queryByText("Built")).not.toBeInTheDocument();
        expect(within(preview).getByRole("button", { name: "Export deck" })).toBeEnabled();
        save.mockRestore();
    });

    it("saves inherit, none, and an explicit project from the goal project link control", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ id: "goal-linked", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState(pmState([project()]));
        const { user } = await mount(data, "2026-10-20");

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getByRole("radio", { name: "Use tracker project" })).toBeChecked();
        expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: "Specific project" }));
        const select = await screen.findByLabelText("Project");
        expect(select).toHaveValue("project-1");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].projectLink).toEqual({ mode: "project", projectId: "project-1" }));
        expect(within(screen.getByLabelText(goal.title)).getByText("Deep Work")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(await screen.findByLabelText("Project")).toHaveValue("project-1");
        await user.click(screen.getByRole("radio", { name: "No project" }));
        expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].projectLink).toEqual({ mode: "none" }));
        expect(screen.queryByText("Deep Work")).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        await user.click(await screen.findByRole("radio", { name: "Use tracker project" }));
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0].projectLink).toEqual({ mode: "inherit" }));
        expect(screen.queryByText("Deep Work")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps a dangling explicit project when an unrelated field is edited", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ id: "goal-broken", trackerId: tracker.id, title: "Broken link", projectLink: { mode: "project", projectId: "project-gone" } });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState(pmState([project()]));
        const { user } = await mount(data, "2026-10-20");

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getByRole("radio", { name: "Specific project" })).toBeChecked();
        const select = screen.getByLabelText("Project");
        expect(select).toHaveValue("project-gone");
        expect(within(select).getByRole("option", { name: "Linked project is missing" })).toBeInTheDocument();
        await user.clear(screen.getByLabelText("Name"));
        await user.type(screen.getByLabelText("Name"), "Still broken");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0]).toMatchObject({
            title: "Still broken", projectLink: { mode: "project", projectId: "project-gone" },
        }));
        expect(within(screen.getByLabelText("Still broken")).getByText("Linked project is missing")).toBeInTheDocument();
    });

    it("preserves an explicit none link when editing a goal's title", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ trackerId: tracker.id, projectLink: { mode: "none" } });
        await data.saveGoals([{ ...tracker, projectId: "project-1" }], [goal], []);
        const { user } = await mount(data);

        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        const title = screen.getByLabelText("Name");
        await user.clear(title);
        await user.type(title, "Revised goal");
        await user.click(screen.getByRole("button", { name: "Save goal" }));
        await waitFor(async () => expect((await data.loadGoals()).goals[0]).toMatchObject({
            title: "Revised goal", projectLink: { mode: "none" },
        }));
    });

    it("shows a quiet missing-project note instead of an error on a broken goal link", async () => {
        const { data, tracker } = await oneTracker();
        const goal = buildGoalFixture({ id: "goal-broken", trackerId: tracker.id, title: "Broken link", projectLink: { mode: "project", projectId: "project-gone" } });
        await data.saveGoals([tracker], [goal], []);
        await data.savePMState({
            projects: { "project-1": project() },
            tasks: {},
            meta: { initializedAt: "2026-10-01T00:00:00.000Z" },
        });
        await mount(data, "2026-10-20");

        const row = screen.getByLabelText(goal.title);
        expect(within(row).getByText("Linked project is missing")).toBeInTheDocument();
        expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("mounts goal-set export and import actions in the selected tracker's slot", async () => {
        const { data, tracker } = await oneTracker();
        const { container } = await mount(data);
        const slot = container.querySelector('[data-goals-slot="goal-set-actions"]') as HTMLElement;
        expect(slot).toHaveAttribute("data-tracker-id", tracker.id);
        expect(within(slot).getByRole("button", { name: "Export tracker" })).toBeDisabled();
        expect(within(slot).getByText("Add a goal before exporting this tracker.")).toBeInTheDocument();
        expect(within(slot).getByLabelText("Import tracker")).toHaveAttribute("type", "file");
        expect(container.querySelectorAll('[data-goals-slot="goal-set-actions"]')).toHaveLength(1);
    });

    it("moves the goal-set actions to the newly selected tracker", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = buildGoalTrackerFixture({ id: "tracker-alpha", name: "Alpha", sortOrder: 0 });
        const second = buildGoalTrackerFixture({ id: "tracker-beta", name: "Beta", sortOrder: 1 });
        await data.saveGoals([first, second], [], []);
        const { user, container } = await mount(data);
        const slot = () => container.querySelector('[data-goals-slot="goal-set-actions"]') as HTMLElement;
        expect(slot()).toHaveAttribute("data-tracker-id", first.id);
        await user.click(trackerRow(second.name));
        expect(slot()).toHaveAttribute("data-tracker-id", second.id);
        expect(within(slot()).getByRole("button", { name: "Export tracker" })).toBeDisabled();
        expect(within(slot()).getByText("Add a goal before exporting this tracker.")).toBeInTheDocument();
        expect(within(slot()).getByLabelText("Import tracker")).toBeInTheDocument();
        expect(container.querySelectorAll('[data-goals-slot="goal-set-actions"]')).toHaveLength(1);
    });

    it("selects an imported tracker and clears the deck preview, pinned check-in, and goal edit", async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 25, 12) });
        const data = new InMemoryDataAccess(makeAppState());
        const tracker = buildGoalTrackerFixture({ cadenceAnchorAt: "2026-10-04" });
        const goal = buildGoalFixture({ id: "goal-ship", trackerId: tracker.id, title: "Ship the release" });
        await data.saveGoals([tracker], [goal], []);
        const { user, container } = await mount(data);
        const slot = () => container.querySelector('[data-goals-slot="goal-set-actions"]') as HTMLElement;
        const wizard = () => container.querySelector('[data-goals-slot="check-in-wizard"]') as HTMLElement;
        const preview = () => container.querySelector('[data-goals-slot="deck-preview"]') as HTMLElement;

        // Put the page in the state import must clear.
        await user.click(within(container.querySelector('[data-goals-slot="check-in-entry"]') as HTMLElement)
            .getByRole("button", { name: "Check in · October 2026" }));
        expect(wizard()).not.toBeEmptyDOMElement();
        await user.click(screen.getByRole("button", { name: "Build deck" }));
        expect(preview()).not.toBeEmptyDOMElement();
        await user.click(screen.getByRole("button", { name: "Edit goal" }));
        expect(screen.getByRole("form", { name: "Edit goal" })).toBeInTheDocument();

        // Drive the real Lane B component through a validated file and confirm.
        await user.upload(
            within(slot()).getByLabelText("Import tracker"),
            new File([serializeGoalSet(tracker, [goal], {})], "goals-work-2026-10-20.json", { type: "application/json" }),
        );
        const review = await within(slot()).findByRole("region", { name: "Import review" });
        expect(within(review).getByText("Ship the release")).toBeInTheDocument();
        await user.click(within(review).getByRole("button", { name: "Create tracker" }));

        await waitFor(() => expect(slot().getAttribute("data-tracker-id")).not.toBe(tracker.id));
        const created = (await data.loadGoals()).trackers.find(row => row.id !== tracker.id)!;
        expect(created).toBeDefined();
        expect(created.cadenceAnchorAt).toBe("2026-10-25");
        expect(screen.getByText(/First period started on/)).toHaveTextContent("2026-10-25");
        expect(slot()).toHaveAttribute("data-tracker-id", created.id);
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!).selectedTrackerId).toBe(created.id);
        expect(screen.getByRole("navigation", { name: "Trackers" }).querySelector("[aria-current=true]")).toHaveTextContent(created.name);
        expect(wizard()).toBeEmptyDOMElement();
        expect(preview()).toBeEmptyDOMElement();
        expect(screen.queryByRole("form", { name: "Edit goal" })).not.toBeInTheDocument();

        // Import stays additive: the source tracker and goal are untouched.
        await waitFor(async () => expect((await data.loadGoals()).goals).toHaveLength(2));
        const saved = await data.loadGoals();
        expect(saved.trackers).toHaveLength(2);
        expect(saved.goals.find(row => row.id === goal.id)).toMatchObject({
            id: goal.id,
            trackerId: tracker.id,
            title: goal.title,
            lifecycle: goal.lifecycle,
        });
    });

    it("leaves the goal-set actions slot absent in the empty state", async () => {
        const { container } = await mount();
        expect(screen.getByRole("heading", { name: "Start your first tracker" })).toBeInTheDocument();
        expect(container.querySelector('[data-goals-slot="goal-set-actions"]')).toBeNull();
        expect(screen.queryByRole("button", { name: "Export tracker" })).not.toBeInTheDocument();
    });
});
