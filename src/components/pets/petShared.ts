import type { PetActivityType } from "../../state/types";

/** Shared presentation metadata for the pet activity types. */
export const PET_ACTIVITY_META: Record<PetActivityType, { icon: string; label: string }> = {
    potty: { icon: "🚽", label: "Potty" },
    training: { icon: "🎓", label: "Training" },
    playtime: { icon: "🎾", label: "Playtime" },
    feeding: { icon: "🍖", label: "Feeding" },
};
