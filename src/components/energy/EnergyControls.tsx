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
const DOT_IDLE = "border-neutral-700 bg-neutral-900/70 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300";
const ANCHOR = "text-[9px] leading-none";
const TITLE = "text-center text-[10px] font-medium leading-none text-neutral-300";

// Bad-to-good ramp: the scale itself reads red -> green, so 1 and 5 are
// visually distinct even before a rating is chosen.
const RATING_TONES = {
    1: { on: "border-rose-400/70 bg-rose-500/25 hover:bg-rose-500/35", idle: "bg-rose-400/70", core: "bg-rose-200" },
    2: { on: "border-orange-400/70 bg-orange-500/25 hover:bg-orange-500/35", idle: "bg-orange-400/70", core: "bg-orange-200" },
    3: { on: "border-amber-400/70 bg-amber-500/25 hover:bg-amber-500/35", idle: "bg-amber-400/70", core: "bg-amber-200" },
    4: { on: "border-lime-400/70 bg-lime-500/25 hover:bg-lime-500/35", idle: "bg-lime-400/70", core: "bg-lime-200" },
    5: { on: "border-emerald-400/70 bg-emerald-500/25 hover:bg-emerald-500/35", idle: "bg-emerald-400/70", core: "bg-emerald-200" },
} as const;

const CAPTION = "text-[9px] leading-none text-neutral-500";

const PILL_BASE = "inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded-full border px-2 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-50";
const PILL_ON = "border-amber-500/60 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25";
const PILL_OFF = "border-neutral-700 bg-neutral-900/70 text-neutral-300 hover:bg-neutral-800";

interface RatingClusterProps {
    field: "energy" | "clarity";
    label: string;
    title: string;
    lowAnchor: string;
    highAnchor: string;
    value: number | null;
    onChange: (patch: EnergyRatingPatch) => void;
    idPrefix: string;
    disabled: boolean;
}

function RatingCluster({ field, label, title, lowAnchor, highAnchor, value, onChange, idPrefix, disabled }: RatingClusterProps) {
    const lowAnchorId = `${idPrefix}-${field}-low`;
    const highAnchorId = `${idPrefix}-${field}-high`;
    return (
        <div className="flex flex-col gap-1">
            <span className={TITLE}>{title}</span>
            <div role="group" aria-label={label} className="flex items-center gap-1">
                {RATINGS.map((rating) => {
                    const selected = value === rating;
                    const next = selected ? null : rating;
                    const tone = RATING_TONES[rating];
                    return (
                        <button
                            key={rating}
                            id={`${idPrefix}-${field}-${rating}`}
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${label} ${rating} of 5`}
                            aria-describedby={rating === 1 ? lowAnchorId : rating === 5 ? highAnchorId : undefined}
                            disabled={disabled}
                            className={`${DOT_BASE} ${selected ? tone.on : DOT_IDLE}`}
                            onClick={() => onChange(field === "energy" ? { energy: next } : { clarity: next })}
                        >
                            <span
                                aria-hidden
                                className={`block rounded-full transition-all ${selected ? `h-2.5 w-2.5 ${tone.core}` : `h-1.5 w-1.5 ${tone.idle}`}`}
                            />
                        </button>
                    );
                })}
            </div>
            <div className="flex items-center justify-between gap-1">
                <span id={lowAnchorId} className={`${ANCHOR} text-rose-400/80`}>{lowAnchor}</span>
                <span id={highAnchorId} className={`${ANCHOR} text-emerald-400/80`}>{highAnchor}</span>
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
                title="Physical energy"
                lowAnchor="Drained"
                highAnchor="Sharp"
                value={energy}
                onChange={onChange}
                idPrefix={idPrefix}
                disabled={disabled}
            />
            <RatingCluster
                field="clarity"
                label="Clarity"
                title="Mental clarity"
                lowAnchor="Foggy"
                highAnchor="Crystal"
                value={clarity}
                onChange={onChange}
                idPrefix={idPrefix}
                disabled={disabled}
            />
            <div className="flex flex-col items-center gap-1">
                <span aria-hidden className={TITLE}>&nbsp;</span>
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
