/**
 * Tailwind v4 does not load this file unless `src/index.css` declares
 * `@config "./tailwind.config.js"`, which this project does not do. The
 * class-based dark variant is declared in `src/index.css` with
 * `@custom-variant dark (...)`, keyed off the resolved `[data-theme]`
 * attribute. See `docs/theme.md` before changing theme behavior.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx,jsx,js}"],
    theme: {
        extend: {},
    },
    plugins: [],
};
