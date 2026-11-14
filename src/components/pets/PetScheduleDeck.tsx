import React, { useState } from "react";
import { formatClock } from "../../lib/pets";
import type {
    PetActivityCounts,
    PetBlockedBy,
    PetDaySchedule,
    PetScheduleEntry,
} from "../../lib/pets";
import type { CalendarBusyContextValue, CalendarBusySnapshot } from "../../state/CalendarBusyContext";
import type { PetActivityType, PetNapRecord, PetScheduleItem } from "../../state/types";
import { PET_ACTIVITY_META } from "./petShared";

interface PetScheduleDeckProps {
    schedule: PetDaySchedule;
    scheduleItems: PetScheduleItem[];
    excludedFixedCount: number;
    /** Done-today counts from the activity log; never stored. */
    doneCounts: PetActivityCounts;
    todayNaps: PetNapRecord[];
    now: Date;
    expanded: boolean;
    onToggleExpanded(): void;
    onCheck(entry: PetScheduleEntry): void;
    onRemove(itemId: string): void;
    /** Calendar busy state from the shell provider; the deck never fetches. */
    calendar: CalendarBusyContextValue;
}

function summarizeDone(counts: PetActivityCounts, todayNaps: readonly PetNapRecord[]): string | null {
    const parts: string[] = [];
    for (const activityType of Object.keys(PET_ACTIVITY_META) as PetActivityType[]) {
        const count = counts[activityType];
        if (count > 0) parts.push(`${count} ${PET_ACTIVITY_META[activityType].label.toLowerCase()}`);
    }
    if (todayNaps.length > 0) {
        const ranges = todayNaps
            .map((nap) => `nap ${formatClock(new Date(nap.start))}–${formatClock(new Date(nap.end!))}`)
            .join(", ");
        parts.push(ranges);
    }
    return parts.length > 0 ? parts.join(", ") : null;
}

function statusChip(entry: PetScheduleEntry, now: Date): { text: string; tone: "done" | "due" | "overdue" | "paused" | "upcoming" } {
    if (entry.fulfilled && entry.fulfilledAt) return { text: `done at ${formatClock(entry.fulfilledAt)}`, tone: "done" };
    if (entry.overdueMinutes > 0) return { text: `overdue ${Math.round(entry.overdueMinutes)}m`, tone: "overdue" };
    if (entry.paused) return { text: "paused — napping", tone: "paused" };
    if (entry.start.getTime() <= now.getTime()) return { text: "due now", tone: "due" };
    return { text: `in ${Math.max(1, Math.ceil((entry.start.getTime() - now.getTime()) / 60_000))}m`, tone: "upcoming" };
}

const CHIP_TONES: Record<"done" | "due" | "overdue" | "paused" | "upcoming", string> = {
    done: "bg-emerald-900/40 text-emerald-300",
    due: "bg-amber-900/40 text-amber-300",
    overdue: "bg-red-900/40 text-red-300",
    paused: "bg-neutral-800 text-neutral-400",
    upcoming: "bg-neutral-800 text-neutral-300",
};

/** Stable identity across a busy move: cards key on the pre-busy anchor. */
function cardKey(entry: PetScheduleEntry): string {
    return `${entry.itemId}-${entry.unshiftedStart.getTime()}`;
}

function busyRange(blocked: PetBlockedBy): string {
    return `busy ${formatClock(blocked.start)}–${formatClock(blocked.end)}`;
}

/** The two blocked reasons read differently: no room before day end vs a hard interval close. */
function blockedCopy(entry: PetScheduleEntry, dayEnd: Date): string {
    const blocked = entry.blockedBy;
    if (!blocked) return "";
    return blocked.reason === "interval-limit"
        ? `Can't push past its ${formatClock(entry.end)} limit — ${busyRange(blocked)}`
        : `Couldn't fit before ${formatClock(dayEnd)} — ${busyRange(blocked)}`;
}

const ScheduleCard: React.FC<{
    entry: PetScheduleEntry;
    now: Date;
    dayEnd: Date;
    onCheck(entry: PetScheduleEntry): void;
    onRemove(itemId: string): void;
}> = ({
    entry,
    now,
    dayEnd,
    onCheck,
    onRemove,
}) => {
    const chip = statusChip(entry, now);
    const due = !entry.fulfilled && !entry.paused && entry.start.getTime() <= now.getTime();
    return (
        <article
            className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                chip.tone === "overdue"
                    ? "border-red-900/60 bg-red-950/20"
                    : entry.fulfilled
                      ? "border-neutral-800/60 bg-neutral-900/20"
                      : "border-neutral-800 bg-neutral-900/40"
            }`}
        >
            <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-neutral-200">
                {formatClock(entry.start)}
            </span>
            <span aria-hidden="true" className="text-base">{PET_ACTIVITY_META[entry.activityType].icon}</span>
            <div className="min-w-0 flex-1">
                <p className={`truncate text-xs ${entry.fulfilled ? "text-neutral-400 line-through" : "text-neutral-100"}`}>
                    {entry.label}
                </p>
                {!entry.fulfilled && entry.shift && (
                    <p className="truncate text-[11px] text-neutral-400">
                        <span className="sr-only">Moved: </span>
                        <span aria-hidden="true">↺ </span>
                        {entry.shift.description}
                    </p>
                )}
                {!entry.fulfilled && entry.blockedBy && (
                    <p className="truncate text-[11px] text-amber-300">
                        <span className="sr-only">Blocked: </span>
                        <span aria-hidden="true">⛔ </span>
                        {blockedCopy(entry, dayEnd)}
                    </p>
                )}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${CHIP_TONES[chip.tone]}`}>{chip.text}</span>
            {due && (
                <button
                    type="button"
                    onClick={() => onCheck(entry)}
                    className="shrink-0 rounded-lg bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-900 hover:bg-neutral-50"
                >
                    ✓ Log {entry.label.toLowerCase()}
                </button>
            )}
            <button
                type="button"
                onClick={() => onRemove(entry.itemId)}
                aria-label={`Remove ${entry.label} from schedule`}
                title="Remove this item and all its future occurrences. Care history is kept."
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-neutral-400 hover:bg-red-950/40 hover:text-red-300"
            >
                Remove
            </button>
        </article>
    );
};

type DeckRow =
    | { kind: "entry"; entry: PetScheduleEntry }
    | { kind: "group"; key: string; run: PetBlockedBy; entries: PetScheduleEntry[] };

function sameRun(left: PetBlockedBy, right: PetBlockedBy): boolean {
    return left.start.getTime() === right.start.getTime() && left.end.getTime() === right.end.getTime();
}

/**
 * Collapses a run of consecutive unfulfilled entries stopped by the same busy
 * run into one grouped row; a lone blocked entry stays a normal card.
 */
function deckRows(entries: readonly PetScheduleEntry[]): DeckRow[] {
    const rows: DeckRow[] = [];
    let index = 0;
    while (index < entries.length) {
        const entry = entries[index];
        const blocked = entry.fulfilled ? null : entry.blockedBy;
        if (!blocked) {
            rows.push({ kind: "entry", entry });
            index += 1;
            continue;
        }
        let end = index + 1;
        while (end < entries.length) {
            const next = entries[end];
            if (next.fulfilled || !next.blockedBy || !sameRun(blocked, next.blockedBy)) break;
            end += 1;
        }
        const members = entries.slice(index, end);
        rows.push(members.length > 1
            ? {
                  kind: "group",
                  key: `${blocked.start.getTime()}-${blocked.end.getTime()}-${cardKey(entry)}`,
                  run: blocked,
                  entries: members,
              }
            : { kind: "entry", entry });
        index = end;
    }
    return rows;
}

const BlockedGroup: React.FC<{
    run: PetBlockedBy;
    entries: PetScheduleEntry[];
    now: Date;
    dayEnd: Date;
    onCheck(entry: PetScheduleEntry): void;
    onRemove(itemId: string): void;
}> = ({
    run,
    entries,
    now,
    dayEnd,
    onCheck,
    onRemove,
}) => {
    const [open, setOpen] = useState(false);
    const overdue = entries.some((entry) => entry.overdueMinutes > 0);
    return (
        <div
            role="group"
            aria-label={`Blocked by ${busyRange(run)}`}
            className={`flex flex-col gap-2 rounded-xl border p-3 ${
                overdue ? "border-red-900/60 bg-red-950/20" : "border-neutral-800 bg-neutral-900/40"
            }`}
        >
            <p className="min-w-0 truncate text-[11px] text-amber-300">
                <span className="sr-only">Blocked: </span>
                <span aria-hidden="true">⛔ </span>
                {entries.map((entry) => entry.label).join(", ")} couldn't be placed — {busyRange(run)}
            </p>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="shrink-0 self-start rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
            >
                {open ? "Hide items" : "Show items"}
            </button>
            {open && (
                <div className="flex flex-col gap-2">
                    {entries.map((entry) => (
                        <ScheduleCard
                            key={cardKey(entry)}
                            entry={entry}
                            now={now}
                            dayEnd={dayEnd}
                            onCheck={onCheck}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

/** "just now" / "Nm ago" / "Nh ago" from the last successful refresh. */
function freshnessLabel(refreshedAt: Date, now: Date): string {
    const minutes = Math.floor((now.getTime() - refreshedAt.getTime()) / 60_000);
    if (!Number.isFinite(minutes) || minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * One slot for both calendar states: fresh enough to describe, or unavailable
 * while the deck keeps displaying the last known busy placement.
 */
function calendarStatusText(snapshot: CalendarBusySnapshot, now: Date): string {
    if (snapshot.status === "unavailable") {
        return snapshot.refreshedAt
            ? "Calendar unavailable — showing last known busy time"
            : "Calendar unavailable";
    }
    const refreshedAt = snapshot.refreshedAt ? new Date(snapshot.refreshedAt) : null;
    const label = refreshedAt && !Number.isNaN(refreshedAt.getTime())
        ? freshnessLabel(refreshedAt, now)
        : "just now";
    return `Calendar · refreshed ${label}`;
}

/** A decorative glyph paired with the word it stands for. */
const LegendMarker: React.FC<{ glyph: string; text: string }> = ({ glyph, text }) => (
    <span className="inline-flex items-center gap-1">
        <span aria-hidden="true">{glyph}</span>
        <span>{text}</span>
    </span>
);

/**
 * Today's schedule as a card deck. Completed items collapse into a slim
 * summary strip; upcoming items stay cards with time, icon, status chip,
 * shift indicator, and an inline check button while due. The expand toggle
 * reveals the full-day view, which also carries the mid-day-start note so a
 * day set up mid-afternoon never reads as blank. Moved and blocked lines make
 * calendar-aware placement explainable; the snapshot is consumed by reference
 * so the one-second tick never refetches.
 */
export const PetScheduleDeck: React.FC<PetScheduleDeckProps> = ({
    schedule,
    scheduleItems,
    excludedFixedCount,
    doneCounts,
    todayNaps,
    now,
    expanded,
    onToggleExpanded,
    onCheck,
    onRemove,
    calendar,
}) => {
    const [managing, setManaging] = useState(false);
    const doneSummary = summarizeDone(doneCounts, todayNaps);
    const upcoming = schedule.entries.filter((entry) => !entry.fulfilled);
    const visible = expanded ? schedule.entries : upcoming;
    const startedMidDay =
        now.getHours() >= 12 &&
        schedule.entries.length > 0 &&
        schedule.entries.every((entry) => entry.start.getTime() > now.getTime()) &&
        schedule.entries.every((entry) => !entry.fulfilled);
    const showCalendarState = calendar.snapshot.status === "ok" || calendar.snapshot.status === "unavailable";

    return (
        <section aria-label="Today's schedule" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-100">Today's schedule</h2>
                <button
                    type="button"
                    onClick={onToggleExpanded}
                    aria-expanded={expanded}
                    className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                >
                    {expanded ? "Show upcoming only" : "Show full day"}
                </button>
                <button
                    type="button"
                    onClick={() => setManaging((value) => !value)}
                    aria-expanded={managing}
                    className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                >
                    Manage schedule items
                </button>
            </div>

            {showCalendarState && (
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-neutral-500">
                    <p className="min-w-0 flex-1">
                        Flexible items move around busy time on your linked calendars.
                        <span className="ml-1 inline-flex flex-wrap items-center gap-x-1 text-neutral-400">
                            <LegendMarker glyph="↺" text="moved" />
                            <span aria-hidden="true">·</span>
                            <LegendMarker glyph="⛔" text="couldn't fit" />
                        </span>
                    </p>
                    <p className="shrink-0 tabular-nums text-neutral-400">{calendarStatusText(calendar.snapshot, now)}</p>
                    <button
                        type="button"
                        onClick={() => calendar.refresh()}
                        aria-label="Refresh calendar busy time"
                        className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                    >
                        Refresh
                    </button>
                </div>
            )}

            {managing && (
                <section aria-label="Manage schedule items" className="rounded-xl border border-neutral-800 p-3">
                    <p className="mb-2 text-[11px] text-neutral-400">
                        Removing an item stops all its future occurrences. Care history is kept.
                    </p>
                    <ul className="flex flex-col gap-2">
                        {scheduleItems.map((item) => (
                            <li key={item.id} className="flex items-center justify-between gap-3 text-xs text-neutral-100">
                                <span>{item.label}</span>
                                <button
                                    type="button"
                                    onClick={() => onRemove(item.id)}
                                    aria-label={`Remove ${item.label} from schedule`}
                                    className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-neutral-400 hover:bg-red-950/40 hover:text-red-300"
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <p className="px-1 text-[11px] text-neutral-500">
                {now >= schedule.dayEnd
                    ? `Schedule ended at ${formatClock(schedule.dayEnd)}. New occurrences begin at ${formatClock(schedule.dayStart)}.`
                    : `Schedule window: ${formatClock(schedule.dayStart)}–${formatClock(schedule.dayEnd)}.`}
                {excludedFixedCount > 0 && ` ${excludedFixedCount} fixed-time item${excludedFixedCount === 1 ? " is" : "s are"} outside this window.`}
            </p>

            {doneSummary && (
                <p className="rounded-xl border border-neutral-800/60 bg-neutral-900/20 px-3 py-2 text-[11px] text-neutral-400">
                    Done today: {doneSummary}
                </p>
            )}

            {startedMidDay && (
                <p className="px-1 text-[11px] text-neutral-500">
                    Tracking started mid-day — the earlier part of today simply isn't shown, not skipped.
                </p>
            )}

            {visible.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {deckRows(visible).map((row) => row.kind === "group" ? (
                        <BlockedGroup
                            key={row.key}
                            run={row.run}
                            entries={row.entries}
                            now={now}
                            dayEnd={schedule.dayEnd}
                            onCheck={onCheck}
                            onRemove={onRemove}
                        />
                    ) : (
                        <ScheduleCard
                            key={cardKey(row.entry)}
                            entry={row.entry}
                            now={now}
                            dayEnd={schedule.dayEnd}
                            onCheck={onCheck}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            ) : (
                <p className="px-1 text-[11px] text-neutral-500">
                    {expanded ? "Nothing scheduled today yet." : "Nothing else due today. 🎉"}
                </p>
            )}
        </section>
    );
};
