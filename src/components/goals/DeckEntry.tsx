import React from "react";
import { periodLabel, type GoalPeriod } from "../../lib/goals/periods";

export type DeckEntryAvailability =
    | { kind: "not-ready"; message: string }
    | { kind: "ready"; period: GoalPeriod; built: boolean };

export interface DeckEntryProps {
    trackerId: string;
    trackerName: string;
    availability: DeckEntryAvailability;
    onBuild: (period: GoalPeriod) => void;
}

const disabledControl = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400 opacity-70 cursor-not-allowed";
const buildControl = "rounded bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";
const builtCue = "rounded-full border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200";

/**
 * Tracker-level entry to the in-app deck preview. The page owns the
 * availability decision; this control only fires a build for a completed
 * period and never derives periods itself.
 */
export const DeckEntry: React.FC<DeckEntryProps> = ({ trackerId, trackerName, availability, onBuild }) => {
    if (availability.kind === "not-ready") {
        return <div
            data-deck-entry-tracker-id={trackerId}
            className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800/70 bg-neutral-950/30 p-3"
        >
            <button
                type="button"
                className={disabledControl}
                disabled
                aria-disabled="true"
                title={availability.message}
            >
                Deck not ready
            </button>
            <p className="text-sm text-neutral-400">{availability.message}</p>
        </div>;
    }
    return <div
        data-deck-entry-tracker-id={trackerId}
        className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800/70 bg-neutral-950/30 p-3"
    >
        <button type="button" className={buildControl} onClick={() => onBuild(availability.period)}>
            {availability.built ? "Rebuild deck" : "Build deck"}
        </button>
        <p className="text-sm text-neutral-400">
            {trackerName} · <time dateTime={availability.period.periodStart}>{periodLabel(availability.period)}</time>
        </p>
        {availability.built && <span className={builtCue}>Built</span>}
    </div>;
};
