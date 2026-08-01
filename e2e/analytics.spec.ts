import { test, expect } from "@playwright/test";
import { baseState, openApp, taskFixture } from "./helpers";

// Timestamps a few hours in the past so date-range filters always include them.
function hoursAgo(hours: number) {
    return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

test.describe("Analytics", () => {
    test("renders metrics from seeded focus logs", async ({ browser }) => {
        const seed = baseState({
            tasks: {
                t1: taskFixture("t1", "Deep work"),
            },
            logs: [
                {
                    task_id: "t1",
                    duration_minutes: 25,
                    finished_at: hoursAgo(1),
                    was_break: false,
                    break_skipped: false,
                },
                {
                    task_id: "t1",
                    duration_minutes: 5,
                    finished_at: hoursAgo(1),
                    was_break: true,
                    break_skipped: false,
                },
                {
                    task_id: "t1",
                    duration_minutes: 25,
                    finished_at: hoursAgo(3),
                    was_break: false,
                    break_skipped: false,
                },
            ],
        });

        const context = await openApp(browser, seed);
        const page = await context.newPage();
        await page.goto("/analytics");

        // Overview cards: two work sessions in the current week, all completed.
        await expect(page.getByText("Completed Pomodoros")).toBeVisible();
        await expect(page.getByText("Today / 2 Wk", { exact: true })).toBeVisible();
        await expect(page.getByText("100%").first()).toBeVisible();

        // Weekly trend and quality panels render.
        await expect(page.getByText("Weekly Trend")).toBeVisible();
        await expect(page.getByText("Quality & Planning")).toBeVisible();
        await expect(page.getByText("Break Discipline")).toBeVisible();
    });
});
