import React from "react";
import { formatClock } from "../../lib/pets";
import type { PetNapReflowProposal } from "../../lib/pets";

interface PetReflowPanelProps {
    proposal: PetNapReflowProposal;
    onConfirm(): void;
    onAdjust(): void;
}

/**
 * Slide-in confirmation of the engine's proposed post-nap reflow. Default
 * accept is the primary action and the panel is non-blocking: it never
 * overlays the page and Adjust simply skips the suggestion, leaving the
 * original times in place for manual editing.
 */
export const PetReflowPanel: React.FC<PetReflowPanelProps> = ({ proposal, onConfirm, onAdjust }) => (
    <aside
        role="dialog"
        aria-label="Nap reflow suggestion"
        className="fixed bottom-16 right-4 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
    >
        <p className="text-xs font-semibold text-neutral-100">Wake-up reflow</p>
        <p className="mt-1 text-[11px] text-neutral-400">
            The nap ran {Math.round(proposal.napMinutes)} minutes. Suggested adjustments:
        </p>
        <ul className="mt-2 flex flex-col gap-1">
            {proposal.changes.map((change) => (
                <li key={`${change.itemId}-${change.reason}`} className="text-[11px] text-neutral-300">
                    ↺ {change.label.toLowerCase()} → {formatClock(change.to)}
                    {change.from ? ` (was ${formatClock(change.from)})` : ""}
                </li>
            ))}
        </ul>
        <div className="mt-3 flex gap-2">
            <button
                type="button"
                onClick={onConfirm}
                className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[11px] font-medium text-neutral-900 hover:bg-white"
            >
                Confirm
            </button>
            <button
                type="button"
                onClick={onAdjust}
                className="rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
            >
                Adjust
            </button>
        </div>
    </aside>
);
