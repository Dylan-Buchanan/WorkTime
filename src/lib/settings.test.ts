import { describe, expect, it } from "vitest";
import { DEFAULT_END_OF_DAY, DEFAULT_START_OF_DAY, isCompleteSettings, isEndOfDayTime, isStartOfDayTime, parsePersistedSettings } from "./settings";

const legacy = {
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 20,
    segment_length: 4,
};

describe("settings persistence parsing", () => {
    it("backfills legacy settings with both clock defaults", () => {
        expect(parsePersistedSettings(legacy)).toEqual({ ...legacy, start_of_day: DEFAULT_START_OF_DAY, end_of_day: DEFAULT_END_OF_DAY });
        expect(isCompleteSettings(legacy)).toBe(false);
        expect(isCompleteSettings({ ...legacy, start_of_day: "06:00", end_of_day: "18:30" })).toBe(true);
    });

    it("accepts only valid 24-hour HH:mm cutoff values", () => {
        expect(isEndOfDayTime("00:00")).toBe(true);
        expect(isEndOfDayTime("23:59")).toBe(true);
        expect(isEndOfDayTime("24:00")).toBe(false);
        expect(isEndOfDayTime("9:00")).toBe(false);
        expect(parsePersistedSettings({ ...legacy, end_of_day: "25:00" })).toBeNull();
    });

    it("validates start of day independently of end of day", () => {
        expect(isStartOfDayTime("00:00")).toBe(true);
        expect(isStartOfDayTime("23:59")).toBe(true);
        expect(isStartOfDayTime("24:00")).toBe(false);
        expect(isStartOfDayTime("9:00")).toBe(false);
        expect(parsePersistedSettings({ ...legacy, start_of_day: "24:00" })).toBeNull();
        expect(parsePersistedSettings({ ...legacy, start_of_day: "23:00", end_of_day: "06:00" }))
            .toEqual({ ...legacy, start_of_day: "23:00", end_of_day: "06:00" });
    });

    it("rejects malformed legacy numeric fields", () => {
        expect(parsePersistedSettings({ ...legacy, work_minutes: "25" })).toBeNull();
        expect(parsePersistedSettings({ ...legacy, segment_length: Number.NaN })).toBeNull();
    });
});
