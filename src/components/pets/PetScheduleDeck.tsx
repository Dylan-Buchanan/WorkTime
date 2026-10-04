import React, { useState } from "react";
import { formatClock } from "../../lib/pets";
import type { PetActivityCounts, PetDaySchedule, PetScheduleEntry } from "../../lib/pets";
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

const ScheduleCard: React.FC<{
    entry: PetScheduleEntry;
    now: Date;
    onCheck(entry: PetScheduleEntry): void;
    onRemove(itemId: string): void;
}> = ({
    entry,
    now,
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
                {entry.shift && (
                    <p className="truncate text-[11px] text-neutral-400">↺ {entry.shift.description}</p>
                )}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${CHIP_TONES[chip.tone]}`}>{chip.text}</span>
            {due && (
                <button
                    type="button"
                    onClick={() => onCheck(entry)}
                    className="shrink-0 rounded-lg bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-900 hover:bg-white"
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

/**
 * Today's schedule as a card deck. Completed items collapse into a slim
 * summary strip; upcoming items stay cards with time, icon, status chip,
 * shift indicator, and an inline check button while due. The expand toggle
 * reveals the full-day view, which also carries the mid-day-start note so a
 * day set up mid-afternoon never reads as blank.
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
                    {visible.map((entry) => (
                        <ScheduleCard key={`${entry.itemId}-${entry.start.getTime()}`} entry={entry} now={now} onCheck={onCheck} onRemove={onRemove} />
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
