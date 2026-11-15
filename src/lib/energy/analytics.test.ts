import { describe, expect, it } from "vitest";
import {
    buildEnergyHeatmap,
    energyRatedFootnote,
    filterEnergyEntries,
    recentEnergyEntries,
    type EnergyAnalyticsFilters,
} from "./analytics";
import type { EnergyEntry } from "../../state/types";

/** Local wall-clock instant, so the tests are timezone-independent. */
const at = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute = 0,
    second = 0
) => new Date(year, month, day, hour, minute, second).toISOString();

function entry(
    windowStartedAt: string,
    overrides: Partial<EnergyEntry> = {}
): EnergyEntry {
    return {
        work_window_id: windowStartedAt,
        energy: null,
        clarity: null,
        caffeine: false,
        energy_carried: false,
        clarity_carried: false,
        created_at: windowStartedAt,
        updated_at: windowStartedAt,
        ...overrides,
    };
}

function filters(
    overrides: Partial<EnergyAnalyticsFilters> = {}
): EnergyAnalyticsFilters {
    return {
        from: new Date(2026, 10, 1, 0, 0, 0),
        to: new Date(2026, 10, 30, 23, 59, 59),
        workHoursOnly: false,
        ...overrides,
    };
}

// 2026-11-02 is a Monday.
const MONDAY = 2;

describe("buildEnergyHeatmap", () => {
    it("averages non-null values and counts only those values", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9, 5), { energy: 4 }),
            entry(at(2026, 10, MONDAY, 9, 15), { energy: null }),
            entry(at(2026, 10, MONDAY, 9, 25), { energy: 2 }),
        ];
        const { matrix, counts, max } = buildEnergyHeatmap(entries, "energy");
        expect(matrix["1-9"]).toBe(3);
        expect(counts["1-9"]).toBe(2);
        expect(max).toBe(5);
        expect(Object.keys(matrix)).toEqual(["1-9"]);
    });

    it("does not dilute a single value with nulls in the same cell", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9, 5), { energy: 3 }),
            entry(at(2026, 10, MONDAY, 9, 35), { energy: null }),
            entry(at(2026, 10, MONDAY, 9, 45), { energy: null }),
        ];
        const { matrix, counts } = buildEnergyHeatmap(entries, "energy");
        expect(matrix["1-9"]).toBe(3);
        expect(counts["1-9"]).toBe(1);
    });

    it("treats nullity independently per metric", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9, 5), { energy: 4, clarity: null }),
            entry(at(2026, 10, MONDAY, 9, 35), { energy: 2, clarity: 3 }),
            entry(at(2026, 10, MONDAY, 10, 5), { energy: null, clarity: null }),
        ];
        const energy = buildEnergyHeatmap(entries, "energy");
        const clarity = buildEnergyHeatmap(entries, "clarity");
        expect(energy.matrix["1-9"]).toBe(3);
        expect(clarity.matrix["1-9"]).toBe(3);
        // The all-null hour has no non-null value for either metric.
        expect(energy.matrix["1-10"]).toBeUndefined();
        expect(clarity.matrix["1-10"]).toBeUndefined();
    });

    it("keeps max at 5 and finite colours for a single entry", () => {
        const entries = [entry(at(2026, 10, MONDAY, 9, 5), { energy: 4 })];
        const { matrix, max } = buildEnergyHeatmap(entries, "energy");
        expect(max).toBe(5);
        const pct = matrix["1-9"] / max;
        expect(Number.isFinite(pct)).toBe(true);
        const lightness = 30 + pct * 30;
        expect(Number.isFinite(lightness)).toBe(true);
        expect(lightness).toBeGreaterThan(30);
        expect(lightness).toBeLessThanOrEqual(60);
    });

    it("returns an empty matrix and max 5 for zero entries", () => {
        const { matrix, counts, max } = buildEnergyHeatmap([], "energy");
        expect(matrix).toEqual({});
        expect(counts).toEqual({});
        expect(max).toBe(5);
    });

    it("buckets by the window START hour, not the finish time", () => {
        // 09:55 local start; a 25-minute session finishes in the 10 hour.
        const entries = [entry(at(2026, 10, MONDAY, 9, 55), { energy: 3 })];
        const { matrix } = buildEnergyHeatmap(entries, "energy");
        expect(matrix["1-9"]).toBe(3);
        expect(matrix["1-10"]).toBeUndefined();
    });
});

describe("filterEnergyEntries", () => {
    it("applies the work-hours filter to the entry's start hour", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 7, 59)),
            entry(at(2026, 10, MONDAY, 18, 59)),
            entry(at(2026, 10, MONDAY, 19, 0)),
        ];
        const kept = filterEnergyEntries(entries, filters({ workHoursOnly: true }));
        expect(kept.map((e) => e.work_window_id)).toEqual([
            at(2026, 10, MONDAY, 18, 59),
        ]);
        expect(filterEnergyEntries(entries, filters())).toHaveLength(3);
    });

    it("uses inclusive range bounds on the window start instant", () => {
        const from = new Date(2026, 10, MONDAY, 9, 0, 0);
        const to = new Date(2026, 10, MONDAY, 10, 0, 0);
        const entries = [
            entry(at(2026, 10, MONDAY, 8, 59, 59)),
            entry(at(2026, 10, MONDAY, 9, 0, 0)),
            entry(at(2026, 10, MONDAY, 10, 0, 0)),
            entry(at(2026, 10, MONDAY, 10, 0, 1)),
        ];
        const kept = filterEnergyEntries(entries, {
            from,
            to,
            workHoursOnly: false,
        });
        expect(kept.map((e) => e.work_window_id)).toEqual([
            at(2026, 10, MONDAY, 9, 0, 0),
            at(2026, 10, MONDAY, 10, 0, 0),
        ]);
    });
});

describe("energyRatedFootnote", () => {
    it("counts explicitly rated entries out of the total", () => {
        const entries = [
            entry(at(2026, 10, MONDAY, 9), { energy: 4 }),
            entry(at(2026, 10, MONDAY, 10), {
                energy: 4,
                energy_carried: true,
            }),
            entry(at(2026, 10, MONDAY, 11), { clarity: 3 }),
            entry(at(2026, 10, MONDAY, 12)),
        ];
        expect(energyRatedFootnote(entries)).toEqual({ explicit: 2, total: 4 });
    });

    it("reports 0 of 0 for no entries", () => {
        expect(energyRatedFootnote([])).toEqual({ explicit: 0, total: 0 });
    });
});

describe("recentEnergyEntries", () => {
    const entries = [
        entry(at(2026, 10, MONDAY, 9), { energy: 1 }),
        entry(at(2026, 10, MONDAY, 11), { energy: 3 }),
        entry(at(2026, 10, MONDAY, 10), { energy: 2 }),
    ];

    it("orders newest first and applies the default limit of 10", () => {
        expect(recentEnergyEntries(entries).map((e) => e.energy)).toEqual([
            3, 2, 1,
        ]);
        const many = Array.from({ length: 12 }, (_, i) =>
            entry(at(2026, 10, MONDAY, 8, i), { energy: (i % 5) + 1 })
        );
        expect(recentEnergyEntries(many)).toHaveLength(10);
    });

    it("honours an explicit limit", () => {
        expect(recentEnergyEntries(entries, 2).map((e) => e.energy)).toEqual([
            3, 2,
        ]);
    });
});
