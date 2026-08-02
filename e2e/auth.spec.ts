import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseConfig } from "../tests/supabase/localSupabase";
import { openApp } from "./helpers";

test.describe("Authentication", () => {
    test("redirects an anonymous root visit to login", async ({ browser }) => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto("/");
            await expect(page).toHaveURL(/\/login$/);
        } finally {
            await context.close();
        }
    });

    test("shows invalid login for unknown credentials", async ({ browser }) => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto("/login");
            await page.getByLabel("Email").fill("missing@example.test");
            await page.getByLabel("Password").fill("wrong-password");
            await page.getByRole("button", { name: "Sign in", exact: true }).click();
            await expect(page.getByRole("alert")).toContainText("email or password is incorrect");
        } finally {
            await context.close();
        }
    });

    test("signs out an authenticated user", async ({ browser }) => {
        const app = await openApp(browser);
        try {
            await app.page.goto("/");
            await app.page.getByRole("button", { name: "Sign out" }).click();
            await expect(app.page).toHaveURL(/\/login$/);
        } finally {
            await app.cleanup();
        }
    });

    test("signs up with a valid invite and lands on timer", async ({ browser }) => {
        test.skip(!process.env.TEST_SIGNUP_INVITE_CODE, "Set TEST_SIGNUP_INVITE_CODE and serve invite-signup to run invite signup E2E");
        const config = localSupabaseConfig();
        const admin = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const email = `worktime-e2e-${Date.now()}@example.test`;
        const password = "WorkTime-test-123";
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            await page.goto("/signup");
            await page.getByLabel("Email").fill(email);
            await page.getByLabel("Password").fill(password);
            await page.getByLabel("Invite code").fill(process.env.TEST_SIGNUP_INVITE_CODE!);
            await page.getByRole("button", { name: "Create account" }).click();
            await expect(page.getByPlaceholder("Task name")).toBeVisible();
        } finally {
            const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
            if (!users.error) {
                const created = users.data.users.find((user) => user.email === email);
                if (created) await admin.auth.admin.deleteUser(created.id);
            }
            await context.close();
        }
    });
});
