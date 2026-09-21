import type { PetTrainingSkill, PetTrainingStatus } from "../../state/types";

/** Forward-only progression order for a training skill. */
export const PET_TRAINING_STATUSES: readonly PetTrainingStatus[] = ["introduced", "progressing", "reliable"];

const PET_TRAINING_STATUS_LABELS: Record<PetTrainingStatus, string> = {
    introduced: "Introduced",
    progressing: "Progressing",
    reliable: "Reliable",
};

export function petTrainingStatusLabel(status: PetTrainingStatus): string {
    return PET_TRAINING_STATUS_LABELS[status];
}

/** The next forward status, or null when the skill is already at the end. */
export function nextPetTrainingStatus(status: PetTrainingStatus): PetTrainingStatus | null {
    const index = PET_TRAINING_STATUSES.indexOf(status);
    if (index < 0 || index === PET_TRAINING_STATUSES.length - 1) return null;
    return PET_TRAINING_STATUSES[index + 1];
}

/** The previous status, or null when the skill is already at the first status. */
export function previousPetTrainingStatus(status: PetTrainingStatus): PetTrainingStatus | null {
    const index = PET_TRAINING_STATUSES.indexOf(status);
    if (index <= 0) return null;
    return PET_TRAINING_STATUSES[index - 1];
}

export function isPetTrainingSkillResolved(skill: PetTrainingSkill): boolean {
    return skill.resolvedAt !== null;
}

/**
 * Advances a skill one step forward (`introduced → progressing → reliable`).
 * A resolved skill, or one already at `reliable`, has no valid forward
 * transition, so those are rejected instead of silently doing nothing.
 */
export function advancePetTrainingSkill(skill: PetTrainingSkill, now: Date): PetTrainingSkill {
    if (skill.resolvedAt !== null) throw new RangeError("A resolved training skill cannot be advanced");
    const status = nextPetTrainingStatus(skill.status);
    if (status === null) throw new RangeError("A reliable training skill cannot advance further");
    return { ...skill, status, updatedAt: now.toISOString() };
}

/**
 * Steps a skill one status back (`reliable → progressing → introduced`), for
 * undoing an advance made by mistake. A resolved skill, or one already at the
 * first status, has no valid reverse transition, so those are rejected instead
 * of silently doing nothing.
 */
export function reversePetTrainingSkill(skill: PetTrainingSkill, now: Date): PetTrainingSkill {
    if (skill.resolvedAt !== null) throw new RangeError("A resolved training skill cannot be reversed");
    const status = previousPetTrainingStatus(skill.status);
    if (status === null) throw new RangeError("An introduced training skill cannot be reversed");
    return { ...skill, status, updatedAt: now.toISOString() };
}

/**
 * Closes a skill as effectively done. Any active status may be resolved so a
 * skill that has been abandoned can still leave the short list; resolving an
 * already-resolved skill is rejected.
 */
export function resolvePetTrainingSkill(skill: PetTrainingSkill, now: Date): PetTrainingSkill {
    if (skill.resolvedAt !== null) throw new RangeError("A training skill is already resolved");
    return { ...skill, resolvedAt: now.toISOString(), updatedAt: now.toISOString() };
}

/**
 * Returns a resolved skill to the active list, restoring the status it held
 * when it was resolved. Reopening a skill that is not resolved is rejected.
 */
export function reopenPetTrainingSkill(skill: PetTrainingSkill, now: Date): PetTrainingSkill {
    if (skill.resolvedAt === null) throw new RangeError("A training skill is not resolved");
    return { ...skill, resolvedAt: null, updatedAt: now.toISOString() };
}
