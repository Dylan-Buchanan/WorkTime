import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const MOBILE_VIEWPORT = { width: 375, height: 700 };

async function expectNoHorizontalOverflow(page: Page) {
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "horizontal page overflow detected").toBeLessThanOrEqual(0);
}

test.describe("Responsive layout", () => {
    test("timer route avoids overflow and opens the tasks/settings drawer", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: MOBILE_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/");
            await expect(page.getByRole("button", { name: "Tasks & Settings" })).toBeVisible();
            await expectNoHorizontalOverflow(page);

            await page.getByRole("button", { name: "Tasks & Settings" }).click();
            await expect(page.getByPlaceholder("Task name")).toBeVisible();
            await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();

            await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
            await expect(page.getByPlaceholder("Task name")).toBeHidden();
        } finally {
            await app.cleanup();
        }
    });

    test("timer task details panel overlays instead of pushing the timer", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: MOBILE_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/");
            await page.getByRole("button", { name: "Tasks & Settings" }).click();
            await page.getByPlaceholder("Task name").fill("Mobile task");
            await page.getByRole("button", { name: "Add", exact: true }).click();
            await expect(page.getByText("Mobile task (0/4)")).toBeVisible();
            await page.getByText("Mobile task (0/4)").click();
            await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

            await page.getByRole("button", { name: "Task Details" }).click();
            const details = page.locator("#timer-task-details-panel");
            await expect(details).toBeVisible();
            await expectNoHorizontalOverflow(page);
        } finally {
            await app.cleanup();
        }
    });

    test("projects route avoids overflow and exposes sidebar and inspector drawers", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: MOBILE_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/projects");
            await expect(page.getByRole("button", { name: "Projects", exact: true })).toBeVisible();
            await expectNoHorizontalOverflow(page);

            await page.getByRole("button", { name: "Projects", exact: true }).click();
            const dialog = page.getByRole("dialog", { name: "Projects" });
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole("button", { name: "New Project" }).first()).toBeVisible();

            await dialog.getByRole("button", { name: "New Project" }).first().click();
            await dialog.getByPlaceholder("Project name").fill("Mobile Project");
            await dialog.getByRole("button", { name: "Create Project" }).click();
            await expect(dialog).toBeHidden();

            const quickAdd = page.getByPlaceholder("Quick add: Title @Project ^YYYY-MM-DD #tag !high");
            await quickAdd.fill("Drawer task @Mobile Project 2p");
            await quickAdd.press("Enter");
            await expect(page.getByText("Drawer task", { exact: true }).first()).toBeVisible();

            const inspector = page.getByRole("dialog", { name: "Task details" });
            await expect(inspector).toBeVisible();
            await expectNoHorizontalOverflow(page);
            await inspector.getByRole("button", { name: "Close" }).click();
            await expect(inspector).toBeHidden();

            await page.getByRole("button", { name: "Task details" }).click();
            await expect(inspector).toBeVisible();
        } finally {
            await app.cleanup();
        }
    });

    test("analytics and habits routes avoid overflow on narrow widths", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: MOBILE_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/analytics");
            await expect(page.getByText("Overview")).toBeVisible();
            await expectNoHorizontalOverflow(page);

            await page.goto("/habits");
            await expect(page.getByRole("button", { name: "Add habit" }).first()).toBeVisible();
            await expectNoHorizontalOverflow(page);
        } finally {
            await app.cleanup();
        }
    });

    test("top navigation keeps every destination reachable on narrow widths", async ({ browser }) => {
        const app = await openApp(browser, undefined, undefined, { viewport: MOBILE_VIEWPORT });
        const page = app.page;
        try {
            await page.goto("/");
            for (const destination of ["Timer", "Projects", "Analytics", "Habits"]) {
                const link = page.getByRole("link", { name: destination });
                await expect(link).toBeVisible();
                const box = await link.boundingBox();
                expect(box, `${destination} link is off-screen`).not.toBeNull();
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
            }
            await expect(page.getByRole("button", { name: /Sync data/ })).toBeVisible();
        } finally {
            await app.cleanup();
        }
    });
});
