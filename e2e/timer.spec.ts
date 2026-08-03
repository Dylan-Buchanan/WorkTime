import { test, expect } from "@playwright/test";
import { baseState, backendState, openApp, syncData, taskFixture } from "./helpers";

test.describe("Timer workflows", () => {
    test("create a task and run a full focus/stop cycle", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
        await page.goto("/");

        // Quick-add a task via the sidebar panel.
        await page.getByPlaceholder("Task name").fill("Write the report");
        await page.getByPlaceholder("Task name").press("Tab");
        await page.keyboard.type("4");
        await page.getByRole("button", { name: "Add", exact: true }).click();

        await expect(page.getByText("Write the report (0/4)")).toBeVisible();

        // Start focus (auto-selects the only task).
        await page.getByRole("button", { name: "Start Focus" }).click();

        // The timer should display a countdown and a Pause button.
        await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
        await expect(page.getByText(/^\d{2}:\d{2}$/)).toBeVisible();

        // Pause / resume.
        await page.getByRole("button", { name: "Pause" }).click();
        await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
        await page.getByRole("button", { name: "Resume" }).click();
        await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

        // Stop early, then verify a partial log was recorded.
        await page.waitForTimeout(1100);
        await page.getByRole("button", { name: "Stop Early" }).click();
        await expect(page.getByRole("button", { name: "Start Focus" })).toBeVisible();

        await syncData(page);

        const state = await backendState(app);
        expect(state.timer).toBeNull();
        const workLog = state.logs.find((l: any) => !l.was_break);
        expect(workLog).toBeTruthy();
        const task = Object.values(state.tasks)[0] as any;
        expect(task.name).toBe("Write the report");
        expect(task.completed_pomodoros).toBeGreaterThan(0);
        } finally { await app.cleanup(); }
    });

    test("auto-progresses an expired work timer into a break", async ({ browser }) => {
        const seed = baseState({
            active_task: "t1",
            tasks: {
                t1: taskFixture("t1", "Quick task"),
            },
            timer: {
                task_id: "t1",
                started_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
                ends_at: new Date(Date.now() + 1000).toISOString(),
                kind: "Work",
                paused: false,
                paused_remaining_secs: 0,
                planned_secs: 25 * 60,
                accumulated_secs: 0,
            },
        });

        const app = await openApp(browser, seed);
        const page = app.page;
        try {
        await page.goto("/");

        // When the seeded timer ends, the app auto-completes it and starts a break.
        await expect(page.getByText("SHORTBREAK")).toBeVisible({ timeout: 15000 });

        await syncData(page);

        const state = await backendState(app);
        expect(state.logs.some((l: any) => !l.was_break)).toBe(true);
        expect(state.timer?.kind).toBe("ShortBreak");
        expect(state.current_cycle_pomodoros).toBe(1);
        } finally { await app.cleanup(); }
    });
});
