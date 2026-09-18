import type { PetNotableEvent } from "../../state/types";
import { formatPetAgeAt } from "./age";
import { createPetNotableEvent } from "./factories";
import type { NewPetNotableEventInput, PetTimelineDateRange } from "./types";

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function timestampOf(value: string | Date, label: string): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid ${label}`);
    return date;
}

/** Local calendar date key (YYYY-MM-DD) for a timeline timestamp. */
export function notableEventDateKey(timestamp: string | Date): string {
    const date = timestampOf(timestamp, "pet notable event timestamp");
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Converts a YYYY-MM-DD date input into the event timestamp at local noon, so
 * the stored instant and the computed age stay on the same local calendar day
 * regardless of DST.
 */
export function notableEventTimestamp(dateKey: string): string {
    const match = DATE_KEY_PATTERN.exec(dateKey);
    if (!match) throw new RangeError("Pet notable event date must use YYYY-MM-DD format");
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
        throw new RangeError("Invalid pet notable event date");
    }
    return date.toISOString();
}

/**
 * Append-plus-correct: rebuilds an event from the edited input with a fresh
 * `updatedAt`, preserving its id and original `createdAt`. There is no delete;
 * the timeline is curated history.
 */
export function correctNotableEvent(
    event: PetNotableEvent,
    input: NewPetNotableEventInput,
    now: Date,
): PetNotableEvent {
    const corrected = createPetNotableEvent(input, now, event.id);
    return { ...corrected, createdAt: event.createdAt };
}

/** Newest first; equal timestamps fall back to creation order. */
export function sortNotableEventsNewestFirst(events: readonly PetNotableEvent[]): PetNotableEvent[] {
    return [...events].sort((left, right) => {
        const byTimestamp = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
        if (byTimestamp !== 0) return byTimestamp;
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
}

/**
 * Filters by inclusive local-calendar range; `null` bounds stay open. An
 * inverted range matches nothing rather than throwing.
 */
export function filterNotableEvents(
    events: readonly PetNotableEvent[],
    range: PetTimelineDateRange,
): PetNotableEvent[] {
    return events.filter((event) => {
        const key = notableEventDateKey(event.timestamp);
        if (range.from !== null && key < range.from) return false;
        if (range.to !== null && key > range.to) return false;
        return true;
    });
}

/**
 * The age annotation shown on every timeline entry, e.g.
 * "at 14 weeks: First reliable sit". The age is computed at the event time and
 * never stored on the record.
 */
export function annotateNotableEvent(event: PetNotableEvent, birthDate: string | Date): string {
    const timestamp = timestampOf(event.timestamp, "pet notable event timestamp");
    return `at ${formatPetAgeAt(birthDate, timestamp)}: ${event.title}`;
}
