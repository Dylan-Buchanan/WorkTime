import { describe, expect, it } from "vitest";
import {
    createPetActivityRecord,
    createPetFixation,
    createPetNapRecord,
    createPetNotableEvent,
    createPetProfile,
    createPetScheduleItem,
    createPetTrainingSkill,
    createPetWeightEntry,
} from "./factories";

const now = new Date(2026, 8, 17, 12, 0, 0, 0);

describe("pet factories", () => {
    it("creates a profile with a derived-only birth date and trimmed name", () => {
        const profile = createPetProfile({ name: "  Whitney  ", birthDate: new Date(2026, 0, 10, 9, 0) }, now, "p1");
        expect(profile.id).toBe("p1");
        expect(profile.name).toBe("Whitney");
        expect(profile.birthDate).toBe("2026-01-10");
        expect(profile.createdAt).toBe(now.toISOString());
    });

    it("preserves date-only birth strings and rejects rollover dates", () => {
        expect(createPetProfile({ name: "Whitney", birthDate: "2026-01-10" }, now, "p1").birthDate).toBe("2026-01-10");
        expect(() => createPetProfile({ name: "Whitney", birthDate: "2026-02-30" }, now, "p2")).toThrow(RangeError);
        expect(() => createPetProfile({ name: "Whitney", birthDate: "2026-01-10T00:00:00Z" }, now, "p3")).toThrow(RangeError);
    });

    it("rejects a nameless profile", () => {
        expect(() => createPetProfile({ name: "   ", birthDate: now }, now, "p1")).toThrow(RangeError);
    });

    it("normalizes fixed-time recurrence into machine-readable minutes", () => {
        const item = createPetScheduleItem(
            {
                activityType: "training",
                label: "Training",
                flexibility: "flexible",
                priority: 2,
                recurrence: { mode: "fixed-time", time: "15:45", windowMinutes: 30 },
            },
            now,
            "s1",
        );
        expect(item.recurrence).toEqual({ mode: "fixed-time", time: "15:45", startMinutes: 945, endMinutes: 975 });
        expect(item.priority).toBe(2);
        expect(item.isActive).toBe(true);
    });

    it("validates interval recurrence and fixed-time strings", () => {
        const item = createPetScheduleItem(
            { activityType: "potty", label: "Potty", flexibility: "flexible", recurrence: { mode: "interval", minMinutes: 60, maxMinutes: 90 } },
            now,
            "s2",
        );
        expect(item.recurrence).toEqual({ mode: "interval", minMinutes: 60, maxMinutes: 90 });
        expect(() =>
            createPetScheduleItem(
                { activityType: "potty", label: "Potty", flexibility: "flexible", recurrence: { mode: "interval", minMinutes: 90, maxMinutes: 60 } },
                now,
                "s3",
            ),
        ).toThrow(RangeError);
        expect(() =>
            createPetScheduleItem(
                { activityType: "potty", label: "Potty", flexibility: "flexible", recurrence: { mode: "fixed-time", time: "25:00" } },
                now,
                "s4",
            ),
        ).toThrow(RangeError);
    });

    it("keeps activity duration optional and non-negative", () => {
        const record = createPetActivityRecord({ activityType: "potty", timestamp: new Date(2026, 8, 17, 10, 0) }, now, "a1");
        expect(record.durationMinutes).toBeUndefined();
        const trained = createPetActivityRecord({ activityType: "training", timestamp: now, durationMinutes: 15 }, now, "a2");
        expect(trained.durationMinutes).toBe(15);
        expect(() => createPetActivityRecord({ activityType: "training", timestamp: now, durationMinutes: -1 }, now, "a3")).toThrow(RangeError);
    });

    it("allows an open nap and rejects an inverted one", () => {
        const open = createPetNapRecord({ start: new Date(2026, 8, 17, 13, 0) }, now, "n1");
        expect(open.end).toBeNull();
        expect(() =>
            createPetNapRecord({ start: new Date(2026, 8, 17, 13, 0), end: new Date(2026, 8, 17, 12, 0) }, now, "n2"),
        ).toThrow(RangeError);
    });

    it("requires a positive weight", () => {
        const entry = createPetWeightEntry({ timestamp: now, weight: 4.2 }, now, "w1");
        expect(entry.weight).toBe(4.2);
        expect(() => createPetWeightEntry({ timestamp: now, weight: 0 }, now, "w2")).toThrow(RangeError);
    });

    it("creates training skills as introduced and requires a label", () => {
        const skill = createPetTrainingSkill({ label: "  Sit  ", notes: "lure + marker" }, now, "k1");
        expect(skill).toMatchObject({
            id: "k1",
            label: "Sit",
            notes: "lure + marker",
            status: "introduced",
            resolvedAt: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
        expect(createPetTrainingSkill({ label: "Sit" }, now, "k2").notes).toBe("");
        expect(() => createPetTrainingSkill({ label: "   " }, now, "k3")).toThrow(RangeError);
    });

    it("creates fixations active with an empty resolution note and requires a label", () => {
        const fixation = createPetFixation({ label: "  Chasing the vacuum  " }, now, "f1");
        expect(fixation).toMatchObject({
            id: "f1",
            label: "Chasing the vacuum",
            notes: "",
            resolvedAt: null,
            resolutionNote: "",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
        expect(() => createPetFixation({ label: "  " }, now, "f2")).toThrow(RangeError);
    });

    it("creates notable events with a trimmed title and a validated timestamp", () => {
        const timestamp = new Date(2026, 6, 9, 12, 0, 0, 0);
        const event = createPetNotableEvent(
            { title: "  First reliable sit  ", notes: "held for five seconds", timestamp },
            now,
            "e1",
        );
        expect(event).toMatchObject({
            id: "e1",
            title: "First reliable sit",
            notes: "held for five seconds",
            timestamp: timestamp.toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
        expect(createPetNotableEvent({ title: "First hike", timestamp: now }, now, "e2").notes).toBe("");
        expect(() => createPetNotableEvent({ title: "   ", timestamp: now }, now, "e3")).toThrow(RangeError);
        expect(() => createPetNotableEvent({ title: "First hike", timestamp: "not-a-date" }, now, "e4")).toThrow(
            RangeError,
        );
    });
});
