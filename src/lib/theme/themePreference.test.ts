import { describe, expect, it, vi } from "vitest";
import {
    DEFAULT_THEME_PREFERENCE,
    THEME_COLOR_BY_RESOLVED_THEME,
    THEME_PREFERENCE_STORAGE_KEY,
    applyResolvedTheme,
    clearThemePreference,
    createThemePreferenceStore,
    getThemePreference,
    isThemePreference,
    resolveTheme,
    setThemePreference,
    subscribeToThemePreference,
} from ".";

type FakeStorage = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

function createFakeStorage(seed: Record<string, string> = {}): FakeStorage & { values: Map<string, string> } {
    const values = new Map(Object.entries(seed));
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
    };
}

describe("surface-local theme preference", () => {
    it("defaults to Dark when nothing is stored", () => {
        expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
        expect(getThemePreference(createFakeStorage())).toBe("dark");
        expect(getThemePreference(undefined)).toBe("dark");
    });

    it("round-trips every supported preference", () => {
        const storage = createFakeStorage();
        for (const preference of ["light", "dark", "system"] as const) {
            expect(setThemePreference(preference, storage)).toBe(preference);
            expect(storage.values.get(THEME_PREFERENCE_STORAGE_KEY)).toBe(preference);
            expect(getThemePreference(storage)).toBe(preference);
        }
    });

    it("falls back to Dark for invalid or corrupt stored values", () => {
        for (const corrupt of ["", "Light", "auto", "system ", "true"]) {
            const storage = createFakeStorage({ [THEME_PREFERENCE_STORAGE_KEY]: corrupt });
            expect(getThemePreference(storage)).toBe("dark");
        }
        expect(isThemePreference("light")).toBe(true);
        expect(isThemePreference("system")).toBe(true);
        expect(isThemePreference(null)).toBe(false);
    });

    it("survives a storage that throws on read or write", () => {
        const throwing: FakeStorage = {
            getItem: () => { throw new Error("blocked"); },
            setItem: () => { throw new Error("quota exceeded"); },
            removeItem: () => { throw new Error("blocked"); },
        };
        expect(getThemePreference(throwing)).toBe("dark");
        expect(setThemePreference("light", throwing)).toBe("light");
        expect(clearThemePreference(throwing)).toBe("dark");
    });

    it("clears back to the Dark default", () => {
        const storage = createFakeStorage({ [THEME_PREFERENCE_STORAGE_KEY]: "light" });
        expect(clearThemePreference(storage)).toBe("dark");
        expect(storage.values.has(THEME_PREFERENCE_STORAGE_KEY)).toBe(false);
        expect(getThemePreference(storage)).toBe("dark");
    });

    it("rejects values outside the supported set", () => {
        expect(() => setThemePreference("sepia" as never, createFakeStorage())).toThrow(/Unsupported theme preference/);
    });

    it("notifies subscribers on set and clear until they unsubscribe", () => {
        const storage = createFakeStorage();
        const listener = vi.fn();
        const unsubscribe = subscribeToThemePreference(listener);

        setThemePreference("light", storage);
        setThemePreference("system", storage);
        clearThemePreference(storage);

        expect(listener.mock.calls).toEqual([["light"], ["system"], ["dark"]]);

        unsubscribe();
        setThemePreference("light", storage);
        expect(listener).toHaveBeenCalledTimes(3);
    });
});

describe("createThemePreferenceStore", () => {
    it("keeps an isolated store in sync with its storage", () => {
        const storage = createFakeStorage();
        const store = createThemePreferenceStore(storage);
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        expect(store.get()).toBe("dark");
        expect(store.set("light")).toBe("light");
        expect(storage.values.get(THEME_PREFERENCE_STORAGE_KEY)).toBe("light");
        expect(store.get()).toBe("light");

        expect(store.clear()).toBe("dark");
        expect(storage.values.has(THEME_PREFERENCE_STORAGE_KEY)).toBe(false);
        expect(listener.mock.calls).toEqual([["light"], ["dark"]]);

        unsubscribe();
        store.set("system");
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("seeds from an existing stored value and rejects unknown values", () => {
        const storage = createFakeStorage({ [THEME_PREFERENCE_STORAGE_KEY]: "system" });
        const store = createThemePreferenceStore(storage);
        expect(store.get()).toBe("system");
        expect(() => store.set("sepia" as never)).toThrow(/Unsupported theme preference/);
    });
});

describe("resolveTheme", () => {
    it("resolves System from the OS preference and passes explicit choices through", () => {
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
    });
});

describe("applyResolvedTheme", () => {
    function createDocument(): Document {
        const doc = document.implementation.createHTMLDocument("theme-test");
        const meta = doc.createElement("meta");
        meta.setAttribute("name", "theme-color");
        meta.setAttribute("content", THEME_COLOR_BY_RESOLVED_THEME.dark);
        doc.head.appendChild(meta);
        return doc;
    }

    it("writes the resolved theme to the document root and the theme-color meta", () => {
        const doc = createDocument();

        expect(applyResolvedTheme("light", doc)).toBe("light");
        expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
        expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#fafafa");

        applyResolvedTheme("dark", doc);
        expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
        expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#0a0a0a");
    });

    it("is idempotent and tolerates a document without the meta tag", () => {
        const doc = document.implementation.createHTMLDocument("theme-test");
        expect(() => applyResolvedTheme("light", doc)).not.toThrow();
        applyResolvedTheme("light", doc);
        expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
    });
});
