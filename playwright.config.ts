import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 30000,
    fullyParallel: false,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: "http://localhost:1420",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run dev",
        url: "http://localhost:1420",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
