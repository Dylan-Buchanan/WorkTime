import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataProvider, useData } from "../../state/DataContext";
import { defaultAppState } from "../engine";
import { createGoal, createGoalCheckIn, createGoalTracker } from "../goals/factories";
import { LocalStagingStore, stagingKey } from "./staging/LocalStagingStore";
import type { SyncSnapshot } from "./staging/types";
import { StagedDataAccess } from "./StagedDataAccess";
import { InMemoryDataAccess } from "./InMemoryDataAccess";
import { buildPushPlan, commitAcknowledgedPush, mergePulledSnapshot } from "./sync/merge";
import { isPlanNonEmpty, pushedSnapshotFromPlan } from "./sync/SyncCoordinator";
import type { SyncExecutor } from "./DataAccess";

const OWNER = "goals-owner";
const T0 = "2026-10-01T12:00:00.000Z";
const T1 = "2026-10-02T12:00:00.000Z";
const T2 = "2026-10-03T12:00:00.000Z";
const now = new Date(T1);
const tracker = createGoalTracker({ name: "Work", cadence: { kind: "every-n-weeks", weekday: 0, intervalWeeks: 2 }, cadenceAnchorAt: "2026-10-04" }, new Date(T0), "tracker");
const goal = createGoal({ trackerId: tracker.id, title: "Ship", metric: { label: "Steps", current: 1, target: 5, unit: "", source: "manual", overridePinned: false } }, new Date(T0), "goal");
const check = createGoalCheckIn({ goalId: goal.id, periodStart: "2026-10-04", planned: [{ text: "Review", dueDate: "2026-10-05" }] }, new Date(T0), "check");
const emptyGoals = { goalTrackers: {}, goalTrackerUpdatedAt: {}, goalTrackerTombstones: {}, goals: {}, goalUpdatedAt: {}, goalTombstones: {}, goalCheckIns: {}, goalCheckInUpdatedAt: {}, goalCheckInTombstones: {} };
const legacySnapshot = {
    tasks: {}, logs: {}, habits: {}, habitCompletions: {}, todos: {}, todoCompletions: {},
    settings: { value: defaultAppState().settings, updatedAt: T0 },
    timerState: { value: { active_task: null, current_cycle_pomodoros: 0, timer: null }, updatedAt: T0, completed: false },
    pmState: { value: { projects: {}, tasks: {}, meta: { initializedAt: T0 } }, updatedAt: T0 },
    petActivityRecords: {}, petProfile: { value: null, updatedAt: null }, petScheduleItems: {}, petNapRecords: {}, petWeightEntries: {}, petTrainingSkills: {}, petFixations: {}, petNotableEvents: {},
};
function baseline(): SyncSnapshot { return structuredClone({ ...legacySnapshot, ...emptyGoals }); }
function setup() {
    const store = new LocalStagingStore(window.localStorage);
    const executor = { sync: vi.fn() } as unknown as SyncExecutor;
    return { store, data: new StagedDataAccess(OWNER, store, executor, { now: () => now }) };
}
async function bootstrap(store: LocalStagingStore, remote = baseline()) {
    await store.update(OWNER, record => mergePulledSnapshot(record, remote, now).record);
}
beforeEach(() => { window.localStorage.clear(); });

describe("goals staged sync foundation", () => {
    it("loads a real v8 record through LocalStagingStore, StagedDataAccess and DataProvider without losing any legacy field", async () => {
        const state = defaultAppState();
        state.tasks = { task: { id: "task", name: "Legacy", target_pomodoros: 2, completed_pomodoros: 1, created_at: T0, completed_at: null, break_skips: 0, archived: false } };
        state.logs = [{ id: "log", task_id: "task", duration_minutes: 25, finished_at: T0, was_break: false, break_skipped: false }];
        const habit = { id: "habit", name: "Walk", description: "Legacy habit", color: "red", frequency: "daily", position: 2, isArchived: false, createdAt: T0, updatedAt: T0 };
        const todo = { id: "todo", title: "Legacy todo", rule: null, dueDate: "2026-10-05", estimate: 1, currentTaskId: null, position: 1, isArchived: false, createdAt: T0, updatedAt: T0 };
        const profile = { id: "pet", name: "Buddy", birthDate: "2026-07-10", createdAt: T0, updatedAt: T0 };
        const snapshot = { ...legacySnapshot, tasks: { task: { value: state.tasks.task, updatedAt: T0 } }, logs: { log: state.logs[0] },
            habits: { habit: { value: habit, updatedAt: T0 } }, todos: { todo: { value: todo, updatedAt: T0 } }, petProfile: { value: profile, updatedAt: T0 } };
        // Literal v8 disk shape: no v9 freshRecord or parse/conversion helper constructs this fixture.
        const v8 = { schemaVersion: 8, ownerId: OWNER, revision: 17, initialized: true, state, inProgressPomodoros: { task: 600 },
            pmState: snapshot.pmState.value, taskUpdatedAt: { task: T1 }, settingsUpdatedAt: T1, timerUpdatedAt: null, pmUpdatedAt: T1, timerCompleted: false,
            taskTombstones: { old: { id: "old", deletedAt: T1 } }, logTombstones: { oldlog: { id: "oldlog", deletedAt: T1 } }, fullWipe: null, pendingCompletions: [], unbootstrapped: false,
            lastSynced: snapshot, habits: { habit }, habitCompletions: { hc: { id: "hc", habitId: "habit", bucket: "2026-10-01", createdAt: T0, updatedAt: T0 } },
            habitUpdatedAt: { habit: T1 }, habitTombstones: {}, habitCompletionTombstones: {}, todos: { todo }, todoUpdatedAt: { todo: T1 }, todoTombstones: {}, todoCompletions: {}, todoCompletionTombstones: {},
            petActivityRecords: {}, petActivityUpdatedAt: {}, petActivityTombstones: {}, petProfile: profile, petProfileUpdatedAt: T1, petProfileTombstone: null,
            petScheduleItems: {}, petScheduleUpdatedAt: {}, petScheduleTombstones: {}, petReminderMarks: { reminder: { id: "reminder", itemId: "item", dueAt: T0, remindedAt: T1 } },
            petNapRecords: {}, petNapUpdatedAt: {}, petNapTombstones: {}, petWeightEntries: {}, petWeightUpdatedAt: {}, petWeightTombstones: {},
            petTrainingSkills: {}, petTrainingSkillUpdatedAt: {}, petTrainingSkillTombstones: {}, petFixations: {}, petFixationUpdatedAt: {}, petFixationTombstones: {}, petNotableEvents: {}, petNotableEventUpdatedAt: {}, petNotableEventTombstones: {} };
        window.localStorage.setItem(stagingKey(OWNER), JSON.stringify(v8));
        const { store, data } = setup();
        const loaded = vi.fn();
        function Consumer() {
            const access = useData();
            useEffect(() => { void access.loadGoals().then(loaded); }, [access]);
            return null;
        }
        render(<DataProvider dataAccess={data}><Consumer /></DataProvider>);
        await waitFor(() => expect(loaded).toHaveBeenCalledWith({ trackers: [], goals: [], checkIns: [] }));
        const expected = { ...v8, ...emptyGoals, schemaVersion: 9, lastSynced: { ...snapshot, ...emptyGoals } };
        expect(store.read(OWNER)).toEqual(expected);
        // Persist by the ordinary full-set writer, then load from a new store instance.
        await data.saveGoals([], [], []);
        expect(new LocalStagingStore(window.localStorage).read(OWNER)).toEqual({ ...expected, revision: 18 });
        expect(JSON.parse(window.localStorage.getItem(stagingKey(OWNER))!).schemaVersion).toBe(9);
    });

    it("stamps changed rows only, clones inputs, isolates owners and rejects backwards built keys atomically", async () => {
        const { store, data } = setup();
        await data.saveGoals([tracker], [goal], [check]);
        expect(data.pendingCount()).toBe(3);
        expect(store.read(OWNER).goalTrackerUpdatedAt).toEqual({ tracker: T1 });
        await bootstrap(store);
        const plan = buildPushPlan(store.read(OWNER));
        const pushed = pushedSnapshotFromPlan(store.read(OWNER), plan);
        await store.update(OWNER, record => commitAcknowledgedPush(record, plan, pushed));
        expect(data.pendingCount()).toBe(0);
        const built = { ...tracker, lastBuiltPeriodStart: "2026-10-04" as const };
        await data.saveGoals([built], [goal], [check]);
        expect(store.read(OWNER).goalUpdatedAt).toEqual({});
        expect(store.read(OWNER).goalCheckInUpdatedAt).toEqual({});
        const before = store.read(OWNER);
        await expect(data.saveGoals([tracker], [goal], [check])).rejects.toThrow("cannot move backwards");
        expect(store.read(OWNER)).toEqual(before);
        const result = await data.loadGoals(); result.goals[0].metric!.current = 999;
        expect((await data.loadGoals()).goals[0].metric!.current).toBe(1);
        const other = new StagedDataAccess("other", store, { sync: vi.fn() } as unknown as SyncExecutor);
        expect(await other.loadGoals()).toEqual({ trackers: [], goals: [], checkIns: [] });
    });

    it("accounts for structural tombstones, re-add and discard against the complete baseline", async () => {
        const { store, data } = setup();
        const remote = baseline(); remote.goalTrackers.tracker = { value: tracker, updatedAt: T0 }; remote.goals.goal = { value: goal, updatedAt: T0 }; remote.goalCheckIns.check = { value: check, updatedAt: T0 };
        await bootstrap(store, remote);
        // Simulate a corrupt omitted row at the staging boundary; no UI or delete operation exists.
        await store.update(OWNER, row => ({ ...row, goals: {}, goalTombstones: { goal: { id: "goal", deletedAt: T1 } } }));
        expect(data.pendingCount()).toBe(1);
        expect(buildPushPlan(store.read(OWNER)).goalTombstones).toEqual([{ id: "goal", deletedAt: T1 }]);
        await data.saveGoals([tracker], [goal], [check]);
        expect(store.read(OWNER).goalTombstones).toEqual({});
        await data.saveGoals([{ ...tracker, name: "Changed" }], [goal], [check]);
        // Re-adding the goal is an explicit write, as its omission may be in flight.
        expect(data.pendingCount()).toBe(2);
        await data.discardPendingChanges();
        expect(await data.loadGoals()).toEqual({ trackers: [tracker], goals: [goal], checkIns: [check] });
        expect(data.pendingCount()).toBe(0);
    });

    it.each([
        ["goalTrackers", "goalTrackerUpdatedAt", "tracker", "goalTrackerUpserts"],
        ["goals", "goalUpdatedAt", "goal", "goalUpserts"],
        ["goalCheckIns", "goalCheckInUpdatedAt", "check", "goalCheckInUpserts"],
    ] as const)("preserves an explicit reversion during an in-flight push for %s", async (collection, stamps, id, upserts) => {
        const { store, data } = setup();
        const remote = baseline();
        remote.goalTrackers.tracker = { value: tracker, updatedAt: T0 };
        remote.goals.goal = { value: goal, updatedAt: T0 };
        remote.goalCheckIns.check = { value: check, updatedAt: T0 };
        await bootstrap(store, remote);
        // Every save supplies the complete domain; only the selected row changes.
        await data.saveGoals(
            [{ ...tracker, name: collection === "goalTrackers" ? "Changed" : tracker.name }],
            [{ ...goal, title: collection === "goals" ? "Changed" : goal.title }],
            [{ ...check, did: collection === "goalCheckIns" ? "Changed" : check.did }],
        );
        const beforePush = store.read(OWNER);
        const plan = buildPushPlan(beforePush);
        expect(plan[upserts]).toHaveLength(1);
        await data.saveGoals([tracker], [goal], [check]);
        // The injected clock never advances, so ordering must come from the writer.
        const pushedB = pushedSnapshotFromPlan(beforePush, plan);
        await store.update(OWNER, row => commitAcknowledgedPush(row, plan, pushedB));
        const reverted = store.read(OWNER);
        expect(reverted[collection][id]).toEqual(remote[collection][id].value);
        expect(reverted[stamps][id] > beforePush[stamps][id]).toBe(true);
        expect(data.pendingCount()).toBe(1);
        const reversionPlan = buildPushPlan(reverted);
        expect(reversionPlan[upserts]).toEqual([{ value: remote[collection][id].value, updatedAt: reverted[stamps][id] }]);
        const merged = mergePulledSnapshot(reverted, pushedB, now).record;
        expect(merged[collection][id]).toEqual(remote[collection][id].value);
        const nextPlan = buildPushPlan(merged);
        const pushedA = pushedSnapshotFromPlan(merged, nextPlan);
        expect(pushedA[collection][id].value).toEqual(remote[collection][id].value);
        await store.update(OWNER, () => commitAcknowledgedPush(merged, nextPlan, pushedA));
        await store.update(OWNER, row => mergePulledSnapshot(row, pushedA, now).record);
        expect(await data.loadGoals()).toEqual({ trackers: [tracker], goals: [goal], checkIns: [check] });
        expect(data.pendingCount()).toBe(0);
        expect(isPlanNonEmpty(buildPushPlan(store.read(OWNER)))).toBe(false);
    });

    it("keeps repeated identical full-set saves as no-ops for synced and pending rows", async () => {
        const { store, data } = setup();
        const remote = baseline();
        remote.goalTrackers.tracker = { value: tracker, updatedAt: T0 };
        remote.goals.goal = { value: goal, updatedAt: T0 };
        remote.goalCheckIns.check = { value: check, updatedAt: T0 };
        await bootstrap(store, remote);
        await data.saveGoals([tracker], [goal], [check]);
        expect(data.pendingCount()).toBe(0);
        expect(isPlanNonEmpty(buildPushPlan(store.read(OWNER)))).toBe(false);
        const changedTracker = { ...tracker, name: "Changed" };
        const changed = { ...goal, title: "Changed" };
        const changedCheck = { ...check, did: "Changed" };
        await data.saveGoals([changedTracker], [changed], [changedCheck]);
        const before = store.read(OWNER);
        await data.saveGoals([structuredClone(changedTracker)], [structuredClone(changed)], [structuredClone(changedCheck)]);
        const after = store.read(OWNER);
        expect(after.goalTrackerUpdatedAt).toEqual(before.goalTrackerUpdatedAt);
        expect(after.goalUpdatedAt).toEqual(before.goalUpdatedAt);
        expect(after.goalCheckInUpdatedAt).toEqual(before.goalCheckInUpdatedAt);
        // Storage revisions advance on each save; the transport content stays identical.
        expect(buildPushPlan(after)).toEqual({ ...buildPushPlan(before), baseRevision: after.revision });
    });

    it("writes structural omission tombstones and clears them on a complete-set re-add", async () => {
        const { store, data } = setup();
        const remote = baseline();
        remote.goalTrackers.tracker = { value: tracker, updatedAt: T0 };
        remote.goals.goal = { value: goal, updatedAt: T0 };
        remote.goalCheckIns.check = { value: check, updatedAt: T0 };
        await bootstrap(store, remote);
        // Deliberately exercise the structural diff with an empty entire desired set.
        // Production callers retain all rows and use archive/lifecycle changes.
        await data.saveGoals([], [], []);
        const omitted = store.read(OWNER);
        expect(omitted.goalTrackerTombstones).toEqual({ tracker: { id: "tracker", deletedAt: T1 } });
        expect(omitted.goalTombstones).toEqual({ goal: { id: "goal", deletedAt: T1 } });
        expect(omitted.goalCheckInTombstones).toEqual({ check: { id: "check", deletedAt: T1 } });
        expect(omitted.goalTrackerUpdatedAt).toEqual({});
        expect(omitted.goalUpdatedAt).toEqual({});
        expect(omitted.goalCheckInUpdatedAt).toEqual({});
        expect(data.pendingCount()).toBe(3);
        const plan = buildPushPlan(omitted);
        expect(plan.goalTrackerTombstones).toEqual([{ id: "tracker", deletedAt: T1 }]);
        expect(plan.goalTombstones).toEqual([{ id: "goal", deletedAt: T1 }]);
        expect(plan.goalCheckInTombstones).toEqual([{ id: "check", deletedAt: T1 }]);
        await data.saveGoals([tracker], [goal], [check]);
        const restored = store.read(OWNER);
        expect(restored.goalTrackerTombstones).toEqual({});
        expect(restored.goalTombstones).toEqual({});
        expect(restored.goalCheckInTombstones).toEqual({});
        expect(await data.loadGoals()).toEqual({ trackers: [tracker], goals: [goal], checkIns: [check] });
        const other = new StagedDataAccess("other", store, { sync: vi.fn() } as unknown as SyncExecutor);
        expect(await other.loadGoals()).toEqual({ trackers: [], goals: [], checkIns: [] });
        expect(other.pendingCount()).toBe(0);
    });

    it.each([T0, T1, T2])("uses whole-row LWW for nested metric and planned values (%s)", async stamp => {
        const { store, data } = setup(); await bootstrap(store);
        await data.saveGoals([tracker], [goal], [check]);
        const remote = baseline();
        const remoteGoal = { ...goal, title: "Remote", metric: { ...goal.metric!, current: 3 } };
        const remoteCheck = { ...check, planned: [{ text: "Remote", dueDate: null }] };
        remote.goals.goal = { value: remoteGoal, updatedAt: stamp }; remote.goalCheckIns.check = { value: remoteCheck, updatedAt: stamp };
        const result = mergePulledSnapshot(store.read(OWNER), remote, now).record;
        expect(result.goals.goal).toEqual(stamp < T1 ? goal : remoteGoal);
        expect(result.goalCheckIns.check).toEqual(stamp < T1 ? check : remoteCheck);
    });

    it("keeps server check-in ids and converges with no ghost rows, stamps or pending work", async () => {
        const { store, data } = setup();
        const remote = baseline(); remote.goalTrackers.tracker = { value: tracker, updatedAt: T0 }; remote.goals.goal = { value: goal, updatedAt: T0 };
        await bootstrap(store, remote);
        await data.saveGoals([tracker], [goal], [check]);
        remote.goalCheckIns.server = { value: { ...check, id: "server", did: "Server content" }, updatedAt: T0 };
        const merged = mergePulledSnapshot(store.read(OWNER), remote, now);
        expect(Object.keys(merged.record.goalCheckIns)).toEqual(["server"]);
        expect(merged.record.goalCheckInUpdatedAt).toEqual({}); expect(merged.record.goalCheckInTombstones).toEqual({});
        expect(merged.pendingCount).toBe(0); expect(isPlanNonEmpty(buildPushPlan(merged.record))).toBe(false);
        expect(mergePulledSnapshot(merged.record, remote, now).record.goalCheckIns).toEqual(merged.record.goalCheckIns);
    });

    it("preserves the later built key when a newer whole-row rename wins, and can acknowledge the repair", async () => {
        const { store, data } = setup();
        await data.saveGoals([{ ...tracker, lastBuiltPeriodStart: "2026-10-18" }], [goal], [check]);
        const remote = baseline(); remote.goalTrackers.tracker = { value: { ...tracker, name: "Remote rename" }, updatedAt: T2 };
        const merged = mergePulledSnapshot(store.read(OWNER), remote, now).record;
        expect(merged.goalTrackers.tracker).toMatchObject({ name: "Remote rename", lastBuiltPeriodStart: "2026-10-18" });
        expect(merged.goalTrackerUpdatedAt.tracker > T2).toBe(true);
        const plan = buildPushPlan(merged); const committed = commitAcknowledgedPush(merged, plan, pushedSnapshotFromPlan(merged, plan));
        expect(committed.goalTrackerUpdatedAt).toEqual({});
        expect(isPlanNonEmpty(buildPushPlan(committed))).toBe(false);
    });

    it("retains edits made during push and preserves goals through a full wipe", async () => {
        const { store, data } = setup(); await bootstrap(store);
        await data.saveGoals([tracker], [goal], [check]);
        const before = store.read(OWNER); const plan = buildPushPlan(before);
        await data.saveGoals([tracker], [{ ...goal, title: "Edited during push" }], [check]);
        await store.update(OWNER, row => commitAcknowledgedPush(row, plan, pushedSnapshotFromPlan(before, plan)));
        expect(data.pendingCount()).toBe(1);
        await data.resetAppState();
        const wipe = mergePulledSnapshot(store.read(OWNER), pushedSnapshotFromPlan(before, plan), now).record;
        const wipePlan = buildPushPlan(wipe);
        expect(wipePlan.fullWipe).toBe(true); expect(wipePlan.goalUpserts?.[0].value.title).toBe("Edited during push");
        const pushed = pushedSnapshotFromPlan(wipe, wipePlan);
        expect(pushed.goalTrackers.tracker.value).toEqual(tracker); expect(pushed.goalCheckIns.check.value).toEqual(check);
        const committed = commitAcknowledgedPush(wipe, wipePlan, pushed);
        expect(isPlanNonEmpty(buildPushPlan(committed))).toBe(false);
    });

    it.each([
        ["goalTrackers", "goalTrackerTombstones", "tracker"],
        ["goals", "goalTombstones", "goal"],
        ["goalCheckIns", "goalCheckInTombstones", "check"],
    ] as const)("orders structural tombstones against remote LWW stamps for %s", async (collection, tombstones, id) => {
        const { store } = setup();
        const remote = baseline();
        remote.goalTrackers.tracker = { value: tracker, updatedAt: T0 };
        remote.goals.goal = { value: goal, updatedAt: T0 };
        remote.goalCheckIns.check = { value: check, updatedAt: T0 };
        await bootstrap(store, remote);
        await store.update(OWNER, row => ({ ...row, [collection]: {}, [tombstones]: { [id]: { id, deletedAt: T1 } } }));
        const local = store.read(OWNER);
        for (const stamp of [T0, T1, T2]) {
            const pulled = structuredClone(remote); pulled[collection][id].updatedAt = stamp;
            const merged = mergePulledSnapshot(local, pulled, now);
            expect(merged.record[collection][id] !== undefined).toBe(stamp > T1);
            expect(merged.pendingCount).toBe(stamp > T1 ? 0 : 1);
            const plan = buildPushPlan(merged.record);
            const committed = commitAcknowledgedPush(merged.record, plan, pushedSnapshotFromPlan(merged.record, plan));
            expect(committed[tombstones]).toEqual({});
            expect(isPlanNonEmpty(buildPushPlan(committed))).toBe(false);
        }
    });

    it("rejects malformed staged rows before touching persistent data", async () => {
        const { store, data } = setup();
        const before = store.read(OWNER);
        await expect(data.saveGoals([tracker], [{ ...goal, metric: { ...goal.metric!, current: NaN } }], [check])).rejects.toThrow("Invalid goals payload");
        expect(store.read(OWNER)).toEqual(before);
    });

    it("supports the same cloned goals load/save and monotonic guard in memory", async () => {
        const data = new InMemoryDataAccess();
        await data.saveGoals([{ ...tracker, isArchived: true, lastBuiltPeriodStart: "2026-10-04" }], [{ ...goal, lifecycle: "achieved", achievedAt: T1 }], [check]);
        expect((await data.loadGoals()).trackers[0].isArchived).toBe(true);
        await expect(data.saveGoals([tracker], [goal], [check])).rejects.toThrow("cannot move backwards");
        await data.discardPendingChanges(); expect(await data.loadGoals()).toEqual({ trackers: [], goals: [], checkIns: [] });
    });
});
