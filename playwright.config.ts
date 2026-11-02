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
    // Bound concurrent browsers and cold Vite route transforms on local Windows runs.
    workers: 2,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: "http://127.0.0.1:3001",
        trace: "retain-on-failure",
    },
    webServer: {
        // Own the server so an open development app cannot supply a stale build
        // or a different Supabase environment. Bind the same address we test.
        command: "pnpm run dev --host 127.0.0.1 --port 3001 --strictPort",
        url: "http://127.0.0.1:3001",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            VITE_SUPABASE_URL: local.url,
            VITE_SUPABASE_ANON_KEY: local.anonKey,
        },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
