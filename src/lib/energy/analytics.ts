import type { EnergyEntry } from "../../state/types";
import { isEnergyEntryExplicitlyRated } from "./rules";

export type EnergyMetric = "energy" | "clarity";

export interface EnergyAnalyticsFilters {
    from: Date;
    to: Date;
    workHoursOnly: boolean;
}

/** Inclusive work-hours window, matching `filterLogs` (local hour 8..18). */
const WORK_HOURS_START = 8;
const WORK_HOURS_END = 18;

/** Maximum rating on either scale; the heatmap ramp is always scaled to it. */
const MAX_RATING = 5;

function startedAt(entry: EnergyEntry): Date {
    return new Date(entry.work_window_id);
}

/**
 * Keep entries whose window start instant is within [from, to] inclusive.
 * `workHoursOnly` keeps local start hour 8..18 inclusive (the same window
 * `filterLogs` applies to a log's finish hour).
 */
export function filterEnergyEntries(
    entries: readonly EnergyEntry[],
    filters: EnergyAnalyticsFilters
): EnergyEntry[] {
    const from = filters.from.getTime();
    const to = filters.to.getTime();
    return entries.filter((entry) => {
        const started = startedAt(entry);
        const at = started.getTime();
        if (!(at >= from && at <= to)) return false;
        if (filters.workHoursOnly) {
            const hour = started.getHours();
            if (hour < WORK_HOURS_START || hour > WORK_HOURS_END) return false;
        }
        return true;
    });
}

/**
 * Bucket entries by the window START's local weekday/hour. A cell's value is
 * the mean of the non-null `metric` values in that cell; cells with no non-null
 * values are absent from the matrix. Nulls never dilute a cell.
 */
export function buildEnergyHeatmap(
    entries: readonly EnergyEntry[],
    metric: EnergyMetric
): { matrix: Record<string, number>; counts: Record<string, number>; max: number } {
    const totals: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const entry of entries) {
        const value = entry[metric];
        if (value === null) continue;
        const started = startedAt(entry);
        const key = `${started.getDay()}-${started.getHours()}`;
        totals[key] = (totals[key] ?? 0) + value;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    const matrix: Record<string, number> = {};
    for (const key of Object.keys(counts)) matrix[key] = totals[key] / counts[key];
    return { matrix, counts, max: MAX_RATING };
}

/** Explicitly rated entries (neither value carried) out of the total in range. */
export function energyRatedFootnote(entries: readonly EnergyEntry[]): {
    explicit: number;
    total: number;
} {
    return {
        explicit: entries.filter(isEnergyEntryExplicitlyRated).length,
        total: entries.length,
    };
}

/** Newest first by window start instant (stable for equal instants). */
export function recentEnergyEntries(
    entries: readonly EnergyEntry[],
    limit = 10
): EnergyEntry[] {
    return [...entries]
        .sort((a, b) => startedAt(b).getTime() - startedAt(a).getTime())
        .slice(0, Math.max(0, limit));
}
