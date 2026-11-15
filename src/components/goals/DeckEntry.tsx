import React from "react";
import { periodLabel, type GoalPeriod } from "../../lib/goals/periods";

export type DeckEntryAvailability =
    | { kind: "not-ready"; message: string; detail?: string }
    | { kind: "ready"; period: GoalPeriod; built: boolean };

export interface DeckEntryProps {
    trackerId: string;
    trackerName: string;
    availability: DeckEntryAvailability;
    onBuild: (period: GoalPeriod) => void;
    variant?: "settled" | "early";
}

const disabledControl = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400 opacity-70 cursor-not-allowed";
/** Amber outline: the deck is the secondary, settled phase and never competes with a live check-in. */
const buildControl = "rounded border border-amber-700/80 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300";
const earlyBuildControl = "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-indigo-200 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";
const builtCue = "rounded-full border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200";

/** Opens the deck preview for the buildable period supplied by the page. */
export const DeckEntry: React.FC<DeckEntryProps> = ({ trackerId, trackerName, availability, onBuild, variant = "settled" }) => {
    const early = variant === "early";
    const buildLabel = early ? "Build deck early" : "Build deck";
    if (availability.kind === "not-ready") {
        return <div
            data-deck-entry-tracker-id={trackerId}
            data-deck-entry-variant={variant}
            className="flex flex-wrap items-center gap-3"
        >
            <button
                type="button"
                className={disabledControl}
                disabled
                aria-disabled="true"
                title={availability.message}
            >
                {early ? buildLabel : "Deck not ready"}
            </button>
            <p className="text-sm text-neutral-400">{availability.message}</p>
            {availability.detail && <p className="text-xs text-neutral-400">{availability.detail}</p>}
        </div>;
    }
    return <div
        data-deck-entry-tracker-id={trackerId}
        data-deck-entry-variant={variant}
        className="flex flex-wrap items-center gap-3"
    >
        <button type="button" className={early ? earlyBuildControl : buildControl} onClick={() => onBuild(availability.period)}>
            {availability.built ? "Rebuild deck" : buildLabel}
        </button>
        <p className="text-sm text-neutral-400">
            {trackerName} · <time dateTime={availability.period.periodStart}>{periodLabel(availability.period)}</time>
        </p>
        {availability.built && <span className={builtCue}>Built</span>}
    </div>;
};
