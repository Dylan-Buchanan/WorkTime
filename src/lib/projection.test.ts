import { describe, expect, it } from "vitest";
import { addProjectedDuration, addProjectWorkableDuration, combinedProjectFinish } from "./projection";
import type { WorkableWeekday } from "../state/types";

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

describe("project workable-time projection", () => {
    const weekdays = { workableStart: "09:00", workableEnd: "17:00", workableDays: [1, 2, 3, 4, 5] as WorkableWeekday[] };

    it("rolls Friday overflow to Monday", () => {
        const finish = addProjectWorkableDuration(new Date(2026, 0, 9, 16, 0), 2 * 60 * 60_000, weekdays);
        expectLocal(finish, 2026, 0, 12, 10, 0);
    });

    it("moves work before the window to that day's start", () => {
        const finish = addProjectWorkableDuration(new Date(2026, 0, 12, 7, 0), 60 * 60_000, weekdays);
        expectLocal(finish, 2026, 0, 12, 10, 0);
    });

    it("combines differently scheduled projects without counting work simultaneously", () => {
        const finish = combinedProjectFinish(new Date(2026, 0, 9, 16, 0), [
            { durationMs: 2 * 60 * 60_000, schedule: weekdays },
            { durationMs: 2 * 60 * 60_000, schedule: { workableStart: "08:00", workableEnd: "12:00", workableDays: [6] } },
        ]);
        expectLocal(finish, 2026, 0, 12, 10, 0);
    });

    it("adds workloads that share the same schedule", () => {
        const finish = combinedProjectFinish(new Date(2026, 0, 12, 9, 0), [
            { durationMs: 2 * 60 * 60_000, schedule: weekdays },
            { durationMs: 3 * 60 * 60_000, schedule: weekdays },
        ]);
        expectLocal(finish, 2026, 0, 12, 14, 0);
    });

    it("preempts a broad window when a narrower project window opens", () => {
        const finish = combinedProjectFinish(new Date(2026, 0, 12, 9, 0), [
            { durationMs: 7 * 60 * 60_000, schedule: weekdays },
            { durationMs: 2 * 60 * 60_000, schedule: { workableStart: "10:00", workableEnd: "12:00", workableDays: [1] } },
        ]);
        expectLocal(finish, 2026, 0, 13, 10, 0);
    });
});
