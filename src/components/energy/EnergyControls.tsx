import type { EnergyRatingPatch } from "../../state/types";

export interface EnergyControlsProps {
    energy: number | null;
    clarity: number | null;
    caffeine: boolean;
    onChange: (patch: EnergyRatingPatch) => void;
    idPrefix: string;
    disabled?: boolean;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

const DOT_BASE = "grid h-6 w-6 place-items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-50";
const DOT_ON = "border-indigo-400/70 bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/35";
const DOT_OFF = "border-neutral-700 bg-neutral-900/70 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300";
const ANCHOR = "text-[9px] leading-none text-neutral-500";
const CAPTION = "text-[9px] leading-none text-neutral-500";

const PILL_BASE = "inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded-full border px-2 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-50";
const PILL_ON = "border-amber-500/60 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25";
const PILL_OFF = "border-neutral-700 bg-neutral-900/70 text-neutral-300 hover:bg-neutral-800";

interface RatingClusterProps {
    field: "energy" | "clarity";
    label: string;
    lowAnchor: string;
    highAnchor: string;
    value: number | null;
    onChange: (patch: EnergyRatingPatch) => void;
    idPrefix: string;
    disabled: boolean;
}

function RatingCluster({ field, label, lowAnchor, highAnchor, value, onChange, idPrefix, disabled }: RatingClusterProps) {
    const lowAnchorId = `${idPrefix}-${field}-low`;
    const highAnchorId = `${idPrefix}-${field}-high`;
    return (
        <div className="flex flex-col gap-1">
            <div role="group" aria-label={label} className="flex items-center gap-1">
                {RATINGS.map((rating) => {
                    const selected = value === rating;
                    const next = selected ? null : rating;
                    return (
                        <button
                            key={rating}
                            id={`${idPrefix}-${field}-${rating}`}
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${label} ${rating} of 5`}
                            aria-describedby={rating === 1 ? lowAnchorId : rating === 5 ? highAnchorId : undefined}
                            disabled={disabled}
                            className={`${DOT_BASE} ${selected ? DOT_ON : DOT_OFF}`}
                            onClick={() => onChange(field === "energy" ? { energy: next } : { clarity: next })}
                        >
                            <span
                                aria-hidden
                                className={`block rounded-full transition-all ${selected ? "h-2.5 w-2.5 bg-indigo-300" : "h-1.5 w-1.5 bg-neutral-600"}`}
                            />
                        </button>
                    );
                })}
            </div>
            <div className="flex items-center justify-between gap-1">
                <span id={lowAnchorId} className={ANCHOR}>{lowAnchor}</span>
                <span id={highAnchorId} className={ANCHOR}>{highAnchor}</span>
            </div>
        </div>
    );
}

export function EnergyControls({ energy, clarity, caffeine, onChange, idPrefix, disabled = false }: EnergyControlsProps) {
    return (
        <div className="flex flex-wrap items-start justify-center gap-x-4 gap-y-2">
            <RatingCluster
                field="energy"
                label="Energy"
                lowAnchor="drained"
                highAnchor="sharp"
                value={energy}
                onChange={onChange}
                idPrefix={idPrefix}
                disabled={disabled}
            />
            <RatingCluster
                field="clarity"
                label="Clarity"
                lowAnchor="foggy"
                highAnchor="crystal"
                value={clarity}
                onChange={onChange}
                idPrefix={idPrefix}
                disabled={disabled}
            />
            <div className="flex flex-col items-center gap-1">
                <button
                    id={`${idPrefix}-caffeine`}
                    type="button"
                    aria-pressed={caffeine}
                    aria-label="Caffeine"
                    disabled={disabled}
                    className={`${PILL_BASE} ${caffeine ? PILL_ON : PILL_OFF}`}
                    onClick={() => onChange({ caffeine: !caffeine })}
                >
                    {caffeine ? "Yes" : "No"}
                </button>
                <span className={CAPTION}>Caffeine</span>
            </div>
        </div>
    );
}
