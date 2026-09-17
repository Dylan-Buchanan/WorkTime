import { describe, expect, it } from "vitest";
import type { PetActivityRecord, PetActivityType, PetNapRecord, PetScheduleItem } from "../../state/types";
import { applyNapReflow, proposeNapReflow } from "./reflow";

const createdAt = new Date(2026, 8, 17, 0, 0, 0, 0).toISOString();

function at(hour: number, minute = 0): Date {
    return new Date(2026, 8, 17, hour, minute, 0, 0);
}

function item(id: string, activityType: PetActivityType, flexibility: "fixed" | "flexible", recurrence: PetScheduleItem["recurrence"]): PetScheduleItem {
    return { id, activityType, label: id.charAt(0).toUpperCase() + id.slice(1), flexibility, priority: 0, recurrence, isActive: true, createdAt, updatedAt: createdAt };
}

function activity(id: string, when: Date, activityType: PetActivityType = "potty"): PetActivityRecord {
    return { id, activityType, timestamp: when.toISOString(), createdAt };
}

function nap(id: string, start: Date, end: Date | null): PetNapRecord {
    return { id, start: start.toISOString(), end: end ? end.toISOString() : null, createdAt, updatedAt: createdAt };
}

const endedNap = nap("n1", at(14, 0), at(14, 40));

describe("proposeNapReflow", () => {
    it("shifts flexible items at or after the nap and never fixed items", () => {
        const proposal = proposeNapReflow({
            nap: endedNap,
            now: at(14, 45),
            scheduleItems: [
                item("potty", "potty", "flexible", { mode: "interval", minMinutes: 60, maxMinutes: 90 }),
                item("playtime", "playtime", "flexible", { mode: "fixed-time", time: "15:05", startMinutes: 905, endMinutes: 905 }),
                item("training", "training", "flexible", { mode: "fixed-time", time: "15:50", startMinutes: 950, endMinutes: 950 }),
                item("feeding", "feeding", "fixed", { mode: "fixed-time", time: "17:00", startMinutes: 1020, endMinutes: 1020 }),
            ],
            activityRecords: [activity("p1", at(13, 20))],
            naps: [endedNap],
        });

        expect(proposal.napMinutes).toBe(40);
        const playtime = proposal.changes.find((change) => change.itemId === "playtime");
        expect(playtime?.to.getHours()).toBe(15);
        expect(playtime?.to.getMinutes()).toBe(45);
        const training = proposal.changes.find((change) => change.itemId === "training");
        expect(training?.to.getHours()).toBe(16);
        expect(training?.to.getMinutes()).toBe(30);
        expect(proposal.changes.some((change) => change.itemId === "feeding")).toBe(false);
        expect(proposal.shifts.find((shift) => shift.itemId === "playtime")?.description).toBe("playtime +40m — nap 14:00–14:40");
    });

    it("includes the pulled-forward interval occurrence as a post-wake shift", () => {
        const proposal = proposeNapReflow({
            nap: endedNap,
            now: at(14, 45),
            scheduleItems: [item("potty", "potty", "flexible", { mode: "interval", minMinutes: 60, maxMinutes: 90 })],
            activityRecords: [activity("p1", at(13, 20))],
            naps: [endedNap],
        });
        const potty = proposal.changes.find((change) => change.itemId === "potty");
        expect(potty?.reason).toBe("post-wake");
        expect(potty?.to.getHours()).toBe(14);
        expect(potty?.to.getMinutes()).toBe(40);
    });

    it("rejects an ongoing nap", () => {
        expect(() =>
            proposeNapReflow({
                nap: nap("n2", at(14, 0), null),
                now: at(14, 10),
                scheduleItems: [],
                activityRecords: [],
                naps: [],
            }),
        ).toThrow(RangeError);
    });
});

describe("applyNapReflow", () => {
    const schedule = (): PetScheduleItem[] => [
        item("potty", "potty", "flexible", { mode: "interval", minMinutes: 60, maxMinutes: 90 }),
        item("playtime", "playtime", "flexible", { mode: "fixed-time", time: "15:05", startMinutes: 905, endMinutes: 935 }),
        item("feeding", "feeding", "fixed", { mode: "fixed-time", time: "17:00", startMinutes: 1020, endMinutes: 1020 }),
    ];

    const proposalFor = (items: PetScheduleItem[]): ReturnType<typeof proposeNapReflow> =>
        proposeNapReflow({
            nap: endedNap,
            now: at(14, 45),
            scheduleItems: items,
            activityRecords: [activity("p1", at(13, 20))],
            naps: [endedNap],
        });

    it("moves flexible fixed-time items by the nap minutes and keeps their window length", () => {
        const items = schedule();
        const next = applyNapReflow(items, proposalFor(items), at(14, 46));
        const playtime = next.find((entry) => entry.id === "playtime");
        expect(playtime?.recurrence).toEqual({
            mode: "fixed-time",
            time: "15:45",
            startMinutes: 945,
            endMinutes: 975,
        });
        expect(playtime?.updatedAt).toBe(at(14, 46).toISOString());
    });

    it("leaves fixed items and interval items untouched", () => {
        const items = schedule();
        const next = applyNapReflow(items, proposalFor(items), at(14, 46));
        expect(next.find((entry) => entry.id === "feeding")).toEqual(items[2]);
        // The interval item's proposal is informational only; its occurrence
        // already reflows from the stored nap log.
        expect(next.find((entry) => entry.id === "potty")).toEqual(items[0]);
    });

    it("wraps a shift that crosses midnight within the same day", () => {
        const items = [item("walk", "playtime", "flexible", { mode: "fixed-time", time: "23:40", startMinutes: 1420, endMinutes: 1450 })];
        const next = applyNapReflow(items, proposalFor(items), at(14, 46));
        expect(next[0].recurrence).toEqual({ mode: "fixed-time", time: "00:20", startMinutes: 20, endMinutes: 50 });
    });

    it("returns the input items unchanged when the proposal has no changes", () => {
        const items = schedule();
        const empty = { ...proposalFor(items), changes: [], shifts: [] };
        expect(applyNapReflow(items, empty, at(14, 46))).toEqual(items);
    });

    it("rejects an invalid reference date", () => {
        const items = schedule();
        expect(() => applyNapReflow(items, proposalFor(items), new Date(Number.NaN))).toThrow(RangeError);
    });
});
