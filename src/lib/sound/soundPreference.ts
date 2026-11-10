export const SOUND_PREFERENCE_STORAGE_KEY = "worktime:sound:v1";

export const SOUND_KEYS = [
    "hover",
    "pressSide",
    "startPomodoro",
    "pomodoroFinish",
    "breakOver",
    "completeTask",
] as const;

export type SoundKey = (typeof SOUND_KEYS)[number];

export interface SoundPreference {
    readonly master: boolean;
    readonly enabled: Readonly<Record<SoundKey, boolean>>;
}

export const DEFAULT_SOUND_PREFERENCE: SoundPreference = Object.freeze({
    master: true,
    enabled: Object.freeze({
        hover: true,
        pressSide: true,
        startPomodoro: true,
        pomodoroFinish: true,
        breakOver: true,
        completeTask: true,
    }),
});

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SoundPreferenceListener = (preference: SoundPreference) => void;

export interface SoundPreferenceStore {
    get(): SoundPreference;
    set(preference: SoundPreference): SoundPreference;
    clear(): SoundPreference;
    subscribe(listener: SoundPreferenceListener): () => void;
}

function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function isSoundPreference(value: unknown): value is SoundPreference {
    if (!value || typeof value !== "object") return false;
    const fields = Object.keys(value);
    if (fields.length !== 2 || !fields.includes("master") || !fields.includes("enabled")) return false;

    const { master, enabled } = value as Partial<SoundPreference>;
    if (typeof master !== "boolean" || !enabled || typeof enabled !== "object") return false;

    const keys = Object.keys(enabled);
    return keys.length === SOUND_KEYS.length
        && SOUND_KEYS.every((key) => keys.includes(key) && typeof enabled[key] === "boolean");
}

function snapshot({ master, enabled }: SoundPreference): SoundPreference {
    return Object.freeze({ master, enabled: Object.freeze({ ...enabled }) });
}

function readPreference(storage: StorageLike | undefined): SoundPreference {
    try {
        const stored = storage?.getItem(SOUND_PREFERENCE_STORAGE_KEY);
        if (stored) {
            const preference: unknown = JSON.parse(stored);
            if (isSoundPreference(preference)) return snapshot(preference);
        }
    } catch {
        // Malformed JSON and unavailable storage both fall back to the default.
    }
    return DEFAULT_SOUND_PREFERENCE;
}

export function createSoundPreferenceStore(storage: StorageLike | undefined): SoundPreferenceStore {
    let preference = readPreference(storage);
    const listeners = new Set<SoundPreferenceListener>();

    function publish(next: SoundPreference): SoundPreference {
        preference = next;
        listeners.forEach((listener) => listener(next));
        return next;
    }

    return {
        get: () => preference,
        set(next) {
            if (!isSoundPreference(next)) throw new Error("Unsupported sound preference");
            const saved = snapshot(next);
            try {
                storage?.setItem(SOUND_PREFERENCE_STORAGE_KEY, JSON.stringify(saved));
            } catch {
                // The current surface can still use the new mix in memory.
            }
            return publish(saved);
        },
        clear() {
            try {
                storage?.removeItem(SOUND_PREFERENCE_STORAGE_KEY);
            } catch {
                // Reset the in-memory mix even if storage is unavailable.
            }
            return publish(DEFAULT_SOUND_PREFERENCE);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

let surfaceStore: SoundPreferenceStore | undefined;

function getSurfaceStore(): SoundPreferenceStore {
    // Read once so a failed write cannot replace the active mix with stale storage.
    return surfaceStore ??= createSoundPreferenceStore(defaultStorage());
}

export function getSoundPreference(): SoundPreference {
    return getSurfaceStore().get();
}

export function setSoundPreference(next: SoundPreference): SoundPreference {
    return getSurfaceStore().set(next);
}

export function clearSoundPreference(): SoundPreference {
    return getSurfaceStore().clear();
}

export function subscribeToSoundPreference(listener: SoundPreferenceListener): () => void {
    return getSurfaceStore().subscribe(listener);
}

export function isSoundEnabled(key: SoundKey, preference = getSoundPreference()): boolean {
    return preference.master && preference.enabled[key];
}
