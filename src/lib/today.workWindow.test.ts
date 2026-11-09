import { describe, expect, it } from "vitest";
import type { PomodoroLogEntry } from "../state/types";
import { buildTodayPomodoros } from "./today";

// Local dates keep the Today boundary independent of the test runner's timezone.
const reference = new Date(2026, 10, 8, 12);
const windowId = new Date(2026, 10, 8, 9).toISOString();
const log = (id: string, duration: number, day = 8, wasBreak = false, skipped = false): PomodoroLogEntry => ({
    id, task_id: "task", duration_minutes: duration, finished_at: new Date(2026, 10, day, 10).toISOString(),
    was_break: wasBreak, break_skipped: skipped,
});

describe("Today work-window identity compatibility", () => {
    it("keeps counts, minutes and sessions identical with or without window ids", () => {
        const logs = [log("slice-a", 5), log("slice-b", 20), log("stop", 2.5),
            log("break", 5, 8, true), log("skip", 0, 8, true, true), log("yesterday", 25, 7)];
        const legacy = buildTodayPomodoros({ logs, reference });
        const stamped = buildTodayPomodoros({
            logs: logs.map((entry) => ({ ...entry, work_window_id: entry.was_break ? null : windowId })), reference,
        });
        expect(legacy.count).toBe(3);
        expect(legacy.minutes).toBe(27.5);
        expect(stamped).toEqual(legacy);
    });
});
