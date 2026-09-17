import { describe, expect, it } from "vitest";
import type { PetFixation } from "../../state/types";
import { isPetFixationActive, resolvePetFixation } from "./fixations";

const now = new Date(2026, 8, 17, 12, 0, 0, 0);
const later = new Date(2026, 8, 20, 18, 15, 0, 0);

function fixation(overrides: Partial<PetFixation> = {}): PetFixation {
    return {
        id: "f1",
        label: "Chasing the vacuum",
        notes: "",
        resolvedAt: null,
        resolutionNote: "",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ...overrides,
    };
}

describe("pet fixation lifecycle", () => {
    it("resolves an active fixation with a trimmed reason and archives it", () => {
        const resolved = resolvePetFixation(fixation(), "  grew out of it  ", later);
        expect(resolved.resolvedAt).toBe(later.toISOString());
        expect(resolved.resolutionNote).toBe("grew out of it");
        expect(resolved.updatedAt).toBe(later.toISOString());
        expect(resolved.createdAt).toBe(now.toISOString());
        expect(isPetFixationActive(resolved)).toBe(false);
    });

    it("rejects resolving an already-resolved fixation", () => {
        const resolved = resolvePetFixation(fixation(), "solved with redirection", later);
        expect(() => resolvePetFixation(resolved, "again", later)).toThrow(RangeError);
    });

    it("requires a non-blank resolution reason", () => {
        expect(() => resolvePetFixation(fixation(), "   ", later)).toThrow(RangeError);
    });

    it("reports active state for an unresolved fixation", () => {
        expect(isPetFixationActive(fixation())).toBe(true);
    });
});
