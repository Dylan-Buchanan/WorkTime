import { describe, expect, it } from "vitest";
import { applyEnergyRating, composeEnergyEntry, energyLocalDayKey, isEnergyEntryExplicitlyRated, isEnergyRating, resolveEnergyPrefill } from "./rules";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const entry = (day = 15, hour = 9, energy: number | null = 4, clarity: number | null = 3) =>
    composeEnergyEntry({ workWindowId: local(day, hour), prefill: { energy, clarity }, explicit: {}, now: local(day, hour) });

describe("energy rules", () => {
    it.each([[0, 5, "05:00", "2026-11-14"], [5, 0, "05:00", "2026-11-15"],
        [4, 59, "05:00", "2026-11-14"], [0, 0, "00:00", "2026-11-15"]] as const)(
        "assigns local %i:%i with boundary %s", (hour, minute, boundary, expected) => {
            expect(energyLocalDayKey(local(15, hour, minute), boundary)).toBe(expected);
        });
    it("uses the latest same-day row without looking past null", () => {
        expect(resolveEnergyPrefill(local(15, 11), [entry(), entry(15, 10, null, 2)], "05:00"))
            .toEqual({ energy: null, clarity: 2 });
    });
    it("ignores yesterday, the same window, future rows and empty days", () => {
        for (const rows of [[], [entry(14)], [entry(15, 11)], [entry(15, 12)]]) {
            expect(resolveEnergyPrefill(local(15, 11), rows, "05:00")).toEqual({ energy: null, clarity: null });
        }
    });
    it("uses the previous local calendar date before the day boundary", () => {
        expect(resolveEnergyPrefill(local(15, 0, 5), [entry(14, 23)], "05:00")).toEqual({ energy: 4, clarity: 3 });
        expect(resolveEnergyPrefill(local(15, 5), [entry(15, 4)], "05:00")).toEqual({ energy: null, clarity: null });
    });
    it.each([
        [{ energy: 4, clarity: null }, {}, { energy: 4, energy_carried: true, clarity: null, clarity_carried: false, caffeine: false }],
        [{ energy: 4, clarity: 3 }, { energy: 2 }, { energy: 2, energy_carried: false, clarity: 3, clarity_carried: true, caffeine: false }],
        [{ energy: 4, clarity: 3 }, { energy: null }, { energy: null, energy_carried: false, clarity: 3, clarity_carried: true, caffeine: false }],
        [{ energy: 4, clarity: 3 }, { caffeine: true }, { energy: 4, energy_carried: true, clarity: 3, clarity_carried: true, caffeine: true }],
    ])("composes prefill %j with explicit %j", (prefill, explicit, expected) => {
        const row = composeEnergyEntry({ workWindowId: local(15, 11), prefill, explicit, now: "now" });
        expect(row).toEqual({ ...expected, work_window_id: local(15, 11), created_at: "now", updated_at: "now" });
    });
    it("updates only named fields, clearing only their carried flags", () => {
        const row = entry();
        expect(applyEnergyRating(row, { clarity: 5 }, "later")).toEqual({ ...row, clarity: 5, clarity_carried: false, updated_at: "later" });
        expect(applyEnergyRating(row, { energy: null }, "later")).toEqual({ ...row, energy: null, energy_carried: false, updated_at: "later" });
        expect(applyEnergyRating(row, { caffeine: true }, "later")).toEqual({ ...row, caffeine: true, updated_at: "later" });
        expect(applyEnergyRating(row, {}, "later")).toBe(row);
    });
    it("counts only non-null explicitly set energy or clarity", () => {
        expect(isEnergyEntryExplicitlyRated(entry())).toBe(false);
        expect(isEnergyEntryExplicitlyRated(applyEnergyRating(entry(), { caffeine: true }, "now"))).toBe(false);
        expect(isEnergyEntryExplicitlyRated(applyEnergyRating(entry(), { energy: null }, "now"))).toBe(false);
        expect(isEnergyEntryExplicitlyRated(applyEnergyRating(entry(), { clarity: 1 }, "now"))).toBe(true);
        expect(isEnergyEntryExplicitlyRated(applyEnergyRating(entry(), { energy: 5 }, "now"))).toBe(true);
    });
    it.each([null, 1, 2, 3, 4, 5])("accepts rating %s", value => expect(isEnergyRating(value)).toBe(true));
    it.each([undefined, "3", 0, 6, 2.5, NaN, true])("rejects rating %s", value => expect(isEnergyRating(value)).toBe(false));
});
