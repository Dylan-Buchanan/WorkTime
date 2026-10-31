import React from "react";

export interface TrackerDueBadgeProps {
    due: boolean;
    periodLabel: string | null;
}

/** Neutral factual signal that the most recent completed period has not been built. */
export const TrackerDueBadge: React.FC<TrackerDueBadgeProps> = ({ due, periodLabel }) => {
    if (!due) return null;
    return <span className="rounded border border-neutral-700 bg-neutral-900/40 px-2 py-1 text-xs text-neutral-300">
        Deck due{periodLabel ? ` · ${periodLabel}` : ""}
    </span>;
};
