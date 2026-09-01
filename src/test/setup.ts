import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
    cleanup();
});

// jsdom does not implement matchMedia; recharts/others touch it during render.
if (typeof window !== "undefined" && !window.matchMedia) {
    (window as any).matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}

// HTMLAudioElement is not implemented in jsdom; useSounds instantiates it eagerly.
// Force-replace it (jsdom ships a partial Audio whose play() returns undefined).
class MockAudio {
    preload: string = "auto";
    currentTime = 0;
    play() {
        return Promise.resolve();
    }
    pause() {}
}
(window as any).Audio = MockAudio;

// Clean up any leftover state between tests.
afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});
