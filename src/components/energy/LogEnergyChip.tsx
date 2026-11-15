import { useEffect, useState } from "react";
import { useAppState } from "../../state/AppStateContext";
import { useOptionalEnergy } from "../../state/EnergyContext";
import { isWorkWindowLive, windowStartedAt } from "../../lib/engine";
import { EnergyControls } from "./EnergyControls";

/** Wall-clock age after which the chip is gone for the window, permanently. */
export const LOG_ENERGY_CHIP_MS = 60_000;

const CHIP = "inline-flex items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-200 transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";
const CLOSE = "rounded px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300";

/**
 * Post-start capture affordance. Visibility is the wall-clock age of the live
 * Work window, so it is independent of pause state, mount time and remaining
 * time; it schedules its own re-render at the 60 s mark so it expires without
 * a parent tick.
 */
export function LogEnergyChip() {
    const energy = useOptionalEnergy();
    const app = useAppState();
    const timer = app.state?.timer ?? null;
    const [openFor, setOpenFor] = useState<string | null>(null);
    const [, bumpRender] = useState(0);
    const windowId = timer && timer.kind === "Work" ? windowStartedAt(timer) : null;
    const age = windowId ? Date.now() - Date.parse(windowId) : null;
    const remaining = age === null || !Number.isFinite(age) ? null : LOG_ENERGY_CHIP_MS - age;

    useEffect(() => {
        if (remaining === null || remaining <= 0) return;
        const id = setTimeout(() => bumpRender((value) => value + 1), remaining);
        return () => clearTimeout(id);
    }, [windowId, remaining]);

    if (!energy || !timer || !windowId || remaining === null || remaining <= 0) return null;
    if (!isWorkWindowLive(timer, new Date())) return null;
    const entry = energy.entries[windowId];
    if (!entry) return null;

    if (openFor !== windowId) {
        return (
            <button type="button" className={CHIP} aria-expanded={false} onClick={() => setOpenFor(windowId)}>
                Log Energy
            </button>
        );
    }

    return (
        <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-neutral-700/70 bg-neutral-900/60 px-3 py-2">
            <div className="flex w-full items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Log Energy</span>
                <button type="button" className={CLOSE} onClick={() => setOpenFor(null)}>Close</button>
            </div>
            <EnergyControls
                idPrefix="energy-chip"
                energy={entry.energy}
                clarity={entry.clarity}
                caffeine={entry.caffeine}
                onChange={(patch) => { void energy.setRating(windowId, patch); }}
            />
        </div>
    );
}
