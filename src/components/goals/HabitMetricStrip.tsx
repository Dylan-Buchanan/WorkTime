import React from "react";
import type { Goal, GoalMetric } from "../../state/types";
import type { LocalDateKey } from "../../lib/todos/types";
import type { GoalPeriod } from "../../lib/goals/periods";
import { readHabitMetric, type HabitMetricReading } from "../../lib/goals/habitMetric";
import { useHabits } from "../../state/HabitContext";

export interface HabitMetricStripProps {
    goal: Goal;
    period: GoalPeriod;
    current: string;
    today: LocalDateKey;
    onInsert: (text: string) => void;
}

type AvailableReading = Extract<HabitMetricReading, { unavailable: false }>;

const button = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50";

/** Count against the period's bucket target; prose is derived, never stored. */
function readingCopy(reading: AvailableReading, unit: string): string {
    const trimmedUnit = unit.trim();
    const label = `${reading.completed} of ${reading.totalBuckets}${trimmedUnit ? ` ${trimmedUnit}` : ""}`;
    if (reading.partial) {
        const days = reading.daysRemaining === 1 ? "day" : "days";
        return `${label} so far · ${reading.daysRemaining} ${days} left${reading.met ? " · target hit" : ""}`;
    }
    if (!reading.met) return `${label} · short by ${Math.abs(reading.delta)}`;
    return reading.delta === 0 ? `${label} · target hit` : `${label} · ${reading.delta} over`;
}

/**
 * Read-only habit progress for one check-in card. The reading is derived live
 * from the habits provider; nothing is written until the explicit insert button
 * asks the wizard to append the displayed sentence to `current`. Never writes
 * `did`, so slip comparison is untouched. Non-habit goals render nothing, so the
 * strip never asks for the habits provider on their behalf.
 */
export const HabitMetricStrip: React.FC<HabitMetricStripProps> = props => {
    const metric = props.goal.metric;
    if (metric?.source !== "habit") return null;
    return <HabitMetricReading {...props} metric={metric} />;
};

interface HabitMetricReadingProps extends HabitMetricStripProps {
    metric: GoalMetric;
}

const HabitMetricReading: React.FC<HabitMetricReadingProps> = ({ goal, period, current, today, onInsert, metric }) => {
    const { state, hydrated } = useHabits();
    const reading = hydrated
        ? readHabitMetric(metric, Object.values(state.habits), Object.values(state.completions), period, today)
        : null;
    const text = reading !== null && !reading.unavailable && reading.totalBuckets > 0
        ? readingCopy(reading, metric.unit)
        : null;
    const status = reading === null
        ? "Loading habit progress…"
        : reading.unavailable
            ? "Habit metric unavailable: linked habit is missing."
            : reading.totalBuckets === 0
                ? "No buckets in this period."
                : null;
    const insert = () => {
        // Repeat presses are no-ops; the wizard also guards the append.
        if (text === null || current.includes(text)) return;
        onInsert(text);
    };

    return <section
        aria-label={`Habit metric for ${goal.title}`}
        className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800/70 bg-neutral-950/20 px-3 py-2"
    >
        <p className={`flex-1 text-xs ${text === null ? "text-neutral-500" : "text-neutral-300"}`}>{text ?? status}</p>
        {text !== null && <button
            type="button"
            className={button}
            aria-label={`Insert habit metric into current for ${goal.title}`}
            onClick={insert}
        >Insert into Current</button>}
    </section>;
};
