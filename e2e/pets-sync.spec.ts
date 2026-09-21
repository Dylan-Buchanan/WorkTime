import { expect, test } from "@playwright/test";
import { backendPetState, openApp, syncData } from "./helpers";

test.describe("Pet persistence", () => {
    test("syncs an onboarded profile and activity record", async ({ browser }) => {
        const app = await openApp(browser);
        const page = app.page;
        try {
            await page.goto("/pet");
            await expect(page.getByRole("heading", { name: "When was your puppy born?" })).toBeVisible();

            await page.getByLabel("Name").fill("Mochi");
            await page.getByLabel("Birth date").fill("2026-03-14");
            await page.getByRole("button", { name: "Save profile" }).click();
            await expect(page.getByRole("heading", { name: "Add your first schedule items" })).toBeVisible();

            await page.getByRole("button", { name: /Potty$/ }).click();
            await expect(page.getByText("Logged potty")).toBeVisible();
            await syncData(page);

            const remote = await backendPetState(app);
            expect(remote.profile).toMatchObject({ name: "Mochi", birthDate: "2026-03-14" });
            expect(Object.values(remote.activities)).toHaveLength(1);
            expect(Object.values(remote.activities)[0]).toMatchObject({ activityType: "potty" });
        } finally {
            await app.cleanup();
        }
    });
});
