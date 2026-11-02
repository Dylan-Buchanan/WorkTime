import React from "react";

export interface TrackerDueBadgeProps {
    due: boolean;
    periodLabel: string | null;
}

/** Neutral factual signal that the most recent completed period has not been built. */
export const TrackerDueBadge: React.FC<TrackerDueBadgeProps> = ({ due, periodLabel }) => {
    if (!due) return null;
    return <span className="rounded-full border border-amber-700/70 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-200">
        Deck due{periodLabel ? ` · ${periodLabel}` : ""}
    </span>;
};
