import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PetPage } from "./PetPage";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { ToastProvider } from "../../state/ToastContext";
import { PetActivityProvider } from "../../state/PetActivityContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import type {
    PetActivityRecord,
    PetActivityType,
    PetFlexibility,
    PetNapRecord,
    PetProfile,
    PetScheduleItem,
    PetWeightEntry,
} from "../../state/types";

const OWNER = "owner-1";
const T0 = "2026-01-01T00:00:00.000Z";
/** Pinned reference time: 2026-09-17 15:00 local. */
const NOW = new Date(2026, 8, 17, 15, 0, 0, 0);

function at(hour: number, minute = 0): Date {
    return new Date(2026, 8, 17, hour, minute, 0, 0);
}

function profileRow(): PetProfile {
    return { id: "p1", name: "Whitney", birthDate: "2026-07-10", createdAt: T0, updatedAt: T0 };
}

function fixedItem(
    id: string,
    activityType: PetActivityType,
    label: string,
    time: string,
    options: { flexibility?: PetFlexibility; windowMinutes?: number } = {},
): PetScheduleItem {
    const [hours, minutes] = time.split(":").map(Number);
    const startMinutes = hours * 60 + minutes;
    const windowMinutes = options.windowMinutes ?? 0;
    return {
        id,
        activityType,
        label,
        flexibility: options.flexibility ?? "fixed",
        priority: 0,
        recurrence: { mode: "fixed-time", time, startMinutes, endMinutes: startMinutes + windowMinutes },
        isActive: true,
        createdAt: T0,
        updatedAt: T0,
    };
}

function intervalItem(id: string, activityType: PetActivityType, label: string, minMinutes: number, maxMinutes: number): PetScheduleItem {
    return {
        id,
        activityType,
        label,
        flexibility: "flexible",
        priority: 0,
        recurrence: { mode: "interval", minMinutes, maxMinutes },
        isActive: true,
        createdAt: T0,
        updatedAt: T0,
    };
}

function activityRow(id: string, activityType: PetActivityType, timestamp: Date): PetActivityRecord {
    return { id, activityType, timestamp: timestamp.toISOString(), createdAt: T0 };
}

function napRow(id: string, start: Date, end: Date | null): PetNapRecord {
    return { id, start: start.toISOString(), end: end ? end.toISOString() : null, createdAt: T0, updatedAt: T0 };
}

function wrap(data: InMemoryDataAccess) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <ToastProvider>
                        <PetActivityProvider>
                            <PetPage />
                        </PetActivityProvider>
                    </ToastProvider>
                </SyncProvider>
            </DataProvider>
        </TauriCloseProvider>
    );
}

async function seedNapFlowData(data: InMemoryDataAccess) {
    await data.savePetProfile(profileRow());
    await data.savePetScheduleItems([
        intervalItem("potty", "potty", "Potty", 60, 90),
        fixedItem("play", "playtime", "Playtime", "15:30", { flexibility: "flexible" }),
        fixedItem("dinner", "feeding", "Dinner", "18:00"),
    ]);
    await data.savePetActivityRecords([activityRow("a1", "potty", at(13, 20))]);
    await data.savePetNapRecords([napRow("n1", at(14, 0), null)]);
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("PetPage", () => {
    it("runs the first-run onboarding from birth date to first schedule items", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("When was your puppy born?")).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Whitney" } });
        fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "2026-07-10" } });
        fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

        await waitFor(() => expect(screen.getByText("Add your first schedule items")).toBeInTheDocument());
        const saved = await data.loadPetProfile();
        expect(saved).toMatchObject({ name: "Whitney", birthDate: "2026-07-10" });
        expect(screen.getByText(/9 weeks old/)).toBeInTheDocument();
    });

    it("adds the first schedule items and notes a mid-day start gracefully", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("Add your first schedule items")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "+ Add schedule item" }));
        fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Evening meal" } });
        fireEvent.change(screen.getByLabelText("Activity"), { target: { value: "feeding" } });
        fireEvent.change(screen.getByLabelText("Flexibility"), { target: { value: "fixed" } });
        fireEvent.change(screen.getByLabelText("Time"), { target: { value: "18:00" } });
        fireEvent.click(screen.getByRole("button", { name: "Add schedule item" }));

        await waitFor(() => expect(screen.getByText("Today's schedule")).toBeInTheDocument());
        expect(screen.getByText("6:00 PM")).toBeInTheDocument();
        expect(screen.getByText(/Tracking started mid-day/)).toBeInTheDocument();
        const items = await data.loadPetScheduleItems();
        expect(items[0].recurrence).toMatchObject({ mode: "fixed-time", time: "18:00" });
    });

    it("does not mark a newly added interval item overdue", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("Add your first schedule items")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "+ Add schedule item" }));
        fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Potty break" } });
        fireEvent.change(screen.getByLabelText("Recurrence"), { target: { value: "interval" } });
        fireEvent.click(screen.getByRole("button", { name: "Add schedule item" }));

        await waitFor(() => expect(screen.getByText("Today's schedule")).toBeInTheDocument());
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByText(/next potty break ~4:30 PM/)).toBeInTheDocument();
    });

    it("collapses completed items into the summary strip and expands the full day", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetScheduleItems([
            fixedItem("feed1", "feeding", "Breakfast", "08:00", { windowMinutes: 30 }),
            fixedItem("train1", "training", "Clicker practice", "13:00"),
        ]);
        await data.savePetActivityRecords([
            activityRow("a1", "feeding", at(8, 5)),
            activityRow("a2", "training", at(13, 5)),
        ]);
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("Today's schedule")).toBeInTheDocument());
        expect(screen.getByText("Done today: 1 training, 1 feeding")).toBeInTheDocument();
        expect(screen.queryByText("done at 8:05 AM")).toBeNull();
        expect(screen.getByText("Nothing else due today. 🎉")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Show full day" }));
        expect(screen.getByText("done at 8:05 AM")).toBeInTheDocument();
        expect(screen.getByText("done at 1:05 PM")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Show upcoming only" }));
        expect(screen.queryByText("done at 8:05 AM")).toBeNull();
    });

    it("logs an unscheduled potty from the persistent bar through the single write path", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetScheduleItems([intervalItem("potty", "potty", "Potty", 60, 90)]);
        await data.savePetActivityRecords([activityRow("a1", "potty", at(13, 30))]);
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("Today's schedule")).toBeInTheDocument());
        expect(screen.getByText("due now")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "🚽 Potty" }));
        await waitFor(() => expect(screen.getByText("Logged potty")).toBeInTheDocument());
        expect(screen.getByText("Done today: 2 potty")).toBeInTheDocument();
        // The interval re-anchors to the fresh record, so the next potty is ~16:00.
        expect(screen.getByText(/next potty ~4:00 PM/)).toBeInTheDocument();

        const records = await data.loadPetActivityRecords();
        expect(records).toHaveLength(2);
        expect(records.some((record) => record.timestamp === NOW.toISOString())).toBe(true);
    });

    it("shows the overdue banner with its inline fix action", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetScheduleItems([intervalItem("potty", "potty", "Potty", 60, 90)]);
        await data.savePetActivityRecords([activityRow("a1", "potty", at(12, 0))]);
        render(wrap(data));

        await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
        expect(screen.getByRole("alert")).toHaveTextContent("Potty was due 90 min ago");

        fireEvent.click(screen.getByRole("button", { name: "Log potty" }));
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        expect(screen.getByText("Done today: 2 potty")).toBeInTheDocument();
        expect(screen.getByText("Logged potty")).toBeInTheDocument();
    });

    it("pauses the schedule during a nap and proposes a reflow on wake-up", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await seedNapFlowData(data);
        render(wrap(data));

        await waitFor(() => expect(screen.getByText(/Whitney's napping/)).toBeInTheDocument());
        expect(screen.getByText(/next potty ~3:20 PM/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Napping — 60m/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /Napping — 60m/ }));

        const panel = await waitFor(() => screen.getByRole("dialog", { name: "Nap reflow suggestion" }));
        expect(panel).toHaveTextContent("The nap ran 60 minutes.");
        expect(panel).toHaveTextContent("↺ potty → 3:00 PM (was 2:20 PM)");
        expect(panel).toHaveTextContent("↺ playtime → 4:30 PM (was 3:30 PM)");
        const endedNap = (await data.loadPetNapRecords())[0];
        expect(endedNap.end).toBe(NOW.toISOString());

        fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByText("4:30 PM")).toBeInTheDocument();
        expect(screen.getByText("due now")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "✓ Log potty" })).toBeInTheDocument();

        const items = await data.loadPetScheduleItems();
        const playtime = items.find((item) => item.id === "play");
        expect(playtime?.recurrence).toMatchObject({ mode: "fixed-time", time: "16:30", startMinutes: 990 });
        const dinner = items.find((item) => item.id === "dinner");
        expect(dinner?.recurrence).toMatchObject({ time: "18:00" });
    });

    it("Adjust skips the reflow suggestion and keeps the original times", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await seedNapFlowData(data);
        render(wrap(data));

        await waitFor(() => expect(screen.getByRole("button", { name: /Napping — 60m/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: /Napping — 60m/ }));
        await waitFor(() => screen.getByRole("dialog", { name: "Nap reflow suggestion" }));

        fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByText("3:30 PM")).toBeInTheDocument();
        const items = await data.loadPetScheduleItems();
        expect(items.find((item) => item.id === "play")?.recurrence).toMatchObject({ time: "15:30" });
    });

    it("renders placeholder tabs for Training, Fixations, and Timeline", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetScheduleItems([fixedItem("dinner", "feeding", "Dinner", "18:00")]);
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("Today's schedule")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("tab", { name: "Training" }));
        expect(screen.getByText(/Training skill tracking is coming soon/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: "Fixations" }));
        expect(screen.getByText(/Fixation tracking is coming soon/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
        expect(screen.getByText(/notable-events timeline is coming soon/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("tab", { name: "Today" }));
        await waitFor(() => expect(screen.getByText("Today's schedule")).toBeInTheDocument());
    });

    it("appends weight entries and shows the latest as the current weight", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetScheduleItems([fixedItem("dinner", "feeding", "Dinner", "18:00")]);
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("No weight logged yet")).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText("Log weight"), { target: { value: "4.2" } });
        fireEvent.click(screen.getByRole("button", { name: "Add weight" }));

        await waitFor(() => expect(screen.getByText("Current weight 4.2")).toBeInTheDocument());
        const entries: PetWeightEntry[] = await data.loadPetWeightEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].weight).toBe(4.2);
    });
});
