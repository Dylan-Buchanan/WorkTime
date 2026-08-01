import { test, expect } from "@playwright/test";
import { openApp } from "./helpers";

test.describe("Project Manager", () => {
    test("create a project and add a task via quick add", async ({ browser }) => {
        const context = await openApp(browser);
        const page = await context.newPage();
        await page.goto("/projects");

        // Create a project.
        await page.getByRole("button", { name: "New Project" }).click();
        await page.getByPlaceholder("Project name").fill("Backend");
        await page.getByRole("button", { name: "Create Project" }).click();
        await expect(page.getByText("Backend", { exact: true }).first()).toBeVisible();

        // Quick-add a task to that project.
        const quickAdd = page.getByPlaceholder("Quick add: Title @Project ^YYYY-MM-DD #tag !high");
        await quickAdd.fill("Add auth flow @Backend #security !high 3p");
        await quickAdd.press("Enter");

        await expect(page.getByText("Add auth flow", { exact: true }).first()).toBeVisible();

        // Debug footer confirms counts.
        await expect(page.getByText("Projects: 2")).toBeVisible();
        await expect(page.getByText("Tasks: 1")).toBeVisible();

        // PM state is persisted to the mock backend (debounced, so poll for it).
        await expect
            .poll(async () => {
                const pm = await page.evaluate(() => window.__TEST_BACKEND__!.getPMState());
                return pm ? Object.keys(pm.tasks).length : 0;
            }, { timeout: 5000 })
            .toBe(1);

        const pm = await page.evaluate(() => window.__TEST_BACKEND__!.getPMState());
        const pmTask = Object.values(pm.tasks)[0] as any;
        expect(pmTask.title).toBe("Add auth flow");
        expect(pmTask.tags).toEqual(["security"]);
        expect(pmTask.priority).toBe("High");
        expect(pmTask.estimatePomos).toBe(3);
    });

    test("quick add to a missing project warns instead of creating", async ({ browser }) => {
        const context = await openApp(browser);
        const page = await context.newPage();
        page.on("dialog", (d) => d.accept());
        await page.goto("/projects");

        const quickAdd = page.getByPlaceholder("Quick add: Title @Project ^YYYY-MM-DD #tag !high");
        await quickAdd.fill("Orphan task @DoesNotExist");
        await quickAdd.press("Enter");

        // No task was created.
        await expect(page.getByText("Tasks: 0")).toBeVisible();
    });
});
