import type { EnergyEntry, EnergyRatingPatch } from "../../state/types";

export interface EnergyPrefill { energy: number | null; clarity: number | null }

export function energyLocalDayKey(instantIso: string, startOfDay: string): string {
    const date = new Date(instantIso);
    const [hour, minute] = startOfDay.split(":").map(Number);
    if (date.getHours() * 60 + date.getMinutes() < hour * 60 + minute) date.setDate(date.getDate() - 1);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function resolveEnergyPrefill(windowStartedAt: string, entries: readonly EnergyEntry[], startOfDay: string): EnergyPrefill {
    const day = energyLocalDayKey(windowStartedAt, startOfDay);
    const before = Date.parse(windowStartedAt);
    let latest: EnergyEntry | undefined;
    for (const entry of entries) {
        if (Date.parse(entry.work_window_id) < before && energyLocalDayKey(entry.work_window_id, startOfDay) === day &&
            (!latest || Date.parse(entry.work_window_id) > Date.parse(latest.work_window_id))) latest = entry;
    }
    return { energy: latest?.energy ?? null, clarity: latest?.clarity ?? null };
}

export function composeEnergyEntry(input: { workWindowId: string; prefill: EnergyPrefill; explicit: EnergyRatingPatch; now: string }): EnergyEntry {
    const { workWindowId, prefill, explicit, now } = input;
    const energySet = Object.prototype.hasOwnProperty.call(explicit, "energy");
    const claritySet = Object.prototype.hasOwnProperty.call(explicit, "clarity");
    return {
        work_window_id: workWindowId,
        energy: energySet ? explicit.energy! : prefill.energy,
        clarity: claritySet ? explicit.clarity! : prefill.clarity,
        caffeine: explicit.caffeine ?? false,
        energy_carried: !energySet && prefill.energy !== null,
        clarity_carried: !claritySet && prefill.clarity !== null,
        created_at: now, updated_at: now,
    };
}

export function applyEnergyRating(entry: EnergyEntry, patch: EnergyRatingPatch, updatedAt: string): EnergyEntry {
    if (Object.keys(patch).length === 0) return entry;
    return { ...entry, ...patch,
        ...(Object.prototype.hasOwnProperty.call(patch, "energy") ? { energy_carried: false } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "clarity") ? { clarity_carried: false } : {}),
        updated_at: updatedAt,
    };
}

export function isEnergyEntryExplicitlyRated(entry: EnergyEntry): boolean {
    return (entry.energy !== null && !entry.energy_carried) || (entry.clarity !== null && !entry.clarity_carried);
}

export function isEnergyRating(value: unknown): value is number | null {
    return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5);
}
