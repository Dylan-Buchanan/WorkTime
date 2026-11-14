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
    it("attributes late logs only to the selected fixed occurrence and recomputes on undo", () => {
        const input = {
            now: at(15),
            scheduleItems: [fixedItem("breakfast", "feeding", "08:00", "fixed"), fixedItem("lunch", "feeding", "12:00", "fixed")],
            naps: [],
        };
        const record: PetActivityRecord = {
            ...activity("late", at(15), "feeding"),
            scheduleItemId: "breakfast", scheduleOccurrenceStart: at(8).toISOString(),
        };
        const schedule = buildPetSchedule({ ...input, activityRecords: [record] });
        expect(schedule.entries.map((entry) => entry.fulfilled)).toEqual([true, false]);
        expect(schedule.entries[0].fulfilledAt).toEqual(at(15));
        expect(schedule.entries[0].overdueMinutes).toBe(0);
        expect(nextDue(schedule)?.itemId).toBe("lunch");
        expect(buildPetSchedule({ ...input, activityRecords: [] }).entries.map((entry) => entry.fulfilled)).toEqual([false, false]);
    });

    it.each([
        { timestamp: at(16).toISOString() },
        { timestamp: at(7).toISOString() },
        { activityType: "playtime" as const },
        { scheduleItemId: "deleted-item" },
        { scheduleOccurrenceStart: new Date(2026, 8, 16, 8).toISOString() },
    ])("does not fulfill another occurrence with an invalid attribution: %j", (overrides) => {
        const schedule = buildPetSchedule({
            now: at(15),
            scheduleItems: [fixedItem("breakfast", "feeding", "08:00", "fixed"), fixedItem("lunch", "feeding", "12:00", "fixed")],
            naps: [],
            activityRecords: [{
                ...activity("late", at(15), "feeding"),
                scheduleItemId: "breakfast", scheduleOccurrenceStart: at(8).toISOString(), ...overrides,
            }],
        });
        expect(schedule.entries.every((entry) => !entry.fulfilled)).toBe(true);
    });

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

describe("buildPetSchedule calendar busy placement", () => {
    const walk = (time = "10:00", window = 0): PetScheduleItem => fixedItem("walk", "playtime", time, "flexible", window);
    const base = { now: at(12), activityRecords: [], naps: [] };
    const busy = (start: Date, end: Date) => [{ start, end }];

    it("preserves nap causes when a label contains the explanation separator", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [intervalItem({ label: "Potty — outside",
            recurrence: { mode: "interval", minMinutes: 30, maxMinutes: 90 } })],
            activityRecords: [activity("anchor", at(10))], naps: [nap("nap", at(10, 30), at(11))],
            busyIntervals: busy(at(11), at(11, 20)) }).entries[0];
        expect(entry.shift?.description).toBe("potty — outside +50m — nap 10:30 AM–11:00 AM; busy 11:00 AM–11:20 AM");
    });

    it.each([false, true])("preserves every legacy field with absent, empty, or out-of-day busy time (active nap: %s)", (active) => {
        const input = {
            now: at(11, 15),
            scheduleItems: [fixedItem("feeding", "feeding", "08:00", "fixed"), walk(), intervalItem()],
            activityRecords: [activity("anchor", at(10)), activity("fed", at(8, 5), "feeding")],
            naps: [nap("ended", at(10, 15), at(10, 30)), ...(active ? [nap("active", at(11), null)] : [])],
        };
        const baseline = buildPetSchedule(input).entries;
        for (const busyIntervals of [undefined, [], busy(at(23), at(23, 30))]) {
            expect(buildPetSchedule({ ...input, busyIntervals }).entries).toEqual(baseline);
        }
        const legacy = baseline.map(({ blockedBy, unshiftedStart, unshiftedWindowEnd, occurrenceStart, ...entry }) => {
            expect(blockedBy).toBeNull();
            expect(unshiftedStart).toEqual(entry.start);
            expect(unshiftedWindowEnd).toEqual(entry.windowEnd);
            expect(occurrenceStart).toEqual(entry.mode === "interval" ? at(11) : entry.start);
            return entry;
        });
        const due = active ? at(11, 30) : at(11, 15);
        const close = active ? at(12) : at(11, 45);
        expect(legacy).toEqual([
            { itemId: "feeding", activityType: "feeding", label: "Feeding", mode: "fixed-time", flexibility: "fixed", priority: 0,
                start: at(8), end: at(8), startMinutes: 480, endMinutes: 480, windowEnd: at(10), fulfilled: true, fulfilledAt: at(8, 5),
                overdueMinutes: 0, paused: false, pulledForward: false, shift: null },
            { itemId: "walk", activityType: "playtime", label: "Walk", mode: "fixed-time", flexibility: "flexible", priority: 0,
                start: at(10), end: at(10), startMinutes: 600, endMinutes: 600, windowEnd: due, fulfilled: false, fulfilledAt: null,
                overdueMinutes: 75, paused: false, pulledForward: false, shift: null },
            { itemId: "potty", activityType: "potty", label: "Potty", mode: "interval", flexibility: "flexible", priority: 0,
                start: due, end: close, startMinutes: active ? 690 : 675, endMinutes: active ? 720 : 705, windowEnd: at(22),
                fulfilled: false, fulfilledAt: null, overdueMinutes: 0, paused: active, pulledForward: false,
                shift: { itemId: "potty", activityType: "potty", label: "Potty", deltaMinutes: active ? 30 : 15, reason: "nap",
                    description: active ? "potty +30m — naps 10:15 AM–10:30 AM, 11:00 AM–11:15 AM" : "potty +15m — nap 10:15 AM–10:30 AM" } },
        ]);
    });

    it("moves a zero-window walk, retaining both anchors and exact busy explanation", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [walk()], busyIntervals: busy(at(10), at(10, 30)) }).entries[0];
        expect(entry).toMatchObject({ start: at(10, 30), end: at(10, 30), startMinutes: 630, endMinutes: 630,
            unshiftedStart: at(10), unshiftedWindowEnd: at(22), windowEnd: at(22), occurrenceStart: at(10), blockedBy: null,
            shift: { reason: "busy", deltaMinutes: 30, description: "walk +30m — busy 10:00 AM–10:30 AM" } });
    });

    it("composes nap then busy while retaining an interval's deadline and pre-nap identity", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [intervalItem({ recurrence: { mode: "interval", minMinutes: 30, maxMinutes: 90 } })],
            activityRecords: [activity("anchor", at(10))], naps: [nap("nap", at(10, 30), at(11))],
            busyIntervals: busy(at(11), at(11, 20)) }).entries[0];
        expect(entry).toMatchObject({ start: at(11, 20), end: at(12), startMinutes: 680, endMinutes: 720,
            occurrenceStart: at(10, 30), unshiftedStart: at(11), blockedBy: null,
            shift: { reason: "busy", deltaMinutes: 50, description: "potty +50m — nap 10:30 AM–11:00 AM; busy 11:00 AM–11:20 AM" } });
    });

    it("keeps the base interval identity when post-wake pull-forward is followed by busy", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [intervalItem()], activityRecords: [activity("anchor", at(10))],
            naps: [nap("nap", at(10, 30), at(11, 10))], busyIntervals: busy(at(11, 10), at(11, 20)) }).entries[0];
        expect(entry).toMatchObject({ occurrenceStart: at(11), unshiftedStart: at(11, 10), start: at(11, 10), end: at(11, 10),
            shift: { reason: "post-wake", deltaMinutes: 10, description: "potty +10m — post-wake 11:10 AM" },
            blockedBy: { start: at(11, 10), end: at(11, 20), reason: "interval-limit" } });
    });

    it("places competing non-zero windows sequentially", () => {
        const entries = buildPetSchedule({ ...base, scheduleItems: [walk("10:00", 30), fixedItem("training", "training", "10:10", "flexible", 30)],
            busyIntervals: busy(at(10), at(10, 30)) }).entries;
        expect(entries.map((entry) => [entry.start, entry.end, entry.shift?.deltaMinutes, entry.shift?.description, entry.blockedBy])).toEqual([
            [at(10, 30), at(11), 30, "walk +30m — busy 10:00 AM–10:30 AM", null],
            [at(11), at(11, 30), 50, "training +50m — busy 10:00 AM–10:30 AM", null],
        ]);
    });

    it("stacks zero-window items at the same free moment", () => {
        const entries = buildPetSchedule({ ...base, scheduleItems: [walk(), fixedItem("training", "training", "10:15", "flexible")],
            busyIntervals: busy(at(10), at(10, 30)) }).entries;
        expect(entries.map((entry) => [entry.start, entry.end, entry.shift?.deltaMinutes, entry.shift?.description, entry.blockedBy])).toEqual([
            [at(10, 30), at(10, 30), 15, "training +15m — busy 10:00 AM–10:30 AM", null],
            [at(10, 30), at(10, 30), 30, "walk +30m — busy 10:00 AM–10:30 AM", null],
        ]);
    });

    it("blocks a window that cannot fit before day end", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [walk("21:20", 30)], busyIntervals: busy(at(21, 20), at(21, 45)) }).entries[0];
        expect(entry).toMatchObject({ start: at(21, 20), end: at(21, 50), shift: null,
            blockedBy: { start: at(21, 20), end: at(21, 45), reason: "day-end" } });
    });

    it("blocks an interval at its maximum close", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [intervalItem({ recurrence: { mode: "interval", minMinutes: 60, maxMinutes: 70 } })],
            activityRecords: [activity("anchor", at(10))], busyIntervals: busy(at(11), at(11, 30)) }).entries[0];
        expect(entry).toMatchObject({ start: at(11), end: at(11, 10), shift: null,
            blockedBy: { start: at(11), end: at(11, 30), reason: "interval-limit" } });
    });

    it("clips busy past dayEnd and allows a zero-window item exactly onto dayEnd", () => {
        const entry = buildPetSchedule({ ...base, scheduleItems: [walk("21:50")], busyIntervals: busy(at(21, 40), at(22, 30)) }).entries[0];
        expect(entry).toMatchObject({ start: at(22), end: at(22), blockedBy: null,
            shift: { reason: "busy", deltaMinutes: 10, description: "walk +10m — busy 9:40 PM–10:00 PM" } });
    });

    it("leaves fixed items in either mode untouched and never reserves their time", () => {
        const items = [fixedItem("feeding", "feeding", "10:00", "fixed", 120),
            intervalItem({ flexibility: "fixed", createdAt: at(9).toISOString() }), walk()];
        const input = { ...base, scheduleItems: items };
        const before = buildPetSchedule(input).entries;
        const entries = buildPetSchedule({ ...input, busyIntervals: busy(at(10), at(10, 30)) }).entries;
        for (const id of ["feeding", "potty"]) expect(entries.find((entry) => entry.itemId === id)).toEqual(before.find((entry) => entry.itemId === id));
        expect(entries.find((entry) => entry.itemId === "walk")?.start).toEqual(at(10, 30));
    });

    it("lets an active nap own a paused occurrence even inside busy time", () => {
        const input = { ...base, scheduleItems: [intervalItem()], activityRecords: [activity("anchor", at(10))], naps: [nap("active", at(10, 30), null)] };
        expect(buildPetSchedule({ ...input, busyIntervals: busy(at(10), at(15)) }).entries).toEqual(buildPetSchedule(input).entries);
    });

    it.each([false, true])("fulfils a moved walk using pre-busy attribution (explicit: %s)", (explicit) => {
        const record = { ...activity("walk-log", at(10, 5), "playtime"),
            ...(explicit ? { scheduleItemId: "walk", scheduleOccurrenceStart: at(10).toISOString() } : {}) };
        const entry = buildPetSchedule({ ...base, scheduleItems: [walk()], activityRecords: [record], busyIntervals: busy(at(10), at(10, 30)) }).entries[0];
        expect(entry).toMatchObject({ start: at(10, 30), fulfilled: true, fulfilledAt: at(10, 5), overdueMinutes: 0 });
    });

    it("accrues overdue from the final end and never changes fulfilment grouping when final order changes", () => {
        const entry = buildPetSchedule({ ...base, now: at(10, 45), scheduleItems: [walk()], busyIntervals: busy(at(10), at(10, 30)) }).entries[0];
        expect(entry.overdueMinutes).toBe(15);
        const entries = buildPetSchedule({ ...base, scheduleItems: [walk(), fixedItem("feeding", "feeding", "10:15", "fixed")],
            busyIntervals: busy(at(10), at(10, 30)) }).entries;
        expect(entries.map((entry) => entry.itemId)).toEqual(["feeding", "walk"]);
        expect(entries[1].windowEnd).toEqual(at(10, 15));
        expect(entries[1].unshiftedWindowEnd).toEqual(at(10, 15));
    });

    it("clips an overnight run spanning midnight to the resolved schedule day", () => {
        const next = (hour: number, minute = 0) => new Date(2026, 8, 18, hour, minute);
        const schedule = buildPetSchedule({ ...base, now: at(23), startOfDay: "20:00", endOfDay: "08:00", scheduleItems: [walk("23:50", 20)],
            busyIntervals: busy(at(23, 45), next(0, 30)) });
        expect(schedule.entries[0]).toMatchObject({ start: next(0, 30), end: next(0, 50), blockedBy: null,
            shift: { deltaMinutes: 40, description: "walk +40m — busy 11:45 PM–12:30 AM" } });
    });

    it("clips a run to a non-midnight dayStart", () => {
        const entry = buildPetSchedule({ ...base, startOfDay: "07:00", scheduleItems: [walk("07:00")],
            busyIntervals: busy(at(6), at(7, 30)) }).entries[0];
        expect(entry).toMatchObject({ start: at(7, 30), end: at(7, 30), blockedBy: null,
            shift: { deltaMinutes: 30, description: "walk +30m — busy 7:00 AM–7:30 AM" } });
    });

    it("clips equal-boundary full days at their configured edges", () => {
        const next = new Date(2026, 8, 18, 22);
        const entry = buildPetSchedule({ ...base, now: at(23), startOfDay: "22:00", endOfDay: "22:00", scheduleItems: [walk("22:00")],
            busyIntervals: busy(at(21), new Date(2026, 8, 18, 23)) }).entries[0];
        expect(entry).toMatchObject({ start: next, end: next, blockedBy: null,
            shift: { deltaMinutes: 1440, description: "walk +1440m — busy 10:00 PM–10:00 PM" } });
    });

    it("blocks non-zero windows and bounded intervals under full-day busy time", () => {
        const entries = buildPetSchedule({ ...base, startOfDay: "07:00", scheduleItems: [walk("10:00", 30),
            intervalItem({ createdAt: at(9).toISOString() }), fixedItem("training", "training", "21:30", "flexible", 60)],
            busyIntervals: busy(at(6), at(23)) }).entries;
        expect(entries).toHaveLength(3);
        expect(entries.map((entry) => [entry.start, entry.end, entry.blockedBy, entry.shift])).toEqual([
            [at(10), at(10, 30), { start: at(7), end: at(22), reason: "interval-limit" }, null],
            [at(10), at(10, 30), { start: at(7), end: at(22), reason: "day-end" }, null],
            [at(21, 30), at(22), { start: at(7), end: at(22), reason: "day-end" }, null],
        ]);
    });

    it("keeps placement identical before, inside, and after a run without negative windows", () => {
        const input = { ...base, scheduleItems: [walk("10:00", 30)], busyIntervals: busy(at(10), at(10, 30)) };
        const placement = (now: Date) => buildPetSchedule({ ...input, now }).entries.map(({ start, end, shift, blockedBy }) => ({ start, end, shift, blockedBy }));
        expect(placement(at(10, 15))).toEqual(placement(at(8)));
        expect(placement(at(12))).toEqual(placement(at(8)));
        expect(placement(at(10, 15))[0].end.getTime() - placement(at(10, 15))[0].start.getTime()).toBe(30 * 60_000);
    });

    it("does not move items for pet-vs-pet overlap alone and respects half-open busy boundaries", () => {
        const entries = buildPetSchedule({ ...base, scheduleItems: [walk("10:00", 30), fixedItem("training", "training", "10:10", "flexible", 30)],
            busyIntervals: busy(at(9), at(10)) }).entries;
        expect(entries.map((entry) => [entry.start, entry.shift, entry.blockedBy])).toEqual([[at(10), null, null], [at(10, 10), null, null]]);
    });

    it("preserves ordered non-overlapping epoch lengths across the US fall-back night in any host timezone", () => {
        const previousTZ = process.env.TZ;
        process.env.TZ = "America/New_York";
        try {
            const schedule = buildPetSchedule({ ...base, now: new Date(2026, 9, 31, 22), startOfDay: "20:00", endOfDay: "08:00",
                scheduleItems: [walk("00:45", 30), fixedItem("training", "training", "01:00", "flexible", 30),
                    fixedItem("feeding", "feeding", "01:15", "flexible", 30)],
                busyIntervals: busy(new Date("2026-11-01T00:30:00-04:00"), new Date("2026-11-01T01:30:00-05:00")) });
            expect(schedule.dayEnd.getTime() - schedule.dayStart.getTime()).toBe(13 * 60 * 60_000);
            expect(schedule.entries).toHaveLength(3);
            let previousEnd = Date.parse("2026-11-01T01:30:00-05:00");
            for (const entry of schedule.entries) {
                expect(entry.shift?.reason).toBe("busy");
                expect(entry.blockedBy).toBeNull();
                expect(entry.start.getTime()).toBe(previousEnd);
                expect(entry.end.getTime() - entry.start.getTime()).toBe(30 * 60_000);
                previousEnd = entry.end.getTime();
            }
        } finally {
            if (previousTZ === undefined) delete process.env.TZ;
            else process.env.TZ = previousTZ;
        }
    });
});
