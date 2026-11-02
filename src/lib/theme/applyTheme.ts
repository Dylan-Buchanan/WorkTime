import { THEME_COLOR_BY_RESOLVED_THEME, type ResolvedTheme } from "./themePreference";

/** The attribute `src/index.css` keys the light palette off of. */
export const THEME_ATTRIBUTE = "data-theme";

export const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';

/**
 * Applies a resolved theme to the document root. The same call runs from the
 * inline bootstrap in `index.html` (before first paint) and from the React
 * hook, so it must stay idempotent and side-effect free beyond the DOM.
 */
export function applyResolvedTheme(theme: ResolvedTheme, target?: Document): ResolvedTheme {
    const doc = target ?? (typeof document === "undefined" ? undefined : document);
    if (!doc) return theme;
    doc.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
    doc.querySelector(THEME_COLOR_META_SELECTOR)?.setAttribute("content", THEME_COLOR_BY_RESOLVED_THEME[theme]);
    return theme;
}
