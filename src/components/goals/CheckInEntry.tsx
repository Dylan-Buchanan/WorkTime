import React from "react";
import type { LocalDateKey } from "../../lib/todos/types";

export type CheckInAvailability =
    | { kind: "not-started"; message: string; firstPeriodLabel: string | null }
    | { kind: "open"; periodStart: LocalDateKey; periodLabel: string };

export interface CheckInEntryProps {
    trackerId: string;
    availability: CheckInAvailability;
    onOpen: (periodStart: LocalDateKey) => void;
}

const button = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs hover:bg-neutral-800 disabled:opacity-50";

/**
 * Tracker-level entry to the per-period check-in wizard. The page owns the
 * availability decision; this control only refuses to fire an open for a
 * tracker without an open grid period.
 */
export const CheckInEntry: React.FC<CheckInEntryProps> = ({ trackerId, availability, onOpen }) => {
    if (availability.kind === "not-started") {
        return <button
            type="button"
            className={button}
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
        className={button}
        onClick={() => onOpen(availability.periodStart)}
        data-check-in-tracker-id={trackerId}
    >
        Check in · {availability.periodLabel}
    </button>;
};
