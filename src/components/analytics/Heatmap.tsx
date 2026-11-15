import React from "react";

export type HeatmapRamp = "focus" | "rating";

export interface HeatmapProps {
    /** key `${weekday 0=Sun}-${hour 0..23}`; an absent key means "no data". */
    matrix: Record<string, number>;
    max: number;
    ramp?: HeatmapRamp; // default "focus"
    cellTitle: (day: string, hour: number, value: number | undefined) => string;
    cellLabel: (day: string, hour: number, value: number | undefined) => string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cellBackground(
    ramp: HeatmapRamp,
    value: number | undefined,
    max: number
): string {
    if (ramp === "rating") {
        if (value === undefined) return "transparent";
        const pct = Math.min(1, Math.max(0, (value - 1) / 4));
        return `hsl(${Math.round(180 - pct * 120)},70%,${30 + pct * 30}%)`;
    }
    const val = value || 0;
    const pct = max > 0 ? val / max : 0;
    return pct === 0
        ? "transparent"
        : `hsl(${Math.round(180 - pct * 120)},70%,${30 + pct * 30}%)`;
}

export const Heatmap: React.FC<HeatmapProps> = ({
    matrix,
    max,
    ramp = "focus",
    cellTitle,
    cellLabel,
}) => (
    <div className="overflow-auto">
        <div
            className="grid"
            style={{ gridTemplateColumns: `48px repeat(24, 1fr)` }}
        >
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-center text-[9px] opacity-60">
                    {h}
                </div>
            ))}
            {WEEKDAYS.map((d, dayIdx) => (
                <React.Fragment key={d}>
                    <div className="text-[10px] pr-1 flex items-center justify-end opacity-60">
                        {d}
                    </div>
                    {Array.from({ length: 24 }).map((_, h) => {
                        const value = matrix[`${dayIdx}-${h}`];
                        const bg = cellBackground(ramp, value, max);
                        return (
                            <div
                                key={h}
                                title={cellTitle(d, h, value)}
                                className="h-5 m-[1px] rounded"
                                style={{ background: bg }}
                                aria-label={cellLabel(d, h, value)}
                            />
                        );
                    })}
                </React.Fragment>
            ))}
        </div>
    </div>
);
