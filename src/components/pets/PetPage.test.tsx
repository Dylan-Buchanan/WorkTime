import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PetPage } from "./PetPage";
import { DataProvider } from "../../state/DataContext";
import { SyncProvider } from "../../state/SyncContext";
import { TauriCloseProvider } from "../../state/TauriCloseContext";
import { ToastProvider } from "../../state/ToastContext";
import { PetActivityProvider } from "../../state/PetActivityContext";
import { PetProvider } from "../../state/PetContext";
import { InMemoryDataAccess } from "../../lib/data/InMemoryDataAccess";
import { makeAppState } from "../../test/mockTauri";
import type {
    PetActivityRecord,
    PetActivityType,
    PetFlexibility,
    PetNapRecord,
    PetNotableEvent,
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

function notableEventRow(id: string, title: string, timestamp: Date): PetNotableEvent {
    return { id, title, notes: "", timestamp: timestamp.toISOString(), createdAt: T0, updatedAt: T0 };
}

function wrap(data: InMemoryDataAccess) {
    return (
        <TauriCloseProvider>
            <DataProvider dataAccess={data}>
                <SyncProvider ownerId={OWNER}>
                    <ToastProvider>
                        <PetProvider><PetActivityProvider><PetPage /></PetActivityProvider></PetProvider>
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
    localStorage.clear();
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

    it("adds notable events with a computed age stamp and filters by date range", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("No weight logged yet")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
        await waitFor(() => expect(screen.getByText("No notable events yet.")).toBeInTheDocument());

        // Today's default date: 2026-09-17 is 9 weeks after the 2026-07-10 birth.
        fireEvent.change(screen.getByLabelText("Event"), { target: { value: "First reliable sit" } });
        fireEvent.click(screen.getByRole("button", { name: "Add event" }));
        await waitFor(() => expect(screen.getByText("at 9 weeks: First reliable sit")).toBeInTheDocument());

        // A backdated event is stamped with the age at the event time.
        fireEvent.change(screen.getByLabelText("Event"), { target: { value: "First wag" } });
        fireEvent.change(screen.getByLabelText("Event date"), { target: { value: "2026-08-21" } });
        fireEvent.click(screen.getByRole("button", { name: "Add event" }));
        await waitFor(() => expect(screen.getByText("at 6 weeks: First wag")).toBeInTheDocument());

        // Chronological, newest first.
        const entries = screen.getAllByRole("listitem").map((item) => item.textContent);
        expect(entries[0]).toContain("First reliable sit");
        expect(entries[1]).toContain("First wag");

        // Date-range filtering over the event list.
        fireEvent.change(screen.getByLabelText("Filter from"), { target: { value: "2026-08-01" } });
        fireEvent.change(screen.getByLabelText("Filter to"), { target: { value: "2026-08-31" } });
        expect(screen.queryByText("at 9 weeks: First reliable sit")).toBeNull();
        expect(screen.getByText("at 6 weeks: First wag")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
        expect(screen.getByText("at 9 weeks: First reliable sit")).toBeInTheDocument();

        expect(await data.loadPetNotableEvents()).toHaveLength(2);
    });

    it("corrects a notable event in place and offers no delete", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetNotableEvents([notableEventRow("e1", "First reliable sit", new Date(2026, 7, 21, 12, 0))]);
        render(wrap(data));

        await waitFor(() => expect(screen.getByText("No weight logged yet")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
        await waitFor(() => expect(screen.getByText("at 6 weeks: First reliable sit")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "Edit First reliable sit" }));
        fireEvent.change(screen.getByLabelText("Edit event"), {
            target: { value: "First reliable sit (hand signal)" },
        });
        fireEvent.change(screen.getByLabelText("Edit date"), { target: { value: "2026-12-25" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
            expect(screen.getByText("at 24 weeks: First reliable sit (hand signal)")).toBeInTheDocument(),
        );

        // Curated history: no delete control exists anywhere in the tab.
        expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull();

        const [saved] = await data.loadPetNotableEvents();
        expect(saved).toMatchObject({ id: "e1", title: "First reliable sit (hand signal)", createdAt: T0 });
        expect(saved.updatedAt).not.toBe(T0);
    });

    it("keeps mechanical records out of the notable timeline", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        await data.savePetActivityRecords([activityRow("a1", "potty", at(13, 0))]);
        await data.savePetNapRecords([napRow("n1", at(14, 0), at(15, 0))]);
        await data.savePetWeightEntries([
            { id: "w1", timestamp: at(9, 0).toISOString(), weight: 4.2, createdAt: T0, updatedAt: T0 },
        ]);
        await data.savePetNotableEvents([notableEventRow("e1", "First reliable sit", new Date(2026, 7, 21, 12, 0))]);
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
        await waitFor(() => expect(screen.getByText("at 6 weeks: First reliable sit")).toBeInTheDocument());

        // Only the manually-created notable event is listed, never potty/nap/weight rows.
        const entries = screen.getAllByRole("listitem");
        expect(entries).toHaveLength(1);
        expect(entries[0]).toHaveTextContent("at 6 weeks: First reliable sit");
    });

    it("requires the pet profile before allowing timeline events", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
        await waitFor(() => expect(screen.getByText(/Today tab/)).toBeInTheDocument());
        expect(screen.queryByRole("button", { name: "Add event" })).toBeNull();
        expect(screen.queryByLabelText("Event")).toBeNull();
        expect(await data.loadPetNotableEvents()).toEqual([]);
    });

    it("rejects a blank notable event title without persisting", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        await data.savePetProfile(profileRow());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
        await waitFor(() => expect(screen.getByText("No notable events yet.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Event"), { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: "Add event" }));
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/title/i));
        expect(await data.loadPetNotableEvents()).toEqual([]);
    });

    it("creates, advances, and archives a training skill", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Training" }));
        await waitFor(() => expect(screen.getByText("What Whitney is learning right now.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Sit" } });
        fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
        await waitFor(() => expect(screen.getByText("Sit")).toBeInTheDocument());
        expect(await data.loadPetTrainingSkills()).toHaveLength(1);

        fireEvent.click(screen.getByRole("button", { name: "Advance Sit" }));
        await waitFor(() => expect(screen.getByText("Progressing")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "Advance Sit" }));
        await waitFor(() => expect(screen.getByText("Reliable")).toBeInTheDocument());
        // Reliable is the end of the line: no further advance control.
        expect(screen.queryByRole("button", { name: "Advance Sit" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Mark done Sit" }));
        await waitFor(async () => expect((await data.loadPetTrainingSkills())[0].resolvedAt).not.toBeNull());
        await waitFor(() => expect(screen.getByText("No skills in progress yet.")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "Show resolved skills (1)" }));
        expect(screen.getByText("Sit")).toBeInTheDocument();
    });

    it("steps a training skill back and reopens a resolved one", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Training" }));
        await waitFor(() => expect(screen.getByText("What Whitney is learning right now.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Sit" } });
        fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
        await waitFor(() => expect(screen.getByText("Sit")).toBeInTheDocument());

        // Introduced is the first status: no reverse control.
        expect(screen.queryByRole("button", { name: "Step back Sit" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Advance Sit" }));
        await waitFor(() => expect(screen.getByText("Progressing")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "Step back Sit" }));
        await waitFor(() => expect(screen.getByText("Introduced")).toBeInTheDocument());
        expect((await data.loadPetTrainingSkills())[0].status).toBe("introduced");

        fireEvent.click(screen.getByRole("button", { name: "Mark done Sit" }));
        await waitFor(() => expect(screen.getByText("No skills in progress yet.")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "Show resolved skills (1)" }));
        fireEvent.click(screen.getByRole("button", { name: "Reopen Sit" }));
        await waitFor(() => expect(screen.getByText("Introduced")).toBeInTheDocument());
        expect(await data.loadPetTrainingSkills()).toMatchObject([
            { label: "Sit", status: "introduced", resolvedAt: null },
        ]);
    });

    it("shows training progress and animates forward versus reverse steps", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Training" }));
        await waitFor(() => expect(screen.getByText("What Whitney is learning right now.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Sit" } });
        fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
        await waitFor(() => expect(screen.getByText("Sit")).toBeInTheDocument());

        // The card reflects its status and exposes an accessible progress meter.
        expect(screen.getByText("Sit").closest("li")).toHaveAttribute("data-status", "introduced");
        const progress = screen.getByRole("progressbar", { name: "Sit training progress" });
        expect(progress).toHaveAttribute("aria-valuenow", "1");
        expect(progress).toHaveAttribute("aria-valuetext", "Introduced");

        fireEvent.click(screen.getByRole("button", { name: "Advance Sit" }));
        await waitFor(() => expect(screen.getByText("Progressing")).toBeInTheDocument());
        expect(screen.getByRole("progressbar", { name: "Sit training progress" })).toHaveAttribute(
            "aria-valuenow",
            "2",
        );
        expect(screen.getByText("Sit").closest("li")).toHaveClass("training-step-forward");

        fireEvent.click(screen.getByRole("button", { name: "Step back Sit" }));
        await waitFor(() => expect(screen.getByText("Introduced")).toBeInTheDocument());
        expect(screen.getByRole("progressbar", { name: "Sit training progress" })).toHaveAttribute(
            "aria-valuenow",
            "1",
        );
        expect(screen.getByText("Sit").closest("li")).toHaveClass("training-step-back");
    });

    it("edits a training skill without disturbing its status and rejects a blank label", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Training" }));
        await waitFor(() => expect(screen.getByText("What Whitney is learning right now.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Sit" } });
        fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "lure" } });
        fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
        await waitFor(() => expect(screen.getByText("Sit")).toBeInTheDocument());
        fireEvent.click(screen.getByRole("button", { name: "Advance Sit" }));
        await waitFor(() => expect(screen.getByText("Progressing")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "Edit Sit" }));
        fireEvent.change(screen.getByLabelText("Edit skill"), { target: { value: "Sit (hand signal)" } });
        fireEvent.change(screen.getByLabelText("Edit notes"), { target: { value: "lure + marker" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.getByText("Sit (hand signal)")).toBeInTheDocument());
        expect(await data.loadPetTrainingSkills()).toMatchObject([
            { label: "Sit (hand signal)", notes: "lure + marker", status: "progressing", resolvedAt: null },
        ]);

        // A blank label is rejected and nothing is persisted.
        fireEvent.click(screen.getByRole("button", { name: "Edit Sit (hand signal)" }));
        fireEvent.change(screen.getByLabelText("Edit skill"), { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/label/i));
        expect((await data.loadPetTrainingSkills())[0].label).toBe("Sit (hand signal)");
    });

    it("resolves a fixation with a reason and preserves it in the archive", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Fixations" }));
        await waitFor(() => expect(screen.getByText("Current obsessions and behavior problems.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Fixation"), { target: { value: "Chasing the vacuum" } });
        fireEvent.click(screen.getByRole("button", { name: "Add fixation" }));
        await waitFor(() => expect(screen.getByText("Chasing the vacuum")).toBeInTheDocument());

        // A blank reason is rejected and the fixation stays active.
        fireEvent.click(screen.getByRole("button", { name: "Resolve Chasing the vacuum" }));
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/reason/i));
        expect((await data.loadPetFixations())[0].resolvedAt).toBeNull();

        fireEvent.change(screen.getByLabelText("Reason for Chasing the vacuum"), {
            target: { value: "grew out of it" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Resolve Chasing the vacuum" }));
        await waitFor(() => expect(screen.getByText("Show resolved fixations (1)")).toBeInTheDocument());

        const [saved] = await data.loadPetFixations();
        expect(saved.resolutionNote).toBe("grew out of it");
        expect(saved.resolvedAt).not.toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Show resolved fixations (1)" }));
        expect(screen.getByText(/grew out of it/)).toBeInTheDocument();
    });

    it("edits a fixation and cancels without persisting the draft", async () => {
        const data = new InMemoryDataAccess(makeAppState());
        render(wrap(data));

        fireEvent.click(screen.getByRole("tab", { name: "Fixations" }));
        await waitFor(() => expect(screen.getByText("Current obsessions and behavior problems.")).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText("Fixation"), { target: { value: "Chasing the vacuum" } });
        fireEvent.click(screen.getByRole("button", { name: "Add fixation" }));
        await waitFor(() => expect(screen.getByText("Chasing the vacuum")).toBeInTheDocument());

        fireEvent.click(screen.getByRole("button", { name: "Edit Chasing the vacuum" }));
        fireEvent.change(screen.getByLabelText("Edit fixation"), { target: { value: "Chasing brooms" } });
        fireEvent.change(screen.getByLabelText("Edit notes"), { target: { value: "redirection" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.getByText("Chasing brooms")).toBeInTheDocument());
        expect(await data.loadPetFixations()).toMatchObject([
            { label: "Chasing brooms", notes: "redirection", resolvedAt: null, resolutionNote: "" },
        ]);

        // Cancel discards the draft and keeps the persisted record.
        fireEvent.click(screen.getByRole("button", { name: "Edit Chasing brooms" }));
        fireEvent.change(screen.getByLabelText("Edit fixation"), { target: { value: "Discarded" } });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.getByText("Chasing brooms")).toBeInTheDocument());
        expect((await data.loadPetFixations())[0].label).toBe("Chasing brooms");
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
