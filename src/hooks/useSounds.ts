import { useEffect } from "react";
import { play, preloadSounds } from "../lib/sound/audioPool";

export type { SoundKey } from "../lib/sound/audioPool";

export function useSounds() {
    useEffect(preloadSounds, []);
    return { play };
}
