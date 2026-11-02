import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemePreference } from "./useThemePreference";
import { THEME_PREFERENCE_STORAGE_KEY } from "../lib/theme";

interface ControllableMediaQuery {
    setMatches(next: boolean): void;
    listenerCount(): number;
}

/** Replaces window.matchMedia with one list we can flip from the test. */
function installMatchMedia(initialMatches: boolean): ControllableMediaQuery {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let matches = initialMatches;
    const list = {
        get matches() {
            return matches;
        },
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.delete(listener);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
            listeners.add(listener);
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
            listeners.delete(listener);
        },
        dispatchEvent: () => false,
    };
    window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
    return {
        setMatches(next) {
            matches = next;
            listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
        },
        listenerCount: () => listeners.size,
    };
}

const ThemeProbe: React.FC = () => {
    const { preference, resolvedTheme, setPreference } = useThemePreference();
    return (
        <div>
            <span data-testid="preference">{preference}</span>
            <span data-testid="resolved">{resolvedTheme}</span>
            <button type="button" onClick={() => setPreference("light")}>Use light</button>
            <button type="button" onClick={() => setPreference("system")}>Use system</button>
            <button type="button" onClick={() => setPreference("dark")}>Use dark</button>
        </div>
    );
};

beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
});

describe("useThemePreference", () => {
    it("applies Dark at the document root on startup when nothing is stored", () => {
        installMatchMedia(true);
        render(<ThemeProbe />);

        expect(screen.getByTestId("preference")).toHaveTextContent("dark");
        expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
        expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    it("applies a stored Light preference on mount", () => {
        installMatchMedia(true);
        localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "light");
        render(<ThemeProbe />);

        expect(screen.getByTestId("preference")).toHaveTextContent("light");
        expect(document.documentElement).toHaveAttribute("data-theme", "light");
    });

    it("persists a selection and flips the document root immediately", () => {
        installMatchMedia(true);
        render(<ThemeProbe />);

        act(() => screen.getByRole("button", { name: "Use light" }).click());

        expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("light");
        expect(screen.getByTestId("preference")).toHaveTextContent("light");
        expect(document.documentElement).toHaveAttribute("data-theme", "light");

        act(() => screen.getByRole("button", { name: "Use dark" }).click());
        expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    it("resolves System against the OS preference and follows it live", () => {
        const media = installMatchMedia(true);
        localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, "system");
        render(<ThemeProbe />);

        expect(screen.getByTestId("preference")).toHaveTextContent("system");
        expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
        expect(document.documentElement).toHaveAttribute("data-theme", "dark");

        act(() => media.setMatches(false));

        expect(screen.getByTestId("resolved")).toHaveTextContent("light");
        expect(document.documentElement).toHaveAttribute("data-theme", "light");

        act(() => media.setMatches(true));
        expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    it("switching to System resolves the stored OS preference without a reload", () => {
        installMatchMedia(false);
        render(<ThemeProbe />);
        expect(document.documentElement).toHaveAttribute("data-theme", "dark");

        act(() => screen.getByRole("button", { name: "Use system" }).click());

        expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe("system");
        expect(screen.getByTestId("resolved")).toHaveTextContent("light");
        expect(document.documentElement).toHaveAttribute("data-theme", "light");
    });

    it("stops following the OS media query after unmount", () => {
        const media = installMatchMedia(true);
        const view = render(<ThemeProbe />);
        expect(media.listenerCount()).toBe(1);

        view.unmount();
        expect(media.listenerCount()).toBe(0);
    });
});
