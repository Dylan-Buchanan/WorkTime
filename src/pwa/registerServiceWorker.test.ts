import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSW } from "virtual:pwa-register";
import { registerServiceWorker } from "./registerServiceWorker";

vi.mock("virtual:pwa-register", () => ({ registerSW: vi.fn() }));

describe("registerServiceWorker", () => {
    beforeEach(() => {
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
});
