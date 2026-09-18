import { describe, expect, it } from "vitest";
import type { PetNotableEvent } from "../../state/types";
import {
    annotateNotableEvent,
    correctNotableEvent,
    filterNotableEvents,
    notableEventDateKey,
    notableEventTimestamp,
    sortNotableEventsNewestFirst,
} from "./timeline";

const BIRTH_DATE = "2026-01-10";
const CREATED_AT = "2026-09-17T10:00:00.000Z";

/** Local-noon timestamp for a calendar date, matching the UI's date input. */
function at(year: number, month: number, day: number): string {
    return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

function eventAt(id: string, dateKey: string, overrides: Partial<PetNotableEvent> = {}): PetNotableEvent {
    const [year, month, day] = dateKey.split("-").map(Number);
    return {
        id,
        title: `Event ${id}`,
        notes: "",
        timestamp: at(year, month, day),
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        ...overrides,
    };
}

describe("pet notable event timeline", () => {
    it("stamps the age at the event time, not the record creation time", () => {
        const backdated = {
            ...eventAt("e1", "2026-07-09", { title: "First reliable sit" }),
            createdAt: "2026-09-17T10:00:00.000Z",
        };
        expect(annotateNotableEvent(backdated, BIRTH_DATE)).toBe("at 25 weeks: First reliable sit");
    });

    it("switches from weeks to months on the six-month birthday", () => {
        const dayBefore = eventAt("e1", "2026-07-09", { title: "First hike" });
        const birthday = eventAt("e2", "2026-07-10", { title: "Six months old" });
        expect(annotateNotableEvent(dayBefore, BIRTH_DATE)).toBe("at 25 weeks: First hike");
        expect(annotateNotableEvent(birthday, BIRTH_DATE)).toBe("at 6 months: Six months old");
    });

    it("filters by an inclusive local-calendar date range with open bounds", () => {
        const events = [
            eventAt("e1", "2026-07-09"),
            eventAt("e2", "2026-07-10"),
            eventAt("e3", "2026-08-01"),
            eventAt("e4", "2026-12-25"),
        ];

        expect(filterNotableEvents(events, { from: null, to: null }).map((event) => event.id)).toEqual([
            "e1",
            "e2",
            "e3",
            "e4",
        ]);
        expect(filterNotableEvents(events, { from: "2026-07-10", to: null }).map((event) => event.id)).toEqual([
            "e2",
            "e3",
            "e4",
        ]);
        expect(filterNotableEvents(events, { from: null, to: "2026-07-10" }).map((event) => event.id)).toEqual([
            "e1",
            "e2",
        ]);
        expect(
            filterNotableEvents(events, { from: "2026-07-10", to: "2026-08-01" }).map((event) => event.id),
        ).toEqual(["e2", "e3"]);
        // An inverted range matches nothing instead of throwing.
        expect(filterNotableEvents(events, { from: "2026-08-01", to: "2026-07-10" })).toEqual([]);
    });

    it("sorts newest first with creation order as the tie-breaker", () => {
        const oldest = eventAt("old", "2026-07-09");
        const newer = eventAt("new", "2026-08-01");
        const firstOfTie = { ...eventAt("tie-first", "2026-08-01"), createdAt: "2026-09-01T10:00:00.000Z" };
        const secondOfTie = { ...eventAt("tie-second", "2026-08-01"), createdAt: "2026-09-02T10:00:00.000Z" };
        const sorted = sortNotableEventsNewestFirst([oldest, secondOfTie, newer, firstOfTie]);
        expect(sorted.map((event) => event.id)).toEqual(["tie-first", "tie-second", "new", "old"]);
    });

    it("corrects an event in place while preserving its id and createdAt", () => {
        const original = eventAt("e1", "2026-07-09", { title: "First sit", notes: "lure" });
        const corrected = correctNotableEvent(
            original,
            { title: "  First reliable sit  ", notes: "held for five seconds", timestamp: at(2026, 7, 24) },
            new Date(2026, 8, 17, 15, 0, 0),
        );
        expect(corrected).toMatchObject({
            id: "e1",
            title: "First reliable sit",
            notes: "held for five seconds",
            timestamp: at(2026, 7, 24),
            createdAt: original.createdAt,
            updatedAt: new Date(2026, 8, 17, 15, 0, 0).toISOString(),
        });
        expect(original.title).toBe("First sit");
        expect(() => correctNotableEvent(original, { title: "   ", timestamp: original.timestamp }, new Date())).toThrow(
            RangeError,
        );
    });

    it("round-trips a date input through the local calendar key", () => {
        expect(notableEventDateKey(at(2026, 7, 9))).toBe("2026-07-09");
        expect(notableEventDateKey(notableEventTimestamp("2026-12-25"))).toBe("2026-12-25");
        expect(() => notableEventTimestamp("2026-7-9")).toThrow(RangeError);
        expect(() => notableEventTimestamp("2026-02-30")).toThrow(RangeError);
    });
});
