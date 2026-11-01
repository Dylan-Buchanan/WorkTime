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
