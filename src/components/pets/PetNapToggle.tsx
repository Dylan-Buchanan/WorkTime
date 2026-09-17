import React from "react";
import type { PetNapRecord } from "../../state/types";

interface PetNapToggleProps {
    napping: boolean;
    activeNap: PetNapRecord | null;
    now: Date;
    onStart(): void;
    onEnd(): void;
}

/**
 * The single nap toggle. While napping it shows elapsed time; pressing it
 * again ends the nap and lets the parent surface the engine's reflow
 * suggestion. The schedule visibly pauses because the engine freezes interval
 * occurrences during an active nap.
 */
export const PetNapToggle: React.FC<PetNapToggleProps> = ({ napping, activeNap, now, onStart, onEnd }) => {
    const elapsedMinutes = activeNap
        ? Math.max(0, Math.floor((now.getTime() - new Date(activeNap.start).getTime()) / 60_000))
        : 0;
    return (
        <div className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3">
            <button
                type="button"
                aria-pressed={napping}
                onClick={napping ? onEnd : onStart}
                className={
                    napping
                        ? "rounded-xl bg-amber-500/20 px-4 py-2 text-xs font-medium text-amber-200 ring-1 ring-amber-500/40 hover:bg-amber-500/30"
                        : "rounded-xl bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
                }
            >
                {napping ? `💤 Napping — ${elapsedMinutes}m (wake up)` : "💤 Nap"}
            </button>
            <p className="text-[11px] text-neutral-400">
                {napping ? "Schedule is paused while napping." : "Napping pauses the schedule until wake-up."}
            </p>
        </div>
    );
};
