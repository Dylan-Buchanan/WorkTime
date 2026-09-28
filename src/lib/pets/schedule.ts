import type {
    PetActivityRecord,
    PetActivityType,
    PetNapRecord,
    PetScheduleItem,
    PetWeightEntry,
} from "../../state/types";
import { formatClock, formatDeltaMinutes } from "./format";
import type {
    BuildPetScheduleInput,
    PetDaySchedule,
    PetDueInfo,
    PetScheduleEntry,
    PetShiftIndicator,
    PetShiftReason,
} from "./types";
import { DEFAULT_END_OF_DAY, DEFAULT_START_OF_DAY, isTimeOfDay } from "../settings";

const MS_PER_MINUTE = 60_000;

function assertValidDate(date: Date, label: string): Date {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RangeError(`Invalid ${label}`);
    return date;
}

export function parsePetScheduleTime(value: string | undefined, fallback: string): number {
    const time = isTimeOfDay(value) ? value : fallback;
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

/** Resolve the latest configured start boundary at or before `now`. */
export function resolvePetScheduleDay(now: Date, startOfDay = DEFAULT_START_OF_DAY, endOfDay = DEFAULT_END_OF_DAY): { dayStart: Date; dayEnd: Date } {
    const startMinute = parsePetScheduleTime(startOfDay, DEFAULT_START_OF_DAY);
    const endMinute = parsePetScheduleTime(endOfDay, DEFAULT_END_OF_DAY);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(startMinute / 60), startMinute % 60);
    const dayStart = now.getTime() >= todayStart.getTime()
        ? todayStart
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, Math.floor(startMinute / 60), startMinute % 60);
    // Equal boundaries intentionally represent a full 24-hour schedule day.
    const overnight = endMinute <= startMinute;
    const endDate = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + (overnight ? 1 : 0), Math.floor(endMinute / 60), endMinute % 60);
    return { dayStart, dayEnd: endDate };
}

export function resolveFixedTimeInScheduleDay(dayStart: Date, startMinute: number, dayEnd: Date, configuredStartMinute: number, configuredEndMinute: number): Date | null {
    const overnight = configuredEndMinute <= configuredStartMinute;
    let dateOffset = 0;
    if (startMinute < configuredStartMinute) {
        if (!overnight || (configuredEndMinute !== configuredStartMinute && startMinute >= configuredEndMinute)) return null;
        dateOffset = 1;
    }
    const date = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + dateOffset,
        Math.floor(startMinute / 60), startMinute % 60);
    return date >= dayStart && date < dayEnd ? date : null;
}

function minutesOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function minutesBetween(later: Date, earlier: Date): number {
    return (later.getTime() - earlier.getTime()) / MS_PER_MINUTE;
}

interface NapBounds {
    start: number;
    end: number;
}

function napBounds(nap: PetNapRecord, nowMs: number): NapBounds | null {
    const start = new Date(nap.start).getTime();
    if (Number.isNaN(start)) return null;
    const end = nap.end === null ? nowMs : new Date(nap.end).getTime();
    if (Number.isNaN(end)) return null;
    return { start, end: Math.max(start, end) };
}

interface PauseSummary {
    totalMs: number;
    contributingNaps: PetNapRecord[];
}

/** Returns the union of nap time in `[from, to]`, so overlaps are counted once. */
function summarizePause(naps: readonly PetNapRecord[], fromMs: number, toMs: number): PauseSummary {
    const ranges: { start: number; end: number; nap: PetNapRecord }[] = [];
    for (const nap of naps) {
        const bounds = napBounds(nap, toMs);
        if (!bounds) continue;
        const start = Math.max(bounds.start, fromMs);
        const end = Math.min(bounds.end, toMs);
        if (end > start) ranges.push({ start, end, nap });
    }
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);

    let totalMs = 0;
    let mergedStart: number | null = null;
    let mergedEnd: number | null = null;
    for (const range of ranges) {
        if (mergedStart === null || mergedEnd === null) {
            mergedStart = range.start;
            mergedEnd = range.end;
        } else if (range.start <= mergedEnd) {
            mergedEnd = Math.max(mergedEnd, range.end);
        } else {
            totalMs += mergedEnd - mergedStart;
            mergedStart = range.start;
            mergedEnd = range.end;
        }
    }
    if (mergedStart !== null && mergedEnd !== null) totalMs += mergedEnd - mergedStart;
    return { totalMs, contributingNaps: ranges.map((range) => range.nap) };
}

function latestRecordAtOrBefore(
    records: readonly PetActivityRecord[],
    activityType: PetActivityType,
    nowMs: number,
    fromMs = Number.NEGATIVE_INFINITY,
): PetActivityRecord | null {
    let latest: PetActivityRecord | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const record of records) {
        if (record.activityType !== activityType) continue;
        const time = new Date(record.timestamp).getTime();
        if (Number.isNaN(time) || time > nowMs || time < fromMs) continue;
        if (time > latestMs) {
            latest = record;
            latestMs = time;
        }
    }
    return latest;
}

/** Latest record of a type regardless of timestamp; corrections are respected. */
export function latestActivityRecord(
    records: readonly PetActivityRecord[],
    activityType: PetActivityType,
): PetActivityRecord | null {
    return latestRecordAtOrBefore(records, activityType, Number.POSITIVE_INFINITY);
}

/** The profile's current weight is the latest entry, never a stored field. */
export function latestWeightEntry(entries: readonly PetWeightEntry[]): PetWeightEntry | null {
    let latest: PetWeightEntry | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const entry of entries) {
        const time = new Date(entry.timestamp).getTime();
        if (Number.isNaN(time)) continue;
        if (time > latestMs) {
            latest = entry;
            latestMs = time;
        }
    }
    return latest;
}

function latestInProgressNap(naps: readonly PetNapRecord[], nowMs: number): PetNapRecord | null {
    let latest: PetNapRecord | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const nap of naps) {
        if (nap.end !== null) continue;
        const start = new Date(nap.start).getTime();
        if (Number.isNaN(start) || start > nowMs) continue;
        if (start > latestMs) {
            latest = nap;
            latestMs = start;
        }
    }
    return latest;
}

function latestCompletedNap(naps: readonly PetNapRecord[], fromMs: number, toMs: number): PetNapRecord | null {
    let latest: PetNapRecord | null = null;
    let latestMs = Number.NEGATIVE_INFINITY;
    for (const nap of naps) {
        if (nap.end === null) continue;
        const end = new Date(nap.end).getTime();
        if (Number.isNaN(end) || end < fromMs || end > toMs) continue;
        if (end > latestMs) {
            latest = nap;
            latestMs = end;
        }
    }
    return latest;
}

export interface ResolvedIntervalWindow {
    /** Latest matching record used as the anchor; null before the first matching record. */
    anchor: Date | null;
    /** Anchor + min interval, before nap pauses. */
    baseStart: Date;
    /** Anchor + max interval, before nap pauses. */
    baseEnd: Date;
    /** Resulting due time after pausing and post-wake pull-forward. */
    start: Date;
    /** Resulting window close after pausing and post-wake pull-forward. */
    end: Date;
    paused: boolean;
    pauseMinutes: number;
    pulledForward: boolean;
    shiftNap: PetNapRecord | null;
    /** Every nap contributing to a delayed occurrence, ordered by start time. */
    shiftNaps: PetNapRecord[];
    shiftReason: PetShiftReason | null;
}

/**
 * Resolves the next interval occurrence for an item. The anchor is the latest
 * matching activity record in the current schedule day (falling back to the
 * item's creation time when it belongs to that day, otherwise the day start).
 * Nap time after the anchor pauses the interval so overdue never accrues while the pet is asleep,
 * and a nap that ran through the due moment pulls the next occurrence forward
 * to the wake time.
 */
export function resolveIntervalWindow(
    item: PetScheduleItem,
    records: readonly PetActivityRecord[],
    naps: readonly PetNapRecord[],
    now: Date,
    dayStart: Date,
): ResolvedIntervalWindow {
    if (item.recurrence.mode !== "interval") {
        throw new RangeError("resolveIntervalWindow requires an interval recurrence");
    }
    const nowMs = now.getTime();
    const itemCreatedMs = new Date(item.createdAt).getTime();
    const firstAnchorMs = Number.isNaN(itemCreatedMs) || itemCreatedMs < dayStart.getTime()
        ? dayStart.getTime()
        : itemCreatedMs;
    const anchorRecord = latestRecordAtOrBefore(records, item.activityType, nowMs, dayStart.getTime());
    const anchorMs = anchorRecord ? new Date(anchorRecord.timestamp).getTime() : firstAnchorMs;
    const baseStartMs = anchorMs + item.recurrence.minMinutes * MS_PER_MINUTE;
    const baseEndMs = anchorMs + item.recurrence.maxMinutes * MS_PER_MINUTE;
    const pause = summarizePause(naps, Math.max(anchorMs, dayStart.getTime()), nowMs);
    const pauseMs = pause.totalMs;
    const pausedStartMs = baseStartMs + pauseMs;
    const pausedEndMs = baseEndMs + pauseMs;
    const activeNap = latestInProgressNap(naps, nowMs);

    const base = {
        anchor: anchorRecord ? new Date(anchorMs) : null,
        baseStart: new Date(baseStartMs),
        baseEnd: new Date(baseEndMs),
        pauseMinutes: pauseMs / MS_PER_MINUTE,
    };

    if (activeNap) {
        return {
            ...base,
            start: new Date(pausedStartMs),
            end: new Date(pausedEndMs),
            paused: true,
            pulledForward: false,
            shiftNap: activeNap,
            shiftNaps: pause.contributingNaps,
            shiftReason: pausedStartMs === baseStartMs ? null : "nap",
        };
    }

    const completedNap = latestCompletedNap(naps, anchorMs, nowMs);
    const wakeMs = completedNap && completedNap.end !== null ? new Date(completedNap.end).getTime() : null;
    if (wakeMs !== null && wakeMs >= baseStartMs && wakeMs < pausedStartMs) {
        return {
            ...base,
            start: new Date(wakeMs),
            end: new Date(wakeMs),
            paused: false,
            pulledForward: true,
            shiftNap: completedNap,
            shiftNaps: completedNap ? [completedNap] : [],
            shiftReason: "post-wake",
        };
    }

    return {
        ...base,
        start: new Date(pausedStartMs),
        end: new Date(pausedEndMs),
        paused: false,
        pulledForward: false,
        shiftNap: completedNap,
        shiftNaps: pause.contributingNaps,
        shiftReason: pausedStartMs === baseStartMs ? null : "nap",
    };
}

/** Builds the reusable "potty +40m — nap 13:30–14:10" style explanation. */
export function formatShiftIndicator(
    item: Pick<PetScheduleItem, "id" | "activityType" | "label">,
    deltaMinutes: number,
    reason: PetShiftReason,
    nap: PetNapRecord | readonly PetNapRecord[] | null,
    now: Date,
): PetShiftIndicator {
    const head = `${item.label.toLowerCase()} ${formatDeltaMinutes(deltaMinutes)}`;
    const naps = nap === null ? [] : Array.isArray(nap) ? nap : [nap];
    let description = head;
    if (reason === "nap" && naps.length > 0) {
        const ranges = naps.map((entry) => {
            const start = new Date(entry.start);
            const end = entry.end ? new Date(entry.end) : now;
            return `${formatClock(start)}–${formatClock(end)}`;
        });
        description = `${head} — ${naps.length === 1 ? "nap" : "naps"} ${ranges.join(", ")}`;
    } else if (reason === "post-wake" && naps.length > 0) {
        const latestNap = naps[naps.length - 1];
        if (latestNap.end) description = `${head} — post-wake ${formatClock(new Date(latestNap.end))}`;
    }
    return {
        itemId: item.id,
        activityType: item.activityType,
        label: item.label,
        deltaMinutes: Math.round(deltaMinutes),
        reason,
        description,
    };
}

function compareEntries(left: PetScheduleEntry, right: PetScheduleEntry): number {
    if (left.start.getTime() !== right.start.getTime()) return left.start.getTime() - right.start.getTime();
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.itemId !== right.itemId) return left.itemId.localeCompare(right.itemId);
    return left.activityType.localeCompare(right.activityType);
}

function buildEntry(
    item: PetScheduleItem,
    input: BuildPetScheduleInput,
    dayStart: Date,
    dayEnd: Date,
    now: Date,
): PetScheduleEntry | null {
    if (item.recurrence.mode === "fixed-time") {
        const configuredStartMinute = parsePetScheduleTime(input.startOfDay, DEFAULT_START_OF_DAY);
        const configuredEndMinute = parsePetScheduleTime(input.endOfDay, DEFAULT_END_OF_DAY);
        const start = resolveFixedTimeInScheduleDay(dayStart, item.recurrence.startMinutes, dayEnd, configuredStartMinute, configuredEndMinute);
        if (!start) return null;
        const rawEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(),
            Math.floor(item.recurrence.endMinutes / 60), item.recurrence.endMinutes % 60);
        const end = rawEnd < start
            ? new Date(rawEnd.getFullYear(), rawEnd.getMonth(), rawEnd.getDate() + 1, rawEnd.getHours(), rawEnd.getMinutes())
            : rawEnd;
        return {
            itemId: item.id,
            activityType: item.activityType,
            label: item.label,
            mode: "fixed-time",
            flexibility: item.flexibility,
            priority: item.priority,
            start,
            end: end > dayEnd ? dayEnd : end,
            startMinutes: item.recurrence.startMinutes,
            endMinutes: minutesOfDay(end > dayEnd ? dayEnd : end),
            windowEnd: end > dayEnd ? dayEnd : end,
            fulfilled: false,
            fulfilledAt: null,
            overdueMinutes: 0,
            paused: false,
            pulledForward: false,
            shift: null,
        };
    }

    const resolved = resolveIntervalWindow(item, input.activityRecords, input.naps, now, dayStart);
    if (resolved.start < dayStart || resolved.start >= dayEnd) return null;
    return {
        itemId: item.id,
        activityType: item.activityType,
        label: item.label,
        mode: "interval",
        flexibility: item.flexibility,
        priority: item.priority,
        start: resolved.start,
        end: resolved.end > dayEnd ? dayEnd : resolved.end,
        startMinutes: minutesOfDay(resolved.start),
        endMinutes: minutesOfDay(resolved.end > dayEnd ? dayEnd : resolved.end),
        windowEnd: resolved.end > dayEnd ? dayEnd : resolved.end,
        fulfilled: false,
        fulfilledAt: null,
        overdueMinutes: 0,
        paused: resolved.paused,
        pulledForward: resolved.pulledForward,
        shift: resolved.shiftReason
            ? formatShiftIndicator(item, minutesBetween(resolved.start, resolved.baseStart), resolved.shiftReason, resolved.shiftNaps, now)
            : null,
    };
}

/** First matching-type record inside `[entry.start, entry.windowEnd)`, or null. */
function firstMatchingRecord(entry: PetScheduleEntry, records: readonly PetActivityRecord[], nowMs: number): Date | null {
    const startMs = entry.start.getTime();
    const endMs = entry.windowEnd.getTime();
    let best: number | null = null;
    for (const record of records) {
        if (record.activityType !== entry.activityType) continue;
        const time = new Date(record.timestamp).getTime();
        if (Number.isNaN(time) || time > nowMs || time < startMs || time >= endMs) continue;
        if (best === null || time < best) best = time;
    }
    return best === null ? null : new Date(best);
}

/**
 * Builds the configured schedule day for `now`. Fulfillment is decided by the agreed
 * `[item start, next item start)` window; overdue is always recomputed from the
 * log and never stored.
 */
export function buildPetSchedule(input: BuildPetScheduleInput): PetDaySchedule {
    const now = assertValidDate(input.now, "pet schedule now");
    const { dayStart, dayEnd } = resolvePetScheduleDay(now, input.startOfDay, input.endOfDay);
    const nowMs = now.getTime();
    const activeNap = latestInProgressNap(input.naps, nowMs);

    const entries = now.getTime() >= dayEnd.getTime() ? [] : input.scheduleItems
        .filter((item) => item.isActive)
        .map((item) => buildEntry(item, input, dayStart, dayEnd, now))
        .filter((entry): entry is PetScheduleEntry => entry !== null)
        .sort(compareEntries);

    let groupStart = 0;
    while (groupStart < entries.length) {
        let nextGroup = groupStart + 1;
        const startMs = entries[groupStart].start.getTime();
        while (nextGroup < entries.length && entries[nextGroup].start.getTime() === startMs) nextGroup += 1;
        const windowEnd = nextGroup < entries.length ? entries[nextGroup].start : dayEnd;
        for (let index = groupStart; index < nextGroup; index += 1) entries[index].windowEnd = windowEnd;
        groupStart = nextGroup;
    }

    for (const entry of entries) {
        const fulfilledAt = firstMatchingRecord(entry, input.activityRecords, nowMs);
        entry.fulfilled = fulfilledAt !== null;
        entry.fulfilledAt = fulfilledAt;
        entry.overdueMinutes = fulfilledAt !== null ? 0 : Math.max(0, minutesBetween(now, entry.end));
    }

    return { now, dayStart, dayEnd, napping: activeNap !== null, activeNap, entries };
}

/** The next obligation of any kind, overdue included, or null when all are done. */
export function nextDue(schedule: PetDaySchedule): PetDueInfo | null {
    let best: PetScheduleEntry | null = null;
    for (const entry of schedule.entries) {
        if (entry.fulfilled) continue;
        const earlier = best === null || entry.start.getTime() < best.start.getTime()
            || (entry.start.getTime() === best.start.getTime() && entry.priority < best.priority);
        if (earlier) best = entry;
    }
    if (best === null) return null;
    return {
        itemId: best.itemId,
        activityType: best.activityType,
        label: best.label,
        at: best.start,
        overdueMinutes: best.overdueMinutes,
    };
}

/** The next not-yet-due schedule item; null when nothing is left ahead today. */
export function freeUntil(schedule: PetDaySchedule): Date | null {
    const nowMs = schedule.now.getTime();
    let best: number | null = null;
    for (const entry of schedule.entries) {
        if (entry.fulfilled) continue;
        const startMs = entry.start.getTime();
        if (startMs <= nowMs) continue;
        if (best === null || startMs < best) best = startMs;
    }
    return best === null ? null : new Date(best);
}
