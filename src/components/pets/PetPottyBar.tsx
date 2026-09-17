import React from "react";

interface PetPottyBarProps {
    onPotty(): void;
}

/**
 * The persistent bottom potty bar. One tap logs an unscheduled potty through
 * the same single write path as the inline checks, which resets the potty
 * interval because the engine re-anchors it to the latest record.
 */
export const PetPottyBar: React.FC<PetPottyBarProps> = ({ onPotty }) => (
    <div className="sticky bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/90 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl">
            <button
                type="button"
                onClick={onPotty}
                className="w-full rounded-xl bg-neutral-100 px-4 py-2 text-xs font-semibold text-neutral-900 hover:bg-white"
            >
                🚽 Potty
            </button>
        </div>
    </div>
);
