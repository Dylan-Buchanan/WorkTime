import { useCallback, useEffect, useState } from "react";
import {
    getSoundPreference,
    setSoundPreference,
    subscribeToSoundPreference,
    type SoundPreference,
} from "../lib/sound";

export interface SoundPreferenceState {
    preference: SoundPreference;
    setPreference: (next: SoundPreference) => void;
}

export function useSoundPreference(): SoundPreferenceState {
    const [preference, setPreferenceState] = useState(() => getSoundPreference());

    useEffect(() => {
        const unsubscribe = subscribeToSoundPreference(setPreferenceState);
        setPreferenceState(getSoundPreference());
        return unsubscribe;
    }, []);

    const setPreference = useCallback((next: SoundPreference) => {
        setSoundPreference(next);
    }, []);

    return { preference, setPreference };
}
