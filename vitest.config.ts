import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "virtual:pwa-register": fileURLToPath(new URL("./src/test/mockPwaRegister.ts", import.meta.url)),
        },
    },
    test: {
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.test.{ts,tsx}"],
        css: false,
        restoreMocks: true,
    },
});
