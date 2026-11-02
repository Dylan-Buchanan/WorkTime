import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckSeries } from "./types";
import { buildSeriesSvg, rasterizeSvgToPng } from "./chart";

const series: DeckSeries = {
    goalId: "goal", goalTitle: "Ship", kind: "status", label: "Status", unit: "",
    current: null, target: null,
    points: [{ periodStart: "2026-10-04", value: 0 }, { periodStart: "2026-10-18", value: 2 }],
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("buildSeriesSvg", () => {
    it("preserves the exact status-series SVG markup and coordinates", () => {
        expect(buildSeriesSvg(series)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="360" viewBox="0 0 1000 360"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="Arial, sans-serif" font-size="22" fill="#1e293b"><text x="145" y="32">Status</text><line x1="145" x2="935" y1="270" y2="270" stroke="#cbd5e1"/><text x="130" y="277" text-anchor="end">Blocked</text><line x1="145" x2="935" y1="170" y2="170" stroke="#cbd5e1"/><text x="130" y="177" text-anchor="end">At risk</text><line x1="145" x2="935" y1="70" y2="70" stroke="#cbd5e1"/><text x="130" y="77" text-anchor="end">On track</text><polyline points="145,270 935,70" fill="none" stroke="#1d4ed8" stroke-width="4"/><circle cx="145" cy="270" r="6" fill="#1d4ed8"><title>2026-10-04: 0</title></circle><text x="145" y="315" text-anchor="middle" font-size="18">2026-10-04</text><circle cx="935" cy="70" r="6" fill="#1d4ed8"><title>2026-10-18: 2</title></circle><text x="935" y="315" text-anchor="middle" font-size="18">2026-10-18</text></g></svg>');
    });

    it.each([
        { values: [3, 3], target: 3, ticks: ["0", "3"], targetY: 70 },
        { values: [0, 0], target: 0, ticks: ["0", "1"], targetY: 270 },
        { values: [1, 2], target: 1000, ticks: ["0", "1000"], targetY: 70 },
        { values: [1, 5], target: 3, ticks: ["0", "3", "5"], targetY: 150 },
        { values: [-3, -3], target: -20, ticks: ["-20", "1"], targetY: 270 },
    ])("frames metric values $values and target $target with unique ticks and a visible dashed target", ({ values, target, ticks, targetY }) => {
        const svg = buildSeriesSvg({
            ...series, kind: "metric", label: "Practice", unit: "sessions", target,
            points: series.points.map((point, index) => ({ ...point, value: values[index] })),
        })!;
        expect(svg).not.toMatch(/NaN|Infinity/);
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        const line = doc.querySelector("line[stroke-dasharray]")!;
        expect(line.getAttribute("aria-label")).toBe(`Target: ${target}`);
        expect(line.getAttribute("y1")).toBe(String(targetY));
        expect(line.getAttribute("y2")).toBe(String(targetY));
        expect(line.getAttribute("x1")).toBe("145");
        expect(line.getAttribute("x2")).toBe("935");
        expect(doc.documentElement.textContent).toContain("Target");
        expect([...doc.querySelectorAll('text[x="130"]')].map(text => text.textContent)).toEqual(ticks);
        for (const point of doc.querySelectorAll("circle")) {
            expect(Number(point.getAttribute("cy"))).toBeGreaterThanOrEqual(70);
            expect(Number(point.getAttribute("cy"))).toBeLessThanOrEqual(270);
        }
        // The target is drawn last so a constant data line cannot cover it.
        expect(svg.indexOf('stroke-dasharray')).toBeGreaterThan(svg.indexOf("</circle>"));
    });

    it("ignores nonfinite targets and scales extreme finite values without nonfinite coordinates", () => {
        for (const target of [NaN, Infinity, -Infinity]) {
            const svg = buildSeriesSvg({ ...series, kind: "metric", target })!;
            expect(svg).not.toMatch(/NaN|Infinity|stroke-dasharray/);
        }
        const svg = buildSeriesSvg({ ...series, kind: "metric", target: Number.MAX_VALUE,
            points: series.points.map((point, index) => ({ ...point, value: index ? Number.MAX_VALUE : -Number.MAX_VALUE })) })!;
        expect(svg).not.toMatch(/NaN|Infinity/);
        expect(svg).toContain('points="145,270 935,70"');
    });

    it("includes every point, date label, legible status axis and the numeric line", () => {
        const svg = buildSeriesSvg(series)!;
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        expect(doc.querySelector("parsererror")).toBeNull();
        expect(doc.querySelector("polyline")?.getAttribute("points")).toBe("145,270 935,70");
        expect(doc.querySelectorAll("circle")).toHaveLength(2);
        expect(doc.documentElement.textContent).toContain("BlockedAt riskOn track");
        expect(svg).toContain("2026-10-04: 0");
        expect(svg).toContain("2026-10-18: 2");
        expect(svg).toContain('fill="#ffffff"');
        expect(svg).toBe(buildSeriesSvg(series));
    });

    it.each([0, 1])("has no chart for %i points", count => {
        expect(buildSeriesSvg({ ...series, points: series.points.slice(0, count) })).toBeNull();
    });

    it("escapes SVG labels instead of interpreting markup", () => {
        const svg = buildSeriesSvg({ ...series, label: '<script>"&\'">', unit: "<&>" })!;
        expect(svg).toContain("&lt;script&gt;&quot;&amp;&apos;&quot;&gt;");
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
        expect(doc.querySelector("script")).toBeNull();
        expect(doc.querySelector("parsererror")).toBeNull();
    });

    it("handles a constant numeric series without nonfinite coordinates", () => {
        const svg = buildSeriesSvg({ ...series, kind: "metric", points: series.points.map(point => ({ ...point, value: -3 })) })!;
        expect(svg).toContain('points="145,270 935,270"');
        expect(svg).not.toMatch(/NaN|Infinity/);
    });

    it("rejects nonfinite points", () => {
        expect(() => buildSeriesSvg({ ...series, points: [...series.points, { periodStart: "2026-11-01", value: NaN }] })).toThrow("finite");
    });
});

describe("rasterizeSvgToPng browser boundary", () => {
    function imageStub() {
        const image = { onload: null as null | (() => void), onerror: null as null | (() => void), src: "" };
        vi.stubGlobal("Image", class { constructor() { return image; } });
        return image;
    }

    it("loads an SVG image and returns the canvas PNG data URL using stubs", async () => {
        const image = imageStub();
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,chart");
        const svg = buildSeriesSvg(series)!;
        const pending = rasterizeSvgToPng(svg);
        expect(image.src).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        image.onload!();
        await expect(pending).resolves.toBe("data:image/png;base64,chart");
        expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1000, 360);
        expect(encode).toHaveBeenCalledWith("image/png");
    });

    it("rejects image loading errors", async () => {
        const image = imageStub();
        const pending = rasterizeSvgToPng("<svg/>");
        image.onerror!();
        await expect(pending).rejects.toThrow("load");
    });

    it.each(["context", "encode", "empty"])("rejects a canvas %s failure", async failure => {
        const image = imageStub();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(failure === "context" ? null : { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
            if (failure === "encode") throw new Error("Canvas failed");
            return "data:,";
        });
        const pending = rasterizeSvgToPng("<svg/>");
        image.onload!();
        await expect(pending).rejects.toThrow();
    });
});
