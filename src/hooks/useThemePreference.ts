import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";
import {
    SYSTEM_THEME_MEDIA_QUERY,
    applyResolvedTheme,
    getThemePreference,
    resolveTheme,
    setThemePreference,
    subscribeToThemePreference,
} from "../lib/theme";
import type { ResolvedTheme, ThemePreference } from "../lib/theme";

export interface ThemePreferenceState {
    /** What the user picked (Light, Dark, or System). */
    preference: ThemePreference;
    /** What is painted right now; System resolves against the OS. */
    resolvedTheme: ResolvedTheme;
    setPreference: (preference: ThemePreference) => void;
}

/**
 * Single source of truth for the active theme. Mount it once at the app root so
 * every route (including the public auth pages) is themed, and again anywhere a
 * control needs the current state — both instances follow the same surface-local
 * store and OS media query. Applying the theme is idempotent, so the extra
 * mounts are harmless.
 */
export const useThemePreference = (): ThemePreferenceState => {
    const systemPrefersDark = useMediaQuery(SYSTEM_THEME_MEDIA_QUERY);
    const [preference, setPreferenceState] = useState<ThemePreference>(() => getThemePreference());

    useEffect(() => subscribeToThemePreference(setPreferenceState), []);

    const resolvedTheme = resolveTheme(preference, systemPrefersDark);

    useEffect(() => {
        applyResolvedTheme(resolvedTheme);
    }, [resolvedTheme]);

    const setPreference = useCallback((next: ThemePreference) => {
        setThemePreference(next);
    }, []);

    return { preference, resolvedTheme, setPreference };
};
