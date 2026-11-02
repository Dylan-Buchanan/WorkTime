export const THEME_PREFERENCE_STORAGE_KEY = "worktime:theme:v1";

export const SYSTEM_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** The stored choice: an explicit palette or the live OS preference. */
export type ThemePreference = "light" | "dark" | "system";

/** The palette actually painted; System resolves to one of these. */
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export const THEME_PREFERENCE_OPTIONS = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
] as const satisfies readonly { id: ThemePreference; label: string }[];

/**
 * Browser/PWA chrome colors per resolved theme. The manifest keeps the dark
 * values because Dark is the default; only the live `theme-color` meta follows
 * the user's choice.
 */
export const THEME_COLOR_BY_RESOLVED_THEME: Record<ResolvedTheme, string> = {
    light: "#fafafa",
    dark: "#0a0a0a",
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ThemePreferenceListener = (preference: ThemePreference) => void;

function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

export function isThemePreference(value: string | null): value is ThemePreference {
    return value === "light" || value === "dark" || value === "system";
}

function readPreference(storage: StorageLike | undefined): ThemePreference {
    if (!storage) return DEFAULT_THEME_PREFERENCE;
    try {
        const value = storage.getItem(THEME_PREFERENCE_STORAGE_KEY);
        return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
    } catch {
        return DEFAULT_THEME_PREFERENCE;
    }
}

let inMemoryPreference = readPreference(defaultStorage());
const listeners = new Set<ThemePreferenceListener>();

function publish(preference: ThemePreference): ThemePreference {
    inMemoryPreference = preference;
    listeners.forEach((listener) => listener(preference));
    return preference;
}

/** Returns the startup-loaded preference and reconciles storage changes. */
export function getThemePreference(storage: StorageLike | undefined = defaultStorage()): ThemePreference {
    const stored = readPreference(storage);
    if (stored !== inMemoryPreference) inMemoryPreference = stored;
    return inMemoryPreference;
}

/**
 * Stores the choice for this browser or Tauri webview only. It never reaches
 * `settings.data`, the staging store, or any synced key.
 */
export function setThemePreference(
    preference: ThemePreference,
    storage: StorageLike | undefined = defaultStorage(),
): ThemePreference {
    if (!isThemePreference(preference)) throw new Error(`Unsupported theme preference: ${String(preference)}`);
    try {
        storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
    } catch {
        // Storage can be blocked or full; the in-memory preference still applies
        // for this session instead of failing the selection.
    }
    return publish(preference);
}

/** Drops the stored choice so the surface falls back to the Dark default. */
export function clearThemePreference(storage: StorageLike | undefined = defaultStorage()): ThemePreference {
    try {
        storage?.removeItem(THEME_PREFERENCE_STORAGE_KEY);
    } catch {
        // Nothing else to do; the in-memory preference resets either way.
    }
    return publish(DEFAULT_THEME_PREFERENCE);
}

export function subscribeToThemePreference(listener: ThemePreferenceListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** System follows the OS; every other choice is already resolved. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
    if (preference === "system") return systemPrefersDark ? "dark" : "light";
    return preference;
}

export interface ThemePreferenceStore {
    get(): ThemePreference;
    set(preference: ThemePreference): ThemePreference;
    clear(): ThemePreference;
    subscribe(listener: ThemePreferenceListener): () => void;
}

/** Creates an isolated store for tests or a future alternate frontend surface. */
export function createThemePreferenceStore(storage: StorageLike): ThemePreferenceStore {
    let value = readPreference(storage);
    const storeListeners = new Set<ThemePreferenceListener>();
    const notify = (next: ThemePreference) => {
        value = next;
        storeListeners.forEach((listener) => listener(next));
        return next;
    };
    return {
        get: () => value,
        set: (preference) => {
            if (!isThemePreference(preference)) throw new Error(`Unsupported theme preference: ${String(preference)}`);
            try {
                storage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
            } catch {
                // Keep the in-memory value usable when storage is unavailable.
            }
            return notify(preference);
        },
        clear: () => {
            try {
                storage.removeItem(THEME_PREFERENCE_STORAGE_KEY);
            } catch {
                // Keep the in-memory value usable when storage is unavailable.
            }
            return notify(DEFAULT_THEME_PREFERENCE);
        },
        subscribe: (listener) => {
            storeListeners.add(listener);
            return () => storeListeners.delete(listener);
        },
    };
}
