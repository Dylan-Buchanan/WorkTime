import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { Heatmap } from "./Heatmap";
import {
    buildEnergyHeatmap,
    energyRatedFootnote,
    filterEnergyEntries,
    recentEnergyEntries,
    type EnergyAnalyticsFilters,
    type EnergyMetric,
} from "../../lib/energy/analytics";
import type { EnergyEntry } from "../../state/types";

export interface WellbeingSectionProps {
    entries: readonly EnergyEntry[];
    filters: EnergyAnalyticsFilters;
    /** True when project, tag, status or deep-work filtering is active. */
    identityFiltersActive: boolean;
}

const METRIC_LABELS: Record<EnergyMetric, string> = {
    energy: "Energy",
    clarity: "Clarity",
};

function ratingText(value: number | null) {
    return value === null ? "—" : value;
}

export const WellbeingSection: React.FC<WellbeingSectionProps> = ({
    entries,
    filters,
    identityFiltersActive,
}) => {
    const [metric, setMetric] = useState<EnergyMetric>("energy");
    const { from, to, workHoursOnly } = filters;

    // Only the date range and work-hours filters apply; entries carry no task
    // identity, so project/tag/status/deep-work filters are deliberately ignored.
    const filtered = useMemo(
        () => filterEnergyEntries(entries, { from, to, workHoursOnly }),
        [entries, from, to, workHoursOnly]
    );
    const heatmap = useMemo(
        () => buildEnergyHeatmap(filtered, metric),
        [filtered, metric]
    );
    const footnote = useMemo(() => energyRatedFootnote(filtered), [filtered]);
    const recent = useMemo(() => recentEnergyEntries(filtered), [filtered]);

    const metricLabel = METRIC_LABELS[metric];
    const titleFor = (day: string, hour: number, value: number | undefined) =>
        `${day} ${hour}:00 - ${
            value === undefined ? "no data" : `${value.toFixed(1)} avg ${metric}`
        }`;
    const labelFor = (day: string, hour: number, value: number | undefined) =>
        `${day} hour ${hour} ${
            value === undefined
                ? "no data"
                : `${value.toFixed(1)} average ${metric}`
        }`;

    return (
        <section id="wellbeing" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Wellbeing</h2>
                <div
                    className="flex items-center gap-1"
                    role="group"
                    aria-label="Wellbeing metric"
                >
                    {(Object.keys(METRIC_LABELS) as EnergyMetric[]).map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setMetric(m)}
                            aria-pressed={metric === m}
                            className={`text-[10px] px-2 py-1 rounded ${
                                metric === m
                                    ? "bg-neutral-700 text-neutral-100"
                                    : "bg-neutral-900 text-neutral-400"
                            }`}
                        >
                            {METRIC_LABELS[m]}
                        </button>
                    ))}
                </div>
            </div>
            <p className="text-[10px] text-neutral-500">
                Cells are bucketed by the hour the session <strong>started</strong>
                {" "}(unlike Focused minutes, which bucket by the hour the session
                finished). Showing {metricLabel.toLowerCase()} averages over
                non-null ratings.
            </p>
            {identityFiltersActive && (
                <p className="text-[10px] text-amber-400/80">
                    Energy is session-scoped, so it is not filtered by project,
                    tag, status or deep-work filters.
                </p>
            )}
            {filtered.length === 0 && (
                <p className="text-[10px] text-neutral-500">
                    No energy check-ins in this range yet.
                </p>
            )}
            <Heatmap
                matrix={heatmap.matrix}
                max={heatmap.max}
                ramp="rating"
                cellTitle={titleFor}
                cellLabel={labelFor}
            />
            <p className="text-[10px] text-neutral-500">
                {footnote.explicit} of {footnote.total} sessions explicitly rated
                (carried values count in the average).
            </p>
            <div className="space-y-1">
                <h3 className="text-[11px] font-medium">Recent check-ins</h3>
                {recent.length === 0 ? (
                    <p className="text-[10px] text-neutral-500">
                        No check-ins to show.
                    </p>
                ) : (
                    <ul className="space-y-1">
                        {recent.map((entry) => (
                            <li
                                key={entry.work_window_id}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-neutral-900 rounded px-2 py-1 text-[10px]"
                            >
                                <span className="tabular-nums opacity-70">
                                    {format(
                                        new Date(entry.work_window_id),
                                        "EEE MMM d HH:mm"
                                    )}
                                </span>
                                <span>
                                    Energy {ratingText(entry.energy)}
                                    {entry.energy !== null &&
                                        entry.energy_carried && (
                                            <span className="ml-1 opacity-50">
                                                carried
                                            </span>
                                        )}
                                </span>
                                <span>
                                    Clarity {ratingText(entry.clarity)}
                                    {entry.clarity !== null &&
                                        entry.clarity_carried && (
                                            <span className="ml-1 opacity-50">
                                                carried
                                            </span>
                                        )}
                                </span>
                                <span>
                                    Caffeine {entry.caffeine ? "Yes" : "No"}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
};
