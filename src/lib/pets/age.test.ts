import { describe, expect, it } from "vitest";
import { derivePetAge, formatPetAge, formatPetAgeAt } from "./age";

function date(year: number, month: number, day: number): Date {
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

const birth = new Date(2026, 0, 10, 9, 30, 0, 0);

describe("pet age", () => {
    it("uses weeks until the six-month birthday", () => {
        const age = derivePetAge(birth, date(2026, 7, 9));
        expect(age.unit).toBe("weeks");
        expect(age.value).toBe(25);
        expect(formatPetAge(age)).toBe("25 weeks");
    });

    it("switches to months on the six-month birthday", () => {
        const age = derivePetAge(birth, date(2026, 7, 10));
        expect(age.unit).toBe("months");
        expect(age.value).toBe(6);
        expect(formatPetAge(age)).toBe("6 months");
    });

    it("uses the clamped calendar anniversary for month-end births", () => {
        const age = derivePetAge(date(2025, 8, 31), date(2026, 2, 28));
        expect(age.unit).toBe("months");
        expect(age.value).toBe(6);
        expect(formatPetAge(age)).toBe("6 months");
    });

    it("counts local calendar days rather than elapsed 24-hour periods", () => {
        const age = derivePetAge(date(2026, 3, 7), date(2026, 3, 14));
        expect(age.totalDays).toBe(7);
        expect(age.weeks).toBe(1);
    });

    it("parses persisted birth dates without a UTC day shift", () => {
        const age = derivePetAge("2026-01-10", date(2026, 7, 9));
        expect(age.birthDate.getDate()).toBe(10);
        expect(age.unit).toBe("weeks");
    });

    it("phrases singular units correctly", () => {
        const age = derivePetAge(date(2026, 8, 1), date(2026, 8, 8));
        expect(age.unit).toBe("weeks");
        expect(formatPetAge(age)).toBe("1 week");
    });

    it("formats directly from dates", () => {
        expect(formatPetAgeAt(birth, date(2026, 6, 10))).toBe("21 weeks");
    });

    it("rejects invalid dates", () => {
        expect(() => derivePetAge(new Date("not-a-date"), date(2026, 1, 1))).toThrow(RangeError);
    });
});
