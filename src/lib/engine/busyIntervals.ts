export interface BusyIntervalInput { start: string | Date; end: string | Date; }

export function validDate(value: Date): Date | null {
    return Number.isNaN(value.getTime()) ? null : value;
}

function intervalDate(value: string | Date): Date | null {
    return value instanceof Date ? validDate(new Date(value.getTime())) : validDate(new Date(value));
}

/** Clip to [windowStart, windowEnd], drop empty/invalid, sort, merge overlapping or touching runs. */
export function mergeBusyIntervals(
    intervals: readonly BusyIntervalInput[],
    windowStart: Date,
    windowEnd: Date,
): Array<{ start: Date; end: Date }> {
    const windowStartMs = windowStart.getTime();
    const windowEndMs = windowEnd.getTime();
    const normalized = intervals.flatMap((interval) => {
        const rawStart = intervalDate(interval.start)?.getTime();
        const rawEnd = intervalDate(interval.end)?.getTime();
        if (rawStart === undefined || rawEnd === undefined) return [];
        const start = Math.max(windowStartMs, rawStart);
        const end = Math.min(windowEndMs, rawEnd);
        return end > start ? [[start, end] as const] : [];
    }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of normalized) {
        const previous = merged[merged.length - 1];
        if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
        else merged.push([start, end]);
    }
    return merged.map(([start, end]) => ({ start: new Date(start), end: new Date(end) }));
}
