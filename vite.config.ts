import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readPublicAppEnv } from "./src/lib/supabaseEnv.ts";

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    readPublicAppEnv(env, { requirePublicAppUrl: command === "build" && mode === "production" });
    const host = process.env.TAURI_DEV_HOST;

    return {
        base: "/",
        build: {
            rolldownOptions: {
                output: {
                    // Split the largest vendor dependencies out of the entry
                    // chunk so no single chunk grows past the 500 kB warning
                    // limit. Groups are matched in order; first match wins.
                    codeSplitting: {
                        groups: [
                            { name: "supabase", test: /[\\/]node_modules[\\/]@supabase[\\/]/ },
                            { name: "react-vendor", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
                        ],
                    },
                },
            },
        },
        plugins: [
            react(),
            VitePWA({
                registerType: "autoUpdate",
                manifest: {
                    name: "WorkTime",
                    short_name: "WorkTime",
                    start_url: "/",
                    display: "standalone",
                    theme_color: "#0a0a0a",
                    background_color: "#171717",
                    icons: [
                        { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                        { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                    ],
                },
                workbox: {
                    globPatterns: ["**/*.{html,js,css,png,svg,ico,mp3}"],
                },
            }),
        ],

        // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
        //
        // 1. prevent Vite from obscuring rust errors
        clearScreen: false,
        // 2. tauri expects a fixed port, fail if that port is not available
        server: {
            port: 3000,
            strictPort: true,
            host: host || false,
            hmr: host
                ? {
                      protocol: "ws",
                      host,
                      port: 1421,
                  }
                : undefined,
            watch: {
                // 3. tell Vite to ignore watching `src-tauri`
                ignored: ["**/src-tauri/**"],
            },
        },
    };
});
