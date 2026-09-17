import type { PetActivityType } from "../../state/types";

/** Shared presentation metadata for the pet activity types. */
export const PET_ACTIVITY_META: Record<PetActivityType, { icon: string; label: string }> = {
    potty: { icon: "🚽", label: "Potty" },
    training: { icon: "🎓", label: "Training" },
    playtime: { icon: "🎾", label: "Playtime" },
    feeding: { icon: "🍖", label: "Feeding" },
};

/** Local id minting for pet records staged through the data access layer. */
export function petUuid(): string {
    try {
        const candidate = globalThis.crypto?.randomUUID;
        if (candidate) return candidate.call(globalThis.crypto);
    } catch {
        // jsdom and older webviews may not expose randomUUID.
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
