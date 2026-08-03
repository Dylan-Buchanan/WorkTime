import { test, expect } from "@playwright/test";
import { backendPMState, openApp, syncData } from "./helpers";

test.describe("Project Manager", () => {
    test("create a project and add a task via quick add", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
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

        // PM changes stage immediately and reach Supabase only on explicit sync.
        await syncData(page);

        const pm = await backendPMState(app);
        const pmTask = Object.values(pm.tasks)[0] as any;
        expect(pmTask.title).toBe("Add auth flow");
        expect(pmTask.tags).toEqual(["security"]);
        expect(pmTask.priority).toBe("High");
        expect(pmTask.estimatePomos).toBe(3);
        } finally { await app.cleanup(); }
    });

    test("quick add to a missing project warns instead of creating", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
        page.on("dialog", (d) => d.accept());
        await page.goto("/projects");

        const quickAdd = page.getByPlaceholder("Quick add: Title @Project ^YYYY-MM-DD #tag !high");
        await quickAdd.fill("Orphan task @DoesNotExist");
        await quickAdd.press("Enter");

        // No task was created.
        await expect(page.getByText("Tasks: 0")).toBeVisible();
        } finally { await app.cleanup(); }
    });
});
