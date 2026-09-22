import { describe, expect, it } from "vitest";
import type { PetTrainingSkill } from "../../state/types";
import {
    PET_TRAINING_STATUSES,
    advancePetTrainingSkill,
    derivePetTrainingElapsed,
    formatPetTrainingElapsed,
    isPetTrainingSkillResolved,
    nextPetTrainingStatus,
    petTrainingStatusLabel,
    previousPetTrainingStatus,
    reopenPetTrainingSkill,
    resolvePetTrainingSkill,
    reversePetTrainingSkill,
} from "./training";

function day(year: number, month: number, date: number): Date {
    return new Date(year, month - 1, date, 12, 0, 0, 0);
}

const now = new Date(2026, 8, 17, 12, 0, 0, 0);
const later = new Date(2026, 8, 18, 9, 30, 0, 0);

function skill(overrides: Partial<PetTrainingSkill> = {}): PetTrainingSkill {
    return {
        id: "k1",
        label: "Sit",
        notes: "",
        status: "introduced",
        resolvedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ...overrides,
    };
}

describe("pet training progression", () => {
    it("walks the forward progression one step at a time and stops at reliable", () => {
        const introduced = skill();
        const progressing = advancePetTrainingSkill(introduced, later);
        expect(progressing.status).toBe("progressing");
        expect(progressing.updatedAt).toBe(later.toISOString());
        expect(progressing.createdAt).toBe(introduced.createdAt);

        const reliable = advancePetTrainingSkill(progressing, later);
        expect(reliable.status).toBe("reliable");
        expect(nextPetTrainingStatus("reliable")).toBeNull();
        expect(() => advancePetTrainingSkill(reliable, later)).toThrow(RangeError);
    });

    it("rejects advancing a resolved skill", () => {
        const resolved = skill({
            status: "progressing",
            resolvedAt: later.toISOString(),
            updatedAt: later.toISOString(),
        });
        expect(() => advancePetTrainingSkill(resolved, later)).toThrow(RangeError);
    });

    it("steps the progression back one status at a time and stops at introduced", () => {
        const reliable = skill({ status: "reliable" });
        const progressing = reversePetTrainingSkill(reliable, later);
        expect(progressing.status).toBe("progressing");
        expect(progressing.updatedAt).toBe(later.toISOString());

        const introduced = reversePetTrainingSkill(progressing, later);
        expect(introduced.status).toBe("introduced");
        expect(previousPetTrainingStatus("introduced")).toBeNull();
        expect(() => reversePetTrainingSkill(introduced, later)).toThrow(RangeError);
    });

    it("rejects reversing a resolved skill", () => {
        const resolved = skill({
            status: "progressing",
            resolvedAt: later.toISOString(),
            updatedAt: later.toISOString(),
        });
        expect(() => reversePetTrainingSkill(resolved, later)).toThrow(RangeError);
    });

    it("resolves an active skill once and rejects a second resolve", () => {
        const resolved = resolvePetTrainingSkill(skill(), later);
        expect(resolved.resolvedAt).toBe(later.toISOString());
        expect(resolved.updatedAt).toBe(later.toISOString());
        expect(isPetTrainingSkillResolved(resolved)).toBe(true);
        expect(() => resolvePetTrainingSkill(resolved, later)).toThrow(RangeError);
    });

    it("reopens a resolved skill, restoring its status and rejecting an active one", () => {
        const resolved = skill({
            status: "progressing",
            resolvedAt: later.toISOString(),
            updatedAt: later.toISOString(),
        });
        const reopened = reopenPetTrainingSkill(resolved, later);
        expect(reopened.resolvedAt).toBeNull();
        expect(reopened.status).toBe("progressing");
        expect(reopened.updatedAt).toBe(later.toISOString());
        expect(isPetTrainingSkillResolved(reopened)).toBe(false);
        expect(() => reopenPetTrainingSkill(reopened, later)).toThrow(RangeError);
    });

    it("exposes the ordered statuses and their labels", () => {
        expect(PET_TRAINING_STATUSES).toEqual(["introduced", "progressing", "reliable"]);
        expect(PET_TRAINING_STATUSES.map(petTrainingStatusLabel)).toEqual([
            "Introduced",
            "Progressing",
            "Reliable",
        ]);
    });
});

describe("pet training elapsed time", () => {
    it("counts whole days for the first week and phrases the singular", () => {
        const elapsed = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 10).toISOString() }),
            day(2026, 1, 13),
        );
        expect(elapsed.active).toBe(true);
        expect(elapsed.unit).toBe("days");
        expect(elapsed.totalDays).toBe(3);
        expect(formatPetTrainingElapsed(elapsed)).toBe("3 days");

        const oneDay = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 10).toISOString() }),
            day(2026, 1, 11),
        );
        expect(formatPetTrainingElapsed(oneDay)).toBe("1 day");
    });

    it("reports zero days for a skill started today", () => {
        const elapsed = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 10).toISOString() }),
            day(2026, 1, 10),
        );
        expect(elapsed.unit).toBe("days");
        expect(formatPetTrainingElapsed(elapsed)).toBe("0 days");
    });

    it("switches to weeks at seven days and keeps weeks until the six-month mark", () => {
        const started = skill({ createdAt: day(2026, 1, 10).toISOString() });

        const oneWeek = derivePetTrainingElapsed(started, day(2026, 1, 17));
        expect(oneWeek.totalDays).toBe(7);
        expect(oneWeek.weeks).toBe(1);
        expect(formatPetTrainingElapsed(oneWeek)).toBe("1 week");

        const weeks = derivePetTrainingElapsed(started, day(2026, 3, 10));
        expect(weeks.unit).toBe("weeks");
        expect(weeks.weeks).toBe(8);
        expect(formatPetTrainingElapsed(weeks)).toBe("8 weeks");
    });

    it("switches to whole months on the six-month mark", () => {
        const elapsed = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 10).toISOString() }),
            day(2026, 7, 10),
        );
        expect(elapsed.unit).toBe("months");
        expect(elapsed.months).toBe(6);
        expect(formatPetTrainingElapsed(elapsed)).toBe("6 months");
    });

    it("freezes the window at resolvedAt for a completed skill", () => {
        const elapsed = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 10).toISOString(), resolvedAt: day(2026, 1, 20).toISOString() }),
            day(2026, 12, 1),
        );
        expect(elapsed.active).toBe(false);
        expect(elapsed.end.getTime()).toBe(day(2026, 1, 20).getTime());
        expect(formatPetTrainingElapsed(elapsed)).toBe("1 week");
    });

    it("clamps a reversed or same-day completed window to zero days", () => {
        const sameDay = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 10).toISOString(), resolvedAt: day(2026, 1, 10).toISOString() }),
            day(2026, 2, 1),
        );
        expect(formatPetTrainingElapsed(sameDay)).toBe("0 days");

        const reversed = derivePetTrainingElapsed(
            skill({ createdAt: day(2026, 1, 20).toISOString(), resolvedAt: day(2026, 1, 10).toISOString() }),
            day(2026, 2, 1),
        );
        expect(formatPetTrainingElapsed(reversed)).toBe("0 days");
    });

    it("rejects an unparseable creation timestamp", () => {
        expect(() => derivePetTrainingElapsed(skill({ createdAt: "not-a-date" }), day(2026, 1, 10))).toThrow(RangeError);
    });
});
