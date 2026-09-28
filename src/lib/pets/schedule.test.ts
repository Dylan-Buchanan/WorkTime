import { describe, expect, it } from "vitest";
import type { PetActivityRecord, PetActivityType, PetNapRecord, PetScheduleItem } from "../../state/types";
import {
    buildPetSchedule,
    freeUntil,
    latestActivityRecord,
    latestWeightEntry,
    nextDue,
} from "./schedule";

const createdAt = new Date(2026, 8, 17, 0, 0, 0, 0).toISOString();

function at(hour: number, minute = 0): Date {
    return new Date(2026, 8, 17, hour, minute, 0, 0);
}

function intervalItem(overrides: Partial<PetScheduleItem> = {}): PetScheduleItem {
    return {
        id: "potty",
        activityType: "potty",
        label: "Potty",
        flexibility: "flexible",
        priority: 0,
        recurrence: { mode: "interval", minMinutes: 60, maxMinutes: 90 },
        isActive: true,
        createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

function fixedItem(
    id: string,
    activityType: PetActivityType,
    time: string,
    flexibility: "fixed" | "flexible",
    windowMinutes = 0,
): PetScheduleItem {
    const [hours, minutes] = time.split(":").map(Number);
    const startMinutes = hours * 60 + minutes;
    return {
        id,
        activityType,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        flexibility,
        priority: 0,
        recurrence: { mode: "fixed-time", time, startMinutes, endMinutes: startMinutes + windowMinutes },
        isActive: true,
        createdAt,
        updatedAt: createdAt,
    };
}

function activity(id: string, when: Date, activityType: PetActivityType = "potty"): PetActivityRecord {
    return { id, activityType, timestamp: when.toISOString(), createdAt };
}

function nap(id: string, start: Date, end: Date | null): PetNapRecord {
    return { id, start: start.toISOString(), end: end ? end.toISOString() : null, createdAt, updatedAt: createdAt };
}

describe("buildPetSchedule interval anchoring", () => {
    it("starts a configured day with fresh fixed and interval occurrences", () => {
        const now = new Date(2026, 8, 18, 6, 30);
        const fixed = fixedItem("morning", "feeding", "06:00", "fixed");
        const interval = intervalItem({ recurrence: { mode: "interval", minMinutes: 60, maxMinutes: 90 } });
        const yesterday = new Date(2026, 8, 17, 23, 30);
        const schedule = buildPetSchedule({
            now,
            startOfDay: "06:00",
            endOfDay: "22:00",
            scheduleItems: [fixed, interval],
            activityRecords: [activity("yesterday", yesterday)],
            naps: [],
        });

        expect(schedule.dayStart).toEqual(new Date(2026, 8, 18, 6, 0));
        expect(schedule.dayEnd).toEqual(new Date(2026, 8, 18, 22, 0));
        expect(schedule.entries.find((entry) => entry.itemId === "morning")).toMatchObject({
            fulfilled: false,
            overdueMinutes: 30,
        });
        expect(schedule.entries.find((entry) => entry.itemId === "potty")?.start).toEqual(new Date(2026, 8, 18, 7, 0));

        const withCurrentActivity = buildPetSchedule({
            now,
            startOfDay: "06:00",
            endOfDay: "22:00",
            scheduleItems: [fixed, interval],
            activityRecords: [
                activity("yesterday", yesterday),
                activity("today-feeding", new Date(2026, 8, 18, 6, 10), "feeding"),
                activity("today-potty", new Date(2026, 8, 18, 6, 10)),
            ],
            naps: [],
        });
        expect(withCurrentActivity.entries.find((entry) => entry.itemId === "morning")?.fulfilled).toBe(true);
        expect(withCurrentActivity.entries.find((entry) => entry.itemId === "potty")?.start).toEqual(new Date(2026, 8, 18, 7, 10));
    });

    it("places overnight fixed occurrences on the calendar day inside the configured window", () => {
        const now = new Date(2026, 8, 18, 6, 30);
        const morning = fixedItem("morning", "feeding", "06:00", "fixed");
        const outside = fixedItem("midday", "feeding", "12:00", "fixed");
        const schedule = buildPetSchedule({
            now,
            startOfDay: "20:00",
            endOfDay: "08:00",
            scheduleItems: [morning, outside],
            activityRecords: [],
            naps: [],
        });

        expect(schedule.dayStart).toEqual(new Date(2026, 8, 17, 20, 0));
        expect(schedule.dayEnd).toEqual(new Date(2026, 8, 18, 8, 0));
        expect(schedule.entries.map((entry) => entry.itemId)).toEqual(["morning"]);
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 18, 6, 0));
    });

    it("ends the configured schedule window until the next start boundary", () => {
        const schedule = buildPetSchedule({
            now: new Date(2026, 8, 17, 22, 1),
            startOfDay: "06:00",
            endOfDay: "22:00",
            scheduleItems: [fixedItem("dinner", "feeding", "18:00", "fixed")],
            activityRecords: [],
            naps: [],
        });
        expect(schedule.dayStart).toEqual(new Date(2026, 8, 17, 6, 0));
        expect(schedule.dayEnd).toEqual(new Date(2026, 8, 17, 22, 0));
        expect(schedule.entries).toEqual([]);
    });

    it("closes the default day at 22:00 and starts fresh at the next midnight", () => {
        const dinner = fixedItem("dinner", "feeding", "21:00", "fixed");
        const late = fixedItem("late", "feeding", "23:00", "fixed");
        const input = { scheduleItems: [dinner, late], activityRecords: [], naps: [] };
        const before = buildPetSchedule({ ...input, now: at(21, 59) });
        expect(before.entries.map((entry) => entry.itemId)).toEqual(["dinner"]);
        expect(before.entries[0].overdueMinutes).toBe(59);
        expect(buildPetSchedule({ ...input, now: at(22) }).entries).toEqual([]);
        const next = buildPetSchedule({ ...input, now: new Date(2026, 8, 18, 0, 0) });
        expect(next.dayStart).toEqual(new Date(2026, 8, 18, 0, 0));
        expect(next.entries.map((entry) => entry.itemId)).toEqual(["dinner"]);
        expect(next.entries[0].overdueMinutes).toBe(0);
    });

    it("skips a gap-due interval and ignores its prior-day record at the next start", () => {
        const potty = intervalItem({ recurrence: { mode: "interval", minMinutes: 240, maxMinutes: 270 } });
        const previous = activity("evening", at(19));
        const input = { startOfDay: "06:00", endOfDay: "22:00", scheduleItems: [potty], activityRecords: [previous], naps: [] };
        expect(buildPetSchedule({ ...input, now: at(21) }).entries).toEqual([]);
        const next = buildPetSchedule({ ...input, now: new Date(2026, 8, 18, 6, 0) });
        expect(next.entries[0].start).toEqual(new Date(2026, 8, 18, 10, 0));
        expect(next.entries[0].fulfilled).toBe(false);
    });

    it("keeps a future creation timestamp as the first interval anchor", () => {
        const item = intervalItem({ createdAt: at(18).toISOString() });
        const schedule = buildPetSchedule({ now: at(15), scheduleItems: [item], activityRecords: [], naps: [] });
        expect(schedule.entries[0].start).toEqual(at(19));
        expect(schedule.entries[0].overdueMinutes).toBe(0);
    });

    it("keeps derived end minutes aligned with the clamped end", () => {
        const fixed = fixedItem("late", "feeding", "21:30", "fixed", 60);
        const interval = intervalItem({ recurrence: { mode: "interval", minMinutes: 30, maxMinutes: 90 }, createdAt: at(21).toISOString() });
        const schedule = buildPetSchedule({ now: at(21, 45), scheduleItems: [fixed, interval], activityRecords: [], naps: [] });
        expect(schedule.entries).toHaveLength(2);
        for (const entry of schedule.entries) {
            expect(entry.end).toEqual(at(22));
            expect(entry.endMinutes).toBe(22 * 60);
        }
    });

    it("treats equal boundaries as a full 24-hour day", () => {
        const schedule = buildPetSchedule({ now: at(23), startOfDay: "22:00", endOfDay: "22:00",
            scheduleItems: [fixedItem("morning", "feeding", "06:00", "fixed")], activityRecords: [], naps: [] });
        expect(schedule.dayEnd).toEqual(new Date(2026, 8, 18, 22));
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 18, 6));
    });

    it("starts a new interval at item creation instead of local midnight", () => {
        const item = intervalItem({ createdAt: at(15, 0).toISOString() });
        const schedule = buildPetSchedule({
            now: at(15, 0),
            scheduleItems: [item],
            activityRecords: [],
            naps: [],
        });
        const entry = schedule.entries[0];
        expect(entry.start).toEqual(at(16, 0));
        expect(entry.end).toEqual(at(16, 30));
        expect(entry.overdueMinutes).toBe(0);
        expect(nextDue(schedule)?.overdueMinutes).toBe(0);
    });

    it("anchors to the latest matching activity record", () => {
        const schedule = buildPetSchedule({
            now: at(10, 30),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [],
        });
        const entry = schedule.entries[0];
        expect(entry.start.getHours()).toBe(11);
        expect(entry.start.getMinutes()).toBe(0);
        expect(entry.end.getMinutes()).toBe(30);
        expect(entry.overdueMinutes).toBe(0);
        expect(entry.shift).toBeNull();
    });

    it("uses timestamp order rather than array order", () => {
        const schedule = buildPetSchedule({
            now: at(10, 30),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("newer", at(10, 0)), activity("older", at(9, 30))],
            naps: [],
        });
        expect(schedule.entries[0].start.getHours()).toBe(11);
    });

    it("re-derives the interval when a timestamp is corrected out of order", () => {
        const corrected = [activity("a", at(9, 0)), activity("b", at(9, 30))];
        const schedule = buildPetSchedule({ now: at(10, 30), scheduleItems: [intervalItem()], activityRecords: corrected, naps: [] });
        expect(schedule.entries[0].start.getHours()).toBe(10);
        expect(schedule.entries[0].start.getMinutes()).toBe(30);
        expect(latestActivityRecord(corrected, "potty")?.id).toBe("b");
    });
});

describe("buildPetSchedule nap reflow", () => {
    it("pauses an interval item while napping and reports the shift", () => {
        const schedule = buildPetSchedule({
            now: at(11, 0),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [nap("n1", at(10, 30), null)],
        });
        expect(schedule.napping).toBe(true);
        const entry = schedule.entries[0];
        expect(entry.paused).toBe(true);
        expect(entry.start.getHours()).toBe(11);
        expect(entry.start.getMinutes()).toBe(30);
        expect(entry.shift?.description).toBe("potty +30m — nap 10:30 AM–11:00 AM");
    });

    it("pulls the next occurrence forward when a nap spans its due time", () => {
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [nap("n1", at(10, 30), at(11, 10))],
        });
        const entry = schedule.entries[0];
        expect(entry.pulledForward).toBe(true);
        expect(entry.start.getHours()).toBe(11);
        expect(entry.start.getMinutes()).toBe(10);
        expect(entry.overdueMinutes).toBe(50);
        expect(entry.shift?.description).toBe("potty +10m — post-wake 11:10 AM");
    });

    it("leaves fixed items in place when a nap ends just before them", () => {
        const schedule = buildPetSchedule({
            now: at(11, 0),
            scheduleItems: [intervalItem(), fixedItem("training", "training", "11:05", "fixed")],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [nap("n1", at(10, 30), at(11, 0))],
        });
        const training = schedule.entries.find((entry) => entry.itemId === "training");
        expect(training?.startMinutes).toBe(665);
        expect(training?.shift).toBeNull();
        expect(freeUntil(schedule)?.getHours()).toBe(11);
        expect(freeUntil(schedule)?.getMinutes()).toBe(5);
        expect(nextDue(schedule)?.itemId).toBe("potty");
    });

    it("re-anchors and keeps pausing when a potty is logged mid-nap", () => {
        const schedule = buildPetSchedule({
            now: at(11, 30),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("p1", at(10, 0)), activity("p2", at(10, 45))],
            naps: [nap("n1", at(10, 30), at(11, 10))],
        });
        const entry = schedule.entries[0];
        expect(entry.pulledForward).toBe(false);
        expect(entry.start.getHours()).toBe(12);
        expect(entry.start.getMinutes()).toBe(10);
        expect(entry.overdueMinutes).toBe(0);
    });

    it("accumulates pause across two consecutive naps", () => {
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [nap("n1", at(10, 30), at(11, 0)), nap("n2", at(11, 10), at(11, 40))],
        });
        const entry = schedule.entries[0];
        expect(entry.pulledForward).toBe(true);
        expect(entry.start.getHours()).toBe(11);
        expect(entry.start.getMinutes()).toBe(40);
        expect(entry.overdueMinutes).toBe(20);
    });

    it("counts overlapping nap time once and explains every contributing nap", () => {
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [intervalItem({ recurrence: { mode: "interval", minMinutes: 120, maxMinutes: 150 } })],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [nap("n1", at(10, 10), at(10, 40)), nap("n2", at(10, 20), at(10, 50))],
        });
        const entry = schedule.entries[0];
        expect(entry.start.getHours()).toBe(12);
        expect(entry.start.getMinutes()).toBe(40);
        expect(entry.shift?.deltaMinutes).toBe(40);
        expect(entry.shift?.description).toBe("potty +40m — naps 10:10 AM–10:40 AM, 10:20 AM–10:50 AM");
    });

    it("does not accrue overdue while the pet is napping", () => {
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [intervalItem()],
            activityRecords: [activity("p1", at(10, 0))],
            naps: [nap("n1", at(10, 30), at(10, 50))],
        });
        const entry = schedule.entries[0];
        expect(entry.pulledForward).toBe(false);
        expect(entry.end.getHours()).toBe(11);
        expect(entry.end.getMinutes()).toBe(50);
        expect(entry.overdueMinutes).toBe(10);
    });
});

describe("buildPetSchedule fulfillment and due reporting", () => {
    it("matches fulfillment only inside [item start, next item start)", () => {
        const schedule = buildPetSchedule({
            now: at(16, 0),
            scheduleItems: [fixedItem("training", "training", "15:45", "flexible"), fixedItem("playtime", "playtime", "16:30", "flexible")],
            activityRecords: [activity("t1", at(15, 45), "training")],
            naps: [],
        });
        const training = schedule.entries.find((entry) => entry.itemId === "training");
        expect(training?.fulfilled).toBe(true);
        expect(training?.fulfilledAt?.getHours()).toBe(15);
        expect(training?.fulfilledAt?.getMinutes()).toBe(45);
        expect(schedule.entries.find((entry) => entry.itemId === "playtime")?.fulfilled).toBe(false);
    });

    it("does not fulfill an item from a record at the next item's start", () => {
        const schedule = buildPetSchedule({
            now: at(17, 0),
            scheduleItems: [fixedItem("training", "training", "15:45", "flexible"), fixedItem("playtime", "playtime", "16:30", "flexible")],
            activityRecords: [activity("t1", at(16, 30), "training")],
            naps: [],
        });
        expect(schedule.entries.find((entry) => entry.itemId === "training")?.fulfilled).toBe(false);
    });

    it("does not fulfill an item from a record after now", () => {
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [fixedItem("training", "training", "11:00", "flexible"), fixedItem("playtime", "playtime", "13:00", "flexible")],
            activityRecords: [activity("future", at(12, 30), "training")],
            naps: [],
        });
        expect(schedule.entries.find((entry) => entry.itemId === "training")?.fulfilled).toBe(false);
    });

    it("gives equal-start items the same next strictly later window end", () => {
        const first = fixedItem("training", "training", "11:00", "flexible");
        const second = { ...fixedItem("playtime", "playtime", "11:00", "flexible"), priority: 1 };
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [first, second, fixedItem("feeding", "feeding", "13:00", "fixed")],
            activityRecords: [activity("t1", at(11, 0), "training"), activity("p1", at(11, 0), "playtime")],
            naps: [],
        });
        const training = schedule.entries.find((entry) => entry.itemId === "training");
        const playtime = schedule.entries.find((entry) => entry.itemId === "playtime");
        expect(training?.windowEnd.getHours()).toBe(13);
        expect(playtime?.windowEnd.getHours()).toBe(13);
        expect(training?.fulfilled).toBe(true);
        expect(playtime?.fulfilled).toBe(true);
    });

    it("reports the next obligation and free-until as distinct answers", () => {
        const schedule = buildPetSchedule({
            now: at(12, 0),
            scheduleItems: [fixedItem("feeding", "feeding", "11:00", "fixed"), fixedItem("playtime", "playtime", "13:00", "flexible")],
            activityRecords: [],
            naps: [],
        });
        const due = nextDue(schedule);
        expect(due?.itemId).toBe("feeding");
        expect(due?.overdueMinutes).toBe(60);
        expect(freeUntil(schedule)?.getHours()).toBe(13);
    });
});

describe("latestWeightEntry", () => {
    it("returns the latest measurement regardless of array order", () => {
        const latest = latestWeightEntry([
            { id: "a", timestamp: at(9).toISOString(), weight: 4, createdAt, updatedAt: createdAt },
            { id: "c", timestamp: at(15).toISOString(), weight: 4.4, createdAt, updatedAt: createdAt },
            { id: "b", timestamp: at(12).toISOString(), weight: 4.2, createdAt, updatedAt: createdAt },
        ]);
        expect(latest?.id).toBe("c");
    });
});
