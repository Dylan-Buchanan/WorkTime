/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

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
