import type { PetTrainingSkill, PetTrainingStatus } from "../../state/types";
import { derivePetAge } from "./age";

/** Forward-only progression order for a training skill. */
export const PET_TRAINING_STATUSES: readonly PetTrainingStatus[] = ["introduced", "progressing", "reliable"];

/** Display unit for a derived training-elapsed window. */
export type PetTrainingElapsedUnit = "days" | "weeks" | "months";

/** Derived time a skill has spent (or spent in total) in training; never stored. */
export interface PetTrainingElapsed {
    /** Local-noon-normalized start of the training window. */
    start: Date;
    /** Resolution time when resolved, otherwise the supplied reference. */
    end: Date;
    /** Whole local calendar days in the window; never negative. */
    totalDays: number;
    /** Whole completed weeks in the window. */
    weeks: number;
    /** Whole completed calendar months in the window. */
    months: number;
    /** False once the skill carries a resolution timestamp. */
    active: boolean;
    /** Display unit: days then weeks until the six-month mark, then months. */
    unit: PetTrainingElapsedUnit;
    /** Display quantity in `unit`. */
    value: number;
}

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

/**
 * Derives how long a skill has been (or was) in training. The window starts at
 * `createdAt` and ends at `resolvedAt` for a resolved skill, otherwise at `now`
 * — elapsed time is never stored. Units follow the pet age convention
 * (`derivePetAge`): whole weeks until the six-month mark, then whole months,
 * with a whole-days lead-in for the first week so short skills stay readable.
 */
export function derivePetTrainingElapsed(skill: PetTrainingSkill, now: Date): PetTrainingElapsed {
    const age = derivePetAge(new Date(skill.createdAt), skill.resolvedAt ? new Date(skill.resolvedAt) : now);
    const unit: PetTrainingElapsedUnit = age.unit === "weeks" && age.totalDays < 7 ? "days" : age.unit;
    return {
        start: age.birthDate,
        end: age.reference,
        totalDays: age.totalDays,
        weeks: age.weeks,
        months: age.months,
        active: skill.resolvedAt === null,
        unit,
        value: unit === "days" ? age.totalDays : age.value,
    };
}

/** Renders a derived training-elapsed window, e.g. "3 days", "1 week", "6 months". */
export function formatPetTrainingElapsed(elapsed: PetTrainingElapsed): string {
    const singular = elapsed.value === 1;
    const noun = singular ? elapsed.unit.slice(0, -1) : elapsed.unit;
    return `${elapsed.value} ${noun}`;
}
