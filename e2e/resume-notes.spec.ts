import { expect, test, type Page } from "@playwright/test";
import { baseState, openApp, taskFixture } from "./helpers";

const taskId = "00000000-0000-4000-8000-00000000000a";
const taskName = "Resume note task";
const nextAction = "Cover the parser error cases";
const seed = () => baseState({
    active_task: taskId,
    tasks: { [taskId]: taskFixture(taskId, taskName) },
});

async function savePausedMemo(page: Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "Start Focus" }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `What were you doing in ${taskName}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Where I am", exact: true }).fill("Parser draft is ready");
    const next = dialog.getByRole("textbox", { name: "Next action", exact: true });
    await next.fill(nextAction);
    await next.press("Enter");
    await expect(dialog).toHaveCount(0);
}

test.describe("Resume notes", () => {
    test("saves a pause memo with Enter and shows its next action on Resume", async ({ browser }) => {
        const app = await openApp(browser, seed());
        try {
            await savePausedMemo(app.page);
            await app.page.getByRole("button", { name: "Resume", exact: true }).click();
            await expect(app.page.getByRole("region", { name: `Resume ${taskName}`, exact: true })).toContainText(nextAction);
        } finally { await app.cleanup(); }
    });

    test("keeps a saved memo hidden after reload until the next Resume", async ({ browser }) => {
        const app = await openApp(browser, seed());
        try {
            await savePausedMemo(app.page);
            await app.page.reload();
            await expect(app.page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
            const card = app.page.getByRole("region", { name: `Resume ${taskName}`, exact: true });
            await expect(card).toHaveCount(0);
            await app.page.getByRole("button", { name: "Resume", exact: true }).click();
            await expect(card).toContainText(nextAction);
        } finally { await app.cleanup(); }
    });
});
