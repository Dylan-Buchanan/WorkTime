import React from "react";
import type { LocalDateKey } from "../../lib/todos/types";

export type CheckInAvailability =
    | { kind: "not-started"; message: string; firstPeriodLabel: string | null }
    | { kind: "open"; periodStart: LocalDateKey; periodLabel: string };

export interface CheckInEntryProps {
    trackerId: string;
    availability: CheckInAvailability;
    onOpen: (periodStart: LocalDateKey) => void;
    /** Every goal in the tracker already has a recorded check-in for this period. */
    complete?: boolean;
}

const disabled = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400 opacity-70 cursor-not-allowed";
const open = "inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm ring-2 ring-indigo-400/40 hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";
/** A completed period stops demanding attention; it stays tappable so it can be reopened. */
const confirmed = "inline-flex items-center gap-2 rounded-md border border-emerald-700/70 bg-emerald-950/30 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300";

/**
 * Tracker-level entry to the per-period check-in wizard. The page owns the
 * availability decision; this control only refuses to fire an open for a
 * tracker without an open grid period.
 */
export const CheckInEntry: React.FC<CheckInEntryProps> = ({ trackerId, availability, onOpen, complete = false }) => {
    if (availability.kind === "not-started") {
        return <button
            type="button"
            className={disabled}
            disabled
            aria-disabled="true"
            title={availability.message}
            data-check-in-tracker-id={trackerId}
        >
            Period not open
        </button>;
    }
    return <button
        type="button"
        className={complete ? confirmed : open}
        onClick={() => onOpen(availability.periodStart)}
        data-check-in-tracker-id={trackerId}
        data-check-in-state={complete ? "complete" : "open"}
    >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-300" />
        <span>Check in · {availability.periodLabel}</span>
        <span aria-hidden="true" className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${complete ? "bg-emerald-700/40 text-emerald-100" : "bg-indigo-600 text-white"}`}>
            {complete ? "Recorded" : "Period open"}
        </span>
    </button>;
};
