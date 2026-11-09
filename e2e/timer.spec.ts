import { test, expect } from "@playwright/test";
import { baseState, backendState, defaultSettings, openApp, syncData, taskFixture } from "./helpers";

function switchFixtures(workMinutes = 25) {
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    const tasks = Object.fromEntries([a, b].map((id, index) => [id, {
        id, title: index === 0 ? "Switch task A" : "Switch task B", appTaskId: id,
        projectId: null, status: "Next", priority: "High", estimatePomos: 4,
        timeSpentMinutes: 0, workedPomos: 0, tags: [], links: [], checklist: [], relatedTo: [],
        sortOrder: index, isArchived: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }]));
    return { a, b, pm: { projects: {}, tasks }, seed: baseState({ active_task: a, tasks: {
        [a]: taskFixture(a, "Switch task A"), [b]: taskFixture(b, "Switch task B"),
    }, settings: { ...defaultSettings, work_minutes: workMinutes } }) };
}

test.describe("Timer workflows", () => {
    test("Switch hands the running window from A to B without changing persisted ends_at", async ({ browser }) => {
        const fixture = switchFixtures();
        const app = await openApp(browser, fixture.seed, fixture.pm);
        try {
            await app.page.clock.install({ time: new Date() });
            await app.page.goto("/");
            await app.page.getByRole("button", { name: "Start Focus" }).click();
            await expect(app.page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
            await syncData(app.page);
            const before = (await backendState(app)).timer!;
            await app.page.clock.fastForward(10_000);
            await app.page.getByRole("button", { name: "Switch", exact: true }).click();
            await app.page.getByRole("dialog", { name: "Switch task", exact: true }).getByRole("button", { name: /Switch task B/ }).click();
            await expect(app.page.getByRole("dialog", { name: "What were you doing in Switch task A?" })).toBeVisible();
            await app.page.keyboard.press("Escape");
            await expect(app.page.getByRole("dialog")).toHaveCount(0);
            await expect(app.page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
            await syncData(app.page);
            const after = (await backendState(app)).timer!;
            expect(after.task_id).toBe(fixture.b);
            expect(after.ends_at).toBe(before.ends_at);
            expect(after.paused).toBe(false);
        } finally { await app.cleanup(); }
    });

    test("Switch slices share one non-null work_window_id after natural completion (#179)", async ({ browser }) => {
        const fixture = switchFixtures(1);
        const app = await openApp(browser, fixture.seed, fixture.pm);
        try {
            await app.page.clock.install({ time: new Date() });
            await app.page.goto("/");
            await app.page.getByRole("button", { name: "Start Focus" }).click();
            await expect(app.page.getByRole("button", { name: "Switch", exact: true })).toBeVisible();
            await app.page.clock.fastForward(10_000);
            await app.page.getByRole("button", { name: "Switch", exact: true }).click();
            await app.page.getByRole("dialog").getByRole("button", { name: /Switch task B/ }).click();
            await expect(app.page.getByRole("dialog", { name: "What were you doing in Switch task A?" })).toBeVisible();
            await app.page.keyboard.press("Escape");
            await expect(app.page.getByRole("dialog")).toHaveCount(0);
            await app.page.clock.fastForward(51_000);
            await expect(app.page.getByText("SHORTBREAK", { exact: true })).toBeVisible();
            await syncData(app.page);
            const logs = (await backendState(app)).logs.filter((log) => !log.was_break);
            expect(logs).toHaveLength(2);
            expect(logs.map((log) => log.task_id).sort()).toEqual([fixture.a, fixture.b]);
            expect(logs[0].work_window_id).toBeTruthy();
            expect(logs[1].work_window_id).toBe(logs[0].work_window_id);
        } finally { await app.cleanup(); }
    });
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
        await expect(page.getByRole("dialog", { name: "What were you doing in Write the report?" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
        await page.getByRole("button", { name: "Resume" }).click();
        await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

        // Stop early, then verify a partial log was recorded.
        await page.waitForTimeout(1100);
        await page.getByRole("button", { name: "End focus" }).click();
        await expect(page.getByRole("dialog", { name: "What were you doing in Write the report?" })).toBeVisible();
        await page.keyboard.press("Escape");
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

    for (const target of [1, 4]) test(`auto-progresses an expired work timer into a break at target ${target}`, async ({ browser }) => {
        const seed = baseState({
            active_task: "t1",
            tasks: {
                t1: taskFixture("t1", "Quick task", { target_pomodoros: target }),
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
        await expect(page.getByRole("button", { name: "Retry Transition" })).toHaveCount(0);

        await syncData(page);

        const state = await backendState(app);
        expect(state.logs.some((l: any) => !l.was_break)).toBe(true);
        expect(state.timer?.kind).toBe("ShortBreak");
        expect(state.current_cycle_pomodoros).toBe(1);
        const task = Object.values(state.tasks)[0];
        expect(task.target_pomodoros).toBe(target);
        expect(task.completed_pomodoros).toBe(1);
        } finally { await app.cleanup(); }
    });
});
