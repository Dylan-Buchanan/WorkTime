import { describe, expect, it } from "vitest";
import type { PetTrainingSkill } from "../../state/types";
import {
    PET_TRAINING_STATUSES,
    advancePetTrainingSkill,
    isPetTrainingSkillResolved,
    nextPetTrainingStatus,
    petTrainingStatusLabel,
    previousPetTrainingStatus,
    reopenPetTrainingSkill,
    resolvePetTrainingSkill,
    reversePetTrainingSkill,
} from "./training";

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
