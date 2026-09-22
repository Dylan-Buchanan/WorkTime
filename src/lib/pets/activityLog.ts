import type { PetActivityRecord, PetActivityType } from "../../state/types";
import { createPetActivityRecord } from "./factories";
import type { NewPetActivityRecordInput } from "./types";

/**
 * The single append path for pet care activities. Inline schedule checks and
 * the bottom potty bar both call this command so derived schedule state (the
 * interval anchor, next-due/overdue, and done-today counts) always recomputes
 * from one log instead of per-button state.
 */
const DURATION_ACTIVITY_TYPES: readonly PetActivityType[] = ["training", "playtime"];

export interface LogActivityResult {
    /** The append-only log with the new record appended. */
    records: PetActivityRecord[];
    /** The created record, so callers can offer an undo affordance. */
    record: PetActivityRecord;
}

export interface PetActivityCounts {
    potty: number;
    training: number;
    playtime: number;
    feeding: number;
}

export function isSameLocalDay(left: Date, right: Date): boolean {
    return (
        left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate()
    );
}

/**
 * Appends one minimal `{ activityType, timestamp, durationMinutes?, skillIds? }` record.
 * `durationMinutes` is only accepted for training and playtime; potty and
 * feeding always stay one-tap records with no duration. Skill tags are kept
 * only for training records.
 */
export function logActivity(
    records: readonly PetActivityRecord[],
    input: NewPetActivityRecordInput,
    now: Date,
    id: string,
): LogActivityResult {
    const record = createPetActivityRecord(input, now, id);
    if (record.durationMinutes !== undefined && !DURATION_ACTIVITY_TYPES.includes(record.activityType)) {
        throw new RangeError("Activity duration is only meaningful for training and playtime");
    }
    return { records: [...records, record], record };
}

/** Undo deletes the record entirely; the log recomputes as if it never happened. */
export function removeActivityRecord(records: readonly PetActivityRecord[], id: string): PetActivityRecord[] {
    return records.filter((record) => record.id !== id);
}

/** Replaces the historical skill tags on one training record. */
export function setActivitySkillIds(
    records: readonly PetActivityRecord[],
    id: string,
    skillIds: readonly string[],
): PetActivityRecord[] {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new RangeError("Activity record not found");
    if (records[index].activityType !== "training") {
        throw new RangeError("Skill tags are only meaningful for training activities");
    }
    const next = records.slice();
    const uniqueSkillIds = [...new Set(skillIds)];
    const { skillIds: _previousSkillIds, ...unchanged } = records[index];
    next[index] = uniqueSkillIds.length > 0 ? { ...unchanged, skillIds: uniqueSkillIds } : unchanged;
    return next;
}

/**
 * Counts how many logged training sessions have included each skill id. Only
 * training records carry skill tags, and a record counts at most once per skill
 * even if the id repeats. Derived only; never stored.
 */
export function countTrainingSessionsBySkill(
    records: readonly PetActivityRecord[],
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of records) {
        if (record.activityType !== "training" || !record.skillIds) continue;
        for (const skillId of new Set(record.skillIds)) {
            counts[skillId] = (counts[skillId] ?? 0) + 1;
        }
    }
    return counts;
}

/** Today's records stay correctable; yesterday-and-older records are frozen. */
export function canCorrectActivityRecord(record: PetActivityRecord, now: Date): boolean {
    const timestamp = new Date(record.timestamp);
    if (Number.isNaN(timestamp.getTime())) return false;
    return isSameLocalDay(timestamp, now);
}

/**
 * Edits a record's timestamp in place. Out-of-order-safe: every derived value
 * recomputes from the log, so moving a record earlier or later is enough.
 */
export function correctActivityTimestamp(
    records: readonly PetActivityRecord[],
    id: string,
    timestamp: string | Date,
    now: Date,
): PetActivityRecord[] {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new RangeError("Activity record not found");
    if (!canCorrectActivityRecord(records[index], now)) {
        throw new RangeError("Only today's activity records can be corrected");
    }
    const nextTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(nextTimestamp.getTime())) throw new RangeError("Invalid pet activity timestamp");
    const next = records.slice();
    next[index] = { ...records[index], timestamp: nextTimestamp.toISOString() };
    return next;
}

/**
 * Counts activities stamped on `now`'s local day, excluding future-stamped
 * records. Derived only; never stored.
 */
export function countActivitiesToday(records: readonly PetActivityRecord[], now: Date): PetActivityCounts {
    const counts: PetActivityCounts = { potty: 0, training: 0, playtime: 0, feeding: 0 };
    const nowMs = now.getTime();
    for (const record of records) {
        const timestamp = new Date(record.timestamp);
        if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() > nowMs) continue;
        if (!isSameLocalDay(timestamp, now)) continue;
        counts[record.activityType] += 1;
    }
    return counts;
}
