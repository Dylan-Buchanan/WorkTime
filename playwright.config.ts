import { defineConfig, devices } from "@playwright/test";
import { localSupabaseConfig } from "./tests/supabase/localSupabase";

const local = (() => {
    try {
        const config = localSupabaseConfig();
        process.env.TEST_SUPABASE_URL = config.url;
        process.env.TEST_SUPABASE_ANON_KEY = config.anonKey;
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY = config.serviceRoleKey;
        return config;
    } catch (error) {
        throw new Error(`Local Supabase is required for Playwright tests. Run npm run supabase:start first. ${error instanceof Error ? error.message : error}`);
    }
})();

export default defineConfig({
    testDir: "./e2e",
    timeout: 30000,
    fullyParallel: false,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: "http://localhost:3000",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            VITE_SUPABASE_URL: local.url,
            VITE_SUPABASE_ANON_KEY: local.anonKey,
        },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
