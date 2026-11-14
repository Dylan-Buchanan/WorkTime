import { describe, expect, it } from "vitest";
import type { PetActivityRecord, PetActivityType, PetNapRecord, PetScheduleItem } from "../../state/types";
import { applyNapReflow, proposeNapReflow } from "./reflow";
import { buildPetSchedule } from "./schedule";

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
        expect(proposal.shifts.find((shift) => shift.itemId === "playtime")?.description).toBe("playtime +40m — nap 2:00 PM–2:40 PM");
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

    it("does not offer a fixed-time shift past the configured end", () => {
        const eveningNap = nap("evening", at(21, 10), at(21, 50));
        const proposal = proposeNapReflow({ nap: eveningNap, now: at(21, 50),
            scheduleItems: [item("walk", "playtime", "flexible", { mode: "fixed-time", time: "21:30", startMinutes: 1290, endMinutes: 1290 })],
            activityRecords: [], naps: [eveningNap] });
        expect(proposal.changes).toEqual([]);
    });

    it("uses the same fallback window as the schedule for invalid times", () => {
        const walk = item("walk", "playtime", "flexible", { mode: "fixed-time", time: "05:00", startMinutes: 300, endMinutes: 300 });
        const earlyNap = nap("early", at(4), at(4, 40));
        const schedule = buildPetSchedule({ now: at(4, 45), startOfDay: "6:00", endOfDay: "bad",
            scheduleItems: [walk], activityRecords: [], naps: [] });
        const proposal = proposeNapReflow({ nap: earlyNap, now: at(4, 45), startOfDay: "6:00", endOfDay: "bad",
            scheduleItems: [walk], activityRecords: [], naps: [earlyNap] });
        expect(schedule.entries[0].start).toEqual(at(5));
        expect(proposal.changes[0].from).toEqual(at(5));
    });

    it("returns no changes after the configured day has ended", () => {
        const lateNap = nap("late", at(21, 30), at(22, 45));
        const proposal = proposeNapReflow({ nap: lateNap, now: at(22, 45),
            scheduleItems: [item("walk", "playtime", "flexible", { mode: "fixed-time", time: "21:45", startMinutes: 1305, endMinutes: 1305 })],
            activityRecords: [], naps: [lateNap] });
        expect(proposal.changes).toEqual([]);
    });
});

describe("applyNapReflow", () => {
    const schedule = (): PetScheduleItem[] => [
        item("potty", "potty", "flexible", { mode: "interval", minMinutes: 60, maxMinutes: 90 }),
        item("playtime", "playtime", "flexible", { mode: "fixed-time", time: "15:05", startMinutes: 905, endMinutes: 935 }),
        item("feeding", "feeding", "fixed", { mode: "fixed-time", time: "17:00", startMinutes: 1020, endMinutes: 1020 }),
    ];

    const proposalFor = (items: PetScheduleItem[], endOfDay?: string): ReturnType<typeof proposeNapReflow> =>
        proposeNapReflow({
            nap: endedNap,
            now: at(14, 45),
            endOfDay,
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

    it("wraps a shift that crosses midnight within an overnight schedule day", () => {
        const items = [item("walk", "playtime", "flexible", { mode: "fixed-time", time: "23:40", startMinutes: 1420, endMinutes: 1450 })];
        const overnightNap = nap("overnight", at(22, 0), at(22, 40));
        const proposal = proposeNapReflow({ nap: overnightNap, now: at(22, 45), startOfDay: "20:00", endOfDay: "08:00",
            scheduleItems: items, activityRecords: [], naps: [overnightNap] });
        const next = applyNapReflow(items, proposal, at(22, 46));
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

describe("nap reflow calendar busy preview", () => {
    const ended = nap("short", at(13, 30), at(14));
    const walk = item("walk", "playtime", "flexible", { mode: "fixed-time", time: "14:15", startMinutes: 855, endMinutes: 855 });
    const input = { nap: ended, now: at(14), scheduleItems: [walk], activityRecords: [], naps: [ended] };

    it("keeps label punctuation out of the composed busy cause", () => {
        const proposal = proposeNapReflow({ ...input, scheduleItems: [{ ...walk, label: "Walk — outside" }],
            busyIntervals: [{ start: at(14, 30), end: at(15) }] });
        expect(proposal.shifts[0].description).toBe("walk — outside +45m — nap 1:30 PM–2:00 PM; busy 2:30 PM–3:00 PM");
    });

    it("previews total nap plus busy displacement but applies only the nap delta", () => {
        const before = structuredClone(input);
        const baseline = proposeNapReflow(input);
        const proposal = proposeNapReflow({ ...input, busyIntervals: [{ start: at(14, 30), end: at(15) }] });
        expect(proposal.changes).toEqual(baseline.changes);
        expect(proposal.changes).toEqual([{ itemId: "walk", activityType: "playtime", label: "Walk", from: at(14, 15), to: at(14, 45), deltaMinutes: 30, reason: "nap" }]);
        expect(proposal.shifts).toEqual([{ itemId: "walk", activityType: "playtime", label: "Walk", deltaMinutes: 45, reason: "busy",
            description: "walk +45m — nap 1:30 PM–2:00 PM; busy 2:30 PM–3:00 PM" }]);
        expect(applyNapReflow(input.scheduleItems, proposal, at(14, 1))[0].recurrence).toEqual({ mode: "fixed-time", time: "14:45", startMinutes: 885, endMinutes: 885 });
        expect(input).toEqual(before);
    });

    it("keeps absent, empty and out-of-day busy proposals identical to the legacy proposal", () => {
        const expected = { nap: ended, napMinutes: 30,
            changes: [{ itemId: "walk", activityType: "playtime", label: "Walk", from: at(14, 15), to: at(14, 45), deltaMinutes: 30, reason: "nap" }],
            shifts: [{ itemId: "walk", activityType: "playtime", label: "Walk", deltaMinutes: 30, reason: "nap", description: "walk +30m — nap 1:30 PM–2:00 PM" }] };
        expect(proposeNapReflow(input)).toEqual(expected);
        expect(proposeNapReflow({ ...input, busyIntervals: [] })).toEqual(expected);
        expect(proposeNapReflow({ ...input, busyIntervals: [{ start: at(23), end: at(23, 30) }] })).toEqual(expected);
    });

    it("uses the same sequential placement as the schedule after nap changes", () => {
        const second = item("training", "training", "flexible", { mode: "fixed-time", time: "14:25", startMinutes: 865, endMinutes: 895 });
        const first = { ...walk, recurrence: { mode: "fixed-time" as const, time: "14:15", startMinutes: 855, endMinutes: 885 } };
        const busyIntervals = [{ start: at(14, 30), end: at(15) }];
        const proposal = proposeNapReflow({ ...input, scheduleItems: [first, second], busyIntervals });
        const applied = applyNapReflow([first, second], proposal, at(14));
        const schedule = buildPetSchedule({ ...input, scheduleItems: applied, busyIntervals });
        expect(proposal.changes.map((change) => change.deltaMinutes)).toEqual([30, 30]);
        expect(proposal.shifts.map((shift) => [shift.reason, shift.deltaMinutes])).toEqual([["busy", 45], ["busy", 65]]);
        expect(schedule.entries.map((entry) => [entry.start, entry.end])).toEqual([[at(15), at(15, 30)], [at(15, 30), at(16)]]);
    });

    it("composes interval previews using the proposal nap without writing busy displacement", () => {
        const potty = item("potty", "potty", "flexible", { mode: "interval", minMinutes: 30, maxMinutes: 90 });
        const napRecord = nap("morning", at(10, 30), at(11));
        const intervalInput = { nap: napRecord, now: at(11), scheduleItems: [potty], activityRecords: [activity("anchor", at(10))], naps: [napRecord] };
        const baseline = proposeNapReflow(intervalInput);
        const proposal = proposeNapReflow({ ...intervalInput, busyIntervals: [{ start: at(11), end: at(11, 20) }] });
        expect(proposal.changes).toEqual(baseline.changes);
        expect(proposal.shifts).toEqual([{ itemId: "potty", activityType: "potty", label: "Potty", deltaMinutes: 50, reason: "busy",
            description: "potty +50m — nap 10:30 AM–11:00 AM; busy 11:00 AM–11:20 AM" }]);
        expect(applyNapReflow([potty], proposal, at(11))).toEqual([potty]);
    });

    it("keeps a nap-only preview for blocked or unaffected occurrences", () => {
        const proposal = proposeNapReflow({ ...input, busyIntervals: [{ start: at(7), end: at(8) }] });
        expect(proposal).toEqual(proposeNapReflow(input));
        const longWalk = { ...walk, recurrence: { mode: "fixed-time" as const, time: "14:15", startMinutes: 855, endMinutes: 885 } };
        const blockedInput = { ...input, scheduleItems: [longWalk], endOfDay: "15:00" };
        expect(proposeNapReflow({ ...blockedInput, busyIntervals: [{ start: at(14, 30), end: at(16) }] })).toEqual(proposeNapReflow(blockedInput));
    });
});
