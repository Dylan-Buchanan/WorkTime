import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useSoundPreference } from "./useSoundPreference";
import {
    DEFAULT_SOUND_PREFERENCE,
    SOUND_PREFERENCE_STORAGE_KEY,
    clearSoundPreference,
    setSoundPreference,
} from "../lib/sound";

afterEach(() => {
    clearSoundPreference();
});

it("initializes from the current mix and follows changes from other consumers", () => {
    const muted = { ...DEFAULT_SOUND_PREFERENCE, master: false };
    setSoundPreference(muted);
    const first = renderHook(useSoundPreference);
    const second = renderHook(useSoundPreference);
    expect(first.result.current.preference).toEqual(muted);
    expect(second.result.current.preference).toEqual(muted);

    const setPreference = first.result.current.setPreference;
    const next = { ...muted, enabled: { ...muted.enabled, hover: false } };
    act(() => setPreference(next));
    expect(first.result.current.preference).toEqual(next);
    expect(second.result.current.preference).toEqual(next);
    expect(first.result.current.setPreference).toBe(setPreference);
    expect(localStorage.getItem(SOUND_PREFERENCE_STORAGE_KEY)).toBe(JSON.stringify(next));

    first.unmount();
    act(() => { clearSoundPreference(); });
    expect(second.result.current.preference).toEqual(DEFAULT_SOUND_PREFERENCE);
});
