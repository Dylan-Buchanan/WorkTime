import type { PetActivityRecord, PetActivityType, PetNapRecord, PetScheduleItem } from "../../state/types";

export type {
    PetActivityRecord,
    PetActivityType,
    PetFixation,
    PetFixedTimeRecurrence,
    PetFlexibility,
    PetIntervalRecurrence,
    PetNapRecord,
    PetNotableEvent,
    PetProfile,
    PetScheduleItem,
    PetScheduleRecurrence,
    PetTrainingSkill,
    PetTrainingStatus,
    PetWeightEntry,
} from "../../state/types";

export type PetScheduleMode = "fixed-time" | "interval";
export type PetAgeUnit = "weeks" | "months";
export type PetShiftReason = "nap" | "post-wake";

export interface NewPetProfileInput {
    name: string;
    birthDate: string | Date;
}

export interface NewPetFixedTimeScheduleInput {
    mode: "fixed-time";
    /** Local wall-clock anchor in 24-hour HH:mm form. Flexible items may receive a reflow proposal. */
    time: string;
    /** Length of the item's own window in minutes; defaults to zero. */
    windowMinutes?: number;
}

export interface NewPetIntervalScheduleInput {
    mode: "interval";
    minMinutes: number;
    maxMinutes: number;
}

export type NewPetScheduleRecurrenceInput = NewPetFixedTimeScheduleInput | NewPetIntervalScheduleInput;

export interface NewPetScheduleItemInput {
    activityType: PetActivityType;
    label: string;
    flexibility: "fixed" | "flexible";
    priority?: number;
    recurrence: NewPetScheduleRecurrenceInput;
    isActive?: boolean;
}

export interface NewPetActivityRecordInput {
    activityType: PetActivityType;
    timestamp: string | Date;
    durationMinutes?: number;
    skillIds?: string[];
}

export interface NewPetNapRecordInput {
    start: string | Date;
    end?: string | Date | null;
}

export interface NewPetWeightEntryInput {
    timestamp: string | Date;
    weight: number;
}

export interface NewPetTrainingSkillInput {
    label: string;
    notes?: string;
}

export interface NewPetFixationInput {
    label: string;
    notes?: string;
}

export interface NewPetNotableEventInput {
    title: string;
    notes?: string;
    timestamp: string | Date;
}

/** Inclusive local-calendar date range for timeline filtering; null is open. */
export interface PetTimelineDateRange {
    /** Inclusive local-calendar start date in YYYY-MM-DD form, or null. */
    from: string | null;
    /** Inclusive local-calendar end date in YYYY-MM-DD form, or null. */
    to: string | null;
}

/** Derived, never stored. `unit` follows the weeks-until-6-months house rule. */
export interface PetAge {
    birthDate: Date;
    reference: Date;
    totalDays: number;
    weeks: number;
    months: number;
    unit: PetAgeUnit;
    value: number;
    sixMonthDate: Date;
}

/** Why an occurrence moved, emitted as computed data for the UI. */
export interface PetShiftIndicator {
    itemId: string;
    activityType: PetActivityType;
    label: string;
    /** Signed minutes the occurrence moved; positive is later. */
    deltaMinutes: number;
    reason: PetShiftReason;
    /** Human-readable explanation, e.g. "potty +40m — nap 13:30–14:10". */
    description: string;
}

/** One resolved occurrence of a schedule item for the local day of `now`. */
export interface PetScheduleEntry {
    itemId: string;
    activityType: PetActivityType;
    label: string;
    mode: PetScheduleMode;
    flexibility: "fixed" | "flexible";
    priority: number;
    /** When the occurrence becomes due. */
    start: Date;
    /** Window close for the occurrence itself. */
    end: Date;
    startMinutes: number;
    endMinutes: number;
    /** Exclusive close of the fulfillment window: next entry start or day end. */
    windowEnd: Date;
    fulfilled: boolean;
    fulfilledAt: Date | null;
    /** Whole minutes past the window close while unfulfilled; zero otherwise. */
    overdueMinutes: number;
    /** True while an ongoing nap pauses this interval occurrence. */
    paused: boolean;
    /** True when a completed nap pulled this occurrence forward to the wake time. */
    pulledForward: boolean;
    /** Computed reflow indicator, or null when the occurrence did not move. */
    shift: PetShiftIndicator | null;
}

export interface BuildPetScheduleInput {
    now: Date;
    scheduleItems: readonly PetScheduleItem[];
    activityRecords: readonly PetActivityRecord[];
    naps: readonly PetNapRecord[];
}

export interface PetDaySchedule {
    now: Date;
    dayStart: Date;
    dayEnd: Date;
    napping: boolean;
    activeNap: PetNapRecord | null;
    entries: PetScheduleEntry[];
}

export interface PetDueInfo {
    itemId: string;
    activityType: PetActivityType;
    label: string;
    at: Date;
    overdueMinutes: number;
}

export interface PetReflowChange {
    itemId: string;
    activityType: PetActivityType;
    label: string;
    /** The occurrence's unshifted start, or null when there was no anchor. */
    from: Date | null;
    to: Date;
    deltaMinutes: number;
    reason: PetShiftReason;
}

export interface PetNapReflowProposal {
    /** The nap the proposal responds to. */
    nap: PetNapRecord;
    /** Whole-minute duration of the nap. */
    napMinutes: number;
    changes: PetReflowChange[];
    shifts: PetShiftIndicator[];
}

export interface ProposeNapReflowInput {
    /** The nap that just ended. */
    nap: PetNapRecord;
    now: Date;
    scheduleItems: readonly PetScheduleItem[];
    activityRecords: readonly PetActivityRecord[];
    naps: readonly PetNapRecord[];
}
