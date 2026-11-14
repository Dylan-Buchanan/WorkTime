import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CalendarBusyContextValue, CalendarBusyStatus } from "../../state/CalendarBusyContext";
import type { PetActivityCounts, PetBlockedBy, PetDaySchedule, PetScheduleEntry } from "../../lib/pets";
import { PetScheduleDeck } from "./PetScheduleDeck";

/** Pinned reference time: 2026-09-17 15:00 local. */
const NOW = new Date(2026, 8, 17, 15, 0, 0, 0);

function at(hour: number, minute = 0): Date {
    return new Date(2026, 8, 17, hour, minute, 0, 0);
}

const EMPTY_COUNTS: PetActivityCounts = { potty: 0, training: 0, playtime: 0, feeding: 0 };

function makeEntry(input: Partial<PetScheduleEntry> & Pick<PetScheduleEntry, "itemId" | "label">): PetScheduleEntry {
    const start = input.start ?? at(10);
    const end = input.end ?? start;
    return {
        activityType: "playtime",
        mode: "fixed-time",
        flexibility: "flexible",
        priority: 0,
        start,
        end,
        startMinutes: start.getHours() * 60 + start.getMinutes(),
        endMinutes: end.getHours() * 60 + end.getMinutes(),
        windowEnd: at(22),
        blockedBy: null,
        unshiftedStart: start,
        unshiftedWindowEnd: at(22),
        occurrenceStart: start,
        fulfilled: false,
        fulfilledAt: null,
        overdueMinutes: 0,
        paused: false,
        pulledForward: false,
        shift: null,
        ...input,
    };
}

function shifted(entry: PetScheduleEntry, description: string, deltaMinutes: number, reason: "nap" | "post-wake" | "busy" = "busy"): PetScheduleEntry {
    return {
        ...entry,
        shift: {
            itemId: entry.itemId,
            activityType: entry.activityType,
            label: entry.label,
            deltaMinutes,
            reason,
            description,
        },
    };
}

function run(start: Date, end: Date, reason: PetBlockedBy["reason"] = "day-end"): PetBlockedBy {
    return { start, end, reason };
}

function makeSchedule(entries: PetScheduleEntry[], overrides: Partial<PetDaySchedule> = {}): PetDaySchedule {
    return {
        now: NOW,
        dayStart: at(0),
        dayEnd: at(22),
        napping: false,
        activeNap: null,
        entries,
        ...overrides,
    };
}

function calendarProp(
    status: CalendarBusyStatus,
    refreshedAt: Date | null = null,
    refresh: () => void = vi.fn(),
): CalendarBusyContextValue {
    return {
        snapshot: {
            intervals: [],
            refreshedAt: refreshedAt ? refreshedAt.toISOString() : null,
            status,
            dayStart: at(0),
            dayEnd: at(22),
        },
        refresh,
    };
}

interface DeckOptions {
    entries: PetScheduleEntry[];
    now?: Date;
    expanded?: boolean;
    calendar?: CalendarBusyContextValue;
    onCheck?(entry: PetScheduleEntry): void;
    onRemove?(itemId: string): void;
}

function deck(options: DeckOptions) {
    const now = options.now ?? NOW;
    return (
        <PetScheduleDeck
            schedule={makeSchedule(options.entries, { now })}
            scheduleItems={[]}
            excludedFixedCount={0}
            doneCounts={EMPTY_COUNTS}
            todayNaps={[]}
            now={now}
            expanded={options.expanded ?? false}
            onToggleExpanded={() => undefined}
            onCheck={options.onCheck ?? (() => undefined)}
            onRemove={options.onRemove ?? (() => undefined)}
            calendar={options.calendar ?? calendarProp("empty")}
        />
    );
}

describe("PetScheduleDeck markers", () => {
    it.each([
        ["walk +30m — busy 2:00 PM–2:30 PM", 30],
        ["walk +55m — nap 1:00 PM–1:30 PM; busy 1:30 PM–2:00 PM", 55],
    ])("renders the moved line verbatim: %s", (description, deltaMinutes) => {
        const entry = shifted(makeEntry({ itemId: "walk", label: "Walk", start: at(14, 30), unshiftedStart: at(14) }), description, deltaMinutes);
        render(deck({ entries: [entry] }));

        const card = screen.getByText("Walk").closest("article")!;
        expect(card).toHaveTextContent(`↺ ${description}`);
        expect(card).toHaveTextContent("Moved:");
        expect(within(card).getByText("↺")).toHaveAttribute("aria-hidden", "true");
    });

    it("renders the day-end blocked copy", () => {
        const entry = makeEntry({
            itemId: "walk",
            label: "Walk",
            start: at(14),
            blockedBy: run(at(14), at(14, 30), "day-end"),
        });
        render(deck({ entries: [entry] }));

        const card = screen.getByText("Walk").closest("article")!;
        expect(card).toHaveTextContent("Blocked: ⛔ Couldn't fit before 10:00 PM — busy 2:00 PM–2:30 PM");
        expect(within(card).getByText("⛔")).toHaveAttribute("aria-hidden", "true");
    });

    it("renders the interval-limit blocked copy", () => {
        const entry = makeEntry({
            itemId: "potty",
            label: "Potty",
            activityType: "potty",
            mode: "interval",
            start: at(14, 10),
            end: at(15, 40),
            blockedBy: run(at(14), at(14, 30), "interval-limit"),
        });
        render(deck({ entries: [entry] }));

        const card = screen.getByText("Potty").closest("article")!;
        expect(card).toHaveTextContent("Blocked: ⛔ Can't push past its 3:40 PM limit — busy 2:00 PM–2:30 PM");
    });

    it("renders both lines on one card with the moved line first", () => {
        const entry = shifted(makeEntry({
            itemId: "potty",
            label: "Potty",
            activityType: "potty",
            mode: "interval",
            start: at(14, 10),
            end: at(15, 40),
            blockedBy: run(at(15, 40), at(16, 10), "interval-limit"),
        }), "potty +40m — nap 1:30 PM–2:10 PM", 40, "nap");
        render(deck({ entries: [entry] }));

        const card = screen.getByText("Potty").closest("article")!;
        const text = card.textContent ?? "";
        expect(text).toContain("Moved:");
        expect(text).toContain("Blocked:");
        expect(text.indexOf("Moved:")).toBeLessThan(text.indexOf("Blocked:"));
    });

    it("shows neither line on fulfilled entries", () => {
        const doneMoved = shifted(makeEntry({
            itemId: "walk",
            label: "Walk",
            start: at(14, 30),
            unshiftedStart: at(14),
            fulfilled: true,
            fulfilledAt: at(15),
        }), "walk +30m — busy 2:00 PM–2:30 PM", 30);
        const doneBlocked = makeEntry({
            itemId: "play",
            label: "Play",
            start: at(16),
            fulfilled: true,
            fulfilledAt: at(16, 5),
            blockedBy: run(at(16), at(16, 30), "day-end"),
        });
        render(deck({ entries: [doneMoved, doneBlocked], expanded: true }));

        for (const label of ["Walk", "Play"]) {
            const card = screen.getByText(label).closest("article")!;
            expect(card).not.toHaveTextContent("Moved:");
            expect(card).not.toHaveTextContent("Blocked:");
            expect(card).not.toHaveTextContent("↺");
            expect(card).not.toHaveTextContent("⛔");
        }
    });

    it("keeps the overdue tone and chip on an overdue blocked card", () => {
        const entry = makeEntry({
            itemId: "walk",
            label: "Walk",
            start: at(14),
            overdueMinutes: 30,
            blockedBy: run(at(14), at(14, 30), "day-end"),
        });
        render(deck({ entries: [entry] }));

        const card = screen.getByText("Walk").closest("article")!;
        expect(card).toHaveTextContent("overdue 30m");
        expect(card).toHaveClass("border-red-900/60");
        expect(card).toHaveTextContent("Blocked: ⛔ Couldn't fit before 10:00 PM — busy 2:00 PM–2:30 PM");
    });

    describe("grouping", () => {
        it("collapses a shared busy run into one grouped row that reveals its members", () => {
            const blocked = run(at(14), at(14, 30), "day-end");
            const entries = [
                makeEntry({ itemId: "walk", label: "Walk", start: at(14), blockedBy: blocked }),
                makeEntry({ itemId: "play", label: "Play", start: at(14, 5), blockedBy: blocked }),
            ];
            render(deck({ entries, onCheck: vi.fn() }));

            const group = screen.getByRole("group", { name: "Blocked by busy 2:00 PM–2:30 PM" });
            expect(group).toHaveTextContent("Blocked: ⛔ Walk, Play couldn't be placed — busy 2:00 PM–2:30 PM");
            expect(within(group).queryAllByRole("article")).toHaveLength(0);

            const toggle = within(group).getByRole("button", { name: "Show items" });
            expect(toggle).toHaveAttribute("aria-expanded", "false");
            fireEvent.click(toggle);

            expect(within(group).getByRole("button", { name: "Hide items" })).toHaveAttribute("aria-expanded", "true");
            expect(within(group).getAllByRole("article")).toHaveLength(2);
            expect(within(group).getByRole("button", { name: /Log walk/ })).toBeInTheDocument();
            expect(within(group).getByRole("button", { name: /Log play/ })).toBeInTheDocument();
            expect(within(group).getByRole("button", { name: "Remove Walk from schedule" })).toBeInTheDocument();
            expect(within(group).getByRole("button", { name: "Remove Play from schedule" })).toBeInTheDocument();
        });

        it("renders a lone blocked entry as a normal card", () => {
            const entry = makeEntry({
                itemId: "walk",
                label: "Walk",
                start: at(14),
                blockedBy: run(at(14), at(14, 30), "day-end"),
            });
            render(deck({ entries: [entry] }));

            expect(screen.queryByRole("group")).toBeNull();
            expect(screen.queryByRole("button", { name: "Show items" })).toBeNull();
            const card = screen.getByText("Walk").closest("article")!;
            expect(card).toHaveTextContent("Blocked:");
        });

        it("does not group entries blocked by different runs", () => {
            const entries = [
                makeEntry({ itemId: "walk", label: "Walk", start: at(14), blockedBy: run(at(14), at(14, 30), "day-end") }),
                makeEntry({ itemId: "play", label: "Play", start: at(14, 5), blockedBy: run(at(14), at(14, 30), "day-end") }),
                makeEntry({ itemId: "dinner", label: "Dinner", activityType: "feeding", start: at(18), blockedBy: run(at(18), at(18, 30), "day-end") }),
            ];
            render(deck({ entries }));

            expect(screen.getAllByRole("group")).toHaveLength(1);
            const group = screen.getByRole("group", { name: "Blocked by busy 2:00 PM–2:30 PM" });
            expect(group).toHaveTextContent("Walk, Play couldn't be placed");
            expect(within(group).queryByText("Dinner")).toBeNull();
            const dinnerCard = screen.getByText("Dinner").closest("article")!;
            expect(dinnerCard).toHaveTextContent("Blocked: ⛔ Couldn't fit before 10:00 PM — busy 6:00 PM–6:30 PM");
        });
    });

    describe("calendar header", () => {
        it("shows the hint, legend, freshness and a working refresh control when ok", () => {
            const refresh = vi.fn();
            render(deck({ entries: [], calendar: calendarProp("ok", new Date(NOW.getTime() - 120_000), refresh) }));

            expect(screen.getByText(/Flexible items move around busy time on your linked calendars\./)).toBeInTheDocument();
            expect(screen.getByText("moved")).toBeInTheDocument();
            expect(screen.getByText("couldn't fit")).toBeInTheDocument();
            expect(screen.getByText("Calendar · refreshed 2m ago")).toBeInTheDocument();

            const button = screen.getByRole("button", { name: "Refresh calendar busy time" });
            fireEvent.click(button);
            expect(refresh).toHaveBeenCalledTimes(1);
        });

        it("uses the unavailable notice in the freshness slot and keeps the refresh control", () => {
            const view = render(deck({
                entries: [],
                calendar: calendarProp("unavailable", new Date(NOW.getTime() - 120_000)),
            }));

            expect(screen.getByText("Calendar unavailable — showing last known busy time")).toBeInTheDocument();
            expect(screen.queryByText(/refreshed/)).toBeNull();
            expect(screen.getByRole("button", { name: "Refresh calendar busy time" })).toBeInTheDocument();
            view.unmount();

            render(deck({ entries: [], calendar: calendarProp("unavailable") }));
            expect(screen.getByText("Calendar unavailable")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Refresh calendar busy time" })).toBeInTheDocument();
        });

        it("renders no hint, status or refresh control when empty or loading", () => {
            for (const status of ["empty", "loading"] as const) {
                const view = render(deck({ entries: [], calendar: calendarProp(status) }));
                expect(screen.queryByText(/Flexible items move around busy time/)).toBeNull();
                expect(screen.queryByText(/^Calendar/)).toBeNull();
                expect(screen.queryByText("moved")).toBeNull();
                expect(screen.queryByRole("button", { name: "Refresh calendar busy time" })).toBeNull();
                view.unmount();
            }
        });
    });
});
