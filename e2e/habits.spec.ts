import { expect, test } from "@playwright/test";
import { backendHabitState, openApp, syncData } from "./helpers";

test.describe("Habits", () => {
    test("creates, checks, switches periods, and expands a habit", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
            await page.goto("/habits");

            await page.getByRole("button", { name: "Add habit" }).first().click();
            await page.getByLabel("Name").fill("Morning run");
            await page.getByLabel("Description").fill("Start the day outside");
            await page.getByLabel("Frequency").selectOption("daily");
            await page.getByRole("button", { name: "Create habit" }).click();

            const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Morning run" }) });
            await expect(card).toContainText("daily");

            const today = card.getByRole("button", { name: /today, not completed/ });
            await today.click();
            await expect(card.getByRole("button", { name: /today, completed/ })).toHaveAttribute("aria-pressed", "true");
            await syncData(page);

            let remote = await backendHabitState(app);
            const created = Object.values(remote.habits).find((habit) => habit.name === "Morning run");
            expect(created).toBeDefined();
            expect(created).toMatchObject({ name: "Morning run", description: "Start the day outside", frequency: "daily", position: 0, isArchived: false });
            expect(Object.values(remote.completions)).toHaveLength(1);
            expect(Object.values(remote.completions)[0].habitId).toBe(created!.id);

            await card.getByRole("button", { name: /today, completed/ }).click();
            await expect(card.getByRole("button", { name: /today, not completed/ })).toHaveAttribute("aria-pressed", "false");
            await syncData(page);
            remote = await backendHabitState(app);
            expect(Object.values(remote.completions)).toHaveLength(0);

            const period = page.getByLabel("Habit period");
            await period.getByRole("button", { name: "Day", exact: true }).click();
            await expect(period.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
            await expect(page.getByLabel("Morning run day completion cells")).toBeVisible();
            await period.getByRole("button", { name: "Month", exact: true }).click();
            await expect(period.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
            await expect(page.getByLabel("Morning run month completion cells")).toBeVisible();
            await period.getByRole("button", { name: "Year", exact: true }).click();
            await expect(period.getByRole("button", { name: "Year", exact: true })).toHaveAttribute("aria-pressed", "true");

            await page.getByRole("button", { name: "Expand Morning run 365 details" }).click();
            const grid = page.getByLabel("Morning run daily 365 completion grid");
            await expect(grid).toBeVisible();
            await expect(grid.getByRole("button")).toHaveCount(365);
            await expect(page.getByRole("button", { name: "Collapse Morning run 365 details" })).toHaveAttribute("aria-expanded", "true");
        } finally {
            await app.cleanup();
        }
    });

    test("reorders habits and persists their positions", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
            await page.goto("/habits");

            for (const name of ["First habit", "Second habit"]) {
                await page.getByRole("button", { name: "Add habit" }).first().click();
                await page.getByLabel("Name").fill(name);
                await page.getByRole("button", { name: "Create habit" }).click();
                await expect(page.getByRole("heading", { name })).toBeVisible();
            }

            const cards = page.locator("article");
            const firstHandle = page.getByRole("button", { name: "Drag First habit to reorder" });
            const target = cards.nth(1);
            const sourceBox = await firstHandle.boundingBox();
            const targetBox = await target.boundingBox();
            expect(sourceBox).not.toBeNull();
            expect(targetBox).not.toBeNull();
            await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
            await page.mouse.down();
            await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + sourceBox!.height / 2 + 12, { steps: 4 });
            await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height * 0.75, { steps: 20 });
            await page.mouse.up();

            await expect(cards.nth(0).getByRole("heading")).toHaveText("Second habit");
            await expect(cards.nth(1).getByRole("heading")).toHaveText("First habit");
            await syncData(page);

            const remote = await backendHabitState(app);
            const byName = Object.fromEntries(Object.values(remote.habits).map((habit) => [habit.name, habit]));
            expect(byName["Second habit"].position).toBe(0);
            expect(byName["First habit"].position).toBe(1);
        } finally {
            await app.cleanup();
        }
    });
});
