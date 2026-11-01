import React from "react";

export interface GoalCountdownBadgeProps {
    daysUntilOpen: number;
}

type CountdownTone = "green" | "yellow" | "red";

const toneClass: Record<CountdownTone, string> = {
    green: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
    yellow: "border-amber-700 bg-amber-950/40 text-amber-200",
    red: "border-rose-700 bg-rose-950/40 text-rose-200",
};

/** Green beyond 10 days, yellow from 4 to 10 days, red at 3 days or fewer. */
export function countdownTone(daysUntilOpen: number): CountdownTone {
    if (daysUntilOpen > 10) return "green";
    if (daysUntilOpen > 3) return "yellow";
    return "red";
}

/** Compact countdown chip for a tracker whose first period has not opened yet. */
export const GoalCountdownBadge: React.FC<GoalCountdownBadgeProps> = ({ daysUntilOpen }) => {
    if (!Number.isInteger(daysUntilOpen) || daysUntilOpen < 1) return null;
    const tone = countdownTone(daysUntilOpen);
    const days = `${daysUntilOpen} ${daysUntilOpen === 1 ? "day" : "days"}`;
    return <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${toneClass[tone]}`}
        data-goal-countdown-tone={tone}
        title={`First period opens in ${days}.`}
    >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        {days}
    </span>;
};
