import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOptionalEnergy } from "../../state/EnergyContext";
import type { EnergyRatingPatch } from "../../state/types";
import { EnergyControls } from "./EnergyControls";

export interface EnergyStartRowProps {
    /** Receives the row's explicit (user-touched) fields so a start can arm them. */
    onExplicitChange?: (explicit: EnergyRatingPatch) => void;
    disabled?: boolean;
}

/** Home-surface row above Start Focus. Lives only in the empty-timer state. */
export function EnergyStartRow({ onExplicitChange, disabled = false }: EnergyStartRowProps) {
    const energy = useOptionalEnergy();
    const [explicit, setExplicit] = useState<EnergyRatingPatch>({});
    const notify = useRef(onExplicitChange);
    useLayoutEffect(() => { notify.current = onExplicitChange; });
    // The row owns no state between sessions: each mount starts untouched and
    // tells its mirror to forget the previous session's taps.
    useEffect(() => { notify.current?.({}); }, []);

    if (!energy) return null;

    const prefill = energy.prefillFor(new Date().toISOString());
    const has = (field: "energy" | "clarity") => Object.prototype.hasOwnProperty.call(explicit, field);
    const apply = (patch: EnergyRatingPatch) => {
        const next = { ...explicit, ...patch };
        setExplicit(next);
        notify.current?.(next);
    };

    return (
        <EnergyControls
            idPrefix="energy-home"
            energy={has("energy") ? explicit.energy! : prefill.energy}
            clarity={has("clarity") ? explicit.clarity! : prefill.clarity}
            caffeine={explicit.caffeine ?? false}
            onChange={apply}
            disabled={disabled}
        />
    );
}
