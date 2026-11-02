import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGoalCheckInFixture, buildGoalFixture, buildGoalTrackerFixture } from "../testFixtures";
import { buildDeckPlan, suggestedSecondsForSlide } from "./plan";
import type { DeckPlan, DeckSeries, DeckSlide } from "./types";
import { deckFileName, renderDeck } from "./render";

const mock = vi.hoisted(() => ({
    slides: [] as Array<{ background?: unknown; addText: ReturnType<typeof vi.fn>; addImage: ReturnType<typeof vi.fn>; addNotes: ReturnType<typeof vi.fn> }>,
    presentation: null as null | { layout?: string; author?: string; title?: string; subject?: string; lang?: string },
    write: vi.fn(), rasterize: vi.fn(),
}));
vi.mock("pptxgenjs", () => ({ default: class {
    layout = "";
    constructor() { mock.presentation = this; }
    addSlide() {
        const slide = { addText: vi.fn(), addImage: vi.fn(), addNotes: vi.fn() };
        mock.slides.push(slide);
        return slide;
    }
    write = mock.write;
} }));
vi.mock("./chart", async importOriginal => ({
    ...await importOriginal<typeof import("./chart")>(), rasterizeSvgToPng: mock.rasterize,
}));

const series: DeckSeries = {
    goalId: "g1", goalTitle: "Edited trend", kind: "status", label: "Edited status label", unit: "",
    current: null, target: null,
    points: [{ periodStart: "2026-10-04", value: 0 }, { periodStart: "2026-10-18", value: 2 }],
};
function fixture(): DeckPlan {
    const base = buildDeckPlan({
        tracker: buildGoalTrackerFixture(), goals: [], checkIns: [],
        period: { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" },
        now: new Date("2026-11-01T12:00:00Z"),
    });
    const common = { notes: "Edited speaker notes", suggestedSeconds: 9999, isHidden: false };
    const slides: DeckSlide[] = [
        { ...common, id: "title", kind: "title", title: "Edited cover", trackerName: "Edited tracker", purpose: "Edited purpose", periodLabel: "Edited period", periodRangeLabel: "Edited range" },
        { ...common, id: "recap:g1", kind: "recap", title: "Edited recap", goalId: "g1", goalTitle: "Edited goal", placement: "body", statusPill: "at-risk", did: "Edited did", current: "Edited current", planned: [{ text: "Edited planned", dueDate: "2026-10-30" }], missReason: "Edited miss reason", metric: { label: "Sessions", current: 3, target: 8, unit: "visits", source: "manual", overridePinned: false }, habitStreak: null, slipBadge: true, slipCount: 2, achievedInPeriod: true, evidenceTaskTitles: ["Edited evidence"] },
        { ...common, id: "misses", kind: "misses", title: "Edited misses", items: [{ goalId: "g1", goalTitle: "Miss goal", text: "Edited miss", dueDate: "2026-10-17", reason: "Edited reason" }] },
        { ...common, id: "next-plans", kind: "next-plans", title: "Edited next", items: [{ goalId: "g1", goalTitle: "Plan goal", text: "Edited next plan", dueDate: "2026-11-14" }] },
        { ...common, id: "progress", kind: "progress", title: "Edited progress", series: [series, { ...series, goalId: "g2", points: series.points.slice(0, 1) }, { ...series, goalId: "g3", points: [] }, { ...series, goalId: "g4", goalTitle: "Second trend" }] },
        { ...common, id: "closing", kind: "closing", title: "Edited closing", commitments: [{ goalId: "g1", goalTitle: "Commitment goal", text: "Edited commitment" }] },
        { ...common, id: "appendix", kind: "appendix", title: "Edited appendix", entries: [{ goalId: "g5", goalTitle: "Retained edited roster", recapSlideId: "recap:g5", statusPill: "blocked", slipCount: 3, metricText: "Edited roster metric" }] },
    ];
    return { ...base, slides };
}

function habitPlan(count: number): DeckPlan {
    const tracker = buildGoalTrackerFixture();
    const goals = ["body", "roster"].map(id => buildGoalFixture({
        id, trackerId: tracker.id, title: `Practice ${id}`,
        metric: { label: "Practice", current: 9999, target: 3, unit: "sessions", source: "habit", habitId: "habit", overridePinned: false },
    }));
    return buildDeckPlan({
        tracker, goals, period: { periodStart: "2026-10-18", periodEnd: "2026-11-01", monthKey: "2026-10" },
        now: new Date(2026, 10, 2, 12),
        checkIns: goals.flatMap(goal => (["2026-10-04", "2026-10-18"] as const).map(periodStart => buildGoalCheckInFixture({
            id: `${goal.id}:${periodStart}`, goalId: goal.id, periodStart, isFocus: goal.id === "body",
        }))),
        habits: [{ id: "habit", name: "Practice", description: "", color: "", frequency: "daily", position: 0,
            isArchived: false, createdAt: tracker.createdAt, updatedAt: tracker.createdAt }],
        completions: [4, 5, 6, ...Array.from({ length: count }, (_, i) => 18 + i)].map(day => ({
            id: `day-${day}`, habitId: "habit", bucket: `2026-10-${String(day).padStart(2, "0")}`,
            createdAt: tracker.createdAt, updatedAt: tracker.createdAt,
        })),
    });
}
const copy = (index: number): string => mock.slides[index].addText.mock.calls.map(([value]) =>
    typeof value === "string" ? value : value.map((run: { text: string }) => run.text).join("\n")).join("\n");

beforeEach(() => {
    mock.slides.length = 0;
    mock.presentation = null;
    mock.write.mockReset().mockResolvedValue(new Blob(["pptx"]));
    mock.rasterize.mockReset().mockResolvedValue("data:image/png;base64,chart");
});

describe("renderDeck", () => {
    it.each([
        [2, "Practice: 2 / 3 sessions · short by 1"],
        [3, "Practice: 3 / 3 sessions"],
        [4, "Practice: 4 / 3 sessions · 1 over"],
    ])("renders derived phrasing for %i completions in recap details and appendix roster", async (count, expected) => {
        const plan = habitPlan(count);
        await renderDeck(plan);
        const rendered = plan.slides.filter(slide => !slide.isHidden && !(slide.kind === "recap" && slide.placement === "appendix"));
        const recapCopy = copy(rendered.findIndex(slide => slide.kind === "recap"));
        const appendixCopy = copy(rendered.findIndex(slide => slide.kind === "appendix"));
        expect(recapCopy).toContain(expected);
        expect(appendixCopy).toContain(expected);
        expect(recapCopy + appendixCopy).not.toContain("9999");
        if (count >= 3) expect(recapCopy).toContain("hit target 2 periods running");
        else expect(recapCopy).not.toContain("periods running");
    });

    it("rasterizes habit metric history with the target reference alongside status history", async () => {
        await renderDeck(habitPlan(4));
        expect(mock.rasterize).toHaveBeenCalledTimes(4);
        const svgs = mock.rasterize.mock.calls.map(([svg]) => svg as string);
        expect(svgs.filter(svg => svg.includes('stroke-dasharray'))).toHaveLength(2);
        expect(svgs[1]).toContain('aria-label="Target: 3"');
        expect(svgs[1]).toContain("Practice (sessions)");
        expect(svgs[1]).toContain("2026-10-18: 4");
        expect(svgs[0]).toContain("Blocked");
    });

    it.each([1, 2, 3])("only renders the hit cue when a streak of %i reaches two periods", async streak => {
        const plan = fixture();
        const recap = plan.slides[1];
        if (recap.kind !== "recap") throw new Error("Missing recap");
        recap.habitStreak = streak;
        await renderDeck(plan);
        if (streak >= 2) expect(copy(1)).toContain(`hit target ${streak} periods running`);
        else expect(copy(1)).not.toContain("periods running");
    });

    it("renders matching cover and recap names exactly once across text runs", async () => {
        const plan = fixture();
        plan.slides = plan.slides.map(slide => {
            if (slide.kind === "title") return { ...slide, title: slide.trackerName };
            if (slide.kind === "recap") return { ...slide, title: slide.goalTitle };
            return slide;
        });
        await renderDeck(plan);
        expect(copy(0).split("Edited tracker")).toHaveLength(2);
        expect(copy(1).split("Edited goal")).toHaveLength(2);
        expect(mock.slides[0].addText).toHaveBeenCalledWith("Edited tracker", expect.objectContaining({ y: 0.45, fontSize: 36 }));
        expect(mock.slides[1].addText).toHaveBeenCalledWith("Edited goal", expect.objectContaining({ y: 1.3, fontSize: 24 }));
    });

    it("preserves distinct edited cover and recap titles alongside their tracker and goal names", async () => {
        await renderDeck(fixture());
        for (const [index, title, name, heroY, heroSize] of [
            [0, "Edited cover", "Edited tracker", 1.8, 32],
            [1, "Edited recap", "Edited goal", 1.3, 24],
        ] as const) {
            expect(copy(index).split(title)).toHaveLength(2);
            expect(copy(index).split(name)).toHaveLength(2);
            expect(mock.slides[index].addText).toHaveBeenCalledWith(title, expect.objectContaining({ y: 0.45, fontSize: 36 }));
            expect(mock.slides[index].addText).toHaveBeenCalledWith(name, expect.objectContaining({ y: heroY, fontSize: heroSize }));
        }
    });

    it("maps all kinds in plan order into light, wide slides with editable text and current notes/seconds", async () => {
        const plan = fixture();
        const before = JSON.stringify(plan);
        const result = await renderDeck(plan);
        expect(result.blob).toBeInstanceOf(Blob);
        expect(mock.write).toHaveBeenCalledExactlyOnceWith({ outputType: "blob" });
        expect(mock.presentation?.layout).toBe("LAYOUT_WIDE");
        expect(mock.slides).toHaveLength(7);
        for (const [index, source] of plan.slides.entries()) {
            const slide = mock.slides[index];
            expect(slide.background).toEqual({ color: "FAFAF9" });
            expect(slide.addText.mock.calls[0][0]).toBe(source.title);
            expect(slide.addNotes).toHaveBeenCalledExactlyOnceWith(
                `${source.notes}\n\nSuggested time: ${suggestedSecondsForSlide(source)} seconds.`,
            );
            expect(slide.addNotes.mock.calls[0][0]).not.toContain("9999");
            for (const [value, options] of slide.addText.mock.calls) {
                expect(typeof value === "string" || Array.isArray(value)).toBe(true);
                expect(options.color).toBe("1E293B");
                expect(options.fontSize).toBeGreaterThanOrEqual(20);
            }
        }
        expect(copy(0)).toContain("Edited tracker\nEdited purpose\nEdited period\nEdited range");
        for (const content of ["Edited goal", "At risk", "Achieved this period", "2 consecutive slips", "Did: Edited did", "Current: Edited current", "Edited planned (due 2026-10-30)", "Miss reason: Edited miss reason", "Sessions: 3 / 8 visits", "Evidence: Edited evidence"]) expect(copy(1)).toContain(content);
        expect(copy(2)).toContain("Miss goal: Edited miss (due 2026-10-17)\nReason: Edited reason");
        expect(copy(3)).toContain("Plan goal: Edited next plan (due 2026-11-14)");
        expect(copy(5)).toContain("Commitment goal: Edited commitment");
        expect(copy(6)).toContain("Retained edited roster · Blocked\n3 consecutive slips\nEdited roster metric");
        const runs = mock.slides[3].addText.mock.calls[1][0];
        expect(runs[0]).toEqual({ text: "Plan goal: Edited next plan (due 2026-11-14)", options: { bullet: { indent: 22 }, breakLine: true } });
        expect(JSON.stringify(plan)).toBe(before);
    });

    it("renders exactly the visible set without reordering or rebuilding appendix copy", async () => {
        const plan = fixture();
        const recap = plan.slides[1];
        if (recap.kind !== "recap") throw new Error("Fixture recap missing");
        plan.slides.splice(2, 0,
            { ...recap, id: "hidden", title: "Hidden recap", isHidden: true },
            { ...recap, id: "appendix-recap", title: "Excluded recap", placement: "appendix" },
        );
        plan.slides.find(slide => slide.kind === "misses")!.isHidden = true;
        [plan.slides[0], plan.slides[1]] = [plan.slides[1], plan.slides[0]];
        await renderDeck(plan);
        expect(mock.slides.map(slide => slide.addText.mock.calls[0][0])).toEqual([
            "Edited recap", "Edited cover", "Edited next", "Edited progress", "Edited closing", "Edited appendix",
        ]);
        expect(copy(5)).toContain("Retained edited roster");
        expect(copy(5)).not.toContain("Edited goal");
    });

    it("embeds one PNG per series with at least two points, keeping goal titles editable", async () => {
        await renderDeck(fixture());
        expect(mock.rasterize).toHaveBeenCalledTimes(2);
        expect(mock.rasterize.mock.calls[0][0]).toContain("Edited status label");
        expect(mock.slides[4].addImage).toHaveBeenCalledTimes(2);
        expect(copy(4)).toContain("Edited trend");
        expect(copy(4)).toContain("Second trend");
        for (const [options] of mock.slides[4].addImage.mock.calls) {
            expect(options.data).toBe("data:image/png;base64,chart");
            expect(options.h / options.w).toBeCloseTo(360 / 1000);
        }
        expect(mock.slides.filter((_, index) => index !== 4).every(slide => !slide.addImage.mock.calls.length)).toBe(true);
    });

    it("keeps empty slides as editable honest placeholders and skips thin series", async () => {
        const plan = fixture();
        plan.slides = plan.slides.map(slide => {
            if (slide.kind === "progress") return { ...slide, series: [{ ...series, points: [] }] };
            if (slide.kind === "misses" || slide.kind === "next-plans") return { ...slide, items: [] };
            return slide;
        });
        await renderDeck(plan);
        expect(copy(2)).toContain("No missed plans recorded.");
        expect(copy(3)).toContain("No plans recorded.");
        expect(copy(4)).toContain("No status history is available yet.");
        expect(mock.rasterize).not.toHaveBeenCalled();
    });

    it("keeps every chart within the slide with positive dimensions for a large roster", async () => {
        const plan = fixture();
        plan.slides = plan.slides.map(slide => slide.kind === "progress" ? {
            ...slide,
            series: Array.from({ length: 32 }, (_, index) => ({ ...series, goalId: `goal-${index}` })),
        } : slide);
        await renderDeck(plan);
        expect(mock.slides[4].addImage).toHaveBeenCalledTimes(32);
        for (const [image] of mock.slides[4].addImage.mock.calls) {
            expect(image.w).toBeGreaterThan(0);
            expect(image.h).toBeGreaterThan(0);
            expect(image.x + image.w).toBeLessThanOrEqual(13.333333);
            expect(image.y + image.h).toBeLessThanOrEqual(7.5);
        }
    });

    it("propagates chart and library write failures without a partial export result", async () => {
        mock.rasterize.mockRejectedValueOnce(new Error("Raster failed"));
        await expect(renderDeck(fixture())).rejects.toThrow("Raster failed");
        expect(mock.write).not.toHaveBeenCalled();
        mock.write.mockRejectedValueOnce(new Error("Write failed"));
        await expect(renderDeck(fixture())).rejects.toThrow("Write failed");
    });

    it("rejects an unexpected library output", async () => {
        mock.write.mockResolvedValue("not a Blob");
        await expect(renderDeck(fixture())).rejects.toThrow("Blob");
    });
});

it("makes a sanitized pptx name from tracker copy and the exact built period key", () => {
    const plan = fixture();
    plan.trackerName = "Work/Team\\Review:\u0000";
    expect(deckFileName(plan)).toBe("Work-Team-Review---2026-10-18.pptx");
});

it("imports the library at runtime only with a function-local awaited dynamic import", () => {
    const source = readFileSync("src/lib/goals/deck/render.ts", "utf8");
    expect(source).not.toMatch(/^\s*import\s+(?!type\b)(?:[^;]*?\bfrom\s*)?["']pptxgenjs["']/m);
    expect(source).not.toMatch(/require\s*\(\s*["']pptxgenjs["']/);
    const functionStart = source.indexOf("export async function renderDeck(");
    expect(functionStart).toBeGreaterThan(0);
    expect(source.slice(0, functionStart)).not.toMatch(/import\s*\(\s*["']pptxgenjs["']/);
    expect(source.slice(functionStart)).toMatch(/await import\("pptxgenjs"\)/);
    expect(source.match(/import\("pptxgenjs"\)/g)).toHaveLength(1);
});
