import type PptxGenJS from "pptxgenjs";
import { buildSeriesSvg, rasterizeSvgToPng } from "./chart";
import { sanitizeDownloadFileName } from "./delivery";
import { suggestedSecondsForSlide } from "./plan";
import type { DeckPlan, DeckRecapSlide, DeckSlide } from "./types";

const STATUS = { "on-track": "On track", "at-risk": "At risk", blocked: "Blocked" };
const STATUS_FILL = { "on-track": "DCFCE7", "at-risk": "FEF3C7", blocked: "FEE2E2" };
const TEXT = "1E293B";
const WIDTH = 13.333333;
type Slide = PptxGenJS.Slide;

function text(slide: Slide, copy: string, x: number, y: number, w: number, h: number, size = 22) {
    slide.addText(copy, {
        x, y, w, h, fontSize: size, fontFace: "Arial", color: TEXT,
        margin: 0, valign: "top", fit: "shrink",
    });
}

function bullets(slide: Slide, lines: string[], x = 0.65, y = 1.55, w = 12.03, h = 5.3) {
    if (lines.length === 0) return;
    slide.addText(lines.map(line => ({ text: line, options: { bullet: { indent: 22 }, breakLine: true } })), {
        x, y, w, h, fontFace: "Arial", fontSize: 24, color: TEXT,
        margin: 0, valign: "top", paraSpaceAfter: 16, fit: "shrink",
    });
}

const due = (date: string | null) => date ? ` (due ${date})` : "";
const named = (title: string, copy: string) => title ? `${title}: ${copy}` : copy;

function recap(slide: Slide, source: DeckRecapSlide) {
    text(slide, source.goalTitle, 0.65, 1.3, 12.03, 0.45, 24);
    slide.addText(STATUS[source.statusPill], {
        x: 0.65, y: 1.85, w: 2.15, h: 0.45, fontSize: 20, bold: true,
        fontFace: "Arial", color: TEXT, fill: { color: STATUS_FILL[source.statusPill] },
        margin: 5, align: "center",
    });
    const cues = [
        ...(source.achievedInPeriod ? ["Achieved this period"] : []),
        ...(source.slipBadge ? [`${source.slipCount} consecutive slips`] : []),
    ];
    text(slide, cues.join(" · "), 3.05, 1.85, 9.6, 0.5, 20);
    bullets(slide, [`Did: ${source.did}`, `Current: ${source.current}`], 0.65, 2.65, 5.7, 2.15);
    text(slide, "Planned", 6.95, 2.65, 5.7, 0.45, 24);
    bullets(slide, source.planned.map(item => item.text + due(item.dueDate)), 6.95, 3.2, 5.7, 1.6);
    const details = [
        ...(source.missReason ? [`Miss reason: ${source.missReason}`] : []),
        ...(source.metric ? [`${source.metric.label}: ${source.metric.current} / ${source.metric.target}${source.metric.unit ? ` ${source.metric.unit}` : ""}`] : []),
        ...(source.evidenceTaskTitles.length ? [`Evidence: ${source.evidenceTaskTitles.join("; ")}`] : []),
    ];
    bullets(slide, details, 0.65, 5.05, 12.03, 1.85);
}

async function renderSlide(slide: Slide, source: DeckSlide) {
    switch (source.kind) {
        case "title":
            text(slide, source.trackerName, 0.65, 1.8, 12.03, 0.75, 32);
            text(slide, source.purpose, 0.65, 2.95, 12.03, 1.6, 28);
            text(slide, `${source.periodLabel}\n${source.periodRangeLabel}`, 0.65, 5.3, 12.03, 1.1, 24);
            break;
        case "recap": recap(slide, source); break;
        case "misses":
            bullets(slide, source.items.length ? source.items.map(item =>
                `${named(item.goalTitle, item.text)}${due(item.dueDate)}\nReason: ${item.reason}`) : ["No missed plans recorded."]);
            break;
        case "next-plans":
            bullets(slide, source.items.length ? source.items.map(item =>
                named(item.goalTitle, item.text) + due(item.dueDate)) : ["No plans recorded."]);
            break;
        case "closing":
            bullets(slide, source.commitments.map(item => named(item.goalTitle, item.text)));
            break;
        case "appendix":
            bullets(slide, source.entries.map(entry => [
                `${entry.goalTitle} · ${STATUS[entry.statusPill]}`,
                ...(entry.slipCount >= 2 ? [`${entry.slipCount} consecutive slips`] : []),
                ...(entry.metricText !== null ? [entry.metricText] : []),
            ].join("\n")));
            break;
        case "progress": {
            const series = source.series.filter(item => item.points.length >= 2);
            if (!series.length) text(slide, "No status history is available yet.", 0.65, 1.55, 12.03, 0.8, 24);
            const columns = series.length === 1 ? 1 : 2;
            const rows = Math.ceil(series.length / columns);
            const cellW = 12.03 / columns;
            const cellH = 5.45 / rows;
            const headerH = Math.min(0.45, cellH * 0.25);
            const gap = Math.min(0.05, cellH * 0.05);
            for (const [index, item] of series.entries()) {
                const svg = buildSeriesSvg(item);
                if (svg === null) continue;
                const data = await rasterizeSvgToPng(svg);
                const x = 0.65 + (index % columns) * cellW;
                const y = 1.4 + Math.floor(index / columns) * cellH;
                text(slide, item.goalTitle, x, y, cellW - 0.2, headerH, 22);
                const w = Math.min(cellW - 0.2, (cellH - headerH - gap) * 1000 / 360);
                slide.addImage({ data, x, y: y + headerH + gap, w, h: w * 360 / 1000, altText: `${item.goalTitle}: ${item.label}` });
            }
            break;
        }
    }
}

export function deckFileName(plan: DeckPlan): string {
    return sanitizeDownloadFileName(`${plan.trackerName}-${plan.period.periodStart}.pptx`);
}

/** The library is loaded only when an export is requested. No file is retained. */
export async function renderDeck(plan: DeckPlan): Promise<{ blob: Blob; fileName: string }> {
    const { default: Pptx } = await import("pptxgenjs");
    const presentation = new Pptx();
    presentation.layout = "LAYOUT_WIDE";
    presentation.author = "WorkTime";
    presentation.title = plan.trackerName;
    presentation.subject = "Goals period review";
    for (const source of plan.slides) {
        if (source.isHidden || (source.kind === "recap" && source.placement === "appendix")) continue;
        const slide = presentation.addSlide();
        slide.background = { color: "FAFAF9" };
        text(slide, source.title, 0.65, 0.45, WIDTH - 1.3, 0.7, 36);
        await renderSlide(slide, source);
        slide.addNotes(`${source.notes}\n\nSuggested time: ${suggestedSecondsForSlide(source)} seconds.`);
    }
    const blob = await presentation.write({ outputType: "blob" });
    if (!(blob instanceof Blob)) throw new Error("The deck renderer did not produce a Blob");
    return { blob, fileName: deckFileName(plan) };
}
