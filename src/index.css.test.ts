/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

function ruleBlock(selectorPattern: RegExp): string {
    const match = css.match(selectorPattern);
    if (!match) throw new Error(`Missing CSS block for ${selectorPattern}`);
    return match[0];
}

const lightBlock = ruleBlock(/\[data-theme="light"\]\s*\{[\s\S]*?\n\}/);
const staticBlock = ruleBlock(/\.theme-static\s*\{[\s\S]*?\n\}/);

describe("global number input styling", () => {
    it("hides the WebKit spin button chrome", () => {
        expect(css).toMatch(
            /input\[type="number"\]::-webkit-inner-spin-button,\s*input\[type="number"\]::-webkit-outer-spin-button\s*\{[^}]*appearance:\s*none[^}]*\}/,
        );
    });

    it("uses the textfield appearance for Firefox", () => {
        expect(css).toMatch(/input\[type="number"\]\s*\{[^}]*appearance:\s*textfield[^}]*\}/);
    });
});

describe("theme layer", () => {
    it("wires class-based dark variants to the resolved theme attribute", () => {
        expect(css).toMatch(/@custom-variant dark \(&:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\)\);/);
    });

    it("declares a color-scheme for both themes so native controls follow", () => {
        expect(css).toMatch(/:root,\s*\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/);
        expect(lightBlock).toContain("color-scheme: light");
    });

    it("mirrors the whole neutral surface ramp in light mode", () => {
        for (const step of [50, 100, 200, 300, 400, 600, 700, 800, 900, 950]) {
            expect(lightBlock).toContain(`--color-neutral-${step}:`);
        }
        // The canvas becomes the lightest surface and the strongest foreground
        // becomes the darkest one.
        expect(lightBlock).toContain("--color-neutral-950: oklch(98.5% 0 none)");
        expect(lightBlock).toContain("--color-neutral-50: oklch(14.5% 0 none)");
        expect(lightBlock).toContain("--color-neutral-100: oklch(20.5% 0 none)");
        expect(lightBlock).toContain("--color-neutral-900: oklch(97% 0 none)");
    });

    it("mirrors accent tints and deep chips while keeping solid fills absolute", () => {
        for (const hue of ["emerald", "amber", "red", "indigo", "sky", "violet", "rose", "green", "yellow", "fuchsia"]) {
            for (const step of [100, 200, 300, 400, 900, 950]) {
                expect(lightBlock).toContain(`--color-${hue}-${step}:`);
            }
            for (const step of [50, 500, 600, 700, 800]) {
                expect(lightBlock).not.toContain(`--color-${hue}-${step}:`);
            }
        }
        // A deep chip becomes a pale chip, and its light label becomes dark.
        expect(lightBlock).toContain("--color-emerald-950: oklch(97.9% 0.021 166.113)");
        expect(lightBlock).toContain("--color-emerald-200: oklch(43.2% 0.095 166.913)");
    });

    it("restores the absolute palette for artifact-fixed content", () => {
        expect(staticBlock).toContain("--color-neutral-950: oklch(14.5% 0 none)");
        expect(staticBlock).toContain("--color-neutral-50: oklch(98.5% 0 none)");
        expect(staticBlock).toContain("--color-emerald-950: oklch(26.2% 0.051 172.552)");
    });

    it("keeps the document canvas and scrollbars on theme-relative variables", () => {
        expect(css).toMatch(/html\s*\{\s*@apply bg-neutral-950;/);
        expect(css).toMatch(/body\s*\{\s*@apply bg-neutral-900 text-neutral-200/);
        expect(css).toContain("var(--color-neutral-600)");
        expect(css).toContain("var(--color-neutral-950)");
    });
});

describe("theme bootstrap in index.html", () => {
    it("defaults the document root to Dark", () => {
        expect(html).toMatch(/<html[^>]*data-theme="dark"/);
    });

    it("applies the stored preference before the app module loads", () => {
        expect(html).toContain("worktime:theme:v1");
        expect(html).toContain('document.documentElement.setAttribute("data-theme", theme)');
        expect(html).toContain("(prefers-color-scheme: dark)");
        expect(html.indexOf("worktime:theme:v1")).toBeLessThan(html.indexOf("/src/main.tsx"));
    });

    it("keeps the static dark browser chrome defaults", () => {
        expect(html).toContain('<meta name="theme-color" content="#0a0a0a" />');
        expect(html).toContain("apple-mobile-web-app-capable");
    });
});
