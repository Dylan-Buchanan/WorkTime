import type { DeckSeries } from "./types";

const WIDTH = 1000;
const HEIGHT = 360;
const xml = (value: string): string => value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]!);

/** Pure numeric-series SVG. No DOM, clocks, external assets, or chart library. */
export function buildSeriesSvg(series: DeckSeries): string | null {
    if (series.points.length < 2) return null;
    if (series.points.some(point => !Number.isFinite(point.value))) {
        throw new RangeError("Chart values must be finite");
    }
    const values = series.points.map(point => point.value);
    const min = series.kind === "status" ? 0 : Math.min(...values);
    const max = series.kind === "status" ? 2 : Math.max(...values);
    const span = max - min || 1;
    const x = (index: number) => 145 + index / (values.length - 1) * 790;
    const y = (value: number) => 270 - (value - min) / span * 200;
    const ticks = series.kind === "status"
        ? [{ value: 0, label: "Blocked" }, { value: 1, label: "At risk" }, { value: 2, label: "On track" }]
        : [{ value: min, label: String(min) }, { value: max, label: String(max) }];
    const grid = ticks.map(tick => `<line x1="145" x2="935" y1="${y(tick.value)}" y2="${y(tick.value)}" stroke="#cbd5e1"/><text x="130" y="${y(tick.value) + 7}" text-anchor="end">${xml(tick.label)}</text>`).join("");
    const points = series.points.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="6" fill="#1d4ed8"><title>${xml(point.periodStart)}: ${point.value}</title></circle><text x="${x(index)}" y="315" text-anchor="middle" font-size="18">${xml(point.periodStart)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="Arial, sans-serif" font-size="22" fill="#1e293b"><text x="145" y="32">${xml(series.label)}${series.unit ? ` (${xml(series.unit)})` : ""}</text>${grid}<polyline points="${values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}" fill="none" stroke="#1d4ed8" stroke-width="4"/>${points}</g></svg>`;
}

/** Small browser-only boundary, separately stubbed by renderer tests. */
export function rasterizeSvgToPng(svg: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onerror = () => reject(new Error("Unable to load the progress chart"));
        image.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = WIDTH;
                canvas.height = HEIGHT;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Unable to render the progress chart");
                context.drawImage(image, 0, 0, WIDTH, HEIGHT);
                const png = canvas.toDataURL("image/png");
                if (!png.startsWith("data:image/png")) throw new Error("Unable to encode the progress chart");
                resolve(png);
            } catch (error) { reject(error); }
        };
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
}
