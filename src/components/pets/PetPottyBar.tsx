import React from "react";

interface PetPottyBarProps {
    onPotty(): void;
    onTraining(): void;
}

/**
 * Persistent bottom quick actions for unscheduled potty and training logs.
 * Both use the same activity path as inline checks, so interval schedules
 * re-anchor from the activity log.
 */
export const PetPottyBar: React.FC<PetPottyBarProps> = ({ onPotty, onTraining }) => (
    <div className="sticky bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/90 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl gap-2">
            <button
                type="button"
                onClick={onPotty}
                className="flex-1 rounded-xl bg-neutral-100 px-4 py-2 text-xs font-semibold text-neutral-900 hover:bg-white"
            >
                🚽 Potty
            </button>
            <button
                type="button"
                onClick={onTraining}
                className="flex-1 rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-700"
            >
                🎓 Training
            </button>
        </div>
    </div>
);
