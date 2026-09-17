import { describe, expect, it } from "vitest";
import type { PetActivityRecord, PetActivityType, PetScheduleItem } from "../../state/types";
import {
    canCorrectActivityRecord,
    correctActivityTimestamp,
    countActivitiesToday,
    logActivity,
    removeActivityRecord,
} from "./activityLog";
import { buildPetSchedule } from "./schedule";

const now = new Date(2026, 8, 17, 12, 0, 0, 0);

function activity(
    id: string,
    activityType: PetActivityType,
    date: Date,
    durationMinutes?: number,
): PetActivityRecord {
    const record: PetActivityRecord = {
        id,
        activityType,
        timestamp: date.toISOString(),
        createdAt: now.toISOString(),
    };
    if (durationMinutes !== undefined) record.durationMinutes = durationMinutes;
    return record;
}

function pottyItem(overrides: Partial<PetScheduleItem> = {}): PetScheduleItem {
    return {
        id: "s-potty",
        activityType: "potty",
        label: "Potty",
        flexibility: "flexible",
        priority: 0,
        recurrence: { mode: "interval", minMinutes: 60, maxMinutes: 90 },
        isActive: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ...overrides,
    };
}

describe("pet activity log", () => {
    it("appends one minimal record through the single write path", () => {
        const existing = activity("a1", "potty", new Date(2026, 8, 17, 9, 0));
        const result = logActivity([existing], { activityType: "potty", timestamp: new Date(2026, 8, 17, 10, 0) }, now, "a2");

        expect(result.records.map((record) => record.id)).toEqual(["a1", "a2"]);
        expect(result.record).toEqual({
            id: "a2",
            activityType: "potty",
            timestamp: new Date(2026, 8, 17, 10, 0).toISOString(),
            createdAt: now.toISOString(),
        });
        // Pure: the input array is never mutated.
        expect(existing.id).toBe("a1");
        expect([existing]).toHaveLength(1);
    });

    it("accepts a duration only for training and playtime", () => {
        const trained = logActivity([], { activityType: "training", timestamp: now, durationMinutes: 12 }, now, "a1");
        expect(trained.record.durationMinutes).toBe(12);
        const played = logActivity([], { activityType: "playtime", timestamp: now, durationMinutes: 30 }, now, "a2");
        expect(played.record.durationMinutes).toBe(30);

        expect(() => logActivity([], { activityType: "potty", timestamp: now, durationMinutes: 5 }, now, "a3"))
            .toThrow(RangeError);
        expect(() => logActivity([], { activityType: "feeding", timestamp: now, durationMinutes: 5 }, now, "a4"))
            .toThrow(RangeError);
    });

    it("recomputes the interval anchor after undo and re-logging", () => {
        const item = pottyItem();
        const first = logActivity([], { activityType: "potty", timestamp: new Date(2026, 8, 17, 10, 0) }, now, "a1");
        const second = logActivity(first.records, { activityType: "potty", timestamp: new Date(2026, 8, 17, 11, 0) }, now, "a2");
        let schedule = buildPetSchedule({ now, scheduleItems: [item], activityRecords: second.records, naps: [] });
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 17, 12, 0));

        const undone = removeActivityRecord(second.records, "a2");
        schedule = buildPetSchedule({ now, scheduleItems: [item], activityRecords: undone, naps: [] });
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 17, 11, 0));

        const relogged = logActivity(undone, { activityType: "potty", timestamp: new Date(2026, 8, 17, 11, 15) }, now, "a3");
        schedule = buildPetSchedule({ now, scheduleItems: [item], activityRecords: relogged.records, naps: [] });
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 17, 12, 15));
    });

    it("anchors on the latest record at or before now when entries are out of order", () => {
        const item = pottyItem();
        const records = [
            activity("later", "potty", new Date(2026, 8, 17, 13, 0)),
            activity("earlier", "potty", new Date(2026, 8, 17, 10, 0)),
        ];
        const schedule = buildPetSchedule({ now, scheduleItems: [item], activityRecords: records, naps: [] });
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 17, 11, 0));
    });

    it("correction edits today's timestamp in place and shifts the interval", () => {
        const item = pottyItem();
        const records = [activity("a1", "potty", new Date(2026, 8, 17, 10, 0))];
        const corrected = correctActivityTimestamp(records, "a1", new Date(2026, 8, 17, 10, 30), now);
        expect(corrected[0].timestamp).toBe(new Date(2026, 8, 17, 10, 30).toISOString());
        expect(corrected[0].createdAt).toBe(records[0].createdAt);

        const schedule = buildPetSchedule({ now, scheduleItems: [item], activityRecords: corrected, naps: [] });
        expect(schedule.entries[0].start).toEqual(new Date(2026, 8, 17, 11, 30));
    });

    it("rejects corrections to yesterday-and-older records or unknown ids", () => {
        const records = [
            activity("today", "potty", new Date(2026, 8, 17, 9, 0)),
            activity("yesterday", "potty", new Date(2026, 8, 16, 9, 0)),
        ];
        expect(canCorrectActivityRecord(records[0], now)).toBe(true);
        expect(canCorrectActivityRecord(records[1], now)).toBe(false);
        expect(() => correctActivityTimestamp(records, "yesterday", new Date(2026, 8, 17, 9, 30), now))
            .toThrow(RangeError);
        expect(() => correctActivityTimestamp(records, "missing", now, now)).toThrow(RangeError);
    });

    it("counts only records from today that are not in the future", () => {
        const records = [
            activity("p1", "potty", new Date(2026, 8, 17, 9, 0)),
            activity("t1", "training", new Date(2026, 8, 17, 11, 0), 10),
            activity("f1", "feeding", new Date(2026, 8, 17, 8, 0)),
            activity("yesterday", "potty", new Date(2026, 8, 16, 15, 0)),
            activity("tomorrow", "potty", new Date(2026, 8, 18, 9, 0)),
            activity("future-today", "potty", new Date(2026, 8, 17, 13, 0)),
        ];
        expect(countActivitiesToday(records, now)).toEqual({
            potty: 1,
            training: 1,
            playtime: 0,
            feeding: 1,
        });
    });

    it("uses the corrected record for fulfillment as well as the anchor", () => {
        const item = pottyItem({ recurrence: { mode: "interval", minMinutes: 30, maxMinutes: 30 } });
        const records = [activity("a1", "potty", new Date(2026, 8, 17, 10, 0))];
        const before = buildPetSchedule({ now, scheduleItems: [item], activityRecords: records, naps: [] });
        expect(before.entries[0].start).toEqual(new Date(2026, 8, 17, 10, 30));

        const corrected = correctActivityTimestamp(records, "a1", new Date(2026, 8, 17, 10, 10), now);
        const after = buildPetSchedule({ now, scheduleItems: [item], activityRecords: corrected, naps: [] });
        expect(after.entries[0].start).toEqual(new Date(2026, 8, 17, 10, 40));
    });
});
