import type {
    PetActivityRecord,
    PetFixation,
    PetNapRecord,
    PetNotableEvent,
    PetProfile,
    PetScheduleItem,
    PetScheduleRecurrence,
    PetTrainingSkill,
    PetWeightEntry,
} from "../../state/types";
import { isWallClockTime } from "../projectSchedule";
import { petBirthDateKey } from "./age";
import type {
    NewPetActivityRecordInput,
    NewPetFixationInput,
    NewPetNapRecordInput,
    NewPetNotableEventInput,
    NewPetProfileInput,
    NewPetScheduleItemInput,
    NewPetScheduleRecurrenceInput,
    NewPetTrainingSkillInput,
    NewPetWeightEntryInput,
} from "./types";

function toIso(value: string | Date, label: string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RangeError(`Invalid ${label}`);
    return date.toISOString();
}

function minutesFromTime(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

function normalizeRecurrence(recurrence: NewPetScheduleRecurrenceInput): PetScheduleRecurrence {
    if (recurrence.mode === "fixed-time") {
        if (!isWallClockTime(recurrence.time)) throw new RangeError("Fixed-time schedule items require an HH:mm time");
        const windowMinutes = recurrence.windowMinutes ?? 0;
        if (!Number.isInteger(windowMinutes) || windowMinutes < 0) {
            throw new RangeError("Fixed-time windowMinutes must be a non-negative integer");
        }
        const startMinutes = minutesFromTime(recurrence.time);
        return { mode: "fixed-time", time: recurrence.time, startMinutes, endMinutes: startMinutes + windowMinutes };
    }
    if (recurrence.mode === "interval") {
        if (!Number.isInteger(recurrence.minMinutes) || recurrence.minMinutes < 1) {
            throw new RangeError("Interval minMinutes must be a positive integer");
        }
        if (!Number.isInteger(recurrence.maxMinutes) || recurrence.maxMinutes < recurrence.minMinutes) {
            throw new RangeError("Interval maxMinutes must be at least minMinutes");
        }
        return { mode: "interval", minMinutes: recurrence.minMinutes, maxMinutes: recurrence.maxMinutes };
    }
    throw new RangeError("Unknown pet schedule recurrence mode");
}

export function createPetProfile(input: NewPetProfileInput, now: Date, id: string): PetProfile {
    const name = input.name?.trim();
    if (!name) throw new RangeError("Pet profile requires a name");
    return {
        id,
        name,
        birthDate: petBirthDateKey(input.birthDate),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export function createPetScheduleItem(input: NewPetScheduleItemInput, now: Date, id: string): PetScheduleItem {
    const label = input.label?.trim();
    if (!label) throw new RangeError("Pet schedule item requires a label");
    return {
        id,
        activityType: input.activityType,
        label,
        flexibility: input.flexibility,
        priority: input.priority ?? 0,
        recurrence: normalizeRecurrence(input.recurrence),
        isActive: input.isActive ?? true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export function createPetActivityRecord(input: NewPetActivityRecordInput, now: Date, id: string): PetActivityRecord {
    const record: PetActivityRecord = {
        id,
        activityType: input.activityType,
        timestamp: toIso(input.timestamp, "pet activity timestamp"),
        createdAt: now.toISOString(),
    };
    if (input.durationMinutes !== undefined) {
        if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 0) {
            throw new RangeError("Pet activity durationMinutes must be a non-negative number");
        }
        record.durationMinutes = input.durationMinutes;
    }
    return record;
}

export function createPetNapRecord(input: NewPetNapRecordInput, now: Date, id: string): PetNapRecord {
    const start = toIso(input.start, "pet nap start");
    const end = input.end === undefined || input.end === null ? null : toIso(input.end, "pet nap end");
    if (end !== null && new Date(end).getTime() < new Date(start).getTime()) {
        throw new RangeError("Pet nap end must not precede its start");
    }
    return { id, start, end, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function createPetWeightEntry(input: NewPetWeightEntryInput, now: Date, id: string): PetWeightEntry {
    if (!Number.isFinite(input.weight) || input.weight <= 0) {
        throw new RangeError("Pet weight must be a positive number");
    }
    return {
        id,
        timestamp: toIso(input.timestamp, "pet weight timestamp"),
        weight: input.weight,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export function createPetTrainingSkill(input: NewPetTrainingSkillInput, now: Date, id: string): PetTrainingSkill {
    const label = input.label?.trim();
    if (!label) throw new RangeError("Pet training skill requires a label");
    return {
        id,
        label,
        notes: input.notes ?? "",
        status: "introduced",
        resolvedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export function createPetFixation(input: NewPetFixationInput, now: Date, id: string): PetFixation {
    const label = input.label?.trim();
    if (!label) throw new RangeError("Pet fixation requires a label");
    return {
        id,
        label,
        notes: input.notes ?? "",
        resolvedAt: null,
        resolutionNote: "",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

export function createPetNotableEvent(input: NewPetNotableEventInput, now: Date, id: string): PetNotableEvent {
    const title = input.title?.trim();
    if (!title) throw new RangeError("Pet notable event requires a title");
    return {
        id,
        title,
        notes: input.notes ?? "",
        timestamp: toIso(input.timestamp, "pet notable event timestamp"),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}
