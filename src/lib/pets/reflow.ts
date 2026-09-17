import type { PetScheduleItem } from "../../state/types";
import { formatMinuteOfDay } from "./format";
import { formatShiftIndicator, resolveIntervalWindow } from "./schedule";
import type {
    PetNapReflowProposal,
    PetReflowChange,
    PetShiftIndicator,
    ProposeNapReflowInput,
} from "./types";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function dayMinute(dayStart: Date, minute: number): Date {
    const hours = Math.floor(minute / 60);
    const mins = minute % 60;
    return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), hours, mins, 0, 0);
}

/**
 * Proposes how the rest of the day reflows around a nap that just ended.
 * Interval items follow their paused/pulled-forward occurrence; flexible
 * fixed-time items at or after the nap are suggested to shift by the nap
 * duration; fixed items are never included. The result is proposal data only —
 * confirming or adjusting it belongs to the UI.
 */
export function proposeNapReflow(input: ProposeNapReflowInput): PetNapReflowProposal {
    const now = input.now;
    if (Number.isNaN(now.getTime())) throw new RangeError("Invalid pet reflow reference date");
    if (input.nap.end === null) throw new RangeError("Nap reflow proposals require an ended nap");

    const napStartMs = new Date(input.nap.start).getTime();
    const napEndMs = new Date(input.nap.end).getTime();
    if (Number.isNaN(napStartMs) || Number.isNaN(napEndMs)) throw new RangeError("Invalid pet reflow nap");
    const napMinutes = Math.max(0, (napEndMs - napStartMs) / MS_PER_MINUTE);
    const dayStart = startOfLocalDay(new Date(napEndMs));

    const changes: PetReflowChange[] = [];
    for (const item of input.scheduleItems) {
        if (!item.isActive) continue;
        if (item.recurrence.mode === "fixed-time") {
            if (item.flexibility === "fixed") continue;
            const start = dayMinute(dayStart, item.recurrence.startMinutes);
            if (start.getTime() < napStartMs) continue;
            changes.push({
                itemId: item.id,
                activityType: item.activityType,
                label: item.label,
                from: start,
                to: new Date(start.getTime() + napMinutes * MS_PER_MINUTE),
                deltaMinutes: napMinutes,
                reason: "nap",
            });
            continue;
        }

        const resolved = resolveIntervalWindow(item, input.activityRecords, input.naps, now, dayStart);
        if (resolved.shiftReason === null) continue;
        changes.push({
            itemId: item.id,
            activityType: item.activityType,
            label: item.label,
            from: resolved.baseStart,
            to: resolved.start,
            deltaMinutes: (resolved.start.getTime() - resolved.baseStart.getTime()) / MS_PER_MINUTE,
            reason: resolved.shiftReason,
        });
    }

    changes.sort((left, right) => left.to.getTime() - right.to.getTime() || left.itemId.localeCompare(right.itemId));

    const itemsById = new Map(input.scheduleItems.map((item) => [item.id, item]));
    const shifts: PetShiftIndicator[] = [];
    for (const change of changes) {
        const item = itemsById.get(change.itemId);
        if (item) shifts.push(formatShiftIndicator(item, change.deltaMinutes, change.reason, input.nap, now));
    }

    return { nap: input.nap, napMinutes, changes, shifts };
}

function wrapDayMinutes(minute: number): number {
    return ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Applies a confirmed nap-reflow proposal to the stored schedule items.
 * Flexible fixed-time items move by their proposed delta, wrapping within the
 * local day and preserving their window length; fixed and interval items come
 * back untouched because their occurrences are either immovable or already
 * recomputed from the nap log itself.
 */
export function applyNapReflow(
    scheduleItems: readonly PetScheduleItem[],
    proposal: PetNapReflowProposal,
    now: Date,
): PetScheduleItem[] {
    if (Number.isNaN(now.getTime())) throw new RangeError("Invalid pet reflow reference date");
    const deltas = new Map<string, number>();
    for (const change of proposal.changes) {
        deltas.set(change.itemId, Math.round(change.deltaMinutes));
    }
    const stamp = now.toISOString();
    return scheduleItems.map((item): PetScheduleItem => {
        const delta = deltas.get(item.id);
        if (delta === undefined || delta === 0) return item;
        if (item.recurrence.mode !== "fixed-time" || item.flexibility !== "flexible") return item;
        const startMinutes = wrapDayMinutes(item.recurrence.startMinutes + delta);
        const windowMinutes = item.recurrence.endMinutes - item.recurrence.startMinutes;
        return {
            ...item,
            recurrence: {
                mode: "fixed-time",
                time: formatMinuteOfDay(startMinutes),
                startMinutes,
                endMinutes: startMinutes + windowMinutes,
            },
            updatedAt: stamp,
        };
    });
}
