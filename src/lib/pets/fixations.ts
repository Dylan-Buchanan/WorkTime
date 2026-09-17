import type { PetFixation } from "../../state/types";

export function isPetFixationActive(fixation: PetFixation): boolean {
    return fixation.resolvedAt === null;
}

/**
 * Archives a fixation and records the freeform reason ("grew out of it",
 * "solved with redirection", …). An already-resolved fixation cannot be
 * resolved again, and a blank reason is rejected because the "how it went
 * away" note is the point of the archive.
 */
export function resolvePetFixation(fixation: PetFixation, reason: string, now: Date): PetFixation {
    if (fixation.resolvedAt !== null) throw new RangeError("A fixation is already resolved");
    const resolutionNote = reason.trim();
    if (!resolutionNote) throw new RangeError("Resolving a fixation requires a reason");
    return { ...fixation, resolvedAt: now.toISOString(), resolutionNote, updatedAt: now.toISOString() };
}
