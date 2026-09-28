import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";
import { makeAppState } from "../test/mockTauri";
import type { PetActivityRecord, PetScheduleItem } from "./types";
import { AppStateProvider, resetNotifyForTesting } from "./AppStateContext";
import { DataProvider } from "./DataContext";
import { PetActivityProvider, usePetActivity } from "./PetActivityContext";
import { PetReminderProvider } from "./PetReminderContext";
import { PetProvider } from "./PetContext";
import { SyncProvider } from "./SyncContext";
import { TauriCloseProvider } from "./TauriCloseContext";
import { ToastProvider } from "./ToastContext";

vi.mock("@tauri-apps/plugin-notification", () => {
    throw new Error("native notifications are unavailable in the browser test");
});

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
    return <div>ready:{String(hydrated)}:{Object.keys(state.records).length}</div>;
}

function wrap(data: InMemoryDataAccess) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <AppStateProvider>
                    <ToastProvider>
                        <PetProvider><PetActivityProvider>
                            <PetReminderProvider><Probe /></PetReminderProvider>
                        </PetActivityProvider></PetProvider>
                    </ToastProvider>
                    </AppStateProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
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
});
