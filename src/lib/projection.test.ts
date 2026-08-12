import { describe, expect, it } from "vitest";
import { addProjectedDuration } from "./projection";

function expectLocal(date: Date, year: number, month: number, day: number, hours: number, minutes: number) {
    expect([
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
    ]).toEqual([year, month, day, hours, minutes]);
}

describe("addProjectedDuration", () => {
    it("keeps work that fits before the cutoff on the same day", () => {
        const finish = addProjectedDuration(new Date(2026, 0, 10, 20, 0), 60 * 60_000, "22:00");
        expectLocal(finish, 2026, 0, 10, 21, 0);
    });

    it("stops at the cutoff and resumes at local midnight", () => {
        const finish = addProjectedDuration(new Date(2026, 0, 10, 20, 0), 3 * 60 * 60_000, "22:00");
        expectLocal(finish, 2026, 0, 11, 1, 0);
    });

    it("rolls across multiple cutoff boundaries", () => {
        const finish = addProjectedDuration(new Date(2026, 0, 10, 21, 0), 25 * 60 * 60_000, "22:00");
        expectLocal(finish, 2026, 0, 12, 2, 0);
    });

    it("moves starts at or after the cutoff to the next local day", () => {
        expectLocal(addProjectedDuration(new Date(2026, 0, 10, 22, 0), 60 * 60_000, "22:00"), 2026, 0, 11, 1, 0);
        expectLocal(addProjectedDuration(new Date(2026, 0, 10, 23, 0), 60 * 60_000, "22:00"), 2026, 0, 11, 1, 0);
    });

    it("treats a midnight cutoff as the following midnight", () => {
        const finish = addProjectedDuration(new Date(2026, 0, 10, 23, 0), 2 * 60 * 60_000, "00:00");
        expectLocal(finish, 2026, 0, 11, 1, 0);
    });
});
