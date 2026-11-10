import { describe, expect, it } from "vitest";
import type { ActiveTimer, Task } from "../../state/types";
import { ownsWorkWindow, partitionPendingFinalizes } from "./pendingFinalize";

const W = "2026-11-09T14:00:00.000Z";
const work: ActiveTimer = {
    task_id: "a", kind: "Work", started_at: W, window_started_at: W,
    ends_at: "2026-11-09T14:25:00.000Z", planned_secs: 1500,
    paused: false, paused_remaining_secs: 0, accumulated_secs: 0,
};
const tasks: Readonly<Record<string, Task>> = Object.fromEntries(
    ["a", "b", "c", "d"].map(id => [id, {
        id, name: id, target_pomodoros: 4, completed_pomodoros: 0,
        created_at: W, completed_at: id === "d" ? W : null, break_skips: 0, archived: false,
    }]),
);

describe("ownsWorkWindow", () => {
    it.each([
        { name: "running Work", timer: work, id: "a", owns: true },
        { name: "paused Work", timer: { ...work, paused: true }, id: "a", owns: true },
        { name: "ShortBreak", timer: { ...work, kind: "ShortBreak" as const }, id: "a", owns: false },
        { name: "LongBreak", timer: { ...work, kind: "LongBreak" as const }, id: "a", owns: false },
        { name: "paused break", timer: { ...work, kind: "ShortBreak" as const, paused: true }, id: "a", owns: false },
        { name: "null", timer: null, id: "a", owns: false },
        { name: "undefined", timer: undefined, id: "a", owns: false },
        { name: "other task", timer: work, id: "b", owns: false },
    ])("checks ownership for $name", ({ timer, id, owns }) => {
        expect(ownsWorkWindow(timer, id)).toBe(owns);
    });
});

describe("partitionPendingFinalizes", () => {
    it.each([
        { name: "Work owner", pending: ["a"], timer: work, flush: [], keep: ["a"], drop: [] },
        { name: "paused Work owner", pending: ["a"], timer: { ...work, paused: true }, flush: [], keep: ["a"], drop: [] },
        { name: "ShortBreak owner", pending: ["a"], timer: { ...work, kind: "ShortBreak" as const }, flush: ["a"], keep: [], drop: [] },
        { name: "no timer", pending: ["a"], timer: null, flush: ["a"], keep: [], drop: [] },
        { name: "other Work owner", pending: ["a"], timer: { ...work, task_id: "b" }, flush: ["a"], keep: [], drop: [] },
        { name: "duplicate ids", pending: ["a", "b", "a"], timer: { ...work, task_id: "b" }, flush: ["a"], keep: ["b"], drop: [] },
        { name: "completed and missing tasks", pending: ["d", "z", "c"], timer: null, flush: ["c"], keep: [], drop: ["d", "z"] },
        { name: "empty queue", pending: [], timer: work, flush: [], keep: [], drop: [] },
    ])("matches the C3.1 example for $name", ({ pending, timer, flush, keep, drop }) => {
        expect(partitionPendingFinalizes(pending, timer, tasks)).toEqual({ flush, keep, drop });
    });

    it("drops completed or missing owners before checking Work ownership", () => {
        for (const id of ["d", "z"]) {
            expect(partitionPendingFinalizes([id], { ...work, task_id: id }, tasks))
                .toEqual({ flush: [], keep: [], drop: [id] });
        }
    });

    it("flushes an archived task whose completed_at is still null", () => {
        expect(partitionPendingFinalizes(["a"], null, { a: { ...tasks.a, archived: true } }))
            .toEqual({ flush: ["a"], keep: [], drop: [] });
    });

    it("deduplicates every partition in first-occurrence order without mutating inputs", () => {
        const pending = Object.freeze(["c", "z", "b", "a", "d", "c", "z", "b", "d", "a"]);
        const before = structuredClone({ timer: work, tasks });
        expect(partitionPendingFinalizes(pending, work, tasks))
            .toEqual({ flush: ["c", "b"], keep: ["a"], drop: ["z", "d"] });
        expect({ timer: work, tasks }).toEqual(before);
        expect(pending).toEqual(["c", "z", "b", "a", "d", "c", "z", "b", "d", "a"]);
    });
});
