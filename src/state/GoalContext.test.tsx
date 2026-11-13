import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { GOAL_UI_STORAGE_KEY, GoalProvider, useGoals, type GoalContextValue } from "./GoalContext";
import { DataProvider } from "./DataContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import { buildGoalTrackerFixture, buildArchivedTrackerFixture, buildGoalFixture, buildGoalCheckInFixture, buildGoalFixtureSet, buildNaturalKeyDuplicatesFixture } from "../lib/goals/testFixtures";
import type { Goal, GoalCheckIn, GoalTracker } from "./types";
import { resolveCadenceAnchorAt } from "../lib/goals/periods";
import { localDateKey } from "../lib/todos/calendar";
import type { LocalDateKey } from "../lib/todos/types";
import type { SyncOptions, SyncResult } from "../lib/data/DataAccess";

let api: GoalContextValue;
function Probe() { api = useGoals(); return null; }
function tree(data: InMemoryDataAccess) {
    return <TauriCloseProvider><DataProvider dataAccess={data}><SyncProvider ownerId="goals-owner"><GoalProvider><Probe /></GoalProvider></SyncProvider></DataProvider></TauriCloseProvider>;
}
async function mount(data = new InMemoryDataAccess(makeAppState())) {
    const view = render(tree(data));
    await waitFor(() => expect(api.hydrated).toBe(true));
    await act(async () => {});
    return { data, ...view };
}
async function seeded(data = new InMemoryDataAccess(makeAppState())) {
    const set = buildGoalFixtureSet();
    await data.saveGoals([set.tracker], set.goals, set.checkIns);
    return { data, set };
}
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
type Payload = { trackers: GoalTracker[]; goals: Goal[]; checkIns: GoalCheckIn[] };
class ControlledData extends InMemoryDataAccess {
    writes: Payload[] = [];
    active = 0;
    maxActive = 0;
    hold: { gate: ReturnType<typeof deferred>; started: ReturnType<typeof deferred>; afterWrite: boolean } | null = null;
    pauseNext(afterWrite = false) {
        const hold = { gate: deferred(), started: deferred(), afterWrite };
        this.hold = hold;
        return hold;
    }
    async stage(payload: Payload) { await super.saveGoals(payload.trackers, payload.goals, payload.checkIns); }
    override async saveGoals(trackers: GoalTracker[], goals: Goal[], checkIns: GoalCheckIn[]) {
        const hold = this.hold;
        this.hold = null;
        this.writes.push(structuredClone({ trackers, goals, checkIns }));
        this.maxActive = Math.max(this.maxActive, ++this.active);
        try {
            if (hold?.afterWrite) await super.saveGoals(trackers, goals, checkIns);
            hold?.started.resolve();
            if (hold) await hold.gate.promise;
            if (!hold?.afterWrite) await super.saveGoals(trackers, goals, checkIns);
        } finally { this.active--; }
    }
}

beforeEach(() => { localStorage.clear(); });

describe("GoalContext", () => {
    it("does not seed or save a slice before sync initialization", async () => {
        class UninitializedData extends InMemoryDataAccess {
            override isInitialized() { return false; }
            override async sync(options: SyncOptions): Promise<SyncResult> { return { ...await super.sync(options), initialized: false }; }
        }
        const data = new UninitializedData(makeAppState());
        const save = vi.spyOn(data, "saveGoals");
        await mount(data);
        expect(api.state.trackers).toEqual({});
        await act(async () => { await expect(api.persist()).rejects.toThrow("Goals are not initialized"); });
        expect(save).not.toHaveBeenCalled();
    });

    it("guards the hook outside its provider", () => {
        expect(() => render(<Probe />)).toThrow("useGoals must be inside GoalProvider");
    });

    it("hydrates the complete staged set without an echo save and keeps only validated UI fields", async () => {
        const { data, set } = await seeded();
        const save = vi.spyOn(data, "saveGoals");
        localStorage.setItem(GOAL_UI_STORAGE_KEY, JSON.stringify({ selectedTrackerId: set.tracker.id, expandedGoalIds: { good: true, bad: "yes", collapsed: false }, goals: { fake: {} } }));
        await mount(data);
        expect(Object.values(api.state.trackers)).toEqual([set.tracker]);
        expect(Object.values(api.state.goals)).toEqual(set.goals);
        expect(Object.values(api.state.checkIns)).toEqual(set.checkIns);
        expect(api.state.ui).toEqual({ selectedTrackerId: set.tracker.id, expandedGoalIds: { good: true, collapsed: false } });
        expect(JSON.parse(localStorage.getItem(GOAL_UI_STORAGE_KEY)!)).toEqual(api.state.ui);
        expect(save).not.toHaveBeenCalled();
    });

    it("persists domain edits across remounts and UI changes never call saveGoals", async () => {
        const { data, unmount } = await mount();
        let tracker!: GoalTracker;
        let goal!: Goal;
        await act(async () => {
            tracker = api.createTracker({ name: "Work", purpose: "Ship", cadence: { kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 }, color: "#123456" });
            goal = api.createGoal({ trackerId: tracker.id, title: "Launch" });
            await api.persist();
        });
        const save = vi.spyOn(data, "saveGoals");
        await act(async () => { api.selectTracker(tracker.id); api.setGoalExpanded(goal.id, true); });
        expect(save).not.toHaveBeenCalled();
        unmount();
        await mount(data);
        expect(api.state.goals[goal.id].title).toBe("Launch");
        expect(api.state.ui).toEqual({ selectedTrackerId: tracker.id, expandedGoalIds: { [goal.id]: true } });
        expect(JSON.stringify((await data.loadGoals()))).not.toContain("expandedGoalIds");
        expect(data.syncCalls.filter(call => call.reason === "bridge")).toHaveLength(0);
    });

    it("resolves creation and reset anchors, rejects arbitrary anchors and runtime stamp patches, and preserves history", async () => {
        const { data, set } = await seeded();
        await mount(data);
        const date = localDateKey(new Date()) as LocalDateKey;
        const cadence = { kind: "monthly-weekday", weekday: 5 } as const;
        await act(async () => {
            const created = api.createTracker({ name: "Life", purpose: "", cadence, color: "" });
            expect(created.cadenceAnchorAt).toBe(resolveCadenceAnchorAt(cadence, date));
            expect(created.sortOrder).toBe(set.tracker.sortOrder + 1);
            expect(() => api.createTracker({ name: "Bad", purpose: "", color: "", cadence, cadenceAnchorAt: "2020-01-01" })).toThrow(RangeError);
            expect(() => api.updateTracker(set.tracker.id, { cadenceAnchorAt: "2020-01-01" })).toThrow(RangeError);
            expect(() => api.updateTracker(set.tracker.id, { lastBuiltPeriodStart: "2026-11-01" } as never)).toThrow("Use stampBuiltPeriod");
            await api.stampBuiltPeriod(set.tracker.id, "2026-11-01");
            api.updateTracker(set.tracker.id, { cadence });
            await api.persist();
        });
        expect(api.state.trackers[set.tracker.id].cadenceAnchorAt).toBe(resolveCadenceAnchorAt(cadence, date));
        expect(api.state.trackers[set.tracker.id].lastBuiltPeriodStart).toBe("2026-11-01");
        expect(Object.values(api.state.checkIns)).toEqual(expect.arrayContaining(set.checkIns));
    });

    it("saves archived trackers, all lifecycle states, omitted reorder rows, and unchanged history in every payload", async () => {
        const { data, set } = await seeded();
        const archived = buildGoalTrackerFixture({ id: "archived", isArchived: true });
        const other = buildGoalFixture({ id: "other", trackerId: archived.id, lifecycle: "dropped" });
        await data.saveGoals([set.tracker, archived], [...set.goals, other], set.checkIns);
        await mount(data);
        const save = vi.spyOn(data, "saveGoals");
        const first = set.goals[0];
        await act(async () => {
            api.archiveTracker(set.tracker.id);
            api.setGoalLifecycle(first.id, "achieved");
            api.reorderGoals(set.tracker.id, [first.id]);
            await api.persist();
        });
        for (const [trackers, goals, checkIns] of save.mock.calls) {
            expect(trackers.map(row => row.id).sort()).toEqual([set.tracker.id, archived.id].sort());
            expect(goals.map(row => row.id).sort()).toEqual([...set.goals.map(row => row.id), other.id].sort());
            expect(checkIns).toEqual([...set.checkIns].sort((a, b) => a.id.localeCompare(b.id)));
        }
        expect(api.state.goals[first.id].achievedAt).not.toBeNull();
        await act(async () => { api.setGoalLifecycle(first.id, "dropped"); await api.persist(); });
        expect(api.state.goals[first.id].achievedAt).toBeNull();
        expect(api.state.goals[first.id].droppedAt).not.toBeNull();
        await act(async () => { api.archiveTracker(set.tracker.id, false); api.setGoalLifecycle(first.id, "active"); await api.persist(); });
        expect(api.state.goals[first.id]).toMatchObject({ lifecycle: "active", achievedAt: null, droppedAt: null });
        expect(Object.values(api.state.checkIns)).toHaveLength(set.checkIns.length);
    });

    it("reorders trackers with dense indices, a deduped input, and a fresh updatedAt", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = buildGoalTrackerFixture({ id: "tracker-first", name: "First", sortOrder: 0 });
        const second = buildGoalTrackerFixture({ id: "tracker-second", name: "Second", sortOrder: 1 });
        const third = buildGoalTrackerFixture({ id: "tracker-third", name: "Third", sortOrder: 2 });
        await data.saveGoals([first, second, third], [], []);
        await mount(data);
        const save = vi.spyOn(data, "saveGoals");
        await act(async () => {
            api.reorderTrackers([third.id, third.id, first.id]);
            await api.persist();
        });
        expect(Object.values(api.state.trackers).sort((a, b) => a.sortOrder - b.sortOrder).map(row => [row.id, row.sortOrder]))
            .toEqual([[third.id, 0], [first.id, 1], [second.id, 2]]);
        for (const original of [third, first]) {
            const row = api.state.trackers[original.id];
            expect(row.updatedAt).not.toBe(original.updatedAt);
            expect(Date.parse(row.updatedAt)).toBeGreaterThan(Date.parse(original.updatedAt));
            expect(row.createdAt).toBe(original.createdAt);
        }
        expect(save.mock.calls.length).toBeGreaterThan(0);
        for (const [trackers] of save.mock.calls) {
            expect(trackers.map(row => row.id).sort()).toEqual([first.id, second.id, third.id].sort());
            expect(trackers.map(row => row.sortOrder).sort()).toEqual([0, 1, 2]);
        }
    });

    it("rejects an unknown tracker id without changing the order", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = buildGoalTrackerFixture({ id: "tracker-first", name: "First", sortOrder: 0 });
        const second = buildGoalTrackerFixture({ id: "tracker-second", name: "Second", sortOrder: 1 });
        await data.saveGoals([first, second], [], []);
        await mount(data);
        const save = vi.spyOn(data, "saveGoals");
        expect(() => api.reorderTrackers([second.id, "missing"])).toThrow(RangeError);
        expect(() => api.reorderTrackers([second.id, "missing"])).toThrow("Invalid tracker order");
        expect(api.state.trackers[first.id].sortOrder).toBe(0);
        expect(api.state.trackers[second.id].sortOrder).toBe(1);
        expect(save).not.toHaveBeenCalled();
    });

    it("appends omitted trackers including archived rows in their current relative order", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const first = buildGoalTrackerFixture({ id: "tracker-first", name: "First", sortOrder: 0 });
        const second = buildGoalTrackerFixture({ id: "tracker-second", name: "Second", sortOrder: 1 });
        const earlierArchive = buildArchivedTrackerFixture({ id: "tracker-archive-earlier", name: "Archived earlier", sortOrder: 3 });
        const laterArchive = buildArchivedTrackerFixture({ id: "tracker-archive-later", name: "Archived later", sortOrder: 5 });
        await data.saveGoals([laterArchive, second, earlierArchive, first], [], []);
        await mount(data);
        const save = vi.spyOn(data, "saveGoals");
        await act(async () => {
            api.reorderTrackers([second.id, first.id]);
            await api.persist();
        });
        const orderedRows = Object.values(api.state.trackers).sort((a, b) => a.sortOrder - b.sortOrder);
        expect(orderedRows.map(row => [row.id, row.sortOrder])).toEqual([
            [second.id, 0], [first.id, 1], [earlierArchive.id, 2], [laterArchive.id, 3],
        ]);
        expect(new Set(orderedRows.map(row => row.sortOrder)).size).toBe(4);
        expect(save.mock.calls.length).toBeGreaterThan(0);
        for (const [trackers] of save.mock.calls) {
            expect(trackers.map(row => row.id).sort()).toEqual([first.id, second.id, earlierArchive.id, laterArchive.id].sort());
            expect(trackers.map(row => row.sortOrder).sort()).toEqual([0, 1, 2, 3]);
        }
    });

    it("upserts by natural key using the latest staged ID while retaining every other check-in", async () => {
        const { data, set } = await seeded();
        await mount(data);
        const [local, server] = buildNaturalKeyDuplicatesFixture(set.goals[0].id);
        const stored = await data.loadGoals();
        const rest = stored.checkIns.filter(row => row.goalId !== server.goalId || row.periodStart !== server.periodStart);
        await act(async () => {
            await data.saveGoals(stored.trackers, stored.goals, [...rest, server]);
            await api.saveCheckIns([{ ...local, did: "Edited offline" }]);
        });
        const saved = await data.loadGoals();
        expect(saved.checkIns.filter(row => row.goalId === server.goalId && row.periodStart === server.periodStart)).toEqual([{ ...local, id: server.id, did: "Edited offline" }]);
        expect(saved.checkIns).toHaveLength(rest.length + 1);
    });

    it("serializes effect, awaited check-in, and stamp saves; replays edits made in flight", async () => {
        const data = new ControlledData(makeAppState());
        const { set } = await seeded(data);
        await mount(data);
        data.writes = [];
        const hold = data.pauseNext();
        act(() => api.updateGoal(set.goals[0].id, { notes: "First edit" }));
        await hold.started.promise;
        let checked!: Promise<void>;
        let stamped!: Promise<void>;
        act(() => {
            api.updateGoal(set.goals[0].id, { notes: "Later edit" });
            checked = api.saveCheckIns([buildGoalCheckInFixture({ id: "later", goalId: set.goals[0].id, periodStart: "2026-11-15", did: "Done" })]);
            stamped = api.stampBuiltPeriod(set.tracker.id, "2026-11-01");
        });
        expect(data.writes).toHaveLength(1);
        expect(api.state.trackers[set.tracker.id].lastBuiltPeriodStart).toBeNull();
        await act(async () => { hold.gate.resolve(); await Promise.all([checked, stamped]); });
        expect(data.maxActive).toBe(1);
        const saved = await data.loadGoals();
        expect(saved.goals.find(row => row.id === set.goals[0].id)?.notes).toBe("Later edit");
        expect(saved.checkIns.some(row => row.periodStart === "2026-11-15")).toBe(true);
        expect(saved.trackers[0].lastBuiltPeriodStart).toBe("2026-11-01");
        expect(api.state.goals[set.goals[0].id].notes).toBe("Later edit");
    });

    it("does not mark a later edit saved while an older write finishes", async () => {
        const data = new ControlledData(makeAppState());
        const { set } = await seeded(data);
        await mount(data);
        const first = data.pauseNext();
        act(() => api.updateGoal(set.goals[0].id, { title: "First" }));
        await first.started.promise;
        act(() => api.updateGoal(set.goals[0].id, { title: "Second" }));
        const second = data.pauseNext();
        await act(async () => { first.gate.resolve(); await second.started.promise; });
        expect(api.state.goals[set.goals[0].id].title).toBe("Second");
        expect((await data.loadGoals()).goals.find(row => row.id === set.goals[0].id)?.title).toBe("First");
        await act(async () => { second.gate.resolve(); await api.persist(); });
        expect((await data.loadGoals()).goals.find(row => row.id === set.goals[0].id)?.title).toBe("Second");
    });

    it("re-reads queued saves, retains remote-only rows and pending edits, and preserves a newer staged build key", async () => {
        const data = new ControlledData(makeAppState());
        const { set } = await seeded(data);
        await mount(data);
        const hold = data.pauseNext(true);
        act(() => api.updateGoal(set.goals[0].id, { notes: "First" }));
        await hold.started.promise;
        const staged = await data.loadGoals();
        const remoteTracker = buildGoalTrackerFixture({ id: "remote-tracker" });
        const remoteGoal = buildGoalFixture({ id: "remote-goal", trackerId: remoteTracker.id });
        await act(async () => {
            await data.stage({ trackers: [{ ...staged.trackers[0], lastBuiltPeriodStart: "2027-01-03" }, remoteTracker], goals: [...staged.goals.map(row => row.id === set.goals[1].id ? { ...row, title: "Untouched remote edit" } : row), remoteGoal], checkIns: staged.checkIns });
            api.updateGoal(set.goals[0].id, { notes: "Pending" });
            api.updateTracker(set.tracker.id, { purpose: "Local purpose" });
        });
        let stamped!: Promise<void>;
        act(() => { stamped = api.stampBuiltPeriod(set.tracker.id, "2026-11-01"); });
        await act(async () => { hold.gate.resolve(); await stamped; });
        const saved = await data.loadGoals();
        expect(saved.trackers).toContainEqual(remoteTracker);
        expect(saved.goals).toContainEqual(remoteGoal);
        expect(saved.goals.find(row => row.id === set.goals[1].id)?.title).toBe("Untouched remote edit");
        expect(saved.trackers.find(row => row.id === set.tracker.id)).toMatchObject({ purpose: "Local purpose", lastBuiltPeriodStart: "2027-01-03" });
        expect(saved.goals.find(row => row.id === set.goals[0].id)?.notes).toBe("Pending");
        expect(data.maxActive).toBe(1);
    });

    it("rejects a stamp after successful delivery initiation without publishing it, and recovers the queue", async () => {
        const data = new ControlledData(makeAppState());
        const { set } = await seeded(data);
        await mount(data);
        const hold = data.pauseNext();
        const initiateDelivery = vi.fn(async () => {});
        let operation!: Promise<void>;
        act(() => { operation = (async () => { await initiateDelivery(); await api.stampBuiltPeriod(set.tracker.id, "2026-11-01"); })(); });
        await hold.started.promise;
        expect(initiateDelivery).toHaveResolved();
        expect(api.state.trackers[set.tracker.id].lastBuiltPeriodStart).toBeNull();
        const rejected = expect(operation).rejects.toThrow("Disk full");
        await act(async () => { hold.gate.reject(new Error("Disk full")); await rejected; });
        expect((await data.loadGoals()).trackers[0].lastBuiltPeriodStart).toBeNull();
        expect(api.state.trackers[set.tracker.id].lastBuiltPeriodStart).toBeNull();
        await act(async () => { await api.stampBuiltPeriod(set.tracker.id, "2026-11-01"); });
        expect(api.state.trackers[set.tracker.id].lastBuiltPeriodStart).toBe("2026-11-01");
    });

    it("rejects awaited check-in failures and later persist retries retained local work", async () => {
        const data = new ControlledData(makeAppState());
        const { set } = await seeded(data);
        await mount(data);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const save = vi.spyOn(data, "saveGoals").mockRejectedValue(new Error("Unavailable"));
        await act(async () => {
            await expect(api.saveCheckIns([buildGoalCheckInFixture({ goalId: set.goals[0].id, periodStart: "2026-12-01" })])).rejects.toThrow("Unavailable");
        });
        expect(warn).toHaveBeenCalled();
        save.mockRestore();
        await act(async () => { await api.persist(); });
        expect((await data.loadGoals()).checkIns.some(row => row.periodStart === "2026-12-01")).toBe(true);
    });

    it("reloads revisions without an echo write and refresh awaits manual sync", async () => {
        const { data, set } = await seeded();
        await mount(data);
        const before = api.revision;
        await act(async () => { await data.saveGoals([{ ...set.tracker, name: "Remote name" }], set.goals, set.checkIns); });
        await waitFor(() => expect(api.state.trackers[set.tracker.id].name).toBe("Remote name"));
        expect(api.revision).toBeGreaterThan(before);
        const save = vi.spyOn(data, "saveGoals");
        await act(async () => { await api.refreshGoals(); });
        expect(data.syncCalls[data.syncCalls.length - 1]?.reason).toBe("manual");
        expect(save).not.toHaveBeenCalled();
    });

    it("warns about invalid hydration rows and refuses a partial normalization write", async () => {
        const { data, set } = await seeded();
        const invalid = { ...set.tracker, id: "invalid", name: "" };
        vi.spyOn(data, "loadGoals").mockResolvedValue({ trackers: [set.tracker, invalid], goals: set.goals, checkIns: set.checkIns });
        const save = vi.spyOn(data, "saveGoals");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await mount(data);
        expect(Object.keys(api.state.trackers)).toEqual([set.tracker.id]);
        expect(save).not.toHaveBeenCalled();
        await act(async () => {
            api.updateTracker(set.tracker.id, { name: "Valid edit" });
            await expect(api.persist()).rejects.toThrow("Invalid staged goals");
        });
        expect(warn).toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it("treats local UI storage failures as nonfatal", async () => {
        const { data, set } = await seeded();
        await mount(data);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
        await act(async () => { api.selectTracker(set.tracker.id); await api.persist(); });
        expect(api.state.ui.selectedTrackerId).toBe(set.tracker.id);
    });
});
