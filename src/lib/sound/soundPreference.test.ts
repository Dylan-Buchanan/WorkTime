import { afterEach, expect, it, vi } from "vitest";
import {
    DEFAULT_SOUND_PREFERENCE,
    SOUND_KEYS,
    SOUND_PREFERENCE_STORAGE_KEY,
    clearSoundPreference,
    createSoundPreferenceStore,
    getSoundPreference,
    isSoundEnabled,
    setSoundPreference,
    subscribeToSoundPreference,
    type SoundPreference,
} from ".";

function createFakeStorage(seed: Record<string, string> = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
    };
}

const customMix = {
    master: false,
    enabled: { ...DEFAULT_SOUND_PREFERENCE.enabled, hover: false },
};

afterEach(() => {
    clearSoundPreference();
});

it("defaults to enabling the master and all six sounds", () => {
    const preference = createSoundPreferenceStore(createFakeStorage()).get();
    expect(preference.master).toBe(true);
    expect(Object.keys(preference.enabled)).toEqual(SOUND_KEYS);
    for (const key of SOUND_KEYS) expect(isSoundEnabled(key, preference)).toBe(true);
});

it("round-trips the mix through storage and clears it to the default", () => {
    const storage = createFakeStorage();
    const store = createSoundPreferenceStore(storage);
    expect(store.set(customMix)).toEqual(customMix);
    expect(storage.values).toEqual(new Map([[SOUND_PREFERENCE_STORAGE_KEY, JSON.stringify(customMix)]]));
    expect(createSoundPreferenceStore(storage).get()).toEqual(customMix);

    expect(store.clear()).toEqual(DEFAULT_SOUND_PREFERENCE);
    expect(storage.values.size).toBe(0);
    expect(createSoundPreferenceStore(storage).get()).toEqual(DEFAULT_SOUND_PREFERENCE);
});

it.each([
    null,
    [],
    { ...customMix, master: "false" },
    { master: false, enabled: { hover: false } },
    { ...customMix, enabled: { ...customMix.enabled, hover: 0 } },
    { ...customMix, enabled: { ...customMix.enabled, volume: true } },
    { ...customMix, volume: 0 },
].map((invalid) => ({ invalid })))("rejects unsupported preferences and ignores them in storage ($invalid)", ({ invalid }) => {
    const storage = createFakeStorage({ [SOUND_PREFERENCE_STORAGE_KEY]: JSON.stringify(invalid) });
    const store = createSoundPreferenceStore(storage);
    expect(store.get()).toEqual(DEFAULT_SOUND_PREFERENCE);
    expect(() => store.set(invalid as SoundPreference)).toThrow("Unsupported sound preference");
    expect(store.get()).toEqual(DEFAULT_SOUND_PREFERENCE);
});

it("falls back to the default for malformed JSON", () => {
    const storage = createFakeStorage({ [SOUND_PREFERENCE_STORAGE_KEY]: "{broken" });
    expect(createSoundPreferenceStore(storage).get()).toEqual(DEFAULT_SOUND_PREFERENCE);
});

it("keeps the active mix in memory when storage throws", () => {
    const unavailable = () => { throw new Error("storage blocked"); };
    const store = createSoundPreferenceStore({
        getItem: unavailable,
        setItem: unavailable,
        removeItem: unavailable,
    });
    expect(store.get()).toEqual(DEFAULT_SOUND_PREFERENCE);
    store.set(customMix);
    expect(store.get()).toEqual(customMix);
    store.clear();
    expect(store.get()).toEqual(DEFAULT_SOUND_PREFERENCE);
});

it("publishes singleton updates synchronously until unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSoundPreference(listener);

    setSoundPreference(customMix);
    expect(getSoundPreference()).toEqual(customMix);
    expect(isSoundEnabled("pressSide")).toBe(false);
    clearSoundPreference();
    expect(listener.mock.calls).toEqual([[customMix], [DEFAULT_SOUND_PREFERENCE]]);

    unsubscribe();
    setSoundPreference(customMix);
    expect(listener).toHaveBeenCalledTimes(2);
});

it("keeps isolated stores and their subscribers independent", () => {
    const first = createSoundPreferenceStore(createFakeStorage());
    const second = createSoundPreferenceStore(createFakeStorage());
    const listener = vi.fn();
    const unsubscribe = first.subscribe(listener);

    second.set(customMix);
    expect(first.get()).toEqual(DEFAULT_SOUND_PREFERENCE);
    expect(listener).not.toHaveBeenCalled();
    first.set(customMix);
    expect(listener).toHaveBeenCalledExactlyOnceWith(customMix);
    unsubscribe();
    first.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second.get()).toEqual(customMix);
    expect(getSoundPreference()).toEqual(DEFAULT_SOUND_PREFERENCE);
});
