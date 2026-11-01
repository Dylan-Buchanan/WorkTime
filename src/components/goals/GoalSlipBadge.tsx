import React from "react";

export interface GoalSlipBadgeProps {
    consecutiveSlips: number;
}

/** Quiet factual counter; it escalates only at two consecutive slips. */
export const GoalSlipBadge: React.FC<GoalSlipBadgeProps> = ({ consecutiveSlips }) => {
    if (consecutiveSlips < 2) return null;
    return <span className="rounded border border-neutral-700 bg-neutral-900/40 px-2 py-1 text-xs text-neutral-300">
        Slipped {consecutiveSlips}×
    </span>;
};
