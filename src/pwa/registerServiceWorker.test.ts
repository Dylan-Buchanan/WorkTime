import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { registerSW } from "virtual:pwa-register";
import { clearTauriPwaState, registerServiceWorker } from "./registerServiceWorker";

vi.mock("virtual:pwa-register", () => ({ registerSW: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));

describe("registerServiceWorker", () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.mocked(isTauri).mockReturnValue(false);
        vi.mocked(registerSW).mockReset();
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    });

    it("ignores environments without service-worker support", () => {
        registerServiceWorker();
        expect(registerSW).not.toHaveBeenCalled();
    });

    it("swallows synchronous registration failures in webviews", () => {
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
        vi.mocked(registerSW).mockImplementation(() => { throw new Error("unsupported webview"); });
        expect(() => registerServiceWorker()).not.toThrow();
    });

    it("does not register a PWA service worker inside Tauri", () => {
        vi.mocked(isTauri).mockReturnValue(true);
        Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });

        registerServiceWorker();

        expect(registerSW).not.toHaveBeenCalled();
    });

    it("removes stale service workers and caches from the Tauri webview", async () => {
        const unregister = vi.fn().mockResolvedValue(true);
        const deleteCache = vi.fn().mockResolvedValue(true);
        Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            value: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
        });
        vi.stubGlobal("caches", {
            keys: vi.fn().mockResolvedValue(["workbox-old-build"]),
            delete: deleteCache,
        });

        await clearTauriPwaState();

        expect(unregister).toHaveBeenCalledOnce();
        expect(deleteCache).toHaveBeenCalledWith("workbox-old-build");
    });
});
