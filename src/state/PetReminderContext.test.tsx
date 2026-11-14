import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import type { GoogleCalendarDataAccess } from "../lib/data/GoogleCalendarDataAccess";
import { buildPetSchedule, formatClock } from "../lib/pets";
import { makeAppState } from "../test/mockTauri";
import type { PetActivityRecord, PetNapRecord, PetScheduleItem } from "./types";
import { AppStateProvider, resetNotifyForTesting } from "./AppStateContext";
import { DataProvider } from "./DataContext";
import { PetActivityProvider, usePetActivity } from "./PetActivityContext";
import { petOccurrenceId, PetReminderProvider } from "./PetReminderContext";
import { CalendarBusyProvider, useCalendarBusy } from "./CalendarBusyContext";
import { PetProvider } from "./PetContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { ToastProvider } from "./ToastContext";

vi.mock("@tauri-apps/plugin-notification", () => {
    throw new Error("native notifications are unavailable in the browser test");
});
vi.mock("../lib/supabase", () => ({ supabase: {} }));

const OWNER = "owner-1";
const START = new Date(2026, 8, 17, 15, 0, 0, 0);

function minutes(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function fixedItem(id: string, label: string, due: Date, windowSeconds = 0): PetScheduleItem {
    const startMinutes = minutes(due);
    return {
        id,
        activityType: "feeding",
        label,
        flexibility: "fixed",
        priority: 0,
        recurrence: {
            mode: "fixed-time",
            time: `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`,
            startMinutes,
            endMinutes: startMinutes + windowSeconds / 60,
        },
        isActive: true,
        createdAt: START.toISOString(),
        updatedAt: START.toISOString(),
    };
}

function intervalItem(): PetScheduleItem {
    return {
        id: "potty",
        activityType: "potty",
        label: "Potty",
        flexibility: "flexible",
        priority: 0,
        recurrence: { mode: "interval", minMinutes: 1, maxMinutes: 2 },
        isActive: true,
        createdAt: START.toISOString(),
        updatedAt: START.toISOString(),
    };
}

function activity(id: string, timestamp: Date): PetActivityRecord {
    return { id, activityType: "potty", timestamp: timestamp.toISOString(), createdAt: timestamp.toISOString() };
}

function Probe() {
    const { state, hydrated } = usePetActivity();
    const { snapshot } = useCalendarBusy();
    return <><div>ready:{String(hydrated)}:{Object.keys(state.records).length}</div><div data-testid="busy-status">{snapshot.status}</div></>;
}

type BusyAccess = Pick<GoogleCalendarDataAccess, "fetchBusyIntervals">;

function busyAccess(intervals: Array<{ start: string; end: string }> = []) {
    return { fetchBusyIntervals: vi.fn<BusyAccess["fetchBusyIntervals"]>().mockResolvedValue({ intervals, refreshedAt: START.toISOString() }) };
}

function wrap(data: InMemoryDataAccess, access: BusyAccess = busyAccess()) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                    <CalendarBusyProvider dataAccess={access}>
                    <ToastProvider>
                        <PetProvider><PetActivityProvider>
                            <PetReminderProvider><Probe /></PetReminderProvider>
                        </PetActivityProvider></PetProvider>
                    </ToastProvider>
                    </CalendarBusyProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function evening(hour: number, minute = 0, second = 0): Date {
    return new Date(2026, 8, 17, hour, minute, second);
}

function runUntil(end: Date, start = evening(20, 50)) {
    return { start: start.toISOString(), end: end.toISOString() };
}

function blockedItem(id = "dinner", label = "Dinner", due = evening(21)): PetScheduleItem {
    return { ...fixedItem(id, label, due, 30 * 60), flexibility: "flexible" };
}

async function eveningData(items = [blockedItem()]): Promise<InMemoryDataAccess> {
    const data = new InMemoryDataAccess(makeAppState());
    await data.updateSettings({ ...makeAppState().settings, start_of_day: "07:00", end_of_day: "22:00" });
    await data.savePetScheduleItems(items);
    return data;
}

async function ready(): Promise<void> {
    await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("busy-status")).toHaveTextContent("ok"));
    await advance(1_000);
}

async function tickAt(time: Date): Promise<void> {
    // Changing wall time preserves each timer's remaining delay. Tick within
    // the requested second instead of assuming the interval lands on its edge.
    vi.setSystemTime(time);
    await advance(1_000);
}

async function refreshBusy(access: ReturnType<typeof busyAccess>, intervals: Array<{ start: string; end: string }>): Promise<void> {
    const calls = access.fetchBusyIntervals.mock.calls.length;
    access.fetchBusyIntervals.mockResolvedValue({ intervals, refreshedAt: new Date().toISOString() });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(access.fetchBusyIntervals).toHaveBeenCalledTimes(calls + 1);
}

function nap(start: Date, end: Date | null): PetNapRecord {
    return { id: "nap", start: start.toISOString(), end: end?.toISOString() ?? null, createdAt: START.toISOString(), updatedAt: START.toISOString() };
}

describe("PetReminderProvider", () => {
    const notifications: Array<{ title: string; options?: { body?: string } }> = [];

    beforeEach(() => {
        localStorage.clear();
        notifications.length = 0;
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(START);
        class MockNotification {
            static permission = "granted";
            static requestPermission = vi.fn(async () => "granted");
            constructor(title: string, options?: { body?: string }) { notifications.push({ title, options }); }
        }
        vi.stubGlobal("Notification", MockNotification);
    });

    afterEach(() => {
        resetNotifyForTesting();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("delivers through the Web fallback at due time and persists no-refire dedup", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const due = new Date(START.getTime() + 60_000);
        await data.savePetScheduleItems([fixedItem("dinner", "Dinner", due)]);
        render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());
        await advance(1_000);
        await advance(59_000);

        await waitFor(() => expect(notifications).toHaveLength(1));
        expect(notifications[0]).toEqual({ title: "Pet care: Dinner", options: { body: "Dinner is due now" } });
        await waitFor(async () => expect(await data.loadPetReminderMarks()).toHaveLength(1));

        await advance(5_000);
        expect(notifications).toHaveLength(1);
    });

    it("reminds a new occurrence at the configured boundary and does not catch up after reopening", async () => {
        const boundary = new Date(2026, 8, 17, 21, 59, 0, 0);
        vi.setSystemTime(boundary);
        const data = new InMemoryDataAccess(makeAppState());
        const appState = makeAppState();
        await data.updateSettings({ ...appState.settings, start_of_day: "22:00", end_of_day: "08:00" });
        await data.savePetScheduleItems([fixedItem("night-care", "Night care", new Date(2026, 8, 17, 22, 0))]);

        const view = render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());
        await advance(60_000);
        await waitFor(() => expect(notifications).toHaveLength(1));
        expect(notifications[0].title).toBe("Pet care: Night care");
        await waitFor(async () => expect(await data.loadPetReminderMarks()).toHaveLength(1));

        view.unmount();
        vi.setSystemTime(new Date(2026, 8, 17, 22, 5));
        render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());
        await advance(1_000);
        expect(notifications).toHaveLength(1);
    });

    it("re-arms an interval reminder after a new activity record changes its anchor", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetScheduleItems([intervalItem()]);
        await data.savePetActivityRecords([activity("a1", START)]);
        render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:1")).toBeInTheDocument());

        await advance(1_000);
        await advance(59_000);
        await waitFor(() => expect(notifications).toHaveLength(1));

        const nextAnchor = new Date();
        await act(async () => { await data.savePetActivityRecords([activity("a1", START), activity("a2", nextAnchor)]); });
        await waitFor(() => expect(screen.getByText("ready:true:2")).toBeInTheDocument());
        await advance(60_000);
        await waitFor(() => expect(notifications).toHaveLength(2));
        expect((await data.loadPetReminderMarks()).map((mark) => mark.id)).toHaveLength(2);
    });

    it("continues reminders using defaults when app state cannot hydrate", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        vi.spyOn(data, "fetchState").mockRejectedValueOnce(new Error("app state unavailable"));
        await data.savePetScheduleItems([fixedItem("dinner", "Dinner", new Date(START.getTime() + 60_000))]);
        render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());
        await advance(60_000);
        await waitFor(() => expect(notifications).toHaveLength(1));
    });

    it("does not notify again when settings move an already-due interval", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.updateSettings({ ...makeAppState().settings, start_of_day: "15:00" });
        await data.savePetScheduleItems([intervalItem()]);
        render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());
        await advance(60_000);
        await waitFor(() => expect(notifications).toHaveLength(1));
        await advance(60_000);
        await data.updateSettings({ ...makeAppState().settings, start_of_day: "15:01" });
        await advance(1_000);
        expect(notifications).toHaveLength(1);
    });

    it("shows one shared warning toast when an item crosses overdue", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const due = new Date(START.getTime() + 60_000);
        await data.savePetScheduleItems([fixedItem("dinner", "Dinner", due, 60)]);
        render(wrap(data));
        await waitFor(() => expect(screen.getByText("ready:true:0")).toBeInTheDocument());

        await advance(1_000);
        await advance(120_000);
        await waitFor(() => expect(screen.getAllByTestId("toast-message").filter((node) => node.textContent === "Dinner is overdue")).toHaveLength(1));
        await advance(2_000);
        expect(screen.getAllByTestId("toast-message").filter((node) => node.textContent === "Dinner is overdue")).toHaveLength(1);
    });

    it("keeps occurrence identity through nap, post-wake and busy moves", () => {
        const item = intervalItem();
        const input = { now: new Date(START.getTime() + 90_000), scheduleItems: [item], activityRecords: [], naps: [] };
        const original = buildPetSchedule(input).entries[0];
        const shifted = buildPetSchedule({ ...input, naps: [nap(new Date(START.getTime() + 10_000), new Date(START.getTime() + 30_000))] }).entries[0];
        const postWake = buildPetSchedule({ ...input, naps: [nap(new Date(START.getTime() + 10_000), new Date(START.getTime() + 80_000))] }).entries[0];
        const moved = buildPetSchedule({ ...input, busyIntervals: [{ start: new Date(START.getTime() + 50_000), end: new Date(START.getTime() + 70_000) }] }).entries[0];
        expect(shifted.shift?.reason).toBe("nap");
        expect(postWake.shift?.reason).toBe("post-wake");
        expect(moved.shift?.reason).toBe("busy");
        for (const entry of [shifted, postWake, moved]) {
            expect(entry.start.getTime()).not.toBe(original.start.getTime());
            expect(petOccurrenceId(entry)).toBe(petOccurrenceId(original));
            expect(petOccurrenceId(entry)).toBe(`${item.id}:${entry.occurrenceStart.toISOString()}`);
        }
    });

    it("honours an existing start-keyed mark for a never-reflowed fixed item", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        const due = new Date(START.getTime() + 60_000);
        const mark = { id: `dinner:${due.toISOString()}`, itemId: "dinner", dueAt: due.toISOString(), remindedAt: START.toISOString() };
        await data.savePetScheduleItems([fixedItem("dinner", "Dinner", due)]);
        await data.savePetReminderMarks([mark]);
        render(wrap(data));
        await ready();
        await advance(65_000);
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([mark]);
    });

    it("holds due and overdue crossings without a mark, then nudges once at run end", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        const run = runUntil(evening(21, 50));
        const entry = buildPetSchedule({ now: evening(21), scheduleItems: [blockedItem()], activityRecords: [], naps: [], startOfDay: "07:00", endOfDay: "22:00", busyIntervals: [run] }).entries[0];
        expect(entry.blockedBy).not.toBeNull();
        render(wrap(data, busyAccess([run])));
        await ready();
        await tickAt(evening(21));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(21, 49, 58));
        expect(notifications).toHaveLength(0);
        expect(screen.queryByText("Dinner is overdue")).toBeNull();
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(21, 50));
        await waitFor(() => expect(notifications).toHaveLength(1));
        expect(notifications[0]).toEqual({ title: "Pet care: Dinner", options: { body: `Held during busy ${formatClock(new Date(run.start))}–${formatClock(new Date(run.end))}. Dinner is due now.` } });
        const marks = await data.loadPetReminderMarks();
        expect(marks).toHaveLength(1);
        expect(marks[0]).toMatchObject({ id: `dinner:${evening(21).toISOString()}`, itemId: "dinner", dueAt: evening(21).toISOString() });
        expect(Date.parse(marks[0].remindedAt)).toBeGreaterThanOrEqual(evening(21, 50).getTime());
        expect(Date.parse(marks[0].remindedAt)).toBeLessThan(evening(21, 50, 1).getTime());
        await advance(5_000);
        expect(notifications).toHaveLength(1);
    });

    it("collapses a run into one nudge ordered by start then label", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData([
            blockedItem("a", "Water", evening(21, 1)),
            blockedItem("b", "Zinc"),
            blockedItem("c", "Dinner"),
        ]);
        const run = runUntil(evening(21, 50));
        render(wrap(data, busyAccess([run])));
        await ready();
        await tickAt(evening(21, 2));
        expect(notifications).toHaveLength(0);
        await tickAt(evening(21, 50));
        expect(notifications).toEqual([{ title: "Pet care: Dinner, Zinc, Water", options: { body: `Held during busy ${formatClock(evening(20, 50))}–${formatClock(evening(21, 50))}. Dinner, Zinc, Water are due now.` } }]);
        expect(await data.loadPetReminderMarks()).toHaveLength(3);
        await advance(5_000);
        expect(notifications).toHaveLength(1);
    });

    it("fires at day end even though the engine has removed the day's entries", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        render(wrap(data, busyAccess([runUntil(evening(22, 30))])));
        await ready();
        await tickAt(evening(21));
        await tickAt(evening(21, 59, 58));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(22));
        expect(notifications).toHaveLength(1);
        expect(notifications[0].options?.body).toBe(`Held during busy ${formatClock(evening(20, 50))}–${formatClock(evening(22))}. Dinner is due now.`);
        const marks = await data.loadPetReminderMarks();
        expect(marks).toHaveLength(1);
        expect(Date.parse(marks[0].remindedAt)).toBeGreaterThanOrEqual(evening(22).getTime());
        await advance(5_000);
        expect(notifications).toHaveLength(1);
    });

    it("stays silent when opened after a blocked run ended", async () => {
        vi.setSystemTime(evening(21, 51));
        const data = await eveningData();
        render(wrap(data, busyAccess([runUntil(evening(21, 50))])));
        await ready();
        await advance(5_000);
        expect(notifications).toHaveLength(0);
        expect(screen.queryByText("Dinner is overdue")).toBeNull();
        expect(await data.loadPetReminderMarks()).toEqual([]);
    });

    it("uses the shorter run end after a focus refresh while pending", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        const access = busyAccess([runUntil(evening(21, 50))]);
        render(wrap(data, access));
        await ready();
        await tickAt(evening(21));
        await refreshBusy(access, [runUntil(evening(21, 40))]);
        await tickAt(evening(21, 39, 58));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(21, 40));
        expect(notifications).toEqual([{ title: "Pet care: Dinner", options: { body: `Held during busy ${formatClock(evening(20, 50))}–${formatClock(evening(21, 40))}. Dinner is due now.` } }]);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(1);
        expect(await data.loadPetReminderMarks()).toHaveLength(1);
    });

    it("fires immediately after a focus refresh removes the pending run", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        const access = busyAccess([runUntil(evening(21, 50))]);
        render(wrap(data, access));
        await ready();
        await tickAt(evening(21));
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await refreshBusy(access, []);
        expect(notifications).toEqual([{ title: "Pet care: Dinner", options: { body: `Held during busy ${formatClock(evening(20, 50))}–${formatClock(evening(21, 50))}. Dinner is due now.` } }]);
        expect(await data.loadPetReminderMarks()).toHaveLength(1);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(1);
    });

    it("drops a pending nudge when activity fulfils the occurrence mid-run", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        render(wrap(data, busyAccess([runUntil(evening(21, 50))])));
        await ready();
        await tickAt(evening(21, 1));
        await act(async () => { await data.savePetActivityRecords([{ id: "fed", activityType: "feeding", timestamp: evening(21, 1).toISOString(), createdAt: evening(21, 1).toISOString(), scheduleItemId: "dinner", scheduleOccurrenceStart: evening(21).toISOString() }]); });
        await waitFor(() => expect(screen.getByText("ready:true:1")).toBeInTheDocument());
        await advance(1_000);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
    });

    it.each([false, true])("does not nudge an already-reminded item that becomes blocked (pre-existing mark: %s)", async (preExisting) => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        if (preExisting) await data.savePetReminderMarks([{ id: `dinner:${evening(21).toISOString()}`, itemId: "dinner", dueAt: evening(21).toISOString(), remindedAt: evening(20, 59).toISOString() }]);
        const access = busyAccess();
        render(wrap(data, access));
        await ready();
        await tickAt(evening(21));
        expect(notifications).toHaveLength(preExisting ? 0 : 1);
        await refreshBusy(access, [runUntil(evening(21, 50))]);
        await tickAt(evening(21, 31));
        expect(screen.queryByText("Dinner is overdue")).toBeNull();
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(preExisting ? 0 : 1);
        expect(await data.loadPetReminderMarks()).toHaveLength(1);
    });

    it("neither announces nor defers a nap-paused interval, then resumes normal reminders", async () => {
        vi.setSystemTime(evening(20, 59, 30));
        const item = { ...intervalItem(), createdAt: evening(20, 59).toISOString() };
        const data = await eveningData([item]);
        const activeNap = nap(evening(20, 59, 20), null);
        await data.savePetNapRecords([activeNap]);
        render(wrap(data, busyAccess([runUntil(evening(21, 50))])));
        await ready();
        await tickAt(evening(21, 1));
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await act(async () => { await data.savePetNapRecords([{ ...activeNap, end: evening(21, 50).toISOString() }]); });
        await advance(1_000);
        expect(notifications).toEqual([{ title: "Pet care: Potty", options: { body: "Potty is due now" } }]);
        expect((await data.loadPetReminderMarks())[0].dueAt).toBe(evening(21).toISOString());
        await advance(5_000);
        expect(notifications).toHaveLength(1);
    });

    it("defers a newly overdue crossing even when due was baselined on open", async () => {
        vi.setSystemTime(evening(21, 10));
        const data = await eveningData();
        render(wrap(data, busyAccess([runUntil(evening(21, 50))])));
        await ready();
        await tickAt(evening(21, 31));
        expect(notifications).toHaveLength(0);
        expect(screen.queryByText("Dinner is overdue")).toBeNull();
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(1);
        expect(notifications[0].options?.body).toBe(`Held during busy ${formatClock(evening(20, 50))}–${formatClock(evening(21, 50))}. Dinner is due now.`);
        expect(await data.loadPetReminderMarks()).toHaveLength(1);
    });

    it("drops an existing pending nudge when an interval becomes nap-paused", async () => {
        vi.setSystemTime(evening(20, 59, 30));
        const data = await eveningData([{ ...intervalItem(), createdAt: evening(20, 59).toISOString() }]);
        render(wrap(data, busyAccess([runUntil(evening(21, 50))])));
        await ready();
        await tickAt(evening(21));
        const activeNap = nap(evening(21), null);
        await act(async () => { await data.savePetNapRecords([activeNap]); });
        await advance(1_000);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await act(async () => { await data.savePetNapRecords([{ ...activeNap, end: evening(21, 50).toISOString() }]); });
        await advance(1_000);
        expect(notifications).toEqual([{ title: "Pet care: Potty", options: { body: "Potty is due now" } }]);
        expect((await data.loadPetReminderMarks())[0].dueAt).toBe(evening(21).toISOString());
    });

    it("moves a pending target later when a focus refresh grows the run", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        const access = busyAccess([runUntil(evening(21, 40))]);
        render(wrap(data, access));
        await ready();
        await tickAt(evening(21));
        await refreshBusy(access, [runUntil(evening(21, 50))]);
        await tickAt(evening(21, 40));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(1);
        expect(notifications[0].options?.body).toBe(`Held during busy ${formatClock(evening(20, 50))}–${formatClock(evening(21, 50))}. Dinner is due now.`);
        await advance(5_000);
        expect(notifications).toHaveLength(1);
    });

    it("drops pending when refreshed busy time moves the item to a future slot, then reminds normally", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        const access = busyAccess([runUntil(evening(21, 50))]);
        render(wrap(data, access));
        await ready();
        await tickAt(evening(21));
        await refreshBusy(access, [runUntil(evening(21, 20))]);
        await tickAt(evening(21, 19, 58));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
        await tickAt(evening(21, 20));
        expect(notifications).toEqual([{ title: "Pet care: Dinner", options: { body: "Dinner is due now" } }]);
        expect((await data.loadPetReminderMarks())[0].dueAt).toBe(evening(21).toISOString());
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(1);
    });

    it.each(["removed", "inactive"])("drops pending when the item is %s before day end", async (change) => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        render(wrap(data, busyAccess([runUntil(evening(22, 30))])));
        await ready();
        await tickAt(evening(21));
        await act(async () => { await data.savePetScheduleItems(change === "removed" ? [] : [{ ...blockedItem(), isActive: false }]); });
        await advance(1_000);
        await tickAt(evening(22));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
    });

    it("clears pending and baselines again when day settings change", async () => {
        vi.setSystemTime(evening(20, 59));
        const data = await eveningData();
        render(wrap(data, busyAccess([runUntil(evening(21, 50))])));
        await ready();
        await tickAt(evening(21));
        await act(async () => { await data.updateSettings({ ...makeAppState().settings, start_of_day: "08:00", end_of_day: "22:00" }); });
        await advance(1_000);
        // Baseline the overdue state too, so no new crossing creates another hold.
        await tickAt(evening(21, 35));
        await act(async () => { await data.updateSettings({ ...makeAppState().settings, start_of_day: "09:00", end_of_day: "22:00" }); });
        await advance(1_000);
        await tickAt(evening(21, 50));
        expect(notifications).toHaveLength(0);
        expect(await data.loadPetReminderMarks()).toEqual([]);
    });
});
